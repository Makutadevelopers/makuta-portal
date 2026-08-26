import { PeriodFilter as PeriodFilterValue } from '../../utils/pettyCashActivity';

export default function PeriodFilter({ value, onChange }: {
  value: PeriodFilterValue;
  onChange: (next: PeriodFilterValue) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={value.mode}
        onChange={e => onChange({ ...value, mode: e.target.value as PeriodFilterValue['mode'] })}
        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
      >
        <option value="all">All time</option>
        <option value="month">Month</option>
        <option value="range">Custom range</option>
      </select>
      {value.mode === 'month' && (
        <input
          type="month"
          value={value.month}
          onChange={e => onChange({ ...value, month: e.target.value })}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600"
        />
      )}
      {value.mode === 'range' && (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">From</span>
            <input type="date" value={value.from} onChange={e => onChange({ ...value, from: e.target.value })}
              className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">To</span>
            <input type="date" value={value.to} onChange={e => onChange({ ...value, to: e.target.value })}
              className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-600" />
          </div>
        </>
      )}
    </div>
  );
}
