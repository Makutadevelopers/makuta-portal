// vendor.service.ts
// Business logic for vendor CRUD. All SQL lives here.

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { query, queryOne } from '../db/query';
import { s3 } from '../config/s3';

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
): Promise<{ vendor: VendorRow; invoicesRecategorised: number } | null> {
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

  const updated = await queryOne<VendorRow>(
    `UPDATE vendors
     SET ${fields.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  );

  if (!updated) return null;

  // Cascade category change to all live invoices for this vendor — invoice
  // .purpose is a denormalised copy of vendors.category, and the rest of the
  // app (dashboards, exports, category-mismatch validation on edit) trusts
  // the invoice row. Skip if the new category is null/blank or hasn't moved.
  let invoicesRecategorised = 0;
  if (
    data.category !== undefined &&
    typeof data.category === 'string' &&
    data.category.trim()
  ) {
    const newCategory = data.category.trim();
    const repointed = await query<{ id: string }>(
      `UPDATE invoices
       SET purpose = $1, updated_at = NOW()
       WHERE vendor_id = $2
         AND deleted_at IS NULL
         AND purpose IS DISTINCT FROM $1
       RETURNING id`,
      [newCategory, id]
    );
    invoicesRecategorised = repointed.length;
  }

  return { vendor: updated, invoicesRecategorised };
}

export async function deleteVendor(id: string): Promise<VendorRow | null> {
  // Unlink invoices first (they'll default to 30-day terms in aging)
  await query('UPDATE invoices SET vendor_id = NULL WHERE vendor_id = $1', [id]);
  return queryOne<VendorRow>(
    'DELETE FROM vendors WHERE id = $1 RETURNING *',
    [id]
  );
}

// ── Vendor detail with invoice stats ──────────────────────────────────────

export interface VendorDetailStats {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  oldestUnpaid: string | null;
}

export interface VendorDetailAttachment {
  id: string;
  invoice_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  url: string;
  uploaded_at: string;
}

export interface VendorDetailInvoice {
  id: string;
  invoice_date: string;
  invoice_no: string | null;
  po_number: string | null;
  purpose: string;
  site: string;
  invoice_amount: number;
  payment_status: string;
  balance: number;
  attachments: VendorDetailAttachment[];
}

export interface VendorDetailResult {
  vendor: VendorRow;
  stats: VendorDetailStats;
  invoices: VendorDetailInvoice[];
}

interface AttachmentRow {
  id: string;
  invoice_id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  s3_key: string;
  s3_bucket: string;
  uploaded_at: string;
}

export async function getVendorDetail(
  id: string,
  opts: { siteFilter?: string[] } = {}
): Promise<VendorDetailResult | null> {
  const vendor = await getVendorById(id);
  if (!vendor) return null;

  // Site role passes a list of assigned sites; HO/mgmt pass nothing and see
  // every invoice for the vendor.
  const params: unknown[] = [id];
  let siteClause = '';
  if (opts.siteFilter && opts.siteFilter.length > 0) {
    params.push(opts.siteFilter);
    siteClause = `AND i.site = ANY($${params.length}::text[])`;
  }

  const invoiceRows = await query<Omit<VendorDetailInvoice, 'attachments'>>(
    `SELECT
       i.id,
       i.invoice_date,
       i.invoice_no,
       i.po_number,
       i.purpose,
       i.site,
       i.invoice_amount,
       i.payment_status,
       i.invoice_amount - COALESCE(
         (SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0
       ) AS balance
     FROM invoices i
     WHERE i.vendor_id = $1
       AND i.deleted_at IS NULL
       ${siteClause}
     ORDER BY i.invoice_date DESC`,
    params
  );

  const invoiceIds = invoiceRows.map(r => r.id);
  const attachmentRows = invoiceIds.length
    ? await query<AttachmentRow>(
        `SELECT id, invoice_id, file_name, file_size, mime_type, s3_key, s3_bucket, uploaded_at
         FROM attachments
         WHERE invoice_id = ANY($1::uuid[])
         ORDER BY uploaded_at`,
        [invoiceIds]
      )
    : [];

  const attachmentsByInvoice = new Map<string, VendorDetailAttachment[]>();
  await Promise.all(attachmentRows.map(async (att) => {
    let url: string;
    if (att.s3_bucket === 'local') {
      url = `/api/invoices/${att.invoice_id}/attachments/${att.id}/download`;
    } else {
      url = await getSignedUrl(
        s3!,
        new GetObjectCommand({ Bucket: att.s3_bucket, Key: att.s3_key }),
        { expiresIn: 900 }
      );
    }
    const slim: VendorDetailAttachment = {
      id: att.id,
      invoice_id: att.invoice_id,
      file_name: att.file_name,
      file_size: att.file_size,
      mime_type: att.mime_type,
      url,
      uploaded_at: att.uploaded_at,
    };
    const list = attachmentsByInvoice.get(att.invoice_id) ?? [];
    list.push(slim);
    attachmentsByInvoice.set(att.invoice_id, list);
  }));

  const invoicesWithAttachments: VendorDetailInvoice[] = invoiceRows.map(inv => ({
    ...inv,
    attachments: attachmentsByInvoice.get(inv.id) ?? [],
  }));

  const totalInvoices = invoicesWithAttachments.length;
  const totalAmount = invoicesWithAttachments.reduce((sum, inv) => sum + Number(inv.invoice_amount), 0);
  const paidAmount = invoicesWithAttachments.reduce((sum, inv) => sum + (Number(inv.invoice_amount) - Number(inv.balance)), 0);
  const outstandingAmount = invoicesWithAttachments.reduce((sum, inv) => sum + Number(inv.balance), 0);

  const unpaidInvoices = invoicesWithAttachments.filter(inv => Number(inv.balance) > 0);
  const oldestUnpaid = unpaidInvoices.length > 0
    ? unpaidInvoices[unpaidInvoices.length - 1].invoice_date
    : null;

  return {
    vendor,
    stats: {
      totalInvoices,
      totalAmount,
      paidAmount,
      outstandingAmount,
      oldestUnpaid,
    },
    invoices: invoicesWithAttachments,
  };
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

export function normalizeVendorName(raw: string): string {
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
  const dismissedRows = await query<{ vendor_a_id: string; vendor_b_id: string }>(
    'SELECT vendor_a_id, vendor_b_id FROM vendor_dedup_dismissed'
  );
  const dismissed = new Set(dismissedRows.map(r => `${r.vendor_a_id}:${r.vendor_b_id}`));
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
      if (dismissed.has(pairKey)) continue;

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

// ── Dedup dismissal ────────────────────────────────────────────────────────

export async function dismissDuplicatePair(
  vendorAId: string,
  vendorBId: string,
  userId: string
): Promise<boolean> {
  if (vendorAId === vendorBId) return false;
  // Canonicalise so the unique pair is always stored with the smaller UUID
  // first (matches the CHECK constraint in migration 022).
  const [lo, hi] = [vendorAId, vendorBId].sort();
  await query(
    `INSERT INTO vendor_dedup_dismissed (vendor_a_id, vendor_b_id, dismissed_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (vendor_a_id, vendor_b_id) DO NOTHING`,
    [lo, hi, userId]
  );
  return true;
}

// ── Vendor merge ───────────────────────────────────────────────────────────

export interface MergeResult {
  mergeId: string;
  keptVendor: VendorRow;
  repointedCount: number;
  removedName: string;
  collapsedDuplicates: number;
}

// Entries in vendor_merges.invoice_changes are a discriminated union: rows
// that have `invoice_id` are invoice re-points (the original use), rows
// that have `credit_note_id` are credit-note re-points (added when CNs were
// blocking the DELETE FROM vendors because of their FK to vendors.id).
//
// Backward compatibility: pre-existing rows in the DB are all of the
// "invoice" shape and have no `kind` discriminator — that's fine, the
// revert code distinguishes them by the presence of `invoice_id` vs
// `credit_note_id`.
interface InvoiceMergeChange {
  invoice_id: string;
  prev_vendor_id: string | null;
  prev_vendor_name: string;
  // Set true when this invoice was a duplicate of another (same invoice_no +
  // amount + date under the kept vendor) and got soft-deleted by the merge.
  // Revert flips deleted_at back to NULL.
  soft_deleted_by_merge?: boolean;
}

interface CreditNoteMergeChange {
  credit_note_id: string;
  prev_vendor_id: string;
  prev_vendor_name: string;
}

type InvoiceChange = InvoiceMergeChange | CreditNoteMergeChange;

function isInvoiceChange(c: InvoiceChange): c is InvoiceMergeChange {
  return 'invoice_id' in c;
}

function isCreditNoteChange(c: InvoiceChange): c is CreditNoteMergeChange {
  return 'credit_note_id' in c;
}

export async function mergeVendors(
  keepId: string,
  removeId: string,
  mergedByUserId: string
): Promise<MergeResult | null> {
  const keepVendor = await getVendorById(keepId);
  const removeVendor = await getVendorById(removeId);
  if (!keepVendor || !removeVendor) return null;

  // Snapshot every invoice that's about to be re-pointed, so revert can put
  // each one back to exactly the vendor_id / vendor_name it had before.
  // Two paths: rows linked by vendor_id (the canonical case) and rows linked
  // only by the denormalised vendor_name (legacy / unmastered rows).
  const byIdRows = await query<{ id: string; vendor_id: string | null; vendor_name: string }>(
    `SELECT id, vendor_id, vendor_name FROM invoices WHERE vendor_id = $1`,
    [removeId]
  );
  const byNameRows = await query<{ id: string; vendor_id: string | null; vendor_name: string }>(
    `SELECT id, vendor_id, vendor_name FROM invoices
     WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM($1)) AND vendor_id IS DISTINCT FROM $2`,
    [removeVendor.name, keepId]
  );

  const seen = new Set<string>();
  const invoiceChanges: InvoiceChange[] = [];
  for (const r of [...byIdRows, ...byNameRows]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    invoiceChanges.push({
      invoice_id: r.id,
      prev_vendor_id: r.vendor_id,
      prev_vendor_name: r.vendor_name,
    });
  }

  // Re-point by vendor_id.
  await query(
    `UPDATE invoices
     SET vendor_id = $1, vendor_name = $2, updated_at = NOW()
     WHERE vendor_id = $3`,
    [keepId, keepVendor.name, removeId]
  );

  // Re-point by vendor_name (catches unlinked rows matching the removed vendor).
  await query(
    `UPDATE invoices SET vendor_name = $1, vendor_id = $2, updated_at = NOW()
     WHERE LOWER(TRIM(vendor_name)) = LOWER(TRIM($3)) AND vendor_id IS DISTINCT FROM $2`,
    [keepVendor.name, keepId, removeVendor.name]
  );

  // Re-point credit notes. credit_notes.vendor_id has a NOT NULL FK to
  // vendors(id) with no ON DELETE clause — leaving them pointed at the
  // removed vendor would block the DELETE FROM vendors below. Snapshot
  // first so revert can put them back to where they came from.
  const cnRows = await query<{ id: string; vendor_id: string; vendor_name: string }>(
    `SELECT id, vendor_id, vendor_name FROM credit_notes WHERE vendor_id = $1`,
    [removeId]
  );
  for (const cn of cnRows) {
    invoiceChanges.push({
      credit_note_id: cn.id,
      prev_vendor_id: cn.vendor_id,
      prev_vendor_name: cn.vendor_name,
    });
  }
  if (cnRows.length > 0) {
    await query(
      `UPDATE credit_notes
         SET vendor_id = $1, vendor_name = $2, updated_at = NOW()
       WHERE vendor_id = $3`,
      [keepId, keepVendor.name, removeId]
    );
  }

  // Collapse duplicate invoices under the kept vendor.  A "duplicate" means
  // two live invoices share invoice_no (case-insensitive trimmed, non-empty)
  // AND invoice_amount (within ₹1 paise tolerance) AND invoice_date.  All
  // three must match — that's strict enough to catch the same physical bill
  // entered under two vendor spellings without collapsing a vendor that
  // legitimately reuses invoice numbers across different amounts/dates.
  //
  // Winner per group: prefer pushed (locked/official), then most payments,
  // then most attachments, then oldest created_at (the original entry).
  const dupGroups = await query<{
    invoice_no_norm: string;
    invoice_amount: string;
    invoice_date: string;
    ids: string[];
  }>(
    `WITH ranked AS (
       SELECT
         i.id,
         LOWER(TRIM(i.invoice_no)) AS invoice_no_norm,
         i.invoice_amount,
         i.invoice_date
       FROM invoices i
       WHERE i.vendor_id = $1
         AND i.deleted_at IS NULL
         AND i.invoice_no IS NOT NULL
         AND TRIM(i.invoice_no) <> ''
     )
     SELECT invoice_no_norm, invoice_amount, invoice_date,
            ARRAY_AGG(id) AS ids
     FROM ranked
     GROUP BY invoice_no_norm, invoice_amount, invoice_date
     HAVING COUNT(*) > 1`,
    [keepId]
  );

  let collapsedDuplicates = 0;
  for (const g of dupGroups) {
    // Rank rows in the group; first row is the winner, rest get soft-deleted.
    const ranked = await query<{
      id: string;
      pushed: boolean | null;
      payment_count: string;
      attachment_count: string;
      created_at: string;
      vendor_id: string | null;
      vendor_name: string;
    }>(
      `SELECT
         i.id,
         i.pushed,
         (SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id) AS payment_count,
         (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = i.id) AS attachment_count,
         i.created_at,
         i.vendor_id,
         i.vendor_name
       FROM invoices i
       WHERE i.id = ANY($1::uuid[])
       ORDER BY
         COALESCE(i.pushed, FALSE) DESC,
         (SELECT COUNT(*) FROM payments p WHERE p.invoice_id = i.id) DESC,
         (SELECT COUNT(*) FROM attachments a WHERE a.invoice_id = i.id) DESC,
         i.created_at ASC,
         i.id ASC`,
      [g.ids]
    );

    // Soft-delete every row past the winner.
    const losers = ranked.slice(1);
    for (const loser of losers) {
      await query(
        `UPDATE invoices SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW()
         WHERE id = $2 AND deleted_at IS NULL`,
        [mergedByUserId, loser.id]
      );
      // Add to invoice_changes if it isn't already tracked (rows that were
      // re-pointed from removeId are already in the list — flag them).
      const existing = invoiceChanges.find(
        (c): c is InvoiceMergeChange => isInvoiceChange(c) && c.invoice_id === loser.id
      );
      if (existing) {
        existing.soft_deleted_by_merge = true;
      } else {
        invoiceChanges.push({
          invoice_id: loser.id,
          prev_vendor_id: loser.vendor_id,
          prev_vendor_name: loser.vendor_name,
          soft_deleted_by_merge: true,
        });
      }
      collapsedDuplicates += 1;
    }
  }

  // Delete the removed vendor.  Cascades clean up vendor_dedup_dismissed
  // rows that reference this UUID; those won't be restored on revert
  // (intentional — dismissals are advisory and easy to redo).
  await query('DELETE FROM vendors WHERE id = $1', [removeId]);

  // Persist the merge so it can be reverted.
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO vendor_merges (
       kept_vendor_id, removed_vendor_id, removed_vendor_snapshot,
       invoice_changes, merged_by
     ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
     RETURNING id`,
    [
      keepId,
      removeId,
      JSON.stringify(removeVendor),
      JSON.stringify(invoiceChanges),
      mergedByUserId,
    ]
  );

  return {
    mergeId: inserted!.id,
    keptVendor: keepVendor,
    repointedCount: invoiceChanges.length,
    removedName: removeVendor.name,
    collapsedDuplicates,
  };
}

// ── Revert ────────────────────────────────────────────────────────────────

export interface VendorMergeRow {
  id: string;
  kept_vendor_id: string;
  removed_vendor_id: string;
  removed_vendor_snapshot: VendorRow;
  invoice_changes: InvoiceChange[];
  merged_by: string | null;
  merged_at: string;
  reverted_at: string | null;
  reverted_by: string | null;
}

export async function getVendorMergeById(id: string): Promise<VendorMergeRow | null> {
  return queryOne<VendorMergeRow>(
    `SELECT id, kept_vendor_id, removed_vendor_id, removed_vendor_snapshot,
            invoice_changes, merged_by, merged_at, reverted_at, reverted_by
     FROM vendor_merges WHERE id = $1`,
    [id]
  );
}

export interface RevertResult {
  restoredVendor: VendorRow;
  restoredInvoiceCount: number;
}

export async function revertVendorMerge(
  mergeId: string,
  revertedByUserId: string
): Promise<RevertResult | null> {
  const merge = await getVendorMergeById(mergeId);
  if (!merge || merge.reverted_at) return null;

  const snap = merge.removed_vendor_snapshot;

  // Re-create the removed vendor with the same UUID.  Use ON CONFLICT DO
  // NOTHING in case a vendor with that ID somehow still exists (shouldn't,
  // but cheap insurance).
  const restored = await queryOne<VendorRow>(
    `INSERT INTO vendors (
       id, name, payment_terms, category, gstin, contact_name,
       phone, email, notes, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       payment_terms = EXCLUDED.payment_terms,
       category = EXCLUDED.category,
       gstin = EXCLUDED.gstin,
       contact_name = EXCLUDED.contact_name,
       phone = EXCLUDED.phone,
       email = EXCLUDED.email,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING *`,
    [
      snap.id, snap.name, snap.payment_terms, snap.category, snap.gstin,
      snap.contact_name, snap.phone, snap.email, snap.notes, snap.created_by,
      snap.created_at,
    ]
  );

  // Restore each tracked row's previous vendor link. Invoices and credit
  // notes share the same change array; dispatch by the discriminator.
  // For invoices that were soft-deleted as duplicates during the merge,
  // also clear deleted_at / deleted_by so they come back to life.
  for (const ch of merge.invoice_changes) {
    if (isInvoiceChange(ch)) {
      if (ch.soft_deleted_by_merge) {
        await query(
          `UPDATE invoices
           SET vendor_id = $1, vendor_name = $2,
               deleted_at = NULL, deleted_by = NULL,
               updated_at = NOW()
           WHERE id = $3`,
          [ch.prev_vendor_id, ch.prev_vendor_name, ch.invoice_id]
        );
      } else {
        await query(
          `UPDATE invoices
           SET vendor_id = $1, vendor_name = $2, updated_at = NOW()
           WHERE id = $3`,
          [ch.prev_vendor_id, ch.prev_vendor_name, ch.invoice_id]
        );
      }
    } else if (isCreditNoteChange(ch)) {
      await query(
        `UPDATE credit_notes
         SET vendor_id = $1, vendor_name = $2, updated_at = NOW()
         WHERE id = $3`,
        [ch.prev_vendor_id, ch.prev_vendor_name, ch.credit_note_id]
      );
    }
  }

  await query(
    `UPDATE vendor_merges SET reverted_at = NOW(), reverted_by = $1 WHERE id = $2`,
    [revertedByUserId, mergeId]
  );

  return {
    restoredVendor: restored!,
    restoredInvoiceCount: merge.invoice_changes.length,
  };
}

// ── List ──────────────────────────────────────────────────────────────────

export interface VendorMergeListItem {
  id: string;
  kept_vendor_id: string;
  removed_vendor_id: string;
  removed_vendor_name: string;
  kept_vendor_name: string | null;
  invoice_count: number;
  merged_by: string | null;
  merged_by_name: string | null;
  merged_at: string;
  reverted_at: string | null;
  reverted_by: string | null;
}

export async function listVendorMerges(opts: {
  onlyUserId?: string;
  includeReverted?: boolean;
  limit?: number;
}): Promise<VendorMergeListItem[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (opts.onlyUserId) {
    conditions.push(`vm.merged_by = $${idx++}`);
    values.push(opts.onlyUserId);
  }
  if (!opts.includeReverted) {
    conditions.push('vm.reverted_at IS NULL');
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  values.push(limit);

  return query<VendorMergeListItem>(
    `SELECT vm.id, vm.kept_vendor_id, vm.removed_vendor_id,
            (vm.removed_vendor_snapshot->>'name') AS removed_vendor_name,
            v.name AS kept_vendor_name,
            jsonb_array_length(vm.invoice_changes) AS invoice_count,
            vm.merged_by, u.name AS merged_by_name,
            vm.merged_at, vm.reverted_at, vm.reverted_by
     FROM vendor_merges vm
     LEFT JOIN vendors v ON v.id = vm.kept_vendor_id
     LEFT JOIN users u ON u.id = vm.merged_by
     ${where}
     ORDER BY vm.merged_at DESC
     LIMIT $${idx}`,
    values
  );
}
