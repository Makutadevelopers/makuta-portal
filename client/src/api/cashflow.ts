import { apiFetch } from './client';
import { CashflowRow } from '../types/cashflow';

export function getCashflow(): Promise<CashflowRow[]> {
  return apiFetch<CashflowRow[]>('/cashflow');
}
