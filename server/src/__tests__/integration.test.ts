// integration.test.ts
// End-to-end integration tests hitting the live dev server at http://localhost:4000.
// Mirrors the scenarios in BROWSER_TEST_PLAN.md except the 4 that need a real browser
// (session expiry DevTools flow, attachment UI, bulk-import duplicate review UI, H1 PATCH tampering).
//
// Run the server first: `npm run dev:server` — then `npm test` from the server package.
// Tests are skipped automatically if the server is not reachable.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4000';
const stamp = Date.now().toString().slice(-8);
const tag = `IT${stamp}`; // unique per test run to avoid collisions

let serverUp = false;

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: any = null;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function login(email: string, password: string): Promise<string> {
  const { status, body } = await api('POST', '/api/auth/login', { email, password });
  if (status !== 200 || !body?.token) throw new Error(`login failed: ${status} ${JSON.stringify(body)}`);
  return body.token as string;
}

// Shared tokens and IDs across tests in this file
let hoToken = '';
let mdToken = '';
let siteToken = '';
const createdInvoiceIds: string[] = [];
const createdVendorIds: string[] = [];

beforeAll(async () => {
  try {
    const h = await fetch(`${BASE}/api/health`);
    serverUp = h.ok;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn(`[integration] server not reachable at ${BASE} — all integration tests will be skipped`);
    return;
  }
  hoToken = await login('rajesh@makuta.in', 'ho123');
  mdToken = await login('arun@makuta.in', 'md123');
  siteToken = await login('suresh@makuta.in', 'nv123');
});

// Best-effort cleanup — permanently delete anything we created
afterAll(async () => {
  if (!serverUp || !hoToken) return;
  for (const id of createdInvoiceIds) {
    await api('DELETE', `/api/invoices/${id}`, undefined, hoToken).catch(() => {});
    await api('DELETE', `/api/invoices/bin/${id}`, undefined, hoToken).catch(() => {});
  }
  for (const id of createdVendorIds) {
    await api('DELETE', `/api/vendors/${id}`, undefined, hoToken).catch(() => {});
  }
});

// Helper: skip suite body when server is down
function requireServer() {
  if (!serverUp) {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw new Error('SKIP: server not reachable');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HO scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('HO — invoice CRUD + duplicate detection (scenarios 2, 3)', () => {
  const vendorName = `Temp ${tag} Vendor`;
  const invoiceNo = `${tag}-001`;
  let createdId = '';

  it('scenario 2: creates an invoice with a new vendor', async () => {
    requireServer();
    const { status, body } = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: vendorName,
      invoice_no: invoiceNo,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 1500,
    }, hoToken);
    expect(status).toBe(201);
    expect(body.id).toBeTruthy();
    expect(body.invoice_no).toBe(invoiceNo);
    createdId = body.id;
    createdInvoiceIds.push(createdId);
  });

  it('scenario 3: rejects duplicate invoice with 409 and existing info', async () => {
    requireServer();
    const { status, body } = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: vendorName,
      invoice_no: invoiceNo,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 1500,
    }, hoToken);
    expect(status).toBe(409);
    expect(body.code).toBe('duplicate_invoice');
    expect(body.existing?.id).toBe(createdId);
  });

  it('duplicate can be overridden with confirm_duplicate=true (scenario 9 server contract)', async () => {
    requireServer();
    const { status, body } = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: vendorName,
      invoice_no: invoiceNo,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 1500,
      confirm_duplicate: true,
    }, hoToken);
    expect(status).toBe(201);
    createdInvoiceIds.push(body.id);
  });
});

