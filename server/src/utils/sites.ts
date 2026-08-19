// Project (site) name helpers.
//
// Sites moved from a hardcoded constant to the `sites` table in migration 053,
// so HO can open a new project from Project Master without a deploy. These
// helpers stay SYNCHRONOUS on purpose — normaliseSiteName() runs per row inside
// the bulk importer and on every invoice write, and making it async would
// ripple through those hot paths for a lookup that changes a few times a year.
// The names come from the in-process cache in services/sites.service.ts.

import {
  cachedSiteNames, cachedActiveSiteNames, siteCacheReady, touchSiteCache,
} from '../services/sites.service';

// Seed list, and the fallback whenever the cache has not yet warmed (first
// request after boot) or a DB blip left it empty. Matches what migration 053
// seeds, so behaviour is identical to the pre-053 build in that window.
export const CANONICAL_SITES = [
  'Nirvana',
  'Taranga',
  'Horizon',
  'Green Wood Villas',
  'Aruna Arcade',
  'Office',
] as const;

// Aliases for the same physical project under different colloquial names
// (locality suffix, abbreviation, etc.). Add new entries here when a CSV
// import or stray manual entry creates a phantom site on the dashboard.
// Keys are lowercased/trimmed for matching.
const SITE_ALIASES: Record<string, string> = {
  'taranga kukatpally': 'Taranga',
  'taranga, kukatpally': 'Taranga',
};

function knownNames(): string[] {
  // Fire-and-forget: a no-op inside the TTL, otherwise it schedules a refresh
  // for subsequent calls. Without this the cache would never age out, since
  // these helpers are synchronous and cannot await one.
  touchSiteCache();
  if (siteCacheReady()) {
    const all = cachedSiteNames();
    if (all.length > 0) return all;
  }
  return [...CANONICAL_SITES];
}

function activeNames(): string[] {
  touchSiteCache();
  if (siteCacheReady()) {
    const active = cachedActiveSiteNames();
    if (active.length > 0) return active;
  }
  return [...CANONICAL_SITES];
}

// Rebuilding the lookup Map on every call would be wasteful inside the
// importer's per-row loop, so memoise it against the array the cache handed
// back — a refresh swaps in a new array, which invalidates this naturally.
let memoSource: string[] | null = null;
let memoMap = new Map<string, string>();

function siteByKey(): Map<string, string> {
  const names = knownNames();
  if (names !== memoSource) {
    memoSource = names;
    memoMap = new Map(names.map(s => [s.toLowerCase().trim(), s]));
  }
  return memoMap;
}

/**
 * Map a free-text site name to its canonical capitalisation. Case-insensitive
 * match; whitespace is trimmed. Returns the registered name when there is a
 * match, otherwise the trimmed input unchanged so legitimate one-off sites
 * (e.g. a new project not yet added to Project Master) still flow through.
 */
export function normaliseSiteName(input: string): string {
  const key = input.toLowerCase().trim();
  if (SITE_ALIASES[key]) return SITE_ALIASES[key];
  return siteByKey().get(key) ?? input.trim();
}

/**
 * Projects currently open for new work, falling back to the seed list when the
 * cache is cold. Use this anywhere a caller needs the list itself (dropdown
 * options, importer remap targets) rather than a membership test.
 */
export function activeSiteNames(): string[] {
  return activeNames();
}

/**
 * True when the (already-normalised) name is a project currently open for new
 * work. Archived projects return false, so an import referencing one is
 * surfaced as an unknown site rather than silently filed against a closed
 * project.
 */
export function isCanonicalSite(name: string): boolean {
  const key = name.toLowerCase().trim();
  return activeNames().some(s => s.toLowerCase().trim() === key);
}
