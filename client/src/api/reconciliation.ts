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
  verified_at: string | null;
  verified_by: string | null;
  verified_by_name: string | null;
  allocations: BankTxnAllocation[];
}

export interface BulkPayAllocationInput {
  invoice_id: string;
  amount: number;
  // TDS % withheld for this invoice (0–10). Computed on base_amount server-side.
  tds_pct?: number;
  // GST-TDS % withheld for this invoice (0–10). Same pre-GST base as TDS.
  gst_tds_pct?: number;
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

export function updateBankTxnDate(id: string, txn_date: string): Promise<{
  id: string;
  txn_ref: string;
  txn_date: string;
  old_date: string;
  payments_updated: number;
}> {
  return apiFetch(`/reconciliation/${id}/date`, {
    method: 'PATCH',
    body: JSON.stringify({ txn_date }),
  });
}

export function verifyBankTxn(id: string, verified: boolean): Promise<{
  id: string;
  txn_ref: string;
  verified_at: string | null;
  verified_by: string | null;
}> {
  return apiFetch(`/reconciliation/${id}/verify`, {
    method: 'PATCH',
    body: JSON.stringify({ verified }),
  });
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
