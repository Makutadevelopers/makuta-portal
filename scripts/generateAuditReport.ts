/**
 * generateAuditReport.ts
 * One-off script: render the production-readiness audit as a PDF.
 * Run: cd server && npx tsx ../scripts/generateAuditReport.ts
 */

import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import { resolve } from 'path';

const OUT_PATH = resolve(process.cwd(), '../makuta-audit-report.pdf');

interface Finding {
  id: string;
  title: string;
  body: string;
}

interface Section {
  heading: string;
  color: string;
  findings: Finding[];
}

const sections: Section[] = [
  {
    heading: 'CRITICAL — Data correctness bugs',
    color: '#c0392b',
    findings: [
      {
        id: 'C1',
        title: 'Soft-delete filter missing in multiple queries',
        body:
          'Yesterday we fixed aging.service and cashflow.controller. Several other queries still ignore deleted_at:\n\n' +
          '- export.controller.ts:114 — SELECT * FROM invoices (PDF export). Exports include deleted invoices.\n' +
          '- export.controller.ts:189 — Cashflow export FROM invoices i. Same problem in PDF cashflow report.\n' +
          '- payment.controller.ts:53 — SELECT id, invoice_amount, site FROM invoices WHERE id = $1. A user can record a payment against a soft-deleted invoice.\n' +
          '- invoice.controller.ts:140 (updateInvoice) — A deleted invoice can be silently un-deleted via UPDATE.\n' +
          '- invoice.controller.ts:208 (pushInvoice) — Soft-deleted invoice can be finalized.\n' +
          '- invoice.controller.ts:248 (bulkPushInvoices) — Bulk-finalizes deleted ones too.\n' +
          '- invoice.controller.ts:404 (undoPushInvoice) — Same issue.',
      },
      {
        id: 'C2',
        title: 'RBAC violation — payments import allows site role',
        body:
          'import.routes.ts:18 mounts the entire /api/import/* router with requireRole([ho, site]). But the payments importer writes to the payments table — and CLAUDE.md says site accountants must NEVER see/touch payment data. A site accountant could bulk-import payments to invoices outside their site.',
      },
      {
        id: 'C3',
        title: 'Site role payment visibility check',
        body:
          'payment.routes.ts:16 restricts GET /api/payments to ho+mgmt. Defensible — but the site role then cannot see partial payments on their own invoice. Either expose a sanitized version or accept the limitation. Worth flagging.',
      },
      {
        id: 'C4',
        title: 'Race condition on payment overpayment',
        body:
          'payment.controller.ts:62-91 reads existing payments, then inserts. No transaction. Two simultaneous payment requests can both pass the >balance check and overpay an invoice. Wrap in BEGIN/COMMIT with SELECT ... FOR UPDATE on the invoice row.',
      },
      {
        id: 'C5',
        title: 'Audit log failure can break business operations',
        body:
          'audit.service.ts:14 — a failing audit insert (e.g. FK violation when invoice_id was just deleted) cascades and fails the parent action. Wrap audit logging in try/catch so audit failures never break business operations.',
      },
      {
        id: 'C6',
        title: 'Inconsistent permanent-delete order',
        body:
          'invoice.controller.ts:361-364 deletes payments → attachments → audit_logs → invoices. But import.controller.ts:567 clearImportedData was failing yesterday on audit_logs. Inconsistent. Add ON DELETE SET NULL (or CASCADE) to audit_logs.invoice_id and attachments.invoice_id in a new migration.',
      },
      {
        id: 'C7',
        title: 'purgeOldBinInvoices not in a transaction',
        body:
          'invoice.controller.ts:381-389 loops with separate DELETEs. If one fails halfway, partial purge. Wrap in BEGIN/COMMIT.',
      },
    ],
  },
  {
    heading: 'HIGH — Authorization & business-rule gaps',
    color: '#d35400',
    findings: [
      {
        id: 'H1',
        title: 'Site accountant can update an invoice site to escape boundary',
        body:
          'invoice.controller.ts:154 checks existing.site !== site (current site), but the request body new data.site is then written through. A site=Nirvana user can PATCH their invoice with {site: "Horizon"} and it succeeds. Fix: explicitly forbid data.site change for site role.',
      },
      {
        id: 'H2',
        title: 'Vendor merge has no audit of which invoices were re-pointed',
        body:
          'vendor.controller.ts:212 — only logs the merge, not the count of re-pointed invoices. Forensic gap.',
      },
      {
        id: 'H3',
        title: 'exportInvoices PDF endpoint has no per-site filtering',
        body:
          'Site accountants would get the same PDF as HO if exposed. Currently the export router requires ho+mgmt — verify this stays that way.',
      },
      {
        id: 'H4',
        title: 'createPayment for a finalized invoice — no check',
        body:
          'No check on invoice.pushed in payment.controller. CLAUDE.md does not explicitly forbid this, but typically payments against finalized invoices need stricter approval. Consider blocking site role from paying finalized invoices.',
      },
      {
        id: 'H5',
        title: 'Duplicate invoice creation only creates an alert — never blocks',
        body:
          'invoice.controller.ts:90-101 inserts an alert but proceeds with insert. Two copies of the same invoice get into the books. Should require explicit "yes I know it is a duplicate" confirmation or return 409.',
      },
      {
        id: 'H6',
        title: 'JWT expiry — 8h, but no refresh',
        body:
          'After 8h users get silent failures. Add either auto-logout UI prompt or token refresh endpoint.',
      },
    ],
  },
  {
    heading: 'MEDIUM — Validation & input safety',
    color: '#b58900',
    findings: [
      {
        id: 'M1',
        title: 'Invoice number nullability inconsistent',
        body:
          'invoice_no is required in zod but migration 010_allow_nullable_invoice_no.sql made the column nullable. Either enforce on backend or accept null end-to-end.',
      },
      {
        id: 'M2',
        title: 'createInvoiceSchema does not validate month is a date string',
        body:
          'invoice.controller.ts:15 — month: z.string().min(1). A user can post month: "banana" and PostgreSQL will throw a 500. Validate as YYYY-MM-DD.',
      },
      {
        id: 'M3',
        title: 'Date parser hard-codes Excel serial range',
        body:
          'import.controller parseDate (line 47) — Excel serials < 30000 (years before ~1982) silently fail.',
      },
      {
        id: 'M4',
        title: 'parseAmount accepts negatives',
        body:
          'parseFloat("-1000") is valid. Always validate amount > 0 in import script.',
      },
      {
        id: 'M5',
        title: 'Multer file filter does not handle .heic',
        body:
          '.heic (iPhone photos) and .svg (XSS risk) are unhandled. SVG is currently blocked, but iPhone users will be unable to upload photos.',
      },
      {
        id: 'M6',
        title: 'No max file count per request',
        body:
          'Multer has fileSize: 10MB but no files: N. A user could upload thousands of files in one request.',
      },
      {
        id: 'M7',
        title: 'XSS surfaces',
        body:
          'Frontend uses {att.file_name} and {vendor_name} directly — React escapes them. PDF export passes raw to pdfkit; verify pdfkit escapes too (it does).',
      },
      {
        id: 'M8',
        title: 'SQL injection',
        body:
          'All queries use parameterized $1, $2. Confirmed safe across all controllers.',
      },
      {
        id: 'M9',
        title: 'Vendor INSERT race in import',
        body:
          'INSERT INTO vendors ... ON CONFLICT (name) DO UPDATE SET name = vendors.name returns id only because of the no-op update. If two parallel imports race, both can call this. Acceptable but worth noting.',
      },
      {
        id: 'M10',
        title: 'Cron secret read at request time',
        body:
          'cron.routes.ts:15 — (env as Record<string, unknown>)[CRON_SECRET]. Bypasses the typed env config. If CRON_SECRET is not set in .env, the check fails closed (good). Document it in README.',
      },
    ],
  },
  {
    heading: 'LOW — UX & defensive coding',
    color: '#1f6feb',
    findings: [
      {
        id: 'L1',
        title: 'Toast/error swallowing in HO InvoiceList.handleSubmit',
        body:
          'On failure, sets error state but the form is inside an expandable row — error may be hidden if user scrolls. Add a toast as well.',
      },
      {
        id: 'L2',
        title: 'getAttachments URL token-append guarded',
        body:
          'client/src/api/attachments.ts appends ?token= only when att.url.startsWith(/api/). Safe — does not leak token to S3.',
      },
      {
        id: 'L3',
        title: 'Clear All Invoices nulls audit_logs.invoice_id',
        body:
          'Loses the link between audit history and the invoices that were cleared. Acceptable for "clear", but document it.',
      },
      {
        id: 'L4',
        title: 'ActionsMenu dropdown overflow on small screens',
        body:
          'Test on small screens — dropdown might be cut off. Has right-0, but consider portal rendering for safety.',
      },
      {
        id: 'L5',
        title: 'Dashboard Total Paid double-count risk',
        body:
          'useDashboardData.ts:120-125 — paidInvoiceTotal + agingPaidTotal. If aging endpoint ever changes to include Paid rows, this double-counts.',
      },
      {
        id: 'L6',
        title: 'Pending Days uses NOW() without timezone',
        body:
          'EXTRACT(DAY FROM NOW() - ...) depends on server timezone vs DATE storage. On boundary days at midnight, off-by-one in IST.',
      },
      {
        id: 'L7',
        title: 'INR formatting uses en-IN consistently — verified.',
        body: '',
      },
      {
        id: 'L8',
        title: 'Email service is fire-and-forget with .catch(() => {})',
        body: 'Silent failures. Log the error at minimum.',
      },
      {
        id: 'L9',
        title: 'Cashflow controller dimension switch is confusing',
        body:
          'When category selected, groupCol switches from i.purpose to i.vendor_name. Frontend label still says "Category" — confusing UX.',
      },
    ],
  },
];

