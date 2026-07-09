// email.service.ts
// Sends transactional emails. Silently skips if SMTP is not configured.

import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { query } from '../db/query';

const isConfigured = !!env.SMTP_HOST && !!env.SMTP_USER;

// Workflow notifications (invoice push, payment edit, invoice deletion, credit
// note allocation, weekly overdue digest) are paused per business request —
// only password-related emails are sent. Flip this to true to re-enable.
const WORKFLOW_EMAILS_ENABLED = false;

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
  if (!WORKFLOW_EMAILS_ENABLED) return;
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

// Human-readable role label + the numbered "what you can do" list shown in the
// welcome / temp-password email. Kept in sync with middleware/rbac.ts and the
// role briefing in CLAUDE.md.
function roleInfo(role: string): { label: string; scope: string; canDo: string[] } {
  switch (role) {
    case 'ho':
      return {
        label: 'Head Office (Head Accountant)',
        scope: 'All sites',
        canDo: [
          'Add, edit and finalize invoices for every site',
          'Record and edit payments of any amount (single, bulk & petty cash)',
          'Manage vendors, credit notes and bank reconciliation',
          'Run the executive dashboard, payment-aging and exports',
          'Manage users and view the full audit log',
        ],
      };
    case 'mgmt':
      return {
        label: 'Management (Managing Director)',
        scope: 'All sites — read only',
        canDo: [
          'View executive dashboards across all sites',
          'View payment aging and expenditure reports',
          'Read-only access — no data entry',
        ],
      };
    case 'project_manager':
      return {
        label: 'Project Manager',
        scope: 'Your assigned sites only — read only',
        canDo: [
          'View invoices, amounts and outstanding balances for your assigned sites',
          'View payment aging and expenditure for those sites',
          'Read-only access — no invoices, payments or edits',
        ],
      };
    case 'site':
    default:
      return {
        label: 'Site Accountant',
        scope: 'Your assigned site(s) only',
        canDo: [
          'Enter invoices for your site',
          'Record minor payments up to ₹50,000 (larger payments are Head Office only)',
          'Log petty-cash expenses against your site float',
          'View category / vendor expenditure and payment status for your site',
        ],
      };
  }
}

export async function notifyTempPassword(params: {
  name: string;
  email: string;
  role: string;
  sites?: string[];
  tempPassword: string;
}): Promise<boolean> {
  const info = roleInfo(params.role);
  const loginUrl = env.APP_URL;
  const sitesLine = params.sites && params.sites.length > 0
    ? params.sites.join(', ')
    : info.scope;
  const canDoList = info.canDo
    .map((c, i) => `<li style="margin:4px 0;"><strong>${i + 1}.</strong> ${c}</li>`)
    .join('');

  const row = (label: string, value: string) =>
    `<tr>
       <td style="padding:6px 12px 6px 0;color:#666;font-size:13px;vertical-align:top;white-space:nowrap;">${label}</td>
       <td style="padding:6px 0;font-size:13px;color:#111;font-weight:600;">${value}</td>
     </tr>`;

  return send({
    to: params.email,
    subject: 'Your Makuta Portal login details',
    html: `
      <h3 style="margin-bottom:4px;">Welcome to the Makuta Portal</h3>
      <p style="color:#555;font-size:13px;margin-top:0;">Invoice &amp; Payment Portal for Makuta Developers — where site invoices are entered, payments are processed and expenditure is tracked across all projects.</p>
      <p>Hi ${params.name},</p>
      <p>Your account is ready. Use the details below to sign in, then change your password from the <strong>"Change password"</strong> button at the top of the screen.</p>

      <table style="border-collapse:collapse;margin:14px 0;">
        ${row('Portal', 'Makuta Invoice &amp; Payment Portal')}
        ${row('Login link', `<a href="${loginUrl}" style="color:#1a3c5e;">${loginUrl}</a>`)}
        ${row('Your email (username)', params.email)}
        ${row('Temporary password', `<span style="font-family:monospace;letter-spacing:2px;background:#f3f4f6;padding:4px 10px;border-radius:6px;display:inline-block;">${params.tempPassword}</span>`)}
        ${row('Your role', info.label)}
        ${row('Access', sitesLine)}
      </table>

      <p style="margin-bottom:4px;font-weight:600;">What you can do as ${info.label}:</p>
      <ul style="padding-left:18px;margin-top:4px;color:#333;font-size:13px;">${canDoList}</ul>

      <p style="color:#666;font-size:12px;margin-top:16px;">For your security, change this temporary password as soon as you sign in. If you didn't request this, contact your manager immediately.</p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice &amp; Payment Portal</p>
    `,
  });
}

