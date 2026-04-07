// tally.controller.ts
// GET /api/tally/vouchers?from=YYYY-MM-DD&to=YYYY-MM-DD
// Exports payment vouchers in Tally-compatible XML format.
// One-way sync: Makuta → Tally (no write-back).

import { Request, Response, NextFunction } from 'express';
import { query } from '../db/query';

interface VoucherRow {
  payment_id: string;
  payment_date: string;
  amount: number;
  payment_type: string;
  payment_ref: string | null;
  bank: string | null;
  vendor_name: string;
  invoice_no: string;
  site: string;
  purpose: string;
}

export async function getTallyVouchers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const from = (req.query.from as string) || '2000-01-01';
    const to = (req.query.to as string) || '2099-12-31';

    const vouchers = await query<VoucherRow>(
      `SELECT
         p.id AS payment_id,
         p.payment_date,
         p.amount,
         p.payment_type,
         p.payment_ref,
         p.bank,
         i.vendor_name,
         i.invoice_no,
         i.site,
         i.purpose
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.payment_date BETWEEN $1 AND $2
       ORDER BY p.payment_date`,
      [from, to]
    );

    const format = req.query.format as string;

    if (format === 'json') {
      res.json(vouchers);
      return;
    }

    // Default: Tally XML format
    const xmlVouchers = vouchers.map(v => `
    <VOUCHER VCHTYPE="Payment" ACTION="Create">
      <DATE>${new Date(v.payment_date).toISOString().split('T')[0].replace(/-/g, '')}</DATE>
      <VOUCHERNUMBER>${v.payment_ref || v.payment_id}</VOUCHERNUMBER>
      <NARRATION>Payment to ${escapeXml(v.vendor_name)} for Inv #${escapeXml(v.invoice_no)} - ${escapeXml(v.site)} ${escapeXml(v.purpose)}</NARRATION>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeXml(v.vendor_name)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <AMOUNT>-${Number(v.amount).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${escapeXml(v.bank || 'Cash')}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <AMOUNT>${Number(v.amount).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
${xmlVouchers}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="tally-vouchers-${from}-to-${to}.xml"`);
    res.send(xml);
  } catch (err) {
    next(err);
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