const testScenarios = [
  {
    group: 'Soft-delete coverage',
    items: [
      'Create invoice → soft delete → verify it is NOT in dashboard, all-invoices, cashflow, payment-aging, exports, KPI cards, alerts.',
      'Soft delete an invoice with payments → verify payments still reference it → verify totals exclude it.',
      'Restore from bin → verify it reappears everywhere.',
      'Permanent delete → verify all FKs are cleaned up.',
      'Bin auto-purge after 30 days.',
    ],
  },
  {
    group: 'RBAC matrix (run for each role: ho, site, mgmt)',
    items: [
      'GET /api/invoices — site sees only own site, mgmt sees all read-only.',
      'POST /api/invoices — site only own site; mgmt forbidden.',
      'PATCH /api/invoices/:id with site field changed — should reject for site role.',
      'POST /api/invoices/:id/payments amount=49999 — site OK; amount=50001 — site forbidden.',
      'POST /api/import/payments as site — should be forbidden (currently allowed — bug C2).',
      'DELETE /api/invoices/:id as site — should be forbidden.',
      'GET /api/audit as mgmt or site — should be forbidden.',
    ],
  },
  {
    group: 'Concurrency',
    items: [
      'Two simultaneous payments equal to balance → second should fail (currently both succeed — bug C4).',
      'Two simultaneous edits to same invoice → last write wins (acceptable, but warn user).',
    ],
  },
  {
    group: 'Data validation',
    items: [
      'POST invoice with month: "banana" — should 400, currently 500 (bug M2).',
      'POST invoice with invoice_amount: -100 — zod blocks.',
      'Bulk import row with Indian comma format ("1,508,053") — should parse to 1508053.',
      'Upload .svg / .exe — should reject.',
      'Upload 100 files in one request — currently no limit (M6).',
    ],
  },
  {
    group: 'Edge cases',
    items: [
      'Vendor with payment_terms=0 — due date = invoice date, instantly overdue.',
      'Invoice with invoice_amount=0 — zod blocks.',
      'Pay full balance, then try add another ₹1 — should reject.',
      'Delete vendor that has invoices — should warn, not silently fail FK.',
      'Merge vendors A→B, then try to use A — should be gone.',
    ],
  },
  {
    group: 'File handling',
    items: [
      'Upload file → view in new tab → token expires (8h) → refresh tab → should get 401 cleanly.',
      'Upload, then permanently delete invoice → orphan files on disk (bug — disk files never cleaned up).',
      'Re-upload same filename → should not overwrite (timestamp prefix used).',
    ],
  },
];

