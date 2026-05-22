import { pool } from './query.js';

async function main() {
  const inv = await pool.query(
    `SELECT id, internal_no, invoice_no, vendor_name, site_location, invoice_amount,
            created_at, import_batch_id, created_by
     FROM invoices WHERE internal_no = $1`,
    ['MKT-03311']
  );
  console.log('--- invoice MKT-03311 ---');
  console.table(inv.rows);

  if (inv.rows.length === 0) { await pool.end(); return; }

  const invoiceId = inv.rows[0].id;
  const createdAt = inv.rows[0].created_at;

  const ownAudits = await pool.query(
    `SELECT a.action, a.created_at, u.name AS user_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.invoice_id = $1
     ORDER BY a.created_at ASC`,
    [invoiceId]
  );
  console.log('--- audit_logs FOR this invoice (all of them) ---');
  console.table(ownAudits.rows.map(r => ({ ...r, action: String(r.action).slice(0, 100) })));

  const batchAudits = await pool.query(
    `SELECT a.action, a.created_at, u.name AS user_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     WHERE action ILIKE 'Bulk imported %invoices%'
       AND a.created_at BETWEEN $1::timestamp - interval '1 hour'
                            AND $1::timestamp + interval '1 hour'
     ORDER BY a.created_at ASC`,
    [createdAt]
  );
  console.log('--- nearby "Bulk imported N invoices" audit rows (±1h of invoice creation) ---');
  console.table(batchAudits.rows.map(r => ({ ...r, action: String(r.action).slice(0, 100) })));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
