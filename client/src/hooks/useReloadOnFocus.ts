import { useEffect, useRef } from 'react';

/**
 * Re-run `refetch` whenever the browser tab/window regains focus, so a page
 * that was loaded earlier picks up edits made elsewhere (another tab, another
 * screen) without a manual reload. Every page in this app keeps its data in
 * local state fetched once on mount; with several tabs open, an edit in one
 * tab left the others showing stale numbers until refresh — this closes that.
 *
 * `refetch` should be a SILENT/background reload (no full-page spinner) so the
 * refresh is invisible while the user is reading. Pass `enabled: false` to
 * pause it — e.g. while an inline edit row or entry form is open — so a
 * background refresh can never clobber input the user is in the middle of.
 *
 * The listeners are bound once; the latest `refetch`/`enabled` are read through
 * refs so callers don't need to memoise them.
 */
export function useReloadOnFocus(refetch: () => void, enabled: boolean = true): void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      if (!enabledRef.current) return;
      refetchRef.current();
    };
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);
}
