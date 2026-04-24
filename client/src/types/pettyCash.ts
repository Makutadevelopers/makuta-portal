// types/pettyCash.ts — shared shape of petty-cash API responses.
// Amounts arrive as TEXT from the server to dodge JS number precision issues
// on NUMERIC(14,2); convert with Number() at render time.

export interface PettyCashBalance {
  site: string;
  total_in: string;
  total_out: string;
  balance: string;
  last_activity: string | null;
}

export interface PettyCashDisbursement {
  id: string;
  site: string;
  amount: string;
  given_on: string;
  given_by: string;
  given_by_name?: string;
  mode: 'cash' | 'bank';
  reference: string | null;
  remarks: string | null;
  created_at: string;
}

export interface PettyCashExpense {
  id: string;
  site: string;
  amount: string;
  spent_on: string;
  purpose: string;
  invoice_id: string | null;
  invoice_no?: string | null;
  payment_id: string | null;
  recorded_by: string;
  recorded_by_name?: string;
  remarks: string | null;
  created_at: string;
}

export interface PettyCashLedgerEntry {
  id: string;
  site: string;
  event_type: 'in' | 'out';
  amount: string;
  event_date: string;
  description: string;
  ref_id: string | null;
  by_name: string | null;
  created_at: string;
}

export interface CreateDisbursementData {
  site: string;
  amount: number;
  given_on: string;
  mode: 'cash' | 'bank';
  reference?: string | null;
  remarks?: string | null;
}

export interface CreateExpenseData {
  site: string;
  amount: number;
  spent_on: string;
  purpose: string;
  invoice_id?: string | null;
  remarks?: string | null;
}
