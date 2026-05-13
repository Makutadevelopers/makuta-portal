// cron.routes.ts
// Internal endpoints triggered by cron jobs / schedulers.
// Protected by a shared secret (CRON_SECRET env var) — not JWT.

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query } from '../db/query';
import {
  notifyOverdueDigest,
  getHoRecipients,
  getSiteAccountantRecipients,
} from '../services/email.service';
import { env } from '../config/env';

const router = Router();

// Shared-secret auth for cron endpoints. Uses a timing-safe comparison so a
// network-adjacent attacker can't byte-by-byte brute-force CRON_SECRET via
// response-time differences.
function verifyCronSecret(req: Request, res: Response): boolean {
  const secret = req.headers['x-cron-secret'];
  const expected = env.CRON_SECRET;
  if (!expected || typeof secret !== 'string') {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  const a = Buffer.from(secret);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// POST /api/cron/overdue-alert — weekly overdue digest.
// Site accountants get a digest scoped to their assigned sites; the Head
// Accountant (role='ho') gets the all-sites rollup. Restricted to invoices
// dated within the last 90 days so historical bulk-imports don't drown the
// signal.
router.post('/overdue-alert', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;

  try {
    const overdue = await query<{
      vendor_name: string;
      site: string;
      balance: number;
      days_past_due: number;
    }>(
      `SELECT
         i.vendor_name,
         i.site,
         i.invoice_amount - COALESCE(p.total_paid, 0) AS balance,
         (CURRENT_DATE - (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE) AS days_past_due
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN (
         SELECT invoice_id, SUM(amount) AS total_paid FROM payments GROUP BY invoice_id
       ) p ON p.invoice_id = i.id
       WHERE i.payment_status IN ('Not Paid', 'Partial')
         AND i.deleted_at IS NULL
         AND CURRENT_DATE > (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')::DATE
         AND i.invoice_amount - COALESCE(p.total_paid, 0) > 0
         AND i.invoice_date >= CURRENT_DATE - INTERVAL '90 days'
       ORDER BY days_past_due DESC`
    );

    if (overdue.length === 0) {
      res.json({ message: 'No overdue invoices in the last 90 days', sent: false, mailsSent: 0 });
      return;
    }

    const totalOverdue = overdue.reduce((s, r) => s + Number(r.balance), 0);

    // Group by site for per-site digests.
    const bySite = new Map<string, typeof overdue>();
    for (const row of overdue) {
      const list = bySite.get(row.site) ?? [];
      list.push(row);
      bySite.set(row.site, list);
    }

    let mailsSent = 0;
    const siteRecipientMap = await getSiteAccountantRecipients();

    for (const [site, rows] of bySite) {
      const recipients = siteRecipientMap.get(site) ?? [];
      if (recipients.length === 0) continue;
      const siteTotal = rows.reduce((s, r) => s + Number(r.balance), 0);
      await notifyOverdueDigest({
        scopeLabel: site,
        recipients,
        overdueCount: rows.length,
        totalOverdue: siteTotal,
        topVendors: rows.slice(0, 10).map(r => ({
          name: r.vendor_name,
          balance: Number(r.balance),
          daysPastDue: r.days_past_due,
        })),
      });
      mailsSent += 1;
    }

    // HO rollup — all sites, includes the site column.
    const hoRecipients = await getHoRecipients();
    if (hoRecipients.length > 0) {
      await notifyOverdueDigest({
        scopeLabel: 'All Sites',
        recipients: hoRecipients,
        overdueCount: overdue.length,
        totalOverdue,
        topVendors: overdue.slice(0, 15).map(r => ({
          name: r.vendor_name,
          site: r.site,
          balance: Number(r.balance),
          daysPastDue: r.days_past_due,
        })),
      });
      mailsSent += 1;
    }

    res.json({
      message: `Overdue digest sent — ${overdue.length} invoices, ₹${totalOverdue.toLocaleString('en-IN')} across ${bySite.size} site(s)`,
      sent: mailsSent > 0,
      mailsSent,
      overdueCount: overdue.length,
    });
  } catch (err) {
    console.error('[cron] overdue digest failed:', err);
    res.status(500).json({ error: 'Failed to send overdue digest' });
  }
});

export default router;
