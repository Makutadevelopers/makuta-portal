export type DisputeSeverity = 'minor' | 'major';

export interface Invoice {
  id: string;
  sl_no: number;
  internal_no: string | null;
  month: string;
  invoice_date: string;
  vendor_id: string;
  vendor_name: string;
  invoice_no: string;
  po_number: string | null;
  purpose: string;
  site: string;
  invoice_amount: number;
  base_amount: number | null;
  cgst_pct: number;
  sgst_pct: number;
  igst_pct: number;
  additional_charge: number;
  additional_charge_cgst_pct: number;
  additional_charge_sgst_pct: number;
  additional_charge_igst_pct: number;
  additional_charge_reason: string | null;
  disputed: boolean;
  dispute_severity: DisputeSeverity | null;
  dispute_reason: string | null;
  disputed_by: string | null;
  disputed_at: string | null;
  payment_status?: string;    // excluded for site role
  // Outstanding balance — invoice_amount minus sum of payments. Available
  // to all roles (site dashboards show "outstanding per project"). Aging
  // data (days_past_due, overdue, total_paid) remains HO+mgmt only.
  balance?: number | string;
  remarks: string | null;
  pushed: boolean;
  pushed_at: string | null;
  approved_by: string | null;
  minor_payment: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  attachment_count?: number;
  allocated_credits?: number;
  effective_payable?: number;
  // Date of the most recent payment (MAX over payments.payment_date).
  // Null when the invoice has no payments yet — i.e. Not Paid.
  last_paid_date?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

export interface CreateInvoiceData {
  month: string;
  invoice_date: string;
  vendor_id?: string;
  vendor_name: string;
  invoice_no: string;
  po_number?: string | null;
  purpose: string;
  site: string;
  invoice_amount: number;
  base_amount?: number;
  cgst_pct?: number;
  sgst_pct?: number;
  igst_pct?: number;
  additional_charge?: number;
  additional_charge_cgst_pct?: number;
  additional_charge_sgst_pct?: number;
  additional_charge_igst_pct?: number;
  additional_charge_reason?: string | null;
  remarks?: string | null;
}
