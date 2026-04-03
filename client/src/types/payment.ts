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
}

export interface CreatePaymentData {
  amount: number;
  payment_type: string;
  payment_ref?: string | null;
  payment_date: string;
  bank?: string | null;
}
