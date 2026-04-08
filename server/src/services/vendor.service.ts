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

// ── Fuzzy vendor matching ──────────────────────────────────────────────────

export interface SimilarVendorMatch {
  id: string;
  name: string;
  similarity: 'exact' | 'similar';
}

const COMMON_SUFFIXES = [
  'pvt', 'ltd', 'limited', 'private', 'enterprises', 'traders', 'india',
];

function normalizeVendorName(raw: string): string {
  let name = raw.toLowerCase().trim();
  for (const suffix of COMMON_SUFFIXES) {
    // Remove suffix with optional preceding dot/space
    name = name.replace(new RegExp(`[\\s.]*\\b${suffix}\\b[\\s.]*`, 'g'), ' ');
  }
  return name.replace(/\s+/g, ' ').trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array.from({ length: n + 1 }, () => 0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

function charOverlapRatio(a: string, b: string): number {
  const charsA = new Map<string, number>();
  for (const c of a) charsA.set(c, (charsA.get(c) ?? 0) + 1);

  let shared = 0;
  for (const c of b) {
    const count = charsA.get(c) ?? 0;
    if (count > 0) {
      shared++;
      charsA.set(c, count - 1);
    }
  }
  const total = Math.max(a.length, b.length);
  return total === 0 ? 0 : shared / total;
}

export async function findSimilarVendors(inputName: string): Promise<SimilarVendorMatch[]> {
  const vendors = await getAllVendors();
  const results: SimilarVendorMatch[] = [];
  const inputLower = inputName.toLowerCase().trim();
  const inputNorm = normalizeVendorName(inputName);

  for (const v of vendors) {
    const vLower = v.name.toLowerCase().trim();
    const vNorm = normalizeVendorName(v.name);

    // Exact match (case-insensitive)
    if (vLower === inputLower) {
      results.push({ id: v.id, name: v.name, similarity: 'exact' });
      continue;
    }

    // Substring containment
    if (vLower.includes(inputLower) || inputLower.includes(vLower)) {
      results.push({ id: v.id, name: v.name, similarity: 'similar' });
      continue;
    }

    // Normalized Levenshtein distance <= 3
    const dist = levenshteinDistance(inputNorm, vNorm);
    if (dist <= 3) {
      results.push({ id: v.id, name: v.name, similarity: dist === 0 ? 'exact' : 'similar' });
      continue;
    }

    // Character overlap > 80%
    if (charOverlapRatio(inputNorm, vNorm) > 0.8) {
      results.push({ id: v.id, name: v.name, similarity: 'similar' });
    }
  }

  return results.slice(0, 5);
}

export interface DuplicatePair {
  vendorA: { id: string; name: string };
  vendorB: { id: string; name: string };
  reason: string;
}

export async function findAllDuplicatePairs(): Promise<DuplicatePair[]> {
  const vendors = await getAllVendors();
  const pairs: DuplicatePair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < vendors.length; i++) {
    for (let j = i + 1; j < vendors.length; j++) {
      const a = vendors[i];
      const b = vendors[j];
      const normA = normalizeVendorName(a.name);
      const normB = normalizeVendorName(b.name);

      const pairKey = [a.id, b.id].sort().join(':');
      if (seen.has(pairKey)) continue;

      // Normalized exact match
      if (normA === normB) {
        seen.add(pairKey);
        pairs.push({ vendorA: { id: a.id, name: a.name }, vendorB: { id: b.id, name: b.name }, reason: 'Same name (different capitalization/suffixes)' });
        continue;
      }

      // Levenshtein distance <= 2 on normalized names (stricter for bulk scan)
      const dist = levenshteinDistance(normA, normB);
      if (dist > 0 && dist <= 2) {
        seen.add(pairKey);
        pairs.push({ vendorA: { id: a.id, name: a.name }, vendorB: { id: b.id, name: b.name }, reason: `Spelling differs by ${dist} character${dist > 1 ? 's' : ''}` });
        continue;
      }

      // High character overlap on short normalized names (>85%)
      if (normA.length >= 5 && normB.length >= 5) {
        const overlap = charOverlapRatio(normA, normB);
        if (overlap > 0.85 && Math.abs(normA.length - normB.length) <= 3) {
          seen.add(pairKey);
          pairs.push({ vendorA: { id: a.id, name: a.name }, vendorB: { id: b.id, name: b.name }, reason: `${Math.round(overlap * 100)}% name similarity` });
        }
      }
    }
  }

  return pairs;
}

// ── Vendor merge ───────────────────────────────────────────────────────────

export interface MergeResult {
  keptVendor: VendorRow;
  repointedCount: number;
  removedName: string;
}

export async function mergeVendors(keepId: string, removeId: string): Promise<MergeResult | null> {
  const keepVendor = await getVendorById(keepId);
  const removeVendor = await getVendorById(removeId);

  if (!keepVendor || !removeVendor) return null;

  // Re-point invoices by vendor_id
  const byId = await query<{ id: string }>(
    'UPDATE invoices SET vendor_id = $1, updated_at = NOW() WHERE vendor_id = $2 RETURNING id',
    [keepId, removeId]
  );

  // Re-point invoices by vendor_name (catches unlinked rows matching the removed vendor).
  // IS DISTINCT FROM handles NULL vendor_id correctly (plain != would skip NULLs).
  const byName = await query<{ id: string }>(
    `UPDATE invoices SET vendor_name = $1, vendor_id = $2, updated_at = NOW()
     WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM($3)) AND vendor_id IS DISTINCT FROM $2
     RETURNING id`,
    [keepVendor.name, keepId, removeVendor.name]
  );

  // Delete the removed vendor
  await query('DELETE FROM vendors WHERE id = $1', [removeId]);

  // Unique count of re-pointed invoices
  const uniqueIds = new Set([...byId.map(r => r.id), ...byName.map(r => r.id)]);
  return {
    keptVendor: keepVendor,
    repointedCount: uniqueIds.size,
    removedName: removeVendor.name,
  };
}
