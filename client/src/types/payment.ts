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
  // server-side from invoice_amount × tds_pct / 100 and frozen at insert.
  tds_pct: number;
  tds_amount: number;
}

export interface CreatePaymentData {
  amount: number;
  payment_type: string;
  payment_ref?: string | null;
  payment_date: string;
  bank?: string | null;
  // Optional. Server defaults to 0. UI suggests 0–2%.
  tds_pct?: number;
}
