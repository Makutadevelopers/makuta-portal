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
  // Legacy — the Bulk Pay UI now sends gst_added_pct instead.
  gst_tds_pct?: number;
  // GST % ADDED at payment (0–28) — extra cash paid to the vendor on top of
  // the invoice, computed on the base after TDS. Settles nothing; forms part
  // of the cheque total.
  gst_added_pct?: number;
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

// Correct a mistyped cheque / transaction reference. The server also rewrites
// payment_ref on every linked payment so the invoice history stays in step.
export function updateBankTxnRef(id: string, txn_ref: string): Promise<{
  id: string;
  txn_ref: string;
  old_ref: string;
  payments_updated: number;
  unchanged: boolean;
}> {
  return apiFetch(`/reconciliation/${id}/ref`, {
    method: 'PATCH',
    body: JSON.stringify({ txn_ref }),
  });
}

// Reverse an entire cheque — deletes every payment under it, recomputes each
// invoice's status, and removes the bank transaction. Requires a reason.
export function revertBankTxn(id: string, reason: string): Promise<{
  txn_ref: string;
  txn_amount: number;
  reverted_payments: number;
  reverted_invoices: number;
  invoice_nos: string[];
}> {
  return apiFetch(`/reconciliation/${id}/revert`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
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
