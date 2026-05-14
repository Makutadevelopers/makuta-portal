// email.service.ts
// Sends transactional emails. Silently skips if SMTP is not configured.

import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { query } from '../db/query';

const isConfigured = !!env.SMTP_HOST && !!env.SMTP_USER;

const transporter = isConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  : null;

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function send(options: EmailOptions): Promise<boolean> {
  if (!transporter) {
    console.log(`[email] SMTP not configured — skipping: ${options.subject}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    console.log(`[email] Sent: ${options.subject} → ${options.to}`);
    return true;
  } catch (err) {
    console.error(`[email] Failed to send: ${options.subject}`, err);
    return false;
  }
}

// ── Recipient resolution ────────────────────────────────────────────────────
// The users table is the source of truth: any active HO user with an email is
// a recipient. HO_NOTIFY_TO is an *additive* env-driven CC list for addresses
// that aren't in users (e.g. an external accountant). Results are not cached
// so an email change in Employee Management takes effect on the next
// notification, not after a 5-minute TTL.

export async function getHoRecipients(): Promise<string[]> {
  let fromDb: string[] = [];
  try {
    const rows = await query<{ email: string }>(
      "SELECT email FROM users WHERE role = 'ho' AND is_active = true AND email IS NOT NULL"
    );
    fromDb = rows.map(r => r.email).filter(Boolean);
  } catch (err) {
    console.error('[email] failed to resolve HO recipients from DB:', err);
  }

  const fromEnv = env.HO_NOTIFY_TO.split(',').map(s => s.trim()).filter(Boolean);

  // Merge + case-insensitive dedupe; preserve insertion order (DB first).
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const e of [...fromDb, ...fromEnv]) {
    const key = e.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(e);
    }
  }
  return merged;
}

// Map of site_name → list of active site-accountant emails assigned to that
// site. Used for the per-site overdue digest.
export async function getSiteAccountantRecipients(): Promise<Map<string, string[]>> {
  try {
    const rows = await query<{ email: string; sites: string[] | null }>(
      "SELECT email, sites FROM users WHERE role = 'site' AND is_active = true AND email IS NOT NULL"
    );
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const sites = Array.isArray(r.sites) ? r.sites : [];
      for (const site of sites) {
        const list = map.get(site) ?? [];
        list.push(r.email);
        map.set(site, list);
      }
    }
    return map;
  } catch (err) {
    console.error('[email] failed to resolve site recipients from DB:', err);
    return new Map();
  }
}

// ── Notification templates ──────────────────────────────────────────────────

export async function notifyInvoicePushed(params: {
  vendorName: string;
  invoiceNo: string;
  amount: number;
  site: string;
}): Promise<void> {
  const recipients = await getHoRecipients();
  if (recipients.length === 0) {
    console.log('[email] notifyInvoicePushed — no HO recipients configured, skipping');
    return;
  }
  await send({
    to: recipients.join(','),
    subject: `Invoice #${params.invoiceNo} pushed to master — ${params.vendorName}`,
    html: `
      <h3>Invoice Approved & Pushed</h3>
      <p><strong>Vendor:</strong> ${params.vendorName}</p>
      <p><strong>Invoice:</strong> #${params.invoiceNo}</p>
      <p><strong>Amount:</strong> ₹${params.amount.toLocaleString('en-IN')}</p>
      <p><strong>Site:</strong> ${params.site}</p>
      <p>This invoice has been pushed to the master sheet and is now locked for editing.</p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}

export async function notifyPaymentRecorded(params: {
  vendorName: string;
  invoiceNo: string;
  paymentAmount: number;
  paymentType: string;
  balance: number;
}): Promise<void> {
  const recipients = await getHoRecipients();
  if (recipients.length === 0) {
    console.log('[email] notifyPaymentRecorded — no HO recipients configured, skipping');
    return;
  }
  const isPaid = params.balance <= 0;
  await send({
    to: recipients.join(','),
    subject: `${isPaid ? 'Full' : 'Part'} payment recorded — #${params.invoiceNo}`,
    html: `
      <h3>Payment Recorded</h3>
      <p><strong>Vendor:</strong> ${params.vendorName}</p>
      <p><strong>Invoice:</strong> #${params.invoiceNo}</p>
      <p><strong>Payment:</strong> ₹${params.paymentAmount.toLocaleString('en-IN')} via ${params.paymentType}</p>
      <p><strong>Remaining balance:</strong> ${isPaid ? 'Fully paid' : `₹${params.balance.toLocaleString('en-IN')}`}</p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}

export async function notifyTempPassword(params: {
  name: string;
  email: string;
  tempPassword: string;
}): Promise<boolean> {
  return send({
    to: params.email,
    subject: 'Your temporary Makuta Portal password',
    html: `
      <h3>Temporary password</h3>
      <p>Hi ${params.name},</p>
      <p>Your password has been reset. Sign in with the temporary password below, then change it from the "Change password" button at the top of the screen.</p>
      <p style="font-size:20px;font-weight:bold;font-family:monospace;letter-spacing:2px;background:#f3f4f6;padding:10px 14px;border-radius:6px;display:inline-block;">${params.tempPassword}</p>
      <p style="color:#666;font-size:12px;">If you didn't request this, contact your manager immediately.</p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}

export async function notifyPasswordReset(params: {
  name: string;
  email: string;
  resetUrl: string;
}): Promise<void> {
  await send({
    to: params.email,
    subject: 'Reset your Makuta Portal password',
    html: `
      <h3>Password reset request</h3>
      <p>Hi ${params.name},</p>
      <p>Click the link below to set a new password for the Makuta Accounting Module. This link expires in 30 minutes.</p>
      <p><a href="${params.resetUrl}" style="background:#1a3c5e;color:white;padding:8px 16px;border-radius:6px;text-decoration:none;display:inline-block;">Reset password</a></p>
      <p style="color:#666;font-size:12px;">If the button doesn't work, copy and paste this URL into your browser:<br>${params.resetUrl}</p>
      <p style="color:#666;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}

// Sends a weekly overdue digest to a single audience (one site's accountants,
// or HO with all-sites rollup). `scopeLabel` shows in the subject + heading;
// pass the site name for per-site mails, or "All Sites" for the HO rollup.
export async function notifyOverdueDigest(params: {
  scopeLabel: string;
  recipients: string[];
  overdueCount: number;
  totalOverdue: number;
  topVendors: Array<{ name: string; balance: number; daysPastDue: number; site?: string }>;
}): Promise<void> {
  if (params.recipients.length === 0) {
    console.log(`[email] notifyOverdueDigest (${params.scopeLabel}) — no recipients, skipping`);
    return;
  }
  if (params.overdueCount === 0) {
    console.log(`[email] notifyOverdueDigest (${params.scopeLabel}) — no overdue invoices, skipping`);
    return;
  }
  const showSiteCol = params.topVendors.some(v => v.site);
  const headerCells = showSiteCol
    ? '<th>Vendor</th><th>Site</th><th>Balance</th><th>Days Overdue</th>'
    : '<th>Vendor</th><th>Balance</th><th>Days Overdue</th>';
  const vendorRows = params.topVendors
    .map(v => {
      const siteCell = showSiteCol ? `<td>${v.site ?? ''}</td>` : '';
      return `<tr><td>${v.name}</td>${siteCell}<td style="text-align:right">₹${v.balance.toLocaleString('en-IN')}</td><td style="text-align:right">${v.daysPastDue}d</td></tr>`;
    })
    .join('');

  await send({
    to: params.recipients.join(','),
    subject: `Weekly Overdue Digest — ${params.scopeLabel}: ${params.overdueCount} invoices · ₹${params.totalOverdue.toLocaleString('en-IN')}`,
    html: `
      <h3>Weekly Overdue Digest — ${params.scopeLabel}</h3>
      <p><strong>${params.overdueCount}</strong> invoices are past their vendor due date, totalling <strong>₹${params.totalOverdue.toLocaleString('en-IN')}</strong>. Showing the top ${params.topVendors.length} by days overdue.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
        <tr style="background:#f3f4f6;">${headerCells}</tr>
        ${vendorRows}
      </table>
      <p style="margin-top:12px;"><a href="${env.APP_URL}/payment-aging">View Payment Aging →</a></p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal · Weekly digest, every Monday 9 AM IST</p>
    `,
  });
}
