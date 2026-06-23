import { LineItemDraft, makeLineItem, computeLineItem } from '../../utils/invoiceMath';
import { formatINR } from '../../utils/formatters';

interface Props {
  items: LineItemDraft[];
  onChange: (items: LineItemDraft[]) => void;
  disabled?: boolean;
}

// Repeatable editor for an invoice's ADDITIONAL line items (transport, loading,
// etc.) — each with its own amount, description and GST split. The primary
// base-amount line lives in the parent form; this manages only the extras.
export default function LineItemsEditor({ items, onChange, disabled }: Props) {
  const on = items.length > 0;

  function enable() {
    onChange([makeLineItem()]);
  }

  function addItem() {
    onChange([...items, makeLineItem()]);
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx));
  }

  function patchItem(idx: number, patch: Partial<LineItemDraft>) {
    onChange(items.map((li, i) => (i === idx ? { ...li, ...patch } : li)));
  }

  const itemsTotal = items.reduce((s, li) => s + computeLineItem(li).lineTotal, 0);

  return (
    <div className="mb-4 p-4 bg-amber-50/40 rounded-lg border border-amber-100">
      <label className="flex items-center gap-2 cursor-pointer mb-3">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled}
          onChange={e => (e.target.checked ? enable() : onChange([]))}
          className="rounded border-gray-300"
        />
        <span className="text-xs font-medium text-gray-700">
          Additional items (transport, loading, etc.) — each with its own tax
        </span>
      </label>

      {on && (
        <>
          <div className="space-y-3">
            {items.map((li, idx) => {
              const c = computeLineItem(li);
              return (
                <div key={idx} className="rounded-lg border border-amber-200 bg-white p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-500">Item {idx + 1}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-amber-800">{formatINR(c.lineTotal)}</span>
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        disabled={disabled}
                        className="text-gray-400 hover:text-red-600 disabled:opacity-30 text-sm"
                        title="Remove item"
                      >
                        &#10005;
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Amount (₹) *</label>
                      <input
                        type="number" min="0" step="0.01" value={li.amount}
                        onChange={e => patchItem(idx, { amount: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Description / reason *</label>
                      <input
                        value={li.description} maxLength={500}
                        onChange={e => patchItem(idx, { description: e.target.value })}
                        placeholder="e.g. Transport, loading, packing..."
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">CGST %</label>
                      <input
                        type="number" min="0" max="100" step="0.01" value={li.cgstPct}
                        onChange={e => patchItem(idx, { cgstPct: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                      <div className="text-[11px] text-gray-400 mt-1">{formatINR(c.cgstAmt)}</div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">SGST %</label>
                      <input
                        type="number" min="0" max="100" step="0.01" value={li.sgstPct}
                        onChange={e => patchItem(idx, { sgstPct: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                      <div className="text-[11px] text-gray-400 mt-1">{formatINR(c.sgstAmt)}</div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">IGST %</label>
                      <input
                        type="number" min="0" max="100" step="0.01" value={li.igstPct}
                        onChange={e => patchItem(idx, { igstPct: e.target.value })}
                        placeholder="0"
                        className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-200"
                      />
                      <div className="text-[11px] text-gray-400 mt-1">{formatINR(c.igstAmt)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={addItem}
              disabled={disabled}
              className="text-xs text-amber-700 hover:underline disabled:opacity-40"
            >
              + Add another item
            </button>
            <span className="text-sm font-medium text-amber-800">
              Items total {formatINR(itemsTotal)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
