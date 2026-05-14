import { useEffect, useRef, useState } from 'react';

// Tracks the live offsetHeight of a sticky page-header (title + filter row
// + any conditional bulk-action bar) so the table's <thead> can pin itself
// flush below it regardless of wrapping or runtime changes.
export function useStickyHeaderHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, height };
}
