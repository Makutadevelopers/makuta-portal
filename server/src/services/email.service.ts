// email.service.ts
// Sends transactional emails. Silently skips if SMTP is not configured.

import nodemailer from 'nodemailer';
import { env } from '../config/env';

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

async function send(options: EmailOptions): Promise<void> {
  if (!transporter) {
    console.log(`[email] SMTP not configured — skipping: ${options.subject}`);
    return;
  }

  try {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    console.log(`[email] Sent: ${options.subject} → ${options.to}`);
  } catch (err) {
    console.error(`[email] Failed to send: ${options.subject}`, err);
  }
}

// ── Notification templates ──────────────────────────────────────────────────

export async function notifyInvoicePushed(params: {
  vendorName: string;
  invoiceNo: string;
  amount: number;
  site: string;
  hoEmail: string;
}): Promise<void> {
  await send({
    to: params.hoEmail,
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
  hoEmail: string;
}): Promise<void> {
  const isPaid = params.balance <= 0;
  await send({
    to: params.hoEmail,
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

export async function notifyOverdueAlert(params: {
  overdueCount: number;
  totalOverdue: number;
  topVendors: Array<{ name: string; balance: number; daysPastDue: number }>;
  hoEmail: string;
}): Promise<void> {
  const vendorRows = params.topVendors
    .map(v => `<tr><td>${v.name}</td><td style="text-align:right">₹${v.balance.toLocaleString('en-IN')}</td><td style="text-align:right">${v.daysPastDue}d</td></tr>`)
    .join('');

  await send({
    to: params.hoEmail,
    subject: `Overdue Alert: ${params.overdueCount} invoices · ₹${params.totalOverdue.toLocaleString('en-IN')}`,
    html: `
      <h3>Overdue Payment Alert</h3>
      <p><strong>${params.overdueCount}</strong> invoices are past their vendor due date, totalling <strong>₹${params.totalOverdue.toLocaleString('en-IN')}</strong>.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
        <tr style="background:#f3f4f6;"><th>Vendor</th><th>Balance</th><th>Days Overdue</th></tr>
        ${vendorRows}
      </table>
      <p style="margin-top:12px;"><a href="${env.NODE_ENV === 'production' ? 'https://invoices.makutadevelopers.com' : 'http://localhost:3000'}/payment-aging">View Payment Aging →</a></p>
      <hr><p style="color:#888;font-size:12px;">Makuta Developers — Invoice & Payment Portal</p>
    `,
  });
}
