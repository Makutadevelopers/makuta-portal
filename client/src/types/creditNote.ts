export interface CreditNoteAllocation {
  id: string;
  credit_note_id: string;
  invoice_id: string;
  allocated_amount: number;
  allocated_by: string | null;
  allocated_at: string;
  // Joined invoice fields (populated by loadAllocations on the server)
  invoice_no: string | null;
  invoice_date: string;
  invoice_amount: number;
}

export interface CreditNote {
  id: string;
  cn_no: string;
  cn_date: string;
  vendor_id: string;
  vendor_name: string;
  site: string;
  base_amount: number;
  cgst_pct: number;
  sgst_pct: number;
  igst_pct: number;
  total_amount: number;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
  allocations: CreditNoteAllocation[];
  unallocated_balance: number;
}

export interface CreateCreditNoteData {
  cn_no: string;
  cn_date: string;
  vendor_id: string;
  vendor_name: string;
  site: string;
  base_amount: number;
  cgst_pct?: number;
  sgst_pct?: number;
  igst_pct?: number;
  total_amount: number;
  remarks?: string | null;
  allocations?: { invoice_id: string; allocated_amount: number }[];
}

export interface VendorCreditBalance {
  total_credit: number;
  allocated: number;
  unallocated_balance: number;
}

export interface InvoiceCreditSuggestions {
  available_credits: {
    id: string;
    cn_no: string;
    cn_date: string;
    total_amount: number;
    unallocated_balance: number;
  }[];
  unallocated_balance: number;
  invoice_effective_payable: number;
}