const fixOrder = [
  'C1 — add deleted_at IS NULL to all 7 queries (breaks production reports right now).',
  'C2 — block site from /api/import/payments.',
  'H1 — block site role from changing data.site on update.',
  'C4 — wrap payment insert in transaction.',
  'C5 — wrap audit calls in try/catch.',
  'M2 — strict zod validation on date fields.',
  'C7, C6 — wrap bin purge in transaction; add CASCADE on FKs.',
  'H5 — block duplicate invoice creation by default.',
];

function render() {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(createWriteStream(OUT_PATH));

  // Header
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#1a3c5e').text('Makuta Portal');
  doc.fontSize(14).fillColor('#1a3c5e').text('Production Readiness Audit');
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#666').text(
    `Generated 2026-04-08  ·  Senior tester review  ·  Scope: backend correctness, RBAC, data integrity, validation, UX`
  );
  doc.moveDown(1);
  doc.strokeColor('#cccccc').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  // Executive summary
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text('Executive summary');
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#333');
  doc.text(
    'This audit identifies 7 critical, 6 high, 10 medium and 9 low findings across the Makuta invoice & payment portal. ' +
    'The most urgent issues are missing soft-delete filters in 7 backend queries (CRITICAL C1), an RBAC violation that lets site accountants ' +
    'bulk-import payments (C2), and a payment race condition that allows overpayment (C4). The recommended fix order is at the end of this report.'
  );
  doc.moveDown(1);

  // Findings sections
  for (const section of sections) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(13).font('Helvetica-Bold').fillColor(section.color).text(section.heading);
    doc.moveDown(0.4);

    for (const f of section.findings) {
      if (doc.y > 720) doc.addPage();
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000').text(`${f.id}. ${f.title}`);
      if (f.body) {
        doc.fontSize(9).font('Helvetica').fillColor('#333').text(f.body, { paragraphGap: 4 });
      }
      doc.moveDown(0.4);
    }
    doc.moveDown(0.6);
  }

  // Test scenarios
  doc.addPage();
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a3c5e').text('Test scenarios to run after fixes');
  doc.moveDown(0.5);

  for (const group of testScenarios) {
    if (doc.y > 720) doc.addPage();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#000').text(group.group);
    doc.moveDown(0.2);
    doc.fontSize(9).font('Helvetica').fillColor('#333');
    for (let i = 0; i < group.items.length; i++) {
      if (doc.y > 750) doc.addPage();
      doc.text(`${i + 1}. ${group.items[i]}`, { indent: 10, paragraphGap: 2 });
    }
    doc.moveDown(0.6);
  }

  // Fix order
  if (doc.y > 650) doc.addPage();
  doc.moveDown(0.5);
  doc.fontSize(13).font('Helvetica-Bold').fillColor('#1a3c5e').text('Recommended fix order');
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica').fillColor('#333');
  for (let i = 0; i < fixOrder.length; i++) {
    doc.text(`${i + 1}. ${fixOrder[i]}`, { indent: 10, paragraphGap: 3 });
  }

  doc.moveDown(1.5);
  doc.fontSize(8).fillColor('#888').text('— end of report —', { align: 'center' });

  doc.end();
  console.log(`PDF written to ${OUT_PATH}`);
}

render();
