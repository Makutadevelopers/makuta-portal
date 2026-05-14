import { BANKS } from '../../utils/constants';

type Props = {
  value: string;
  onChange: (v: string) => void;
  className?: string;
};

export default function BankSelect({ value, onChange, className }: Props) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className}>
      <option value="">Select bank</option>
      {BANKS.map(b => <option key={b} value={b}>{b}</option>)}
      <option value="Other">Other</option>
    </select>
  );
}
