import { useState, useEffect } from 'react';
import { getAttachments, Attachment } from '../../api/attachments';

interface Props {
  invoiceId: string;
  invoiceNo: string;
  onClose: () => void;
}

export default function AttachmentViewer({ invoiceId, invoiceNo, onClose }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Attachment | null>(null);

  useEffect(() => {
    getAttachments(invoiceId)
      .then(setAttachments)
      .catch(() => setAttachments([]))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  function isImage(mime: string | null): boolean {
    return !!mime && mime.startsWith('image/');
  }

  function isPdf(mime: string | null): boolean {
    return mime === 'application/pdf';
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Slide-in panel */}
      <div className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-sm font-medium text-gray-900">Attachments</div>
            <div className="text-xs text-gray-500 mt-0.5">Invoice #{invoiceNo}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">&#10005;</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">Loading...</div>
          ) : attachments.length === 0 ? (
            <div className="text-gray-400 text-sm text-center py-8">No attachments uploaded yet.</div>
          ) : (
            <div className="space-y-3">
              {attachments.map(att => (
                <div key={att.id} className="border border-gray-100 rounded-lg p-3">
                  {/* Thumbnail / icon */}
                  {isImage(att.mime_type) ? (
                    <div
                      className="w-full h-32 bg-gray-50 rounded-md mb-2 cursor-pointer overflow-hidden flex items-center justify-center"
                      onClick={() => setPreview(att)}
                    >
                      <img src={att.url} alt={att.file_name} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : isPdf(att.mime_type) ? (
                    <div
                      className="w-full h-32 bg-red-50 rounded-md mb-2 cursor-pointer flex items-center justify-center"
                      onClick={() => setPreview(att)}
                    >
                      <div className="text-center">
                        <div className="text-red-500 text-2xl mb-1">&#128196;</div>
                        <div className="text-xs text-red-600">Click to preview PDF</div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-16 bg-gray-50 rounded-md mb-2 flex items-center justify-center">
                      <div className="text-gray-400 text-2xl">&#128196;</div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-900 truncate">{att.file_name}</div>
                      <div className="text-xs text-gray-400">{att.file_size ? `${Math.round(att.file_size / 1024)} KB` : ''}</div>
                    </div>
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={att.file_name}
                      className="text-xs text-blue-600 hover:underline ml-3 flex-shrink-0"
                    >
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen preview */}
      {preview && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white text-2xl hover:text-gray-300" onClick={() => setPreview(null)}>&#10005;</button>
          <div className="max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            {isImage(preview.mime_type) ? (
              <img src={preview.url} alt={preview.file_name} className="max-w-full max-h-[90vh] object-contain" />
            ) : isPdf(preview.mime_type) ? (
              <iframe src={preview.url} title={preview.file_name} className="w-[80vw] h-[85vh] bg-white rounded-lg" />
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
