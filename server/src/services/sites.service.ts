// sites.service.ts
// Reads and mutations for the `sites` registry (migration 053), plus the
// in-process name cache that lets utils/sites.ts stay synchronous.
//
// Why a cache: normaliseSiteName() is called per-row inside the bulk importer
// and on every invoice write. Making it async would ripple through those hot
// paths for a lookup that changes a few times a year, so the site names are
// held in memory, refreshed on a short TTL and eagerly after every mutation.

import { query, queryOne, withTransaction } from '../db/query';
import { logAudit } from './audit.service';

export interface SiteRow {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

const SELECT_COLS = 'id, name, active, created_at, updated_at, created_by';

// ── Name cache ────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;
let cachedNames: string[] = [];
let cachedActiveNames: string[] = [];
let cachedAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Every registered project name, archived ones included. Used for case
 * normalisation: an archived project's rows must still normalise to its
 * registered capitalisation rather than being treated as a new phantom.
 */
export function cachedSiteNames(): string[] {
  return cachedNames;
}

/** Only projects currently open for new work — what validation should accept. */
export function cachedActiveSiteNames(): string[] {
  return cachedActiveNames;
}

/** True once the cache has been populated at least once. */
export function siteCacheReady(): boolean {
  return cachedAt > 0;
}

/**
 * Refresh the cached names. Concurrent callers share one query. Failures leave
 * the previous list in place — a transient DB blip must not empty every
 * dropdown or make normaliseSiteName() start rejecting valid sites.
 */
export async function refreshSiteCache(force = false): Promise<void> {
  if (!force && Date.now() - cachedAt < CACHE_TTL_MS) return;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const rows = await query<{ name: string; active: boolean }>(
        'SELECT name, active FROM sites ORDER BY name'
      );
      cachedNames = rows.map(r => r.name);
      cachedActiveNames = rows.filter(r => r.active).map(r => r.name);
      cachedAt = Date.now();
    } catch (err) {
      console.error('[sites] cache refresh failed, keeping previous list:', err);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Fire-and-forget refresh, for sync call sites that must not await. */
export function touchSiteCache(): void {
  void refreshSiteCache().catch(() => undefined);
}

// ── Reads ─────────────────────────────────────────────────────────────────
export async function listSites(includeInactive: boolean): Promise<SiteRow[]> {
  return query<SiteRow>(
    includeInactive
      ? `SELECT ${SELECT_COLS} FROM sites ORDER BY active DESC, name`
      : `SELECT ${SELECT_COLS} FROM sites WHERE active = TRUE ORDER BY name`
  );
}

export async function findSiteById(id: string): Promise<SiteRow | null> {
  return queryOne<SiteRow>(`SELECT ${SELECT_COLS} FROM sites WHERE id = $1`, [id]);
}

export async function findSiteByName(name: string): Promise<SiteRow | null> {
  return queryOne<SiteRow>(`SELECT ${SELECT_COLS} FROM sites WHERE LOWER(name) = LOWER($1)`, [name]);
}

/**
 * How many live records reference this project. Shown in the UI before an
 * archive/rename so nobody acts blind, and used to block archiving a project
 * that still has open work.
 */
export async function siteUsage(name: string): Promise<{
  invoices: number; creditNotes: number; pettyCash: number; users: number;
}> {
  const row = await queryOne<{
    invoices: string; credit_notes: string; petty_cash: string; users: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM invoices     WHERE site = $1 AND deleted_at IS NULL) AS invoices,
       (SELECT COUNT(*) FROM credit_notes WHERE site = $1 AND deleted_at IS NULL) AS credit_notes,
       (SELECT (SELECT COUNT(*) FROM petty_cash_disbursements WHERE site = $1)
             + (SELECT COUNT(*) FROM petty_cash_expenses      WHERE site = $1)) AS petty_cash,
       (SELECT COUNT(*) FROM users WHERE $1 = ANY(sites)) AS users`,
    [name]
  );
  return {
    invoices: Number(row?.invoices ?? 0),
    creditNotes: Number(row?.credit_notes ?? 0),
    pettyCash: Number(row?.petty_cash ?? 0),
    users: Number(row?.users ?? 0),
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────
export async function createSite(name: string, userId: string): Promise<SiteRow> {
  const row = await queryOne<SiteRow>(
    `INSERT INTO sites (name, created_by) VALUES ($1, $2) RETURNING ${SELECT_COLS}`,
    [name, userId]
  );
  await refreshSiteCache(true);
  await logAudit({ userId, action: `Added project "${name}"` });
  return row!;
}

export async function setSiteActive(site: SiteRow, active: boolean, userId: string): Promise<SiteRow> {
  const row = await queryOne<SiteRow>(
    `UPDATE sites SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING ${SELECT_COLS}`,
    [active, site.id]
  );
  await refreshSiteCache(true);
  await logAudit({
    userId,
    action: `${active ? 'Reactivated' : 'Archived'} project "${site.name}"`,
    metadata: { siteId: site.id, name: site.name, active },
  });
  return row!;
}

/**
 * Rename a project and rewrite every record that stores its name.
 *
 * The name is denormalised across five places, so a rename that only touched
 * the registry would split one project into two on every dashboard. All of it
 * moves in ONE transaction: either the project is fully renamed or nothing
 * changed.
 *
 * Counts of what moved go into the audit entry, and the old name is recorded,
 * so the change is reversible by running the rename back the other way.
 */
export async function renameSite(
  site: SiteRow,
  nextName: string,
  userId: string
): Promise<{ row: SiteRow; moved: Record<string, number> }> {
  const result = await withTransaction(async (tx) => {
    const moved: Record<string, number> = {};

    const bump = async (label: string, sql: string) => {
      const rows = await tx.query<{ id: unknown }>(sql, [nextName, site.name]);
      moved[label] = rows.length;
    };

    await bump('invoices',
      'UPDATE invoices SET site = $1, updated_at = NOW() WHERE site = $2 RETURNING id');
    await bump('credit_notes',
      'UPDATE credit_notes SET site = $1, updated_at = NOW() WHERE site = $2 RETURNING id');
    await bump('petty_cash_disbursements',
      'UPDATE petty_cash_disbursements SET site = $1 WHERE site = $2 RETURNING id');
    await bump('petty_cash_expenses',
      'UPDATE petty_cash_expenses SET site = $1 WHERE site = $2 RETURNING id');

    // users.site is the legacy single-site column; users.sites is the array
    // that multi-site accountants and project managers actually use. Both must
    // move or someone silently loses access to their own project.
    await bump('users_single',
      'UPDATE users SET site = $1, updated_at = NOW() WHERE site = $2 RETURNING id');
    const arrRows = await tx.query<{ id: string }>(
      `UPDATE users
          SET sites = ARRAY_REPLACE(sites, $2, $1), updated_at = NOW()
        WHERE $2 = ANY(sites)
      RETURNING id`,
      [nextName, site.name]
    );
    moved.users_multi = arrRows.length;

    const row = await tx.queryOne<SiteRow>(
      `UPDATE sites SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING ${SELECT_COLS}`,
      [nextName, site.id]
    );
    return { row: row!, moved };
  });

  await refreshSiteCache(true);
  await logAudit({
    userId,
    action: `Renamed project "${site.name}" → "${nextName}"`,
    metadata: { siteId: site.id, from: site.name, to: nextName, moved: result.moved },
  });
  return result;
}