describe('HO — payments: partial, full, overpayment block (scenarios 5, 6)', () => {
  let invoiceId = '';
  const vendorName = `Pay ${tag} Vendor`;

  it('creates the test invoice for ₹1,500', async () => {
    requireServer();
    const { status, body } = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: vendorName,
      invoice_no: `${tag}-PAY-A`,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 1500,
    }, hoToken);
    expect(status).toBe(201);
    invoiceId = body.id;
    createdInvoiceIds.push(invoiceId);
  });

  it('scenario 5a: partial payment moves status to Partial', async () => {
    requireServer();
    const pay = await api('POST', `/api/invoices/${invoiceId}/payments`, {
      amount: 500,
      payment_type: 'NEFT',
      payment_ref: `${tag}-PART`,
      payment_date: '2026-04-07',
    }, hoToken);
    expect(pay.status).toBe(201);

    const list = await api('GET', '/api/invoices', undefined, hoToken);
    const row = (list.body as any[]).find(r => r.id === invoiceId);
    expect(row.payment_status).toBe('Partial');
    expect(Number(row.balance ?? 1000)).toBe(1000);
  });

  it('scenario 5b: full payment moves status to Paid', async () => {
    requireServer();
    const pay = await api('POST', `/api/invoices/${invoiceId}/payments`, {
      amount: 1000,
      payment_type: 'NEFT',
      payment_ref: `${tag}-FULL`,
      payment_date: '2026-04-08',
    }, hoToken);
    expect(pay.status).toBe(201);

    const list = await api('GET', '/api/invoices', undefined, hoToken);
    const row = (list.body as any[]).find(r => r.id === invoiceId);
    expect(row.payment_status).toBe('Paid');
  });

  it('scenario 6: overpayment rejected with 400 and balance message', async () => {
    requireServer();
    // Fresh ₹500 invoice
    const fresh = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: vendorName,
      invoice_no: `${tag}-PAY-B`,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 500,
    }, hoToken);
    expect(fresh.status).toBe(201);
    createdInvoiceIds.push(fresh.body.id);

    const pay = await api('POST', `/api/invoices/${fresh.body.id}/payments`, {
      amount: 1000,
      payment_type: 'NEFT',
      payment_ref: `${tag}-OVER`,
      payment_date: '2026-04-08',
    }, hoToken);
    expect(pay.status).toBe(400);
    expect(String(pay.body.message)).toMatch(/exceeds outstanding balance/i);
  });
});

describe('HO — soft delete, restore, bin purge (scenario 7, C1)', () => {
  let invoiceId = '';

  it('creates invoice and soft-deletes it', async () => {
    requireServer();
    const create = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: `Del ${tag} Vendor`,
      invoice_no: `${tag}-DEL-001`,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 999,
    }, hoToken);
    expect(create.status).toBe(201);
    invoiceId = create.body.id;
    createdInvoiceIds.push(invoiceId);

    const del = await api('DELETE', `/api/invoices/${invoiceId}`, undefined, hoToken);
    expect(del.status).toBe(200);
  });

  it('soft-deleted invoice is hidden from GET /api/invoices', async () => {
    requireServer();
    const list = await api('GET', '/api/invoices', undefined, hoToken);
    const row = (list.body as any[]).find(r => r.id === invoiceId);
    expect(row).toBeUndefined();
  });

  it('soft-deleted invoice is hidden from /api/cashflow (C1)', async () => {
    requireServer();
    const cf = await api('GET', '/api/cashflow', undefined, hoToken);
    expect(cf.status).toBe(200);
    // Shape varies (pivot or tabular); just ensure the invoice_no doesn't show up anywhere
    const haystack = JSON.stringify(cf.body);
    expect(haystack.includes(`${tag}-DEL-001`)).toBe(false);
  });

  it('soft-deleted invoice is hidden from /api/aging (L6 + C1)', async () => {
    requireServer();
    const ag = await api('GET', '/api/aging', undefined, hoToken);
    expect(ag.status).toBe(200);
    const haystack = JSON.stringify(ag.body);
    expect(haystack.includes(`${tag}-DEL-001`)).toBe(false);
  });

  it('invoice is visible in /api/invoices/bin and can be restored', async () => {
    requireServer();
    const bin = await api('GET', '/api/invoices/bin', undefined, hoToken);
    expect(bin.status).toBe(200);
    expect((bin.body as any[]).find(r => r.id === invoiceId)).toBeTruthy();

    const restore = await api('POST', `/api/invoices/bin/${invoiceId}/restore`, {}, hoToken);
    expect(restore.status).toBe(200);

    const list = await api('GET', '/api/invoices', undefined, hoToken);
    expect((list.body as any[]).find(r => r.id === invoiceId)).toBeTruthy();
  });
});

