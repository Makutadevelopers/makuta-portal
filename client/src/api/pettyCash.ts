import { apiFetch } from './client';
import {
  PettyCashBalance,
  PettyCashDisbursement,
  PettyCashExpense,
  PettyCashLedgerEntry,
  CreateDisbursementData,
  CreateExpenseData,
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

export function getLedger(site?: string): Promise<PettyCashLedgerEntry[]> {
  const q = site ? `?site=${encodeURIComponent(site)}` : '';
  return apiFetch<PettyCashLedgerEntry[]>(`/petty-cash/ledger${q}`);
}
