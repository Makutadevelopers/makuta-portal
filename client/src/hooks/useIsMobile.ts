import { useState, useEffect } from 'react';

// Returns true on phone-width viewports. Tailwind's `sm` breakpoint is 640px,
// so "mobile" is anything below it. Used to render a card list instead of a
// wide table (see components/ui/MobileCard). Kept as a matchMedia hook rather
// than a pure-CSS `sm:hidden` toggle so pages render only ONE branch — the
// invoice lists mount heavy edit forms per expanded row, and rendering both a
// table row and a card would double the DOM and mount those forms twice.
export function useIsMobile(query = '(max-width: 639px)'): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return match;
}