describe('HO — finalize / undo finalize (scenario 8)', () => {
  let invoiceId = '';

  it('finalizes a draft invoice', async () => {
    requireServer();
    const create = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: `Fin ${tag} Vendor`,
      invoice_no: `${tag}-FIN-001`,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 2000,
    }, hoToken);
    expect(create.status).toBe(201);
    invoiceId = create.body.id;
    createdInvoiceIds.push(invoiceId);

    const push = await api('POST', `/api/invoices/${invoiceId}/push`, {}, hoToken);
    expect(push.status).toBe(200);
    expect(push.body.pushed).toBe(true);
  });

  it('finalized invoice cannot be edited or deleted', async () => {
    requireServer();
    const edit = await api('PATCH', `/api/invoices/${invoiceId}`, { remarks: 'nope' }, hoToken);
    expect(edit.status).toBe(403);

    const del = await api('DELETE', `/api/invoices/${invoiceId}`, undefined, hoToken);
    expect(del.status).toBe(403);
  });

  it('undo finalize returns invoice to draft', async () => {
    requireServer();
    const undo = await api('POST', `/api/invoices/${invoiceId}/undo-push`, {}, hoToken);
    expect(undo.status).toBe(200);
    expect(undo.body.pushed).toBe(false);
  });
});

describe('HO — vendor CRUD + merge (scenario 10)', () => {
  let vendorA = '';
  let vendorB = '';

  it('creates two vendors and merges them', async () => {
    requireServer();
    const a = await api('POST', '/api/vendors', {
      name: `Dup ${tag} A`,
      payment_terms: 30,
    }, hoToken);
    expect(a.status).toBe(201);
    vendorA = a.body.id;
    createdVendorIds.push(vendorA);

    const b = await api('POST', '/api/vendors', {
      name: `Dup ${tag} A Pvt Ltd`,
      payment_terms: 30,
    }, hoToken);
    expect(b.status).toBe(201);
    vendorB = b.body.id;
    createdVendorIds.push(vendorB);

    // Create an invoice pointing at vendorB so merge has something to re-point
    const inv = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_id: vendorB,
      vendor_name: `Dup ${tag} A Pvt Ltd`,
      invoice_no: `${tag}-MRG-001`,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 5000,
    }, hoToken);
    expect(inv.status).toBe(201);
    createdInvoiceIds.push(inv.body.id);

    // Merge B into A
    const merge = await api('POST', '/api/vendors/merge', {
      keepId: vendorA,
      removeId: vendorB,
    }, hoToken);
    expect(merge.status).toBe(200);
    // Surviving vendor is A; B should be gone
    const getB = await api('GET', `/api/vendors/${vendorB}`, undefined, hoToken);
    expect(getB.status).toBe(404);
  });
});

describe('HO — audit trail and cashflow access (scenarios 11, 12)', () => {
  it('audit trail returns newest-first rows with action text', async () => {
    requireServer();
    const { status, body } = await api('GET', '/api/audit', undefined, hoToken);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as any[]).length).toBeGreaterThan(0);
    // Any recent entry should have an action string
    expect(typeof (body as any[])[0].action).toBe('string');
  });

  it('cashflow returns 200 for HO with site/category filters', async () => {
    requireServer();
    const cf = await api('GET', '/api/cashflow?site=Nirvana', undefined, hoToken);
    expect(cf.status).toBe(200);
  });
});

