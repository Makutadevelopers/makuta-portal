export interface Vendor {
  id: string;
  name: string;
  payment_terms: number;
  category: string | null;
  gstin: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateVendorInput {
  name: string;
  payment_terms: number;
  category?: string | null;
  gstin?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export interface UpdateVendorInput extends Partial<CreateVendorInput> {}
