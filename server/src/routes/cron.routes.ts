// cron.routes.ts
// Internal endpoints triggered by cron jobs / schedulers.
// Protected by a shared secret (CRON_SECRET env var) — not JWT.

import { Router, Request, Response } from 'express';
import { query } from '../db/query';
import { notifyOverdueAlert } from '../services/email.service';
import { env } from '../config/env';

const router = Router();

// Simple shared-secret auth for cron endpoints
function verifyCronSecret(req: Request, res: Response): boolean {
  const secret = req.headers['x-cron-secret'] as string | undefined;
  const expected = (env as Record<string, unknown>)['CRON_SECRET'] as string | undefined;
  if (!expected || !secret || secret !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// POST /api/cron/overdue-alert — sends daily overdue email to HO
router.post('/overdue-alert', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req, res)) return;

  try {
    const overdue = await query<{
      vendor_name: string;
      balance: number;
      days_past_due: number;
    }>(
      `SELECT
         i.vendor_name,
         i.invoice_amount - COALESCE(p.total_paid, 0) AS balance,
         EXTRACT(DAY FROM NOW() - (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day'))::INT AS days_past_due
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN (
         SELECT invoice_id, SUM(amount) AS total_paid FROM payments GROUP BY invoice_id
       ) p ON p.invoice_id = i.id
       WHERE i.payment_status IN ('Not Paid', 'Partial')
         AND i.deleted_at IS NULL
         AND NOW() > (i.invoice_date + COALESCE(v.payment_terms, 30) * INTERVAL '1 day')
         AND i.invoice_amount - COALESCE(p.total_paid, 0) > 0
       ORDER BY days_past_due DESC`
    );

    if (overdue.length === 0) {
      res.json({ message: 'No overdue invoices', sent: false });
      return;
    }

    const totalOverdue = overdue.reduce((s, r) => s + Number(r.balance), 0);
    const topVendors = overdue.slice(0, 10).map(r => ({
      name: r.vendor_name,
      balance: Number(r.balance),
      daysPastDue: r.days_past_due,
    }));

    await notifyOverdueAlert({
      overdueCount: overdue.length,
      totalOverdue,
      topVendors,
      hoEmail: 'rajesh@makuta.in',
    });

    res.json({
      message: `Overdue alert sent — ${overdue.length} invoices, ₹${totalOverdue.toLocaleString('en-IN')}`,
      sent: true,
      overdueCount: overdue.length,
    });
  } catch (err) {
    console.error('[cron] overdue-alert failed:', err);
    res.status(500).json({ error: 'Failed to send overdue alert' });
  }
});

export default router;
