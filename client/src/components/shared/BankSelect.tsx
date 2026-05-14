import { ChangeEvent, useEffect, useState } from 'react';
import { BANKS, addCustomBank, loadCustomBanks } from '../../utils/constants';

const OTHER_SENTINEL = '__other__';

type Props = {
  value: string;
  onChange: (v: string) => void;
  className?: string;
};

export default function BankSelect({ value, onChange, className }: Props) {
  const [customBanks, setCustomBanks] = useState<string[]>(() => loadCustomBanks());
  const allBanks = [...BANKS, ...customBanks];
  const valueIsKnown = !value || allBanks.includes(value);
  const [mode, setMode] = useState<'select' | 'other'>(valueIsKnown ? 'select' : 'other');
  const [otherInput, setOtherInput] = useState(valueIsKnown ? '' : value);

  // Reset to the select view when the parent clears the bank (e.g. after submit).
  useEffect(() => {
    if (!value) {
      setMode('select');
      setOtherInput('');
    }
  }, [value]);

  const handleSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === OTHER_SENTINEL) {
      setMode('other');
      setOtherInput('');
      onChange('');
    } else {
      onChange(v);
    }
  };

  const commitOther = () => {
    const name = otherInput.trim();
    if (!name) {
      onChange('');
      return;
    }
    const next = addCustomBank(name);
    setCustomBanks(next);
    onChange(name);
  };

  if (mode === 'other') {
    return (
      <div className="flex items-stretch gap-2">
        <input
          autoFocus
          value={otherInput}
          onChange={e => setOtherInput(e.target.value)}
          onBlur={commitOther}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitOther(); } }}
          placeholder="Enter bank name"
          className={className}
        />
        <button
          type="button"
          onClick={() => { setMode('select'); setOtherInput(''); onChange(''); }}
          className="px-2 text-xs text-gray-500 hover:text-gray-700"
          title="Back to list"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <select value={value} onChange={handleSelect} className={className}>
      <option value="">Select bank</option>
      {allBanks.map(b => <option key={b} value={b}>{b}</option>)}
      <option value={OTHER_SENTINEL}>Other…</option>
    </select>
  );
}
