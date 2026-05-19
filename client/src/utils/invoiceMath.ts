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