// Self-service password-reset OTP. The user types this code back into the
// portal and chooses their own new password — their current password is
// NOT changed until they verify the OTP.
export async function notifyResetOtp(params: {
  name: string;
  email: string;
  otp: string;
}): Promise<boolean> {
  return send({
    to: params.email,
    subject: 'Your Makuta password reset code',
    html: `
      <h3>Password reset code</h3>
      <p>Hi ${params.name},</p>
      <p>Use the 6-digit code below to set a new password on the Makuta portal. The code expires in 15 minutes.</p>
      <p style="font-size:28px;font-weight:bold;font-family:monospace;letter-spacing:8px;background:#f3f4f6;padding:14px 22px;border-radius:6px;display:inline-block;">${params.otp}</p>
      <p style="color:#666;font-size:12px;">If you didn't request a password reset, you can ignore this email — your password has not been changed.</p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}

export async function notifyPaymentEdited(params: {
  vendorName: string;
  invoiceNo: string;
  before: { amount: number; type: string; ref: string | null; date: string; bank: string | null };
  after:  { amount: number; type: string; ref: string | null; date: string; bank: string | null };
  editedBy: string;
}): Promise<void> {
  if (!WORKFLOW_EMAILS_ENABLED) return;
  const recipients = await getHoRecipients();
  if (recipients.length === 0) {
    console.log('[email] notifyPaymentEdited — no HO recipients configured, skipping');
    return;
  }
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const dash = (v: string | null | undefined) => v ?? '—';
  const row = (label: string, beforeV: string, afterV: string) => {
    const changed = beforeV !== afterV;
    return `<tr><td style="padding:4px 10px;color:#666;">${label}</td>
      <td style="padding:4px 10px;${changed ? 'color:#b45309;' : ''}">${beforeV}</td>
      <td style="padding:4px 10px;${changed ? 'color:#15803d;font-weight:600;' : ''}">${afterV}</td></tr>`;
  };
  await send({
    to: recipients.join(','),
    subject: `Payment edited — ${params.vendorName} #${params.invoiceNo}`,
    html: `
      <h3>Payment edited</h3>
      <p>${params.editedBy} edited a payment on invoice <strong>${params.vendorName} #${params.invoiceNo}</strong>.</p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:8px;">
        <tr style="background:#f3f4f6;"><th style="padding:6px 10px;text-align:left;">Field</th><th style="padding:6px 10px;text-align:left;">Before</th><th style="padding:6px 10px;text-align:left;">After</th></tr>
        ${row('Amount', inr(params.before.amount), inr(params.after.amount))}
        ${row('Type',   params.before.type,        params.after.type)}
        ${row('Ref',    dash(params.before.ref),   dash(params.after.ref))}
        ${row('Date',   params.before.date,        params.after.date)}
        ${row('Bank',   dash(params.before.bank),  dash(params.after.bank))}
      </table>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}

export async function notifyInvoiceDeleted(params: {
  vendorName: string;
  invoiceNo: string;
  amount: number;
  site: string;
  deletedBy: string;
  mode: 'bin' | 'permanent';
}): Promise<void> {
  if (!WORKFLOW_EMAILS_ENABLED) return;
  const recipients = await getHoRecipients();
  if (recipients.length === 0) {
    console.log('[email] notifyInvoiceDeleted — no HO recipients configured, skipping');
    return;
  }
  const verb = params.mode === 'permanent' ? 'Permanently deleted' : 'Moved to bin';
  const note = params.mode === 'permanent'
    ? 'This action is irreversible. All linked payments and attachments were also removed.'
    : 'The invoice can still be restored from Bin for 30 days.';
  await send({
    to: recipients.join(','),
    subject: `Invoice ${params.mode === 'permanent' ? 'permanently deleted' : 'moved to bin'} — ${params.vendorName} #${params.invoiceNo}`,
    html: `
      <h3>${verb}: ${params.vendorName} #${params.invoiceNo}</h3>
      <p><strong>${params.deletedBy}</strong> ${verb.toLowerCase()} invoice <strong>${params.vendorName} #${params.invoiceNo}</strong>.</p>
      <ul style="font-size:13px;">
        <li>Amount: ₹${params.amount.toLocaleString('en-IN')}</li>
        <li>Site: ${params.site}</li>
      </ul>
      <p style="color:#666;font-size:12px;">${note}</p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}

export async function notifyCreditNoteAllocated(params: {
  cnNo: string;
  vendorName: string;
  invoiceNo: string;
  amount: number;
  allocatedBy: string;
}): Promise<void> {
  if (!WORKFLOW_EMAILS_ENABLED) return;
  const recipients = await getHoRecipients();
  if (recipients.length === 0) {
    console.log('[email] notifyCreditNoteAllocated — no HO recipients configured, skipping');
    return;
  }
  await send({
    to: recipients.join(','),
    subject: `Credit note allocated — CN #${params.cnNo} → ${params.vendorName} #${params.invoiceNo}`,
    html: `
      <h3>Credit note allocated</h3>
      <p><strong>${params.allocatedBy}</strong> allocated <strong>₹${params.amount.toLocaleString('en-IN')}</strong> of credit note <strong>#${params.cnNo}</strong> against invoice <strong>${params.vendorName} #${params.invoiceNo}</strong>.</p>
      <p style="color:#666;font-size:12px;">The invoice's outstanding balance and Paid / Partial badge have been updated accordingly.</p>
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
  if (!WORKFLOW_EMAILS_ENABLED) return;
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
