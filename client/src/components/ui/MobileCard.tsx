import { ReactNode } from 'react';

// Presentation-only building blocks for the mobile card list that replaces
// wide data tables on phones (see useIsMobile). MobileCard is the row shell;
// CardField is a compact `label : value` line so a card reads as a key/value
// list. Shared across every list page as they get their mobile treatment.

export function MobileCard({
  header,
  children,
  selected,
  accentClass,
  className,
}: {
  // Top row of the card: typically a checkbox + bold title on the left and an
  // ActionsMenu / links on the right.
  header: ReactNode;
  children?: ReactNode;
  // Row is bulk-selected → tinted background.
  selected?: boolean;
  // Optional left accent, e.g. a dispute flag: 'border-l-4 border-red-400'.
  accentClass?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        selected ? 'bg-blue-50/60 border-blue-200' : 'bg-white border-gray-100'
      } ${accentClass ?? ''} ${className ?? ''}`}
    >
      <div className="flex items-start justify-between gap-2">{header}</div>
      {children && <div className="mt-2 space-y-1">{children}</div>}
    </div>
  );
}

export function CardField({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-gray-400 flex-shrink-0">{label}</span>
      <span className={`text-gray-700 text-right min-w-0 truncate ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}
