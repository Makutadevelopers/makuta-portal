import { useBanks } from '../../hooks/useBanks';

type Props = {
  value: string;
  onChange: (v: string) => void;
  className?: string;
};

// Bank dropdown for payment forms. Reads from the DB-backed Bank Master
// (managed by HO at /banks) and falls back to the static BANKS seed list
// inside useBanks while the API request is in flight or has failed.
// "Other" remains a literal pickable value so the original payment that
// stored "Other" against a bank continues to round-trip cleanly.
export default function BankSelect({ value, onChange, className }: Props) {
  const { names } = useBanks();
  // If the selected value isn't in the active list (e.g. it points to a
  // bank that HO has since deactivated), preserve it in the dropdown so
  // the form doesn't silently lose the existing value on save.
  const showLegacyValue = value && value !== 'Other' && !names.includes(value);

  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="">Select bank</option>
      {names.map(b => <option key={b} value={b}>{b}</option>)}
      {showLegacyValue && <option value={value}>{value} (inactive)</option>}
      <option value="Other">Other</option>
    </select>
  );
}
