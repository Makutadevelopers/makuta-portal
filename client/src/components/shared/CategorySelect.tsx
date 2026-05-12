import { useState, useRef, useEffect } from 'react';
import { useCategories } from '../../hooks/useCategories';
import { useToast } from '../../context/ToastContext';

interface Props {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  // If true, render an "All Categories" sentinel as the first option with
  // value "All" — used by list filters.
  includeAll?: boolean;
}

// A category dropdown that fetches names from /api/categories and lets the
// user add a new one inline. The new value is created case-insensitively;
// "hardware" / "Hardware" / "HARDWARE" all map to the same row.
export default function CategorySelect({
  value, onChange, required, className, id, name, placeholder, includeAll,
}: Props) {
  const { names, add } = useCategories();
  const { notify } = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const ADD_SENTINEL = '__add_new__';

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (e.target.value === ADD_SENTINEL) {
      setDraft('');
      setAdding(true);
      return;
    }
    onChange(e.target.value);
  }

  async function commitNew() {
    const trimmed = draft.trim();
    if (!trimmed) { setAdding(false); return; }
    try {
      const persistedName = await add(trimmed);
      onChange(persistedName);
      setAdding(false);
      notify(`Added category: ${persistedName}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to add category');
    }
  }

  if (adding) {
    return (
      <div className={`flex items-center gap-1 ${className ?? ''}`}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitNew(); }
            if (e.key === 'Escape') { e.preventDefault(); setAdding(false); }
          }}
          placeholder="New category name"
          className="flex-1 px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          maxLength={64}
        />
        <button type="button" onClick={commitNew}
          className="px-2 py-2 text-xs font-medium text-white bg-[#1a3c5e] rounded-lg hover:bg-[#15304d]">
          Add
        </button>
        <button type="button" onClick={() => setAdding(false)}
          className="px-2 py-2 text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={handleSelectChange}
      required={required}
      className={className ?? 'px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200'}
    >
      {placeholder && !includeAll && <option value="">{placeholder}</option>}
      {includeAll && <option value="All">All Categories</option>}
      {names.map(n => <option key={n} value={n}>{n}</option>)}
      <option value={ADD_SENTINEL}>+ Add new category…</option>
    </select>
  );
}
