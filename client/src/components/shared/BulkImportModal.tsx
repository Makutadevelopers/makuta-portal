import { useState, useRef, ChangeEvent } from 'react';
import { apiFetch } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { formatINR, formatDate } from '../../utils/formatters';

// ── Response shapes ─────────────────────────────────────────────────────────
interface DuplicateRow {
  row: number;
  invoiceNo: string;
  vendorName: string;
  site: string;
  amount: number;
  invoiceDate: string;
  existingId: string;
  existingInvoiceNo: string | null;
  existingAmount: string;
  existingDate: string;
}

interface SkippedRow { row: number; reason: string; }

interface PreviewResult {
  mode: 'preview';
  total: number;
  toImport: number;
  duplicates: DuplicateRow[];
  skipped: SkippedRow[];
}

interface CommitResult {
  mode: 'commit';
  message: string;
  imported: number;
  total: number;
  batchId: string;
  forcedDuplicates: Array<{ row: number; invoiceNo: string; vendorName: string }>;
  skipped: SkippedRow[];
  errors: string[];
}

// Vendor import uses the legacy single-phase response
interface LegacyResult {
  message: string;
  imported: number;
  skipped: number;
  total: number;
  errors?: string[];
}

type ImportType = 'invoices' | 'vendors';

export default function BulkImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [importType, setImportType] = useState<ImportType>('invoices');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Invoice flow state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmedDupRows, setConfirmedDupRows] = useState<Set<number>>(new Set());
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  // Vendor flow state
  const [vendorResult, setVendorResult] = useState<LegacyResult | null>(null);

  // Shared error
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const { notify } = useToast();

  function resetState() {
    setFile(null);
    setPreview(null);
    setConfirmedDupRows(new Set());
    setCommitResult(null);
    setVendorResult(null);
    setErrorMsg(null);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setPreview(null);
      setCommitResult(null);
      setVendorResult(null);
      setErrorMsg(null);
    }
  }

  async function handleUploadVendors() {
    if (!file) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch<LegacyResult>('/import/vendors', { method: 'POST', body: fd });
      setVendorResult(res);
      if (res.imported > 0) notify(`Imported ${res.imported} vendors`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  async function handlePreview() {
    if (!file) return;
    setUploading(true);
    setErrorMsg(null);
    setCommitResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // No `mode` field → server defaults to preview
      const res = await apiFetch<PreviewResult>('/import/invoices', { method: 'POST', body: fd });
      setPreview(res);
      setConfirmedDupRows(new Set()); // user must opt-in each duplicate
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleCommit() {
    if (!file || !preview) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'commit');
      for (const rowNum of confirmedDupRows) {
        fd.append('confirmedDuplicates', String(rowNum));
      }
      const res = await apiFetch<CommitResult>('/import/invoices', { method: 'POST', body: fd });
      setCommitResult(res);
      if (res.imported > 0) notify(`Imported ${res.imported} invoices`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
    }
  }

  function toggleDupRow(rowNum: number) {
    setConfirmedDupRows(prev => {
      const next = new Set(prev);
      if (next.has(rowNum)) next.delete(rowNum); else next.add(rowNum);
      return next;
    });
  }

  function toggleAllDups() {
    if (!preview) return;
    if (confirmedDupRows.size === preview.duplicates.length) {
      setConfirmedDupRows(new Set());
    } else {
      setConfirmedDupRows(new Set(preview.duplicates.map(d => d.row)));
    }
  }

  function handleDownloadTemplate() {
    window.open(`/api/import/template/${importType === 'invoices' ? 'payments' : 'vendors'}`, '_blank');
  }

  const nothingCommittedYet = !commitResult && !vendorResult;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="text-base font-medium text-gray-900">Bulk Import from CSV</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {/* Type selector */}
        <div className="flex items-center gap-2 mb-4">
          {([['invoices', 'Invoices & Payments'], ['vendors', 'Vendors']] as [ImportType, string][]).map(([t, label]) => (
            <button key={t} onClick={() => { setImportType(t); resetState(); }}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
                importType === t ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Template download hint */}
        <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
          First time? <button onClick={handleDownloadTemplate} className="underline font-medium">Download CSV template</button> to see the expected column format.
        </div>

        {/* File picker (only show until we have a commit result) */}
        {nothingCommittedYet && (
          <div className="mb-4">
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="hidden" />
            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300">
              {file ? (
                <div>
                  <div className="text-sm font-medium text-gray-900">{file.name}</div>
                  <div className="text-xs text-gray-500">{Math.round(file.size / 1024)} KB — click to change</div>
                </div>
              ) : (
                <div>
                  <div className="text-sm text-gray-600 font-medium">Click to select CSV or Excel file</div>
                  <div className="text-xs text-gray-400 mt-1">.csv, .xlsx, .xls supported</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error bar */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 text-red-800 rounded-lg text-sm font-medium">{errorMsg}</div>
        )}

        {/* ── Invoice preview step ─────────────────────────────────────── */}
        {importType === 'invoices' && preview && !commitResult && (
          <div className="mb-4 space-y-3">
            <div className="p-3 rounded-lg bg-green-50 text-green-800 text-sm">
              <div className="font-medium">Preview ready — nothing has been imported yet.</div>
              <div className="text-xs mt-1">
                Total rows: {preview.total} · Will import: <strong>{preview.toImport}</strong> · Duplicates flagged: <strong>{preview.duplicates.length}</strong> · Skipped: {preview.skipped.length}
              </div>
            </div>

            {preview.duplicates.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-amber-900">
                    {preview.duplicates.length} possible duplicate{preview.duplicates.length > 1 ? 's' : ''} — review each one
                  </div>
                  <button onClick={toggleAllDups} className="text-xs text-amber-700 underline">
                    {confirmedDupRows.size === preview.duplicates.length ? 'Dismiss all' : 'Confirm all'}
                  </button>
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {preview.duplicates.map(d => {
                    const confirmed = confirmedDupRows.has(d.row);
                    return (
                      <div key={d.row} className={`rounded border px-3 py-2 ${confirmed ? 'border-green-300 bg-green-50' : 'border-amber-200 bg-white'}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="font-medium text-gray-900">
                              Row {d.row}: <span className="font-normal">#{d.invoiceNo}</span> · {d.vendorName}
                            </div>
                            <div className="text-gray-500 mt-0.5">
                              New: {formatINR(d.amount)} on {formatDate(d.invoiceDate)} · Site {d.site || '—'}
                            </div>
                            <div className="text-gray-500">
                              Existing: {formatINR(Number(d.existingAmount))} on {formatDate(d.existingDate)} · #{d.existingInvoiceNo ?? '(no invoice no)'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={() => toggleDupRow(d.row)}
                              className={`px-2.5 py-1 text-xs font-medium rounded ${
                                confirmed
                                  ? 'bg-green-600 text-white hover:bg-green-700'
                                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {confirmed ? '✓ Confirmed' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => { const next = new Set(confirmedDupRows); next.delete(d.row); setConfirmedDupRows(next); }}
                              className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-xs text-amber-700 mt-2">
                  Dismissed duplicates will not be imported. Confirmed ones will be created anyway (alerted to HO for audit).
                </div>
              </div>
            )}

            {preview.skipped.length > 0 && (
              <div className="p-3 rounded-lg bg-gray-50 text-xs text-gray-600 max-h-32 overflow-y-auto">
                <div className="font-medium mb-1">{preview.skipped.length} row{preview.skipped.length > 1 ? 's' : ''} will be skipped:</div>
                {preview.skipped.slice(0, 20).map(s => (
                  <div key={s.row}>Row {s.row}: {s.reason}</div>
                ))}
                {preview.skipped.length > 20 && <div className="text-gray-400">… and {preview.skipped.length - 20} more</div>}
              </div>
            )}
          </div>
        )}

        {/* ── Invoice commit result ────────────────────────────────────── */}
        {commitResult && (
          <div className="mb-4">
            <div className="p-3 rounded-lg bg-green-50 text-green-800 text-sm">
              <div className="font-medium">{commitResult.message}</div>
              <div className="text-xs mt-1">Batch ID: <code className="text-[10px]">{commitResult.batchId}</code></div>
            </div>
            {commitResult.errors && commitResult.errors.length > 0 && (
              <div className="mt-2 p-3 rounded-lg bg-red-50 text-red-700 text-xs space-y-0.5 max-h-32 overflow-y-auto">
                {commitResult.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}

        {/* ── Vendor result ────────────────────────────────────────────── */}
        {vendorResult && (
          <div className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 text-sm">
            <div className="font-medium">{vendorResult.message}</div>
            <div className="text-xs mt-1">Total: {vendorResult.total} · Imported: {vendorResult.imported} · Skipped: {vendorResult.skipped}</div>
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap mt-4">
          {/* Vendor flow */}
          {importType === 'vendors' && !vendorResult && (
            <button onClick={handleUploadVendors} disabled={!file || uploading}
              className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
              {uploading ? 'Importing...' : 'Import Vendors'}
            </button>
          )}

          {/* Invoice — step 1: preview */}
          {importType === 'invoices' && !preview && !commitResult && (
            <button onClick={handlePreview} disabled={!file || uploading}
              className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50">
              {uploading ? 'Analyzing...' : 'Preview Import'}
            </button>
          )}

          {/* Invoice — step 2: commit */}
          {importType === 'invoices' && preview && !commitResult && (
            <>
              <button onClick={handleCommit} disabled={uploading}
                className="px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
                {uploading ? 'Importing...' : `Confirm & Import ${preview.toImport + confirmedDupRows.size} Row${(preview.toImport + confirmedDupRows.size) === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => { setPreview(null); setConfirmedDupRows(new Set()); }} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">
                Back
              </button>
            </>
          )}

          {/* Done */}
          {(commitResult || vendorResult) && (
            <button onClick={onDone} className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d]">
              Done — Refresh Data
            </button>
          )}

          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>

          <button
            onClick={async () => {
              const clearType = importType === 'invoices' ? 'invoices' : 'vendors';
              if (!confirm(`Delete ALL ${clearType}? This cannot be undone.`)) return;
              setClearing(true);
              try {
                const res = await apiFetch<{ message: string; deleted: number }>(`/import/clear/${clearType}`, { method: 'DELETE' });
                notify(res.message, 'error');
                resetState();
                onDone();
              } catch (err) {
                notify(err instanceof Error ? err.message : 'Failed to clear', 'error');
              } finally {
                setClearing(false);
              }
            }}
            disabled={clearing}
            className="ml-auto px-4 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
          >
            {clearing ? 'Clearing...' : `Clear All ${importType === 'invoices' ? 'Invoices' : 'Vendors'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
