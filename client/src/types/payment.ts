export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_type: string;
  payment_ref: string | null;
  payment_date: string;
  bank: string | null;
  recorded_by: string | null;
  created_at: string;
  // TDS deducted at source on this payment row. `tds_amount` is computed
  // server-side from base_amount × tds_pct / 100 and frozen at insert.
  tds_pct: number;
  tds_amount: number;
  // GST-TDS withheld under GST law, computed on the same pre-GST base and
  // frozen server-side. Settles the invoice alongside cash + TDS.
  gst_tds_pct: number;
  gst_tds_amount: number;
}

export interface CreatePaymentData {
  amount: number;
  payment_type: string;
  payment_ref?: string | null;
  payment_date: string;
  bank?: string | null;
  // Optional. Server defaults to 0. UI suggests 0–2%.
  tds_pct?: number;
  // Optional GST-TDS %. Server defaults to 0; statutory rate is 2%.
  gst_tds_pct?: number;
}
