import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

// Adds keyboard navigation (ArrowUp/ArrowDown to move, Enter to pick,
// Escape to close) to a custom typeahead dropdown — the kind built from an
// <input> plus an absolutely-positioned list of clickable rows. Native
// <select> elements already do this; these hand-rolled ones don't.
//
// Usage:
//   const matches = vendors.filter(v => ...);
//   const kbd = useTypeaheadKeyboard({
//     items: matches, open: !!vendorSearch,
//     onSelect: v => handleVendorChange(v.id),
//     onEmptyEnter: () => handleStageNewVendor(vendorSearch), // optional
//     onClose: () => setVendorSearch(''),                     // optional
//   });
//   <input onKeyDown={kbd.onKeyDown} ... />
//   matches.map((v, i) => (
//     <div ref={kbd.itemRef(i)} className={kbd.isActive(i) ? 'bg-blue-50' : ''} ... />
//   ))
export function useTypeaheadKeyboard<T>(opts: {
  items: T[];
  open: boolean;
  onSelect: (item: T) => void;
  onEmptyEnter?: () => void;
  onClose?: () => void;
}) {
  const { items, open, onSelect, onEmptyEnter, onClose } = opts;
  const [activeIndex, setActiveIndex] = useState(0);
  const activeRef = useRef<HTMLElement | null>(null);

  // Reset the highlight whenever the result set changes or the menu reopens,
  // so we never point past the end of a freshly-filtered list.
  useEffect(() => { setActiveIndex(0); }, [items.length, open]);

  // Keep the highlighted row scrolled into view inside the overflow container.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function onKeyDown(e: KeyboardEvent) {
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => (items.length ? Math.min(i + 1, items.length - 1) : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (items.length) {
          e.preventDefault();
          onSelect(items[Math.min(activeIndex, items.length - 1)]);
        } else if (onEmptyEnter) {
          e.preventDefault();
          onEmptyEnter();
        }
        break;
      case 'Escape':
        if (onClose) {
          e.preventDefault();
          onClose();
        }
        break;
    }
  }

  return {
    activeIndex,
    onKeyDown,
    isActive: (i: number) => i === activeIndex,
    // Callback ref that captures the active row for scroll-into-view.
    itemRef: (i: number) => (el: HTMLElement | null) => {
      if (i === activeIndex) activeRef.current = el;
    },
  };
}
