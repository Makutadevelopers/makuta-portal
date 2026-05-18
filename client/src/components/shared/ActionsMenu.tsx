import { useState, useEffect, useRef } from 'react';

export interface ActionItem {
  label: string;
  color: string;
  onClick: () => void;
}

export default function ActionsMenu({ items }: { items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleScroll() { setOpen(false); }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuH = items.length * 32 + 8;
    const menuW = 176;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < menuH + 8 && rect.top > menuH + 8
      ? rect.top - menuH - 4
      : rect.bottom + 4;
    const left = Math.max(8, rect.right - menuW);
    setPos({ top, left });
    setOpen(true);
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        ref={btnRef}
        onClick={toggle}
        className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1"
      >
        Actions
        <span className="text-[10px]">&#9662;</span>
      </button>
      {open && pos && (
        <div
          className="fixed z-50 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1"
          style={{ top: pos.top, left: pos.left }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              onClick={() => { item.onClick(); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${item.color}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
