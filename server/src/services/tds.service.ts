// tds.service.ts
// TDS register — every tax deduction we have withheld, for audit / filing prep.
//
// Two independent deductions live on each payment row and are FROZEN at insert
// time (see migrations 027 and 050):
//   tds_amount     — income-tax TDS (194C contractors, typically 1–2%)
//   gst_tds_amount — GST-TDS (CGST+SGST, statutorily 2%)
// Both settle part of the invoice WITHOUT cash reaching the vendor — we remit
// them to the department on the vendor's behalf. Everywhere else in the app
// these columns are only ever read inside the settlement sum
// (amount + tds_amount + gst_tds_amount); this service is the one place that
// reports them as amounts in their own right.
//
// The register is keyed on payment_date (when the deduction was made), NOT
// invoice_date — a deduction belongs to the period we actually withheld it in,
// which is what a TDS return is filed on.

import { query } from '../db/query';

export interface TdsRow {
  payment_id: string;
  payment_date: string;
  vendor_name: string;
  gstin: string | null;
  invoice_id: string;
  invoice_no: string | null;
  invoice_date: string;
  site: string;
  invoice_amount: string;
  cash_amount: string;
  tds_pct: string;
  tds_amount: string;
  gst_tds_pct: string;
  gst_tds_amount: string;
  total_tds: string;
  payment_type: string;
  payment_ref: string | null;
  recorded_by_name: string | null;
}

export interface TdsVendorRow {
  vendor_name: string;
  gstin: string | null;
  deduction_count: number;
  income_tax_tds: number;
  gst_tds: number;
  total_tds: number;
}

export interface TdsTotals {
  incomeTaxTds: number;
  gstTds: number;
  totalTds: number;
  deductionCount: number;
  vendorCount: number;
  cashPaidOnThose: number;
}

export interface TdsRegister {
  rows: TdsRow[];
  byVendor: TdsVendorRow[];
  totals: TdsTotals;
}

export interface TdsFilters {
  from?: string;
  to?: string;
  site?: string;
  /** Hard role-scope cap. When provided it ALWAYS applies. undefined = no cap. */
  allowedSites?: string[];
}

function n(v: unknown): number {
  return Number(v) || 0;
}

/**
 * Fetch every payment that carried a deduction, newest first, plus a per-vendor
 * rollup and period totals.
 *
 * Only rows where at least one of the two deductions is non-zero are returned —
 * a plain cash payment is not a TDS event and would only dilute the register.
 */
export async function getTdsRegister(filters: TdsFilters = {}): Promise<TdsRegister> {
  const { from, to, site, allowedSites } = filters;

  const clauses: string[] = [];
  const params: (string | string[])[] = [];

  if (from) {
    params.push(from);
    clauses.push(`AND p.payment_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    clauses.push(`AND p.payment_date <= $${params.length}::date`);
  }
  if (site && site !== 'All') {
    params.push(site);
    clauses.push(`AND i.site = $${params.length}`);
  }
  if (allowedSites) {
    params.push(allowedSites);
    clauses.push(`AND i.site = ANY($${params.length})`);
  }

  const rows = await query<TdsRow>(
    `SELECT
       p.id                                        AS payment_id,
       TO_CHAR(p.payment_date, 'YYYY-MM-DD')       AS payment_date,
       i.vendor_name,
       v.gstin,
       i.id                                        AS invoice_id,
       i.invoice_no,
       TO_CHAR(i.invoice_date, 'YYYY-MM-DD')       AS invoice_date,
       i.site,
       i.invoice_amount::text                      AS invoice_amount,
       p.amount::text                              AS cash_amount,
       p.tds_pct::text                             AS tds_pct,
       p.tds_amount::text                          AS tds_amount,
       p.gst_tds_pct::text                         AS gst_tds_pct,
       p.gst_tds_amount::text                      AS gst_tds_amount,
       (p.tds_amount + p.gst_tds_amount)::text     AS total_tds,
       p.payment_type,
       p.payment_ref,
       u.name                                      AS recorded_by_name
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN vendors v ON v.id = i.vendor_id
     LEFT JOIN users u   ON u.id = p.recorded_by
     WHERE i.deleted_at IS NULL
       AND (p.tds_amount > 0 OR p.gst_tds_amount > 0)
     ${clauses.join('\n     ')}
     ORDER BY p.payment_date DESC, i.vendor_name ASC`,
    params
  );

  // Roll up in JS rather than a second round-trip — the register is already in
  // memory and a TDS period is at most a few hundred rows.
  const vendorMap = new Map<string, TdsVendorRow>();
  for (const r of rows) {
    const entry = vendorMap.get(r.vendor_name) ?? {
      vendor_name: r.vendor_name,
      gstin: r.gstin,
      deduction_count: 0,
      income_tax_tds: 0,
      gst_tds: 0,
      total_tds: 0,
    };
    entry.deduction_count++;
    entry.income_tax_tds += n(r.tds_amount);
    entry.gst_tds += n(r.gst_tds_amount);
    entry.total_tds += n(r.tds_amount) + n(r.gst_tds_amount);
    vendorMap.set(r.vendor_name, entry);
  }

  const byVendor = Array.from(vendorMap.values()).sort((a, b) => b.total_tds - a.total_tds);

  const incomeTaxTds = rows.reduce((s, r) => s + n(r.tds_amount), 0);
  const gstTds = rows.reduce((s, r) => s + n(r.gst_tds_amount), 0);

  return {
    rows,
    byVendor,
    totals: {
      incomeTaxTds,
      gstTds,
      totalTds: incomeTaxTds + gstTds,
      deductionCount: rows.length,
      vendorCount: vendorMap.size,
      cashPaidOnThose: rows.reduce((s, r) => s + n(r.cash_amount), 0),
    },
  };
}
