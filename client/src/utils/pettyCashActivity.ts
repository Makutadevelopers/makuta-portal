// Merges petty-cash disbursements + expenses into one chronological feed and
// applies the shared "month / custom range / all time" period filter used by
// both the HO drilldown and the site accountant's own-site ledger.

import { PettyCashDisbursement, PettyCashExpense } from '../types/pettyCash';

export type PettyCashActivityEntry =
  | { type: 'in'; date: string; row: PettyCashDisbursement }
  | { type: 'out'; date: string; row: PettyCashExpense };

export function mergePettyCashActivity(
  disbursements: PettyCashDisbursement[],
  expenses: PettyCashExpense[],
): PettyCashActivityEntry[] {
  const entries: PettyCashActivityEntry[] = [
    ...disbursements.map((row): PettyCashActivityEntry => ({ type: 'in', date: row.given_on, row })),
    ...expenses.map((row): PettyCashActivityEntry => ({ type: 'out', date: row.spent_on, row })),
  ];
  return entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.row.created_at < b.row.created_at ? 1 : -1;
  });
}

export type PeriodMode = 'all' | 'month' | 'range';

export interface PeriodFilter {
  mode: PeriodMode;
  month: string;  // 'YYYY-MM'
  from: string;   // 'YYYY-MM-DD'
  to: string;     // 'YYYY-MM-DD'
}

export const DEFAULT_PERIOD_FILTER: PeriodFilter = { mode: 'all', month: '', from: '', to: '' };

export function matchesPeriod(dateStr: string, filter: PeriodFilter): boolean {
  const date = dateStr.slice(0, 10);
  if (filter.mode === 'month') {
    return filter.month ? date.slice(0, 7) === filter.month : true;
  }
  if (filter.mode === 'range') {
    if (filter.from && date < filter.from) return false;
    if (filter.to && date > filter.to) return false;
    return true;
  }
  return true;
}
