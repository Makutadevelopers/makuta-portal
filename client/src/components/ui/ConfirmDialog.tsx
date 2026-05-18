// In-app replacement for window.confirm(). Use via the useConfirm() hook:
//
//   const { confirm, dialog } = useConfirm();
//   // ...
//   if (!(await confirm({ title: 'Delete?', message: '...', variant: 'danger' }))) return;
//   // ...do the destructive thing
//   // and somewhere in JSX:
//   {dialog}
//
// Promise resolves true if the user confirms, false on cancel / backdrop / Escape.

import { useCallback, useEffect, useRef, useState } from 'react';

export type ConfirmVariant = 'danger' | 'warning' | 'primary';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const VARIANT_BTN: Record<ConfirmVariant, string> = {
  danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-200',
  warning: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-200',
  primary: 'bg-[#1a3c5e] hover:bg-[#15304d] focus:ring-blue-200',
};

export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback(
    (ok: boolean) => {
      if (pending) {
        pending.resolve(ok);
        setPending(null);
      }
    },
    [pending]
  );

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    }
    document.addEventListener('keydown', onKey);
    // Focus Cancel by default — safer than focusing the destructive button.
    cancelBtnRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, close]);

  const dialog = pending ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => close(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-2">
          <div id="confirm-dialog-title" className="text-base font-semibold text-gray-900">
            {pending.title}
          </div>
          <div className="mt-2 whitespace-pre-line text-sm text-gray-600">
            {pending.message}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-5 pt-3">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={() => close(false)}
            className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200"
          >
            {pending.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white focus:outline-none focus:ring-2 ${VARIANT_BTN[pending.variant ?? 'primary']}`}
          >
            {pending.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
