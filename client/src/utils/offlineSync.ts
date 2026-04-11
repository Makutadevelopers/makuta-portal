// offlineSync.ts
// Queues invoice creation requests when offline and syncs when back online.
// Uses IndexedDB via a simple wrapper for persistence.

const DB_NAME = 'makuta-offline';
const STORE_NAME = 'pending-invoices';
const DB_VERSION = 1;

interface PendingInvoice {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOfflineInvoice(data: Record<string, unknown>): Promise<string> {
  const db = await openDB();
  const id = crypto.randomUUID();
  const entry: PendingInvoice = { id, data, createdAt: new Date().toISOString() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(entry);
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingInvoices(): Promise<PendingInvoice[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as PendingInvoice[]);
    request.onerror = () => reject(request.error);
  });
}

export async function removePendingInvoice(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function syncPendingInvoices(
  apiPost: (url: string, body: Record<string, unknown>) => Promise<unknown>
): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingInvoices();
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      await apiPost('/invoices', item.data);
      await removePendingInvoice(item.id);
      synced++;
    } catch {
      failed++;
    }
  }

  return { synced, failed };
}

export function getPendingCount(): Promise<number> {
  return getPendingInvoices().then(items => items.length);
}
