// Shared helpers for the invoice/vendor list search bars.
//
// The search input on these pages doubles as an amount lookup — typing "4564"
// should find rows where the vendor name, invoice no, PO no, OR the raw
// invoice amount contains those digits. Pasted amounts like "₹4,564" are
// normalised so the currency formatting doesn't break the match.

import type { ReactNode } from 'react';

// Strip ₹ and thousands-separators, lower-case, trim.
export function normaliseSearch(q: string): string {
  return q.toLowerCase().replace(/[₹,]/g, '').trim();
}

// True when the numeric amount (as a plain digit string) contains the query.
// Used to flag the amount cell so we can paint it yellow.
export function amountMatchesSearch(amount: number, query: string): boolean {
  const q = normaliseSearch(query);
  if (!q) return false;
  return Number.isFinite(amount) && amount.toString().includes(q);
}

// Wrap the first case-insensitive occurrence of `query` inside `text` in a
// <mark>. Returns the raw text untouched when there's no query or no match.
export function highlight(text: string | null | undefined, query: string): ReactNode {
  if (text == null || text === '') return text ?? '';
  const q = normaliseSearch(query);
  if (!q) return text;
  const s = String(text);
  const idx = s.toLowerCase().indexOf(q);
  if (idx === -1) return s;
  return (
    <>
      {s.slice(0, idx)}
      <mark className="bg-yellow-200 text-gray-900 rounded px-0.5">
        {s.slice(idx, idx + q.length)}
      </mark>
      {s.slice(idx + q.length)}
    </>
  );
}
