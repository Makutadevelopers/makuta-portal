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

/**
 * Map a free-text site name to its canonical capitalisation. Case-insensitive
 * match; whitespace is trimmed. Returns the canonical name when there is a
 * match, otherwise the trimmed input unchanged so legitimate one-off sites
 * (e.g. a new project not yet added to the constant list) still flow through.
 */
export function normaliseSiteName(input: string): string {
  const key = input.toLowerCase().trim();
  return SITE_BY_KEY.get(key) ?? input.trim();
}
