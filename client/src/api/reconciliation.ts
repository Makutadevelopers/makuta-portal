import { apiFetch } from './client';

export interface BankTxnAllocation {
  payment_id: string;
  invoice_id: string;
  invoice_no: string;
  vendor_name: string;
  site: string;
  invoice_amount: number;
  allocated_amount: number;
  payment_status: string;
}

export interface BankReconciliationRow {
  id: string;
  txn_type: string;
  txn_ref: string;
  txn_amount: number;
  txn_date: string;
  bank: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  allocated_total: number;
  allocation_count: number;
  balance: number;
  tally_ok: boolean;
  allocations: BankTxnAllocation[];
}

export interface BulkPayAllocationInput {
  invoice_id: string;
  amount: number;
}

export interface BulkPayInput {
  txn_type: string;
  txn_ref: string;
  txn_amount: number;
  txn_date: string;
  bank?: string | null;
  remarks?: string | null;
  allocations: BulkPayAllocationInput[];
}

export function getBankReconciliation(): Promise<BankReconciliationRow[]> {
  return apiFetch<BankReconciliationRow[]>('/reconciliation');
}

export function bulkPayInvoices(data: BulkPayInput): Promise<{
  txn: { id: string; txn_ref: string; txn_amount: number };
  allocations: { invoice_id: string; amount: number; invoice_no: string }[];
}> {
  return apiFetch('/reconciliation/bulk-pay', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
