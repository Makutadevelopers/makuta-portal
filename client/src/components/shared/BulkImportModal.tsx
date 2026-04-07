import { useState, useRef, ChangeEvent } from 'react';
import { apiFetch } from '../../api/client';
import { useToast } from '../../context/ToastContext';

interface ImportResult {
  message: string;
  imported: number;
  skipped: number;
  total: number;
  duplicates?: Array<{ row: number; invoiceNo: string; vendorName: string }>;
  errors?: string[];
}

type ImportType = 'vendors' | 'payments';

export default function BulkImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [importType, setImportType] = useState<ImportType>('payments');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { notify } = useToast();

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setResult(null);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await apiFetch<ImportResult>(`/import/${importType}`, {
        method: 'POST',
        body: formData,
      });

      setResult(res);
      if (res.imported > 0) {
        notify(`Imported ${res.imported} ${importType}`);
      }
    } catch (err) {
      setResult({
        message: err instanceof Error ? err.message : 'Import failed',
        imported: 0,
        skipped: 0,
        total: 0,
      });
    } finally {
      setUploading(false);
    }
  }

  function handleDownloadTemplate() {
    window.open(`/api/import/template/${importType}`, '_blank');
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-lg w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="text-base font-medium text-gray-900">Bulk Import from CSV</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {/* Type selector */}
        <div className="flex items-center gap-2 mb-4">
          {([['payments', 'Invoices & Payments'], ['vendors', 'Vendors']] as [ImportType, string][]).map(([t, label]) => (
            <button key={t} onClick={() => { setImportType(t); setFile(null); setResult(null); }}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium ${
                importType === t ? 'bg-[#1a3c5e] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Template download */}
        <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
          First time? <button onClick={handleDownloadTemplate} className="underline font-medium">Download CSV template</button> to see the expected column format.
        </div>

        {/* File picker */}
        <div className="mb-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300"
          >
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

        {/* Result */}
        {result && (
          <div className="mb-4 space-y-3">
            <div className={`p-3 rounded-lg text-sm ${result.imported > 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              <div className="font-medium">{result.message}</div>
              {result.total > 0 && (
                <div className="text-xs mt-1">
                  Total rows: {result.total} · Imported: {result.imported} · Skipped: {result.skipped}
                </div>
              )}
              {result.errors && result.errors.length > 0 && (
                <div className="mt-2 text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-red-600">{err}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Duplicates found */}
            {result.duplicates && result.duplicates.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                <div className="font-medium text-amber-800 mb-2">
                  {result.duplicates.length} duplicate{result.duplicates.length > 1 ? 's' : ''} already in system — skipped:
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {result.duplicates.map((d, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-white rounded px-2.5 py-1.5 border border-amber-100">
                      <div>
                        <span className="font-medium text-gray-900">#{d.invoiceNo}</span>
                        <span className="text-gray-500 ml-2">{d.vendorName}</span>
                      </div>
                      <span className="text-amber-600 text-[10px]">Row {d.row}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="px-5 py-2.5 bg-[#1a3c5e] text-white text-sm font-medium rounded-lg hover:bg-[#15304d] disabled:opacity-50"
          >
            {uploading ? 'Importing...' : importType === 'payments' ? 'Import Invoices & Payments' : 'Import Vendors'}
          </button>
          {result && result.imported > 0 && (
            <button onClick={onDone} className="px-5 py-2.5 text-sm text-green-600 font-medium hover:underline">
              Done — Refresh Data
            </button>
          )}
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
