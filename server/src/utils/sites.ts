// Canonical project sites. Mirrors client/src/utils/constants.ts SITES.
// Kept here so server-side validation can normalise any case/whitespace
// variants the client (or a CSV upload) might send.

export const CANONICAL_SITES = [
  'Nirvana',
  'Taranga',
  'Horizon',
  'Green Wood Villas',
  'Aruna Arcade',
  'Office',
] as const;

const SITE_BY_KEY = new Map<string, string>(
  CANONICAL_SITES.map(s => [s.toLowerCase().trim(), s])
);

// Aliases for the same physical project under different colloquial names
// (locality suffix, abbreviation, etc.). Add new entries here when a CSV
// import or stray manual entry creates a phantom site on the dashboard.
// Keys are lowercased/trimmed for matching.
const SITE_ALIASES: Record<string, string> = {
  'taranga kukatpally': 'Taranga',
  'taranga, kukatpally': 'Taranga',
};

/**
 * Map a free-text site name to its canonical capitalisation. Case-insensitive
 * match; whitespace is trimmed. Returns the canonical name when there is a
 * match, otherwise the trimmed input unchanged so legitimate one-off sites
 * (e.g. a new project not yet added to the constant list) still flow through.
 */
export function normaliseSiteName(input: string): string {
  const key = input.toLowerCase().trim();
  if (SITE_ALIASES[key]) return SITE_ALIASES[key];
  return SITE_BY_KEY.get(key) ?? input.trim();
}

/** True when the (already-normalised) name is one of the canonical sites. */
export function isCanonicalSite(name: string): boolean {
  return SITE_BY_KEY.has(name.toLowerCase().trim());
}
