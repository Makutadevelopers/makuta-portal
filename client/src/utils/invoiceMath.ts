export interface InvoiceTotalInput {
  baseAmount: number;
  cgstPct: number;
  sgstPct: number;
  igstPct: number;
  addlChargeOn: boolean;
  addlCharge: number;
  addlGstOn: boolean;
  addlCgstPct: number;
  addlSgstPct: number;
  addlIgstPct: number;
}

export interface InvoiceTotalBreakdown {
  baseNum: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  addlChargeNum: number;
  addlCgstAmt: number;
  addlSgstAmt: number;
  addlIgstAmt: number;
  addlLineTotal: number;
  total: number;
}

// ── Multi line-item support ────────────────────────────────────────────────
// An invoice's extra charges can be several line items, each with its own GST.
// These helpers compute the primary (base + GST) line plus N extra items.

export interface LineItemDraft {
  description: string;
  amount: string;
  cgstPct: string;
  sgstPct: string;
  igstPct: string;
}

export interface LineItemComputed {
  amountNum: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  lineTotal: number;
}

export function makeLineItem(): LineItemDraft {
  return { description: '', amount: '', cgstPct: '', sgstPct: '', igstPct: '' };
}

export function computeLineItem(li: LineItemDraft): LineItemComputed {
  const amountNum = Number(li.amount) || 0;
  const cgstAmt = +(amountNum * (Number(li.cgstPct) || 0) / 100).toFixed(2);
  const sgstAmt = +(amountNum * (Number(li.sgstPct) || 0) / 100).toFixed(2);
  const igstAmt = +(amountNum * (Number(li.igstPct) || 0) / 100).toFixed(2);
  const lineTotal = +(amountNum + cgstAmt + sgstAmt + igstAmt).toFixed(2);
  return { amountNum, cgstAmt, sgstAmt, igstAmt, lineTotal };
}

export interface InvoiceTotalWithItemsInput {
  baseAmount: number | string;
  cgstPct: number | string;
  sgstPct: number | string;
  igstPct: number | string;
  items: LineItemDraft[];
}

export interface InvoiceTotalWithItemsBreakdown {
  baseNum: number;
  cgstAmt: number;
  sgstAmt: number;
  igstAmt: number;
  itemsBase: number;   // Σ pre-GST item amounts
  itemsTotal: number;  // Σ (item + item GST)
  total: number;
}

export function computeInvoiceTotalWithItems(i: InvoiceTotalWithItemsInput): InvoiceTotalWithItemsBreakdown {
  const baseNum = Number(i.baseAmount) || 0;
  const cgstAmt = +(baseNum * (Number(i.cgstPct) || 0) / 100).toFixed(2);
  const sgstAmt = +(baseNum * (Number(i.sgstPct) || 0) / 100).toFixed(2);
  const igstAmt = +(baseNum * (Number(i.igstPct) || 0) / 100).toFixed(2);
  const itemsBase = +i.items.reduce((s, li) => s + (Number(li.amount) || 0), 0).toFixed(2);
  const itemsTotal = +i.items.reduce((s, li) => s + computeLineItem(li).lineTotal, 0).toFixed(2);
  const total = +(baseNum + cgstAmt + sgstAmt + igstAmt + itemsTotal).toFixed(2);
  return { baseNum, cgstAmt, sgstAmt, igstAmt, itemsBase, itemsTotal, total };
}

export function computeInvoiceTotal(i: InvoiceTotalInput): InvoiceTotalBreakdown {
  const baseNum = Number(i.baseAmount) || 0;
  const cgstNum = Number(i.cgstPct) || 0;
  const sgstNum = Number(i.sgstPct) || 0;
  const igstNum = Number(i.igstPct) || 0;
  const cgstAmt = +(baseNum * cgstNum / 100).toFixed(2);
  const sgstAmt = +(baseNum * sgstNum / 100).toFixed(2);
  const igstAmt = +(baseNum * igstNum / 100).toFixed(2);
  const addlChargeNum = i.addlChargeOn ? (Number(i.addlCharge) || 0) : 0;
  const addlCgstNum = i.addlChargeOn && i.addlGstOn ? (Number(i.addlCgstPct) || 0) : 0;
  const addlSgstNum = i.addlChargeOn && i.addlGstOn ? (Number(i.addlSgstPct) || 0) : 0;
  const addlIgstNum = i.addlChargeOn && i.addlGstOn ? (Number(i.addlIgstPct) || 0) : 0;
  const addlCgstAmt = +(addlChargeNum * addlCgstNum / 100).toFixed(2);
  const addlSgstAmt = +(addlChargeNum * addlSgstNum / 100).toFixed(2);
  const addlIgstAmt = +(addlChargeNum * addlIgstNum / 100).toFixed(2);
  const addlLineTotal = +(addlChargeNum + addlCgstAmt + addlSgstAmt + addlIgstAmt).toFixed(2);
  const total = +(baseNum + cgstAmt + sgstAmt + igstAmt + addlLineTotal).toFixed(2);
  return {
    baseNum, cgstAmt, sgstAmt, igstAmt,
    addlChargeNum, addlCgstAmt, addlSgstAmt, addlIgstAmt,
    addlLineTotal, total,
  };
}
