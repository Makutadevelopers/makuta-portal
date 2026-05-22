import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tiny stale-while-revalidate data cache (no external dependency).
 *
 * Why this exists: every page used to fetch its full list from scratch on
 * mount and blank to a spinner — so navigating back to a page you just left
 * felt slow, and data only refreshed when the tab regained focus. This module
 * keeps fetched data in a module-level cache keyed by URL so that:
 *   - revisiting a page renders the cached data INSTANTLY (no spinner), then
 *     silently revalidates in the background;
 *   - all components reading the same key share one copy and stay in sync;
 *   - concurrent fetches for the same key are de-duplicated;
 *   - data self-refreshes on a background poll and on tab focus, so edits made
 *     elsewhere (another user / another tab) appear within seconds without a
 *     manual reload;
 *   - a mutation can patch the cache in place (setQueryData) or force a
 *     refetch (invalidateQuery) so every page sharing that key updates at once.
 */

interface Entry<T> {
  data: T | undefined;
  error: Error | null;
  fetchedAt: number; // 0 = never successfully loaded
  promise: Promise<T> | null; // in-flight fetch, for de-duplication
  subscribers: Set<() => void>;
}

const cache = new Map<string, Entry<unknown>>();
// Latest fetcher per key, so invalidateQuery can trigger a refetch without a
// component handing one in. Refreshed on every render of a subscribing hook.
const fetchers = new Map<string, () => Promise<unknown>>();

function getEntry<T>(key: string): Entry<T> {
  let entry = cache.get(key) as Entry<T> | undefined;
  if (!entry) {
    entry = { data: undefined, error: null, fetchedAt: 0, promise: null, subscribers: new Set() };
    cache.set(key, entry as Entry<unknown>);
  }
  return entry;
}

function notify(entry: Entry<unknown>): void {
  entry.subscribers.forEach((fn) => fn());
}

// Fetch for a key, sharing a single in-flight promise across all callers.
function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const entry = getEntry<T>(key);
  if (entry.promise) return entry.promise;

  const p = fetcher()
    .then((data) => {
      entry.data = data;
      entry.error = null;
      entry.fetchedAt = Date.now();
      entry.promise = null;
      notify(entry);
      return data;
    })
    .catch((err) => {
      entry.error = err instanceof Error ? err : new Error(String(err));
      entry.promise = null;
      notify(entry);
      throw err;
    });

  entry.promise = p;
  return p;
}

/**
 * Patch a cached value in place and notify every component reading that key.
 * Use after a mutation when you already know the new shape (no refetch needed).
 */
export function setQueryData<T>(key: string, updater: (prev: T | undefined) => T): void {
  const entry = getEntry<T>(key);
  entry.data = updater(entry.data);
  entry.fetchedAt = Date.now();
  entry.error = null;
  notify(entry);
}

/**
 * Force a refetch of one or more cached keys (those with live subscribers
 * refetch immediately; others are just marked stale so their next mount
 * revalidates). Pass `{ exact: true }` to match a single key, otherwise the
 * argument is treated as a prefix (e.g. invalidateQuery('/aging') refreshes
 * every per-site aging query).
 */
export function invalidateQuery(keyOrPrefix: string, opts: { exact?: boolean } = {}): void {
  for (const [key, entry] of cache) {
    const match = opts.exact ? key === keyOrPrefix : key.startsWith(keyOrPrefix);
    if (!match) continue;
    entry.fetchedAt = 0; // mark stale for next mount
    const fetcher = fetchers.get(key);
    if (fetcher && entry.subscribers.size > 0) {
      revalidate(key, fetcher).catch(() => {});
    }
  }
}

export interface CachedQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  /** Force a background revalidation of this key. */
  refresh: () => Promise<T>;
}

export interface CachedQueryOptions {
  /** Background poll interval in ms (only while the tab is visible). 0 = off. */
  pollMs?: number;
  /** Revalidate when the tab regains focus. Default true. */
  refreshOnFocus?: boolean;
  /** Skip fetching entirely (e.g. while an edit form owns the data). */
  enabled?: boolean;
}

/**
 * Subscribe a component to a cached query.
 *
 * `key` should uniquely identify the request (typically the API path + query
 * string). `fetcher` is the function that performs the actual request; it is
 * read through a ref so callers don't need to memoise it.
 */
export function useCachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CachedQueryOptions = {},
): CachedQueryResult<T> {
  const { pollMs = 0, refreshOnFocus = true, enabled = true } = opts;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  fetchers.set(key, () => fetcherRef.current());

  const [, forceRender] = useState(0);

  // Subscribe + initial revalidate (stale-while-revalidate: cached data shows
  // immediately, fresh data arrives in the background).
  useEffect(() => {
    if (!enabled) return;
    const entry = getEntry<T>(key);
    const cb = () => forceRender((n) => n + 1);
    entry.subscribers.add(cb);
    revalidate(key, () => fetcherRef.current()).catch(() => {});
    return () => {
      entry.subscribers.delete(cb);
    };
  }, [key, enabled]);

  // Background polling — paused while the tab is hidden to avoid useless churn.
  useEffect(() => {
    if (!enabled || !pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      revalidate(key, () => fetcherRef.current()).catch(() => {});
    }, pollMs);
    return () => clearInterval(id);
  }, [key, enabled, pollMs]);

  // Revalidate on focus / visibility regain.
  useEffect(() => {
    if (!enabled || !refreshOnFocus) return;
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      revalidate(key, () => fetcherRef.current()).catch(() => {});
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [key, enabled, refreshOnFocus]);

  const refresh = useCallback(() => revalidate(key, () => fetcherRef.current()), [key]);

  const entry = getEntry<T>(key);
  return {
    data: entry.data,
    // Spinner only before the first successful load with no cached data and no
    // error yet; a revalidation over existing data never flips this back on.
    loading: entry.data === undefined && entry.error === null,
    error: entry.error,
    refresh,
  };
}
