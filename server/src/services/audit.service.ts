// audit.service.ts
// Writes audit log entries. Called from controllers after successful actions.

import { queryOne } from '../db/query';

interface AuditEntry {
  userId: string;
  action: string;
  invoiceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  await queryOne(
    `INSERT INTO audit_logs (user_id, action, invoice_id, metadata)
     VALUES ($1, $2, $3, $4)`,
    [entry.userId, entry.action, entry.invoiceId ?? null, entry.metadata ? JSON.stringify(entry.metadata) : null]
  );
}