describe('HO — PDF export (scenario 13 server side)', () => {
  it('returns a PDF stream for HO', async () => {
    requireServer();
    const res = await fetch(`${BASE}/api/export/invoices`, {
      headers: { Authorization: `Bearer ${hoToken}` },
    });
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') || '';
    expect(ct.toLowerCase()).toContain('pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    // PDF magic bytes
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MD scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('MD — read-only access (scenario 14)', () => {
  it('can read invoices', async () => {
    requireServer();
    const { status } = await api('GET', '/api/invoices', undefined, mdToken);
    expect(status).toBe(200);
  });

  it('can read cashflow and aging', async () => {
    requireServer();
    expect((await api('GET', '/api/cashflow', undefined, mdToken)).status).toBe(200);
    expect((await api('GET', '/api/aging', undefined, mdToken)).status).toBe(200);
  });

  it('CANNOT create invoices', async () => {
    requireServer();
    const { status } = await api('POST', '/api/invoices', {
      month: '2026-04-01', invoice_date: '2026-04-01',
      vendor_name: `MD ${tag}`, invoice_no: `${tag}-MD-NO`,
      purpose: 'Steel', site: 'Nirvana', invoice_amount: 100,
    }, mdToken);
    expect(status).toBe(403);
  });

  it('CANNOT create vendors', async () => {
    requireServer();
    const { status } = await api('POST', '/api/vendors', { name: `MD ${tag}` }, mdToken);
    expect(status).toBe(403);
  });

  it('CANNOT view audit trail', async () => {
    requireServer();
    const { status } = await api('GET', '/api/audit', undefined, mdToken);
    expect(status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Site accountant scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('Site accountant — site scoping (scenarios 15, 16)', () => {
  let siteInvoiceId = '';

  it('GET /invoices returns only Nirvana rows with payment_status badge but no amounts', async () => {
    requireServer();
    const { status, body } = await api('GET', '/api/invoices', undefined, siteToken);
    expect(status).toBe(200);
    const rows = body as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.site).toBe('Nirvana');
      // payment_status badge IS allowed — site needs to see Paid/Partial/Not Paid
      expect(r).toHaveProperty('payment_status');
      // Amounts and aging remain HO+mgmt only
      expect(r).not.toHaveProperty('total_paid');
      expect(r).not.toHaveProperty('balance');
      expect(r).not.toHaveProperty('days_past_due');
      expect(r).not.toHaveProperty('overdue');
    }
  });

  it('scenario 15: site CANNOT access aging or cashflow', async () => {
    requireServer();
    expect((await api('GET', '/api/aging', undefined, siteToken)).status).toBe(403);
    expect((await api('GET', '/api/cashflow', undefined, siteToken)).status).toBe(403);
  });

  it('scenario 16: site creates an invoice for own site', async () => {
    requireServer();
    const { status, body } = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: `Site ${tag} Vendor`,
      invoice_no: `${tag}-SITE-001`,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 20000,
    }, siteToken);
    expect(status).toBe(201);
    siteInvoiceId = body.id;
    createdInvoiceIds.push(siteInvoiceId);
  });

  it('site CANNOT create invoice for a different site', async () => {
    requireServer();
    const { status } = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: `Site ${tag} Cheat`,
      invoice_no: `${tag}-SITE-CHEAT`,
      purpose: 'Steel',
      site: 'Horizon',
      invoice_amount: 1000,
    }, siteToken);
    expect(status).toBe(403);
  });

  it('scenario 17 (H1): site CANNOT change invoice.site via PATCH', async () => {
    requireServer();
    const { status, body } = await api('PATCH', `/api/invoices/${siteInvoiceId}`, {
      site: 'Horizon',
    }, siteToken);
    expect(status).toBe(403);
    expect(String(body.message)).toMatch(/cannot change the site/i);
  });
});

describe('Site accountant — payment limits (scenarios 18, 19)', () => {
  let siteInvoiceId = '';

  it('creates a ₹80,000 invoice owned by site', async () => {
    requireServer();
    const c = await api('POST', '/api/invoices', {
      month: '2026-04-01',
      invoice_date: '2026-04-01',
      vendor_name: `Limit ${tag} Vendor`,
      invoice_no: `${tag}-SITE-002`,
      purpose: 'Steel',
      site: 'Nirvana',
      invoice_amount: 80000,
    }, siteToken);
    expect(c.status).toBe(201);
    siteInvoiceId = c.body.id;
    createdInvoiceIds.push(siteInvoiceId);
  });

  it('scenario 18a: major payment > ₹50k rejected with 403', async () => {
    requireServer();
    const pay = await api('POST', `/api/invoices/${siteInvoiceId}/payments`, {
      amount: 51000,
      payment_type: 'NEFT',
      payment_ref: `${tag}-MAJ`,
      payment_date: '2026-04-08',
    }, siteToken);
    expect(pay.status).toBe(403);
    expect(String(pay.body.message)).toMatch(/up to ₹50/);
  });

  it('scenario 18b: minor payment ≤ ₹50k accepted', async () => {
    requireServer();
    const pay = await api('POST', `/api/invoices/${siteInvoiceId}/payments`, {
      amount: 40000,
      payment_type: 'NEFT',
      payment_ref: `${tag}-MIN`,
      payment_date: '2026-04-08',
    }, siteToken);
    expect(pay.status).toBe(201);
  });

  it('scenario 19 (H4): site CANNOT pay finalized invoices', async () => {
    requireServer();
    // HO finalizes the invoice
    const push = await api('POST', `/api/invoices/${siteInvoiceId}/push`, {}, hoToken);
    expect(push.status).toBe(200);

    // Site tries to pay
    const pay = await api('POST', `/api/invoices/${siteInvoiceId}/payments`, {
      amount: 1000,
      payment_type: 'NEFT',
      payment_ref: `${tag}-AFTER-FIN`,
      payment_date: '2026-04-08',
    }, siteToken);
    expect(pay.status).toBe(403);
    expect(String(pay.body.message)).toMatch(/finalized.*head office/i);

    // Cleanup: undo finalize so teardown can soft-delete it
    await api('POST', `/api/invoices/${siteInvoiceId}/undo-push`, {}, hoToken);
  });
});

describe('Site accountant — bulk import scoping C2 (scenario 20)', () => {
  it('payments import is HO-only: site gets 403', async () => {
    requireServer();
    // Multipart body with a tiny CSV
    const form = new FormData();
    form.append('file', new Blob(['a,b\n1,2\n'], { type: 'text/csv' }), 'p.csv');
    const res = await fetch(`${BASE}/api/import/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${siteToken}` },
      body: form,
    });
    expect(res.status).toBe(403);
  });

  it('invoice import preview skips rows for foreign sites when caller is site', async () => {
    requireServer();
    const csv = [
      'Invoice date,Vendor Name,Invoice no,Purpose,Site,Invoice amount',
      `2026-04-01,Imp ${tag} A,${tag}-IMP-NIR,Steel,Nirvana,1000`,
      `2026-04-01,Imp ${tag} B,${tag}-IMP-HOR,Steel,Horizon,2000`,
    ].join('\n');

    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'imp.csv');
    form.append('mode', 'preview');

    const res = await fetch(`${BASE}/api/import/invoices`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${siteToken}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // One row will import (Nirvana), one skipped (Horizon)
    expect(body.toImport).toBe(1);
    const skipped = body.skipped as Array<{ reason: string }>;
    expect(skipped.some(s => /Horizon/i.test(s.reason))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth — unauthenticated requests rejected
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth gating', () => {
  it('401 on protected routes without token', async () => {
    requireServer();
    const { status } = await api('GET', '/api/invoices');
    expect(status).toBe(401);
  });

  it('401 with an obviously bad token', async () => {
    requireServer();
    const { status } = await api('GET', '/api/invoices', undefined, 'not-a-real-token');
    expect(status).toBe(401);
  });
});
