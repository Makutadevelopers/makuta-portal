// audit.service.ts
// Writes audit log entries. Called from controllers after successful actions.
//
// IMPORTANT: audit writes must never fail the parent business operation.
// If the insert throws (e.g. FK violation on a just-deleted invoice), we log
// the error to stderr and return normally. The caller does not need to wrap this.

import { queryOne } from '../db/query';

interface AuditEntry {
  userId: string;
  action: string;
  invoiceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await queryOne(
      `INSERT INTO audit_logs (user_id, action, invoice_id, metadata)
       VALUES ($1, $2, $3, $4)`,
      [entry.userId, entry.action, entry.invoiceId ?? null, entry.metadata ? JSON.stringify(entry.metadata) : null]
    );
  } catch (err) {
    console.error('[audit] failed to write log entry:', {
      action: entry.action,
      invoiceId: entry.invoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    // swallow — auditing must never break business flow
  }
}
