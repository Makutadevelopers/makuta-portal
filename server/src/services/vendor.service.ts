// vendor.service.ts
// Business logic for vendor CRUD. All SQL lives here.

import { query, queryOne } from '../db/query';

export interface VendorRow {
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

export interface UpdateVendorInput {
  name?: string;
  payment_terms?: number;
  category?: string | null;
  gstin?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export async function getAllVendors(): Promise<VendorRow[]> {
  return query<VendorRow>('SELECT * FROM vendors ORDER BY name');
}

export async function getVendorById(id: string): Promise<VendorRow | null> {
  return queryOne<VendorRow>('SELECT * FROM vendors WHERE id = $1', [id]);
}

export async function getVendorByName(name: string): Promise<VendorRow | null> {
  return queryOne<VendorRow>(
    'SELECT * FROM vendors WHERE LOWER(name) = LOWER($1)',
    [name]
  );
}

export async function getVendorTerms(name: string): Promise<number> {
  const vendor = await queryOne<Pick<VendorRow, 'payment_terms'>>(
    'SELECT payment_terms FROM vendors WHERE LOWER(name) = LOWER($1)',
    [name]
  );
  return vendor?.payment_terms ?? 30;
}

export async function createVendor(
  data: CreateVendorInput,
  userId: string
): Promise<VendorRow> {
  const vendor = await queryOne<VendorRow>(
    `INSERT INTO vendors (name, payment_terms, category, gstin, contact_name, phone, email, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.name,
      data.payment_terms,
      data.category ?? null,
      data.gstin ?? null,
      data.contact_name ?? null,
      data.phone ?? null,
      data.email ?? null,
      data.notes ?? null,
      userId,
    ]
  );
  return vendor!;
}

export async function updateVendor(
  id: string,
  data: UpdateVendorInput,
  _userId: string
): Promise<VendorRow | null> {
  const ALLOWED_FIELDS = [
    'name', 'payment_terms', 'category', 'gstin',
    'contact_name', 'phone', 'email', 'notes',
  ];

  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(data)) {
    if (value !== undefined && ALLOWED_FIELDS.includes(column)) {
      fields.push(`${column} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (fields.length === 0) {
    return null;
  }

  fields.push('updated_at = NOW()');
  values.push(id);

  return queryOne<VendorRow>(
    `UPDATE vendors
     SET ${fields.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );
}

export async function deleteVendor(id: string): Promise<VendorRow | null> {
  // Unlink invoices first (they'll default to 30-day terms in aging)
  await query('UPDATE invoices SET vendor_id = NULL WHERE vendor_id = $1', [id]);
  return queryOne<VendorRow>(
    'DELETE FROM vendors WHERE id = $1 RETURNING *',
    [id]
  );
}
