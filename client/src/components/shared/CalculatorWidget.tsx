import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';

const GST_RATES = [5, 12, 18, 28];

type Op = '+' | '-' | '*' | '/' | null;

export default function CalculatorWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // Calculator state
  const [display, setDisplay] = useState('0');
  const [stored, setStored] = useState<number | null>(null);
  const [op, setOp] = useState<Op>(null);
  const [replace, setReplace] = useState(true);

  const compute = useCallback((a: number, b: number, operation: Op): number => {
    switch (operation) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? NaN : a / b;
      default: return b;
    }
  }, []);

  const inputDigit = useCallback((d: string) => {
    setDisplay(prev => {
      if (replace) { setReplace(false); return d === '.' ? '0.' : d; }
      if (d === '.' && prev.includes('.')) return prev;
      if (prev === '0' && d !== '.') return d;
      return prev + d;
    });
  }, [replace]);

  const chooseOp = useCallback((next: Op) => {
    const current = Number(display);
    if (stored !== null && op && !replace) {
      const result = compute(stored, current, op);
      setStored(result);
      setDisplay(String(+result.toFixed(6)));
    } else {
      setStored(current);
    }
    setOp(next);
    setReplace(true);
  }, [display, stored, op, replace, compute]);

  const equals = useCallback(() => {
    if (stored === null || op === null) return;
    const current = Number(display);
    const result = compute(stored, current, op);
    setDisplay(String(+result.toFixed(6)));
    setStored(null);
    setOp(null);
    setReplace(true);
  }, [display, stored, op, compute]);

  const clearAll = useCallback(() => {
    setDisplay('0');
    setStored(null);
    setOp(null);
    setReplace(true);
  }, []);

  const backspace = useCallback(() => {
    setDisplay(prev => {
      if (replace) return prev;
      if (prev.length <= 1 || (prev.length === 2 && prev.startsWith('-'))) return '0';
      return prev.slice(0, -1);
    });
  }, [replace]);

  const percent = useCallback(() => {
    setDisplay(prev => String(Number(prev) / 100));
  }, []);

  const applyGst = useCallback((rate: number, add: boolean) => {
    const current = Number(display);
    const factor = 1 + rate / 100;
    const result = add ? current * factor : current / factor;
    setDisplay(String(+result.toFixed(2)));
    setReplace(true);
  }, [display]);

  // Keyboard input when panel is open
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) { inputDigit(e.key); e.preventDefault(); return; }
      if (e.key === '.') { inputDigit('.'); return; }
      if (e.key === '+') { chooseOp('+'); return; }
      if (e.key === '-') { chooseOp('-'); return; }
      if (e.key === '*') { chooseOp('*'); return; }
      if (e.key === '/') { e.preventDefault(); chooseOp('/'); return; }
      if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); equals(); return; }
      if (e.key === 'Backspace') { backspace(); return; }
      if (e.key === 'Escape') { clearAll(); return; }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, inputDigit, chooseOp, equals, backspace, clearAll]);

  // MD doesn't get the calculator (per spec)
  if (user?.role === 'mgmt') return null;

  const formattedDisplay = (() => {
    const n = Number(display);
    if (Number.isNaN(n)) return 'Error';
    const [int, dec] = display.split('.');
    const intFmt = Number(int).toLocaleString('en-IN');
    return dec !== undefined ? `${intFmt}.${dec}` : intFmt;
  })();

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-[#1a3c5e] text-white shadow-lg hover:bg-[#15304d] flex items-center justify-center"
          title="Calculator"
          aria-label="Open calculator"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="6" x2="16" y2="6" />
            <line x1="8" y1="10" x2="8" y2="10" />
            <line x1="12" y1="10" x2="12" y2="10" />
            <line x1="16" y1="10" x2="16" y2="10" />
            <line x1="8" y1="14" x2="8" y2="14" />
            <line x1="12" y1="14" x2="12" y2="14" />
            <line x1="16" y1="14" x2="16" y2="14" />
            <line x1="8" y1="18" x2="8" y2="18" />
            <line x1="12" y1="18" x2="16" y2="18" />
          </svg>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-[#1a3c5e] text-white flex items-center justify-between">
            <span className="text-sm font-medium">Calculator</span>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white text-lg leading-none" aria-label="Close">&times;</button>
          </div>

          {/* Display */}
          <div className="px-4 py-3 bg-gray-50 text-right">
            {op && stored !== null && (
              <div className="text-xs text-gray-400 font-mono">
                {Number(stored).toLocaleString('en-IN')} {op}
              </div>
            )}
            <div className="text-2xl font-mono text-gray-900 break-all">{formattedDisplay}</div>
          </div>

          {/* GST shortcuts */}
          <div className="px-3 py-2 bg-amber-50 border-y border-amber-100">
            <div className="text-[10px] text-amber-800 mb-1 font-medium">GST shortcuts</div>
            <div className="grid grid-cols-4 gap-1">
              {GST_RATES.map(r => (
                <button
                  key={`add-${r}`}
                  onClick={() => applyGst(r, true)}
                  className="px-1 py-1.5 text-[11px] bg-white border border-amber-200 rounded hover:bg-amber-100 font-medium text-amber-900"
                  title={`Add ${r}% GST`}
                >+{r}%</button>
              ))}
              {GST_RATES.map(r => (
                <button
                  key={`sub-${r}`}
                  onClick={() => applyGst(r, false)}
                  className="px-1 py-1.5 text-[11px] bg-white border border-amber-200 rounded hover:bg-amber-100 font-medium text-amber-900"
                  title={`Remove ${r}% GST`}
                >-{r}%</button>
              ))}
            </div>
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-4 gap-1 p-2">
            <button onClick={clearAll} className="col-span-2 py-3 bg-red-50 text-red-700 rounded hover:bg-red-100 text-sm font-medium">AC</button>
            <button onClick={backspace} className="py-3 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm font-medium">⌫</button>
            <button onClick={() => chooseOp('/')} className={`py-3 rounded text-sm font-medium ${op === '/' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}>÷</button>

            {['7','8','9'].map(d => <KeyBtn key={d} label={d} onClick={() => inputDigit(d)} />)}
            <button onClick={() => chooseOp('*')} className={`py-3 rounded text-sm font-medium ${op === '*' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}>×</button>

            {['4','5','6'].map(d => <KeyBtn key={d} label={d} onClick={() => inputDigit(d)} />)}
            <button onClick={() => chooseOp('-')} className={`py-3 rounded text-sm font-medium ${op === '-' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}>−</button>

            {['1','2','3'].map(d => <KeyBtn key={d} label={d} onClick={() => inputDigit(d)} />)}
            <button onClick={() => chooseOp('+')} className={`py-3 rounded text-sm font-medium ${op === '+' ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}>+</button>

            <button onClick={percent} className="py-3 bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-sm font-medium">%</button>
            <KeyBtn label="0" onClick={() => inputDigit('0')} />
            <KeyBtn label="." onClick={() => inputDigit('.')} />
            <button onClick={equals} className="py-3 bg-[#1a3c5e] text-white rounded hover:bg-[#15304d] text-sm font-medium">=</button>
          </div>

          <div className="px-3 pb-2 text-[10px] text-gray-400">
            Keyboard: digits, +−×÷, Enter = , Backspace ⌫, Esc AC
          </div>
        </div>
      )}
    </>
  );
}

function KeyBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="py-3 bg-white border border-gray-100 rounded hover:bg-gray-50 text-sm font-medium text-gray-900">
      {label}
    </button>
  );
}
