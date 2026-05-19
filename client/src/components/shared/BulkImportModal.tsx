import { useState, useRef, ChangeEvent } from 'react';
import { apiFetch, getApiToken } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../hooks/useAuth';
import { useConfirm } from '../ui/ConfirmDialog';
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

interface UnknownSite { name: string; rowCount: number; }

interface HeaderReport {
  recognised: string[];
  unrecognised: string[];
  missing_required: string[];
}

interface PreviewResult {
  mode: 'preview';
  total: number;
  toImport: number;
  duplicates: DuplicateRow[];
  skipped: SkippedRow[];
  unknownSites?: UnknownSite[];
  canonicalSites?: string[];
  headers?: HeaderReport;
}

interface CommitResult {
  mode: 'commit';
  message: string;
  imported: number;
  total: number;
  batchId: string;
  skippedDuplicates: Array<{ row: number; invoiceNo: string; vendorName: string }>;
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
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  // Per-unknown-site remap chosen in the preview step. Key = original CSV site
  // name; value = canonical site name to rewrite it to, or '' to keep as-is.
  const [siteRemap, setSiteRemap] = useState<Record<string, string>>({});

  // Vendor flow state
  const [vendorResult, setVendorResult] = useState<LegacyResult | null>(null);

  // Shared error
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const { notify } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { user } = useAuth();
  const allowedSites = user?.sites && user.sites.length > 0
    ? user.sites
    : (user?.site ? [user.site] : []);
  const isSiteRole = user?.role === 'site';

  function resetState() {
    setFile(null);
    setPreview(null);
    setCommitResult(null);
    setVendorResult(null);
    setErrorMsg(null);
    setSiteRemap({});
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setPreview(null);
      setCommitResult(null);
      setVendorResult(null);
      setErrorMsg(null);
      setSiteRemap({});
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
      // Only send entries where the user picked a canonical target;
      // blank selections mean "keep as-is".
      const remapToSend: Record<string, string> = {};
      for (const [k, v] of Object.entries(siteRemap)) {
        if (v) remapToSend[k] = v;
      }
      if (Object.keys(remapToSend).length > 0) {
        fd.append('siteRemap', JSON.stringify(remapToSend));
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

  async function handleDownloadTemplate() {
    const type = importType === 'invoices' ? 'invoices' : 'vendors';
    const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
    const token = getApiToken();
    try {
      const res = await fetch(`${API_BASE}/import/template/${type}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'ngrok-skip-browser-warning': 'true',
        },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `makuta_${type}_template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      notify('Failed to download template', 'error');
    }
  }

  const nothingCommittedYet = !commitResult && !vendorResult;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      {confirmDialog}
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

        {/* Site hint for site-role bulk invoice imports */}
        {isSiteRole && importType === 'invoices' && allowedSites.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <div className="font-medium mb-0.5">
              Set the <code className="px-1 py-0.5 bg-white rounded border border-amber-200 font-mono">Site Location</code> column on every row.
            </div>
            <div>
              You can import for {allowedSites.length === 1 ? 'this site' : 'any of these sites'}:{' '}
              {allowedSites.map((s, i) => (
                <span key={s}>
                  <strong>{s}</strong>{i < allowedSites.length - 1 ? ', ' : ''}
                </span>
              ))}
              . Rows with a different or misspelled site are skipped.
            </div>
          </div>
        )}

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

            {preview.headers && preview.headers.unrecognised.length > 0 && (
              <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm">
                <div className="font-medium text-yellow-900 mb-1">
                  {preview.headers.unrecognised.length} column{preview.headers.unrecognised.length > 1 ? 's were' : ' was'} not recognised
                </div>
                <div className="text-xs text-yellow-800 mb-2">
                  These columns will be ignored on import. Rename them in your spreadsheet to a known column (Invoice date, Vendor Name, Payment Date, etc.) if they hold data you need:
                </div>
                <div className="flex flex-wrap gap-1">
                  {preview.headers.unrecognised.map(h => (
                    <span key={h} className="inline-block bg-white border border-yellow-300 text-yellow-900 text-xs rounded px-2 py-0.5">{h}</span>
                  ))}
                </div>
              </div>
            )}

            {preview.unknownSites && preview.unknownSites.length > 0 && preview.canonicalSites && (
              <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-sm">
                <div className="font-medium text-orange-900 mb-1">
                  {preview.unknownSites.length} site name{preview.unknownSites.length > 1 ? 's don’t' : ' doesn’t'} match a known project
                </div>
                <div className="text-xs text-orange-800 mb-2">
                  Pick the project each one belongs to, or leave it as-is to keep it as a new site.
                </div>
                <div className="space-y-2">
                  {preview.unknownSites.map(us => (
                    <div key={us.name} className="flex items-center gap-2 bg-white rounded border border-orange-200 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900 truncate">"{us.name}"</div>
                        <div className="text-[11px] text-gray-500">{us.rowCount} row{us.rowCount === 1 ? '' : 's'}</div>
                      </div>
                      <select
                        value={siteRemap[us.name] ?? ''}
                        onChange={e => setSiteRemap(r => ({ ...r, [us.name]: e.target.value }))}
                        className="text-xs border border-gray-200 rounded px-2 py-1.5 bg-white"
                      >
                        <option value="">Keep as-is (new project)</option>
                        {preview.canonicalSites!.map(s => (
                          <option key={s} value={s}>Map to {s}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {preview.duplicates.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                <div className="font-medium text-amber-900 mb-2">
                  {preview.duplicates.length} duplicate{preview.duplicates.length > 1 ? 's' : ''} will be skipped
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {preview.duplicates.map(d => (
                    <div key={d.row} className="rounded border border-amber-200 bg-white px-3 py-2 text-xs">
                      <div className="font-medium text-gray-900">
                        Row {d.row}: <span className="font-normal">#{d.invoiceNo}</span> · {d.vendorName}
                      </div>
                      <div className="text-gray-500 mt-0.5">
                        CSV: {formatINR(d.amount)} on {formatDate(d.invoiceDate)} · Site {d.site || '—'}
                      </div>
                      <div className="text-gray-500">
                        Existing: {formatINR(Number(d.existingAmount))} on {formatDate(d.existingDate)} · #{d.existingInvoiceNo ?? '(no invoice no)'}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-amber-700 mt-2">
                  One vendor cannot have two invoices with the same invoice number — these rows will not be imported.
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
                {uploading ? 'Importing...' : `Confirm & Import ${preview.toImport} Row${preview.toImport === 1 ? '' : 's'}`}
              </button>
              <button onClick={() => setPreview(null)} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">
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
              const ok = await confirm({
                title: `Delete ALL ${clearType}?`,
                message: 'This is irreversible and will wipe every row from the table. Use only for fresh imports.',
                confirmLabel: `Yes, delete all ${clearType}`,
                variant: 'danger',
              });
              if (!ok) return;
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
