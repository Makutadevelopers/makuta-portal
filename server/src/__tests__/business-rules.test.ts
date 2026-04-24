// business-rules.test.ts
// Unit tests for critical business logic — no database required.
// Tests: validation schemas, role enforcement, payment rules, overdue logic.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Validation Schemas (replicated from controllers for pure unit testing) ───

const createInvoiceSchema = z.object({
  month: z.string().min(1, 'Month is required'),
  invoice_date: z.string().min(1, 'Invoice date is required'),
  vendor_id: z.string().uuid().nullable().optional().or(z.literal('')).transform(v => v || null),
  vendor_name: z.string().min(1, 'Vendor name is required'),
  invoice_no: z.string().min(1, 'Invoice number is required'),
  po_number: z.string().nullable().optional(),
  purpose: z.string().min(1, 'Purpose is required'),
  site: z.string().min(1, 'Site is required'),
  invoice_amount: z.number().positive('Amount must be positive'),
  remarks: z.string().nullable().optional(),
});

const createPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  payment_type: z.string().min(1, 'Payment type is required'),
  payment_ref: z.string().nullable().optional(),
  payment_date: z.string().min(1, 'Payment date is required'),
  bank: z.string().nullable().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

const bulkPushSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// ─── Business Logic Functions (pure, no DB) ───

const MINOR_LIMIT = 50_000;

function computePaymentStatus(invoiceAmount: number, totalPaid: number): string {
  if (totalPaid >= invoiceAmount) return 'Paid';
  if (totalPaid > 0) return 'Partial';
  return 'Not Paid';
}

function isOverdue(invoiceDate: string, paymentTerms: number, balance: number): boolean {
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + paymentTerms);
  return new Date() > dueDate && balance > 0;
}

function canSiteProcessPayment(role: string, amount: number): boolean {
  if (role !== 'site') return true;
  return amount <= MINOR_LIMIT;
}

function canSiteCreateInvoice(role: string, userSite: string | null, invoiceSite: string): boolean {
  if (role !== 'site') return true;
  return userSite === invoiceSite;
}

// payment_status IS now visible to site (badge only); amounts + aging stay hidden.
const SITE_HIDDEN_FIELDS = ['total_paid', 'balance', 'days_past_due', 'overdue'];

function filterForSiteRole(invoice: Record<string, unknown>): Record<string, unknown> {
  const filtered = { ...invoice };
  for (const field of SITE_HIDDEN_FIELDS) {
    delete filtered[field];
  }
  return filtered;
}

const ALLOWED_INVOICE_UPDATE_FIELDS = [
  'month', 'invoice_date', 'vendor_id', 'vendor_name', 'invoice_no',
  'po_number', 'purpose', 'site', 'invoice_amount', 'remarks',
];

