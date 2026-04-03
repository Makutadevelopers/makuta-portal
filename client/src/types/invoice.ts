export interface Invoice {
  id: string;
  sl_no: number;
  month: string;
  invoice_date: string;
  vendor_id: string;
  vendor_name: string;
  invoice_no: string;
  po_number: string | null;
  purpose: string;
  site: string;
  invoice_amount: number;
  payment_status?: string;    // excluded for site role
  remarks: string | null;
  pushed: boolean;
  pushed_at: string | null;
  approved_by: string | null;
  minor_payment: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceData {
  month: string;
  invoice_date: string;
  vendor_id: string;
  vendor_name: string;
  invoice_no: string;
  po_number?: string | null;
  purpose: string;
  site: string;
  invoice_amount: number;
  remarks?: string | null;
}
