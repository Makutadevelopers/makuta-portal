export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  invoice_id: string | null;
  invoice_no: string | null;
  invoice_site: string | null;
  vendor_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