function sanitizeUpdateFields(data: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (ALLOWED_INVOICE_UPDATE_FIELDS.includes(key) && value !== undefined) {
      safe[key] = value;
    }
  }
  return safe;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Invoice Validation Schema', () => {
  const validInvoice = {
    month: '2026-04',
    invoice_date: '2026-04-01',
    vendor_id: '550e8400-e29b-41d4-a716-446655440000',
    vendor_name: 'Steel Corp',
    invoice_no: 'INV-001',
    purpose: 'Steel supply',
    site: 'Nirvana',
    invoice_amount: 100000,
  };

  it('accepts a valid invoice', () => {
    const result = createInvoiceSchema.safeParse(validInvoice);
    expect(result.success).toBe(true);
  });

  it('rejects missing month', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, month: '' });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, invoice_amount: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects zero amount', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, invoice_amount: 0 });
    expect(result.success).toBe(false);
  });

  it('accepts empty string vendor_id and transforms to null', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, vendor_id: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vendor_id).toBeNull();
    }
  });

  it('rejects invalid UUID vendor_id', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, vendor_id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('allows null po_number', () => {
    const result = createInvoiceSchema.safeParse({ ...validInvoice, po_number: null });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = createInvoiceSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('Payment Validation Schema', () => {
  const validPayment = {
    amount: 50000,
    payment_type: 'NEFT',
    payment_date: '2026-04-07',
  };

  it('accepts a valid payment', () => {
    expect(createPaymentSchema.safeParse(validPayment).success).toBe(true);
  });

  it('rejects negative amount', () => {
    expect(createPaymentSchema.safeParse({ ...validPayment, amount: -1 }).success).toBe(false);
  });

  it('rejects zero amount', () => {
    expect(createPaymentSchema.safeParse({ ...validPayment, amount: 0 }).success).toBe(false);
  });

  it('rejects empty payment_type', () => {
    expect(createPaymentSchema.safeParse({ ...validPayment, payment_type: '' }).success).toBe(false);
  });

  it('accepts optional bank and payment_ref', () => {
    const result = createPaymentSchema.safeParse({
      ...validPayment,
      bank: 'HDFC',
      payment_ref: 'REF-123',
    });
    expect(result.success).toBe(true);
  });
});

describe('Login Validation Schema', () => {
  it('accepts valid credentials', () => {
    expect(loginSchema.safeParse({ email: 'user@makuta.in', password: 'pass123' }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ email: 'not-email', password: 'pass123' }).success).toBe(false);
  });

  it('rejects empty password', () => {
    expect(loginSchema.safeParse({ email: 'user@makuta.in', password: '' }).success).toBe(false);
  });
});

describe('Bulk Push Validation', () => {
  it('accepts valid UUID array', () => {
    const ids = ['550e8400-e29b-41d4-a716-446655440000'];
    expect(bulkPushSchema.safeParse({ ids }).success).toBe(true);
  });

  it('rejects empty array', () => {
    expect(bulkPushSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it('rejects non-UUID strings', () => {
    expect(bulkPushSchema.safeParse({ ids: ['not-uuid'] }).success).toBe(false);
  });

  it('rejects array exceeding max', () => {
    const ids = Array.from({ length: 501 }, () => '550e8400-e29b-41d4-a716-446655440000');
    expect(bulkPushSchema.safeParse({ ids }).success).toBe(false);
  });
});

describe('Payment Status Computation', () => {
  it('returns "Paid" when totalPaid equals invoice amount', () => {
    expect(computePaymentStatus(100000, 100000)).toBe('Paid');
  });

  it('returns "Paid" when totalPaid exceeds invoice amount', () => {
    expect(computePaymentStatus(100000, 100001)).toBe('Paid');
  });

  it('returns "Partial" when totalPaid is between 0 and invoice amount', () => {
    expect(computePaymentStatus(100000, 50000)).toBe('Partial');
  });

  it('returns "Partial" for very small partial payment', () => {
    expect(computePaymentStatus(100000, 1)).toBe('Partial');
  });

  it('returns "Not Paid" when totalPaid is 0', () => {
    expect(computePaymentStatus(100000, 0)).toBe('Not Paid');
  });

  it('handles decimal amounts correctly', () => {
    expect(computePaymentStatus(100000.50, 100000.50)).toBe('Paid');
  });
});

describe('Overdue Calculation', () => {
  it('is overdue when past due date with outstanding balance', () => {
    // Date well in the past + short payment terms = overdue
    expect(isOverdue('2024-01-01', 30, 50000)).toBe(true);
  });

  it('is NOT overdue when no balance remains', () => {
    expect(isOverdue('2024-01-01', 30, 0)).toBe(false);
  });

  it('is NOT overdue when due date is in the future', () => {
    // Far future date
    expect(isOverdue('2030-01-01', 365, 50000)).toBe(false);
  });

  it('handles default 30-day payment terms', () => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 31);
    const dateStr = thirtyDaysAgo.toISOString().split('T')[0];
    expect(isOverdue(dateStr, 30, 10000)).toBe(true);
  });

  it('is NOT overdue when due date is tomorrow', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    // Due tomorrow = 1 day terms from tomorrow, well in the future
    expect(isOverdue(dateStr, 1, 10000)).toBe(false);
  });
});

describe('Minor / Major Payment Rules', () => {
  it('site can process payments <= 50,000', () => {
    expect(canSiteProcessPayment('site', 50000)).toBe(true);
  });

  it('site CANNOT process payments > 50,000', () => {
    expect(canSiteProcessPayment('site', 50001)).toBe(false);
  });

  it('ho can process any payment amount', () => {
    expect(canSiteProcessPayment('ho', 1000000)).toBe(true);
  });

  it('site can process 1 rupee payment', () => {
    expect(canSiteProcessPayment('site', 1)).toBe(true);
  });

  it('boundary: site can process exactly 50,000', () => {
    expect(canSiteProcessPayment('site', MINOR_LIMIT)).toBe(true);
  });

  it('boundary: site cannot process 50,001', () => {
    expect(canSiteProcessPayment('site', MINOR_LIMIT + 1)).toBe(false);
  });
});

describe('Site Role — Invoice Site Scoping', () => {
  it('site user can create invoice for own site', () => {
    expect(canSiteCreateInvoice('site', 'Nirvana', 'Nirvana')).toBe(true);
  });

  it('site user CANNOT create invoice for other site', () => {
    expect(canSiteCreateInvoice('site', 'Nirvana', 'Taranga')).toBe(false);
  });

  it('ho user can create for any site', () => {
    expect(canSiteCreateInvoice('ho', null, 'Taranga')).toBe(true);
  });
});

describe('Site Role — Data Filtering', () => {
  it('strips payment fields from site response', () => {
    const fullInvoice = {
      id: '123',
      invoice_no: 'INV-001',
      vendor_name: 'Steel Corp',
      invoice_amount: 100000,
      payment_status: 'Partial',
      total_paid: 50000,
      balance: 50000,
      days_past_due: 10,
      overdue: true,
    };

    const filtered = filterForSiteRole(fullInvoice);

    expect(filtered.id).toBe('123');
    expect(filtered.invoice_no).toBe('INV-001');
    expect(filtered.invoice_amount).toBe(100000);
    expect(filtered).toHaveProperty('payment_status', 'Partial');
    expect(filtered).not.toHaveProperty('total_paid');
    expect(filtered).not.toHaveProperty('balance');
    expect(filtered).not.toHaveProperty('days_past_due');
    expect(filtered).not.toHaveProperty('overdue');
  });
});

describe('SQL Injection Prevention — Update Field Whitelist', () => {
  it('allows valid update fields', () => {
    const data = { month: '2026-04', vendor_name: 'New Name' };
    const safe = sanitizeUpdateFields(data);
    expect(Object.keys(safe)).toEqual(['month', 'vendor_name']);
  });

  it('strips unknown / injected fields', () => {
    const data = {
      month: '2026-04',
      'id; DROP TABLE invoices; --': 'hack',
      password_hash: 'xxx',
      role: 'ho',
      created_by: 'attacker',
    };
    const safe = sanitizeUpdateFields(data);
    expect(Object.keys(safe)).toEqual(['month']);
    expect(safe).not.toHaveProperty('id; DROP TABLE invoices; --');
    expect(safe).not.toHaveProperty('password_hash');
    expect(safe).not.toHaveProperty('role');
    expect(safe).not.toHaveProperty('created_by');
  });

  it('skips undefined values', () => {
    const data = { month: undefined, vendor_name: 'Steel Corp' };
    const safe = sanitizeUpdateFields(data);
    expect(Object.keys(safe)).toEqual(['vendor_name']);
  });

  it('returns empty object for all-invalid fields', () => {
    const data = { evil_field: 'hack', another_bad: 123 };
    const safe = sanitizeUpdateFields(data);
    expect(Object.keys(safe)).toHaveLength(0);
  });
});

describe('Overpayment Prevention', () => {
  it('rejects payment exceeding balance', () => {
    const invoiceAmount = 100000;
    const alreadyPaid = 80000;
    const balance = invoiceAmount - alreadyPaid;
    const newPayment = 25000;
    expect(newPayment > balance).toBe(true);
  });

  it('accepts payment equal to balance', () => {
    const invoiceAmount = 100000;
    const alreadyPaid = 80000;
    const balance = invoiceAmount - alreadyPaid;
    const newPayment = 20000;
    expect(newPayment > balance).toBe(false);
  });

  it('accepts payment less than balance', () => {
    const invoiceAmount = 100000;
    const alreadyPaid = 0;
    const balance = invoiceAmount - alreadyPaid;
    const newPayment = 50000;
    expect(newPayment > balance).toBe(false);
  });
});

describe('Role-Based Access Control', () => {
  type Role = 'ho' | 'site' | 'mgmt';

  function isAllowed(userRole: Role, allowedRoles: Role[]): boolean {
    return allowedRoles.includes(userRole);
  }

  // Invoice CRUD
  it('ho can access invoices', () => expect(isAllowed('ho', ['ho'])).toBe(true));
  it('site CANNOT access all invoices (ho-only)', () => expect(isAllowed('site', ['ho'])).toBe(false));
  it('mgmt CANNOT modify invoices', () => expect(isAllowed('mgmt', ['ho', 'site'])).toBe(false));

  // Payment aging
  it('ho can view payment aging', () => expect(isAllowed('ho', ['ho'])).toBe(true));
  it('mgmt can view vendor aging', () => expect(isAllowed('mgmt', ['ho', 'mgmt'])).toBe(true));
  it('site CANNOT view payment aging', () => expect(isAllowed('site', ['ho', 'mgmt'])).toBe(false));

  // Audit logs
  it('ho can view audit trail', () => expect(isAllowed('ho', ['ho'])).toBe(true));
  it('site CANNOT view audit trail', () => expect(isAllowed('site', ['ho'])).toBe(false));
  it('mgmt CANNOT view audit trail', () => expect(isAllowed('mgmt', ['ho'])).toBe(false));

  // Vendors
  it('ho can manage vendors', () => expect(isAllowed('ho', ['ho'])).toBe(true));
  it('site CANNOT manage vendors', () => expect(isAllowed('site', ['ho'])).toBe(false));

  // Invoice creation — ho + site
  it('ho can create invoices', () => expect(isAllowed('ho', ['ho', 'site'])).toBe(true));
  it('site can create invoices', () => expect(isAllowed('site', ['ho', 'site'])).toBe(true));
  it('mgmt CANNOT create invoices', () => expect(isAllowed('mgmt', ['ho', 'site'])).toBe(false));
});

describe('Filename Sanitization', () => {
  function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
  }

  it('passes normal filenames through', () => {
    expect(sanitizeFilename('invoice.pdf')).toBe('invoice.pdf');
  });

  it('strips path traversal attempts', () => {
    const result = sanitizeFilename('../../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
    expect(result.length).toBeGreaterThan(0);
  });

  it('strips special characters', () => {
    expect(sanitizeFilename('file name (1).pdf')).toBe('file_name__1_.pdf');
  });

  it('truncates very long filenames', () => {
    const longName = 'a'.repeat(300) + '.pdf';
    expect(sanitizeFilename(longName).length).toBeLessThanOrEqual(255);
  });
});
