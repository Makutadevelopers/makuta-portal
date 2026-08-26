import { apiFetch } from './client';
import {
  PettyCashBalance,
  PettyCashDisbursement,
  PettyCashExpense,
  PettyCashLedgerEntry,
  CreateDisbursementData,
  CreateExpenseData,
  UpdateDisbursementData,
  UpdateExpenseData,
} from '../types/pettyCash';

export function getAllBalances(): Promise<PettyCashBalance[]> {
  return apiFetch<PettyCashBalance[]>('/petty-cash/balances');
}

export function getSiteBalance(site: string): Promise<PettyCashBalance> {
  return apiFetch<PettyCashBalance>(`/petty-cash/balances/${encodeURIComponent(site)}`);
}

export function listDisbursements(site?: string): Promise<PettyCashDisbursement[]> {
  const q = site ? `?site=${encodeURIComponent(site)}` : '';
  return apiFetch<PettyCashDisbursement[]>(`/petty-cash/disbursements${q}`);
}

export function createDisbursement(data: CreateDisbursementData): Promise<PettyCashDisbursement> {
  return apiFetch<PettyCashDisbursement>('/petty-cash/disbursements', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listExpenses(site?: string): Promise<PettyCashExpense[]> {
  const q = site ? `?site=${encodeURIComponent(site)}` : '';
  return apiFetch<PettyCashExpense[]>(`/petty-cash/expenses${q}`);
}

export function createExpense(data: CreateExpenseData): Promise<PettyCashExpense> {
  return apiFetch<PettyCashExpense>('/petty-cash/expenses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateDisbursement(id: string, data: UpdateDisbursementData): Promise<PettyCashDisbursement> {
  return apiFetch<PettyCashDisbursement>(`/petty-cash/disbursements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteDisbursement(id: string, reason: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/petty-cash/disbursements/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

export function updateExpense(id: string, data: UpdateExpenseData): Promise<PettyCashExpense> {
  return apiFetch<PettyCashExpense>(`/petty-cash/expenses/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteExpense(id: string, reason: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(`/petty-cash/expenses/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason }),
  });
}

export function getLedger(site?: string): Promise<PettyCashLedgerEntry[]> {
  const q = site ? `?site=${encodeURIComponent(site)}` : '';
  return apiFetch<PettyCashLedgerEntry[]>(`/petty-cash/ledger${q}`);
}
