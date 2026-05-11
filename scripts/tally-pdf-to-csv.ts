#!/usr/bin/env -S npx tsx
/**
 * tally-pdf-to-csv.ts
 *
 * Convert a Tally "Ledger Account" PDF export into a CSV that matches the
 * portal's Invoice Bulk Import template, so the result can be shared with
 * the accountants for cross-check and then uploaded via
 * All Invoices → Bulk Import.
 *
 * Usage:
 *   npx tsx scripts/tally-pdf-to-csv.ts <input.pdf> --site=<Site> [--out=<file.csv>] [--gst=<pct>] [--category=<default>]
 *
 * Examples:
 *   npx tsx scripts/tally-pdf-to-csv.ts ./gen.pdf --site=Taranga
 *   npx tsx scripts/tally-pdf-to-csv.ts ./gen.pdf --site=Taranga --out=./gen.csv --gst=18
 *
 * Requirements:
 *   - poppler's `pdftotext` on PATH. macOS: `brew install poppler`.
 *
 * Scope:
 *   - Targets the Tally "Ledger Account" report layout specifically (the
 *     one with `Date / Particulars / Vch Type / Debit / Credit` columns
 *     and "Being …" narrations). Other Tally reports (Daybook, Purchase
 *     Register, etc) will not parse cleanly — re-export from Tally as
 *     Excel for those.
 *   - Skips Debit-Note rows (material returns) — those belong in the
 *     portal's Credit Notes module, not invoice bulk import.
 *   - Skips Opening / Closing / Carried Over / Brought Forward rows.
 *   - Assumes intra-state GST split (CGST + SGST, IGST=0). Override with
 *     --gst=<pct> if needed; the split is always pct/2 + pct/2.
 *
 * Output:
 *   - CSV with the bulk-import template columns, sorted by invoice date.
 *   - Always review before uploading. GST split is an assumption; per-row
 *     edits may be needed for inter-state purchases or non-default rates.
 */

import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import path from 'path';

// ── Arg parsing ─────────────────────────────────────────────────────────────
interface Args {
  input: string;
  site: string;
  out?: string;
  gst: number;
  defaultCategory: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [k, ...rest] = arg.slice(2).split('=');
      flags[k] = rest.join('=') || 'true';
    } else {
      positional.push(arg);
    }
  }
  if (positional.length === 0) {
    console.error('Usage: tally-pdf-to-csv.ts <input.pdf> --site=<Site> [--out=<file.csv>] [--gst=<pct>] [--category=<default>]');
    process.exit(2);
  }
  if (!flags.site) {
    console.error('Error: --site is required (one of Nirvana / Taranga / Horizon / Green Wood Villas / Aruna Arcade / Office)');
    process.exit(2);
  }
  return {
    input: positional[0],
    site: flags.site,
    out: flags.out,
    gst: flags.gst ? Number(flags.gst) : 18,
    defaultCategory: flags.category ?? 'Hardware',
  };
}

// ── PDF text extraction ─────────────────────────────────────────────────────
function pdfToText(file: string): string {
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  } catch (err) {
    console.error('Failed to run pdftotext. Install with `brew install poppler` (macOS) or `apt install poppler-utils` (Linux).');
    console.error(err);
    process.exit(1);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const MONTH_NUM: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function parseTallyDate(s: string): string | null {
  // "31-Mar-25" → "2025-03-31"
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const [, dd, mon, yy] = m;
  const mm = MONTH_NUM[mon.charAt(0).toUpperCase() + mon.slice(1, 3).toLowerCase()];
  if (!mm) return null;
  const yyyy = Number(yy) >= 50 ? `19${yy}` : `20${yy}`;
  return `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
}

function parseIndianAmount(s: string): number | null {
  // "2,42,144.00" → 242144
  const cleaned = s.replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Categories that exist in the portal's static PURPOSES list. Anything
// outside this maps to 'Misc' so the bulk import doesn't reject the row.
const KNOWN_CATEGORIES = new Set([
  'Material', 'Steel', 'Cement', 'Bricks', 'Aggregates', 'Hardware', 'Tiles',
  'Plumbing Material', 'Electrical Material', 'Scaffolding', 'Admixtures',
  'Granite', 'Misc', 'RMC Service', 'Painting Materials', 'Doors',
  'Advertisement', 'Water Proofing', 'Consultant', 'Fire Fighting',
  'Contractor', 'Machinery', 'Loan', 'Miwan Shuttering', 'Tax',
  'Sales Refund', 'Lifts', 'Security Service', 'Diesel',
  'Ms Sections & Tubes & Pipes', 'CP & Sanitary', 'Windows',
  'General Supplies', 'Electrical',
]);
function normaliseCategory(raw: string, fallback: string): string {
  const t = raw.trim();
  if (!t) return fallback;
  if (KNOWN_CATEGORIES.has(t)) return t;
  // Common Tally → portal aliases.
  if (/chemical/i.test(t)) return 'Admixtures';
  return 'Misc';
}

// ── Vendor detection ────────────────────────────────────────────────────────
// Tally Ledger PDFs put the party name on line 2 of the header block:
//   Makuta Projects LLp
//   General Engineering & Tools Center        <- vendor
//   Ledger Account
//   1-Apr-23 to 6-May-26
function detectVendor(text: string): string {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Find first non-header non-page line that isn't "Makuta Projects LLp" or
  // "Ledger Account" or a date range.
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const l = lines[i];
    if (/^Makuta /i.test(l)) continue;
    if (/^Ledger Account$/i.test(l)) continue;
    if (/Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar/.test(l) && /\d{2}/.test(l) && /to/i.test(l)) continue;
    if (/^Page /i.test(l)) continue;
    if (/^Find - Results$/i.test(l)) continue;
    if (l.length < 4) continue;
    return l;
  }
  return '';
}

// ── Voucher parsing ─────────────────────────────────────────────────────────
interface Voucher {
  date: string;            // YYYY-MM-DD
  category: string;        // mapped to portal category
  vchType: string;         // Purchase / Debit Note / …
  total: number;           // gross amount (Cr side of a Purchase)
  invoiceNo: string;       // vendor's invoice number from narration
  poNumber: string;        // PO number from narration
  rawNarration: string;
}

function extractVouchers(text: string, opts: { defaultCategory: string }): Voucher[] {
  // Strategy: walk the page text line by line. A voucher starts on a line
  // that contains both a Tally date prefix (DD-MMM-YY) AND a voucher type
  // (Purchase / Debit Note / Credit Note / Receipt / Payment / Journal /
  // Sales). We then look one line ahead for the running-balance row and
  // collect 1–4 narration lines until the next voucher start.
  //
  // Two complications the parser has to handle:
  //   1. Dr/Cr indicator and category float between date and amount.
  //   2. Same-date continuation rows (no date prefix on row 2).

  const rawLines = text.split(/\r?\n/);
  // Skip Tally's repeating page-header lines so they don't bleed into narrations.
  const lines = rawLines
    .map(l => l.replace(/\s+$/, ''))
    .filter(l => !/^Makuta /i.test(l))
    .filter(l => !/^General Engineering/i.test(l))
    .filter(l => !/^Ledger Account/i.test(l))
    .filter(l => !/^Date\s+Particulars/i.test(l))
    .filter(l => !/^\s*Brought Forward/i.test(l))
    .filter(l => !/^\s*Carried Over/i.test(l))
    .filter(l => !/Closing Balance/i.test(l))
    .filter(l => !/Opening Balance/i.test(l))
    .filter(l => !/^\s*Diff in Tax/i.test(l))
    .filter(l => !/^\s*Balance After/i.test(l))
    .filter(l => !/^\s*Current Total/i.test(l));

  const datePrefix = /^(\d{1,2}-[A-Za-z]{3}-\d{2})\s+/;
  const voucherRe = /^(?:(\d{1,2}-[A-Za-z]{3}-\d{2})\s+)?(Dr|Cr)\s+([A-Z][A-Za-z &]*?)\s{2,}.*?(Purchase|Debit Note|Credit Note|Sales|Receipt|Payment|Journal)\b.*?([\d,]+\.\d{2})\s*$/;
  const amountTail = /([\d,]+\.\d{2})\s*$/;

  const out: Voucher[] = [];
  let currentDate = '';
  let pending: Partial<Voucher> | null = null;
  let narrationLines: string[] = [];

  function flush() {
    if (!pending) return;
    const merged = narrationLines.join(' ').replace(/\s+/g, ' ').trim();
    // Vendor's invoice number from narrations like "Invoice no 626 Po No: 0195"
    const invMatch = merged.match(/Invoice\s*no(?:\s*[:\.]?\s*|\s+)([0-9A-Za-z\.,/-]+)/i)
      || merged.match(/Invoice\s*No[:\.]?\s*([0-9A-Za-z\.,/-]+)/i)
      || merged.match(/invoice\s+no\s+([0-9A-Za-z\.,/-]+)/i);
    const poMatch = merged.match(/Po\s*No[:\.]?\s*([0-9A-Za-z\.,/-]+)/i)
      || merged.match(/PO\s*no[:\.]?\s*([0-9A-Za-z\.,/-]+)/i);

    let inv = (invMatch?.[1] ?? '').replace(/[.,]+$/, '');
    let po = (poMatch?.[1] ?? '').replace(/[.,]+$/, '');
    // Strip the leading "." Tally sometimes emits: ".0316" → "0316"
    if (po.startsWith('.')) po = po.slice(1);
    if (inv.startsWith('.')) inv = inv.slice(1);

    out.push({
      date: pending.date ?? '',
      category: pending.category ?? '',
      vchType: pending.vchType ?? '',
      total: pending.total ?? 0,
      invoiceNo: inv,
      poNumber: po,
      rawNarration: merged,
    });
    pending = null;
    narrationLines = [];
  }

  for (const line of lines) {
    const dm = line.match(datePrefix);
    if (dm) currentDate = parseTallyDate(dm[1]) ?? currentDate;

    const vm = line.match(voucherRe);
    if (vm) {
      flush();
      const [, dateRaw, , catRaw, vchType, amountRaw] = vm;
      const parsedDate = dateRaw ? parseTallyDate(dateRaw) : currentDate;
      if (parsedDate) currentDate = parsedDate;
      pending = {
        date: parsedDate ?? currentDate,
        category: normaliseCategory(catRaw, opts.defaultCategory),
        vchType,
        total: parseIndianAmount(amountRaw) ?? 0,
      };
      continue;
    }

    // Lines after a voucher start are running-balance + narration. We don't
    // need the running-balance row; the "Being …" narration carries the
    // invoice + PO references.
    if (pending) {
      const tail = line.match(amountTail);
      const isRunningBal = tail && /Cr|Dr/.test(line);
      if (!isRunningBal) narrationLines.push(line.trim());
    }
  }
  flush();

  return out.filter(v => v.date && v.total > 0 && v.vchType === 'Purchase');
}

// ── CSV emission ────────────────────────────────────────────────────────────
const HEADERS = [
  'Sl.No', 'Month', 'Invoice date', 'Vendor Name', 'Invoice no', 'PO Number',
  'Head', 'Site Location', 'Base Amount', 'CGST %', 'SGST %', 'IGST %',
  'Additional Charge', 'Additional Charge CGST %', 'Additional Charge SGST %',
  'Additional Charge IGST %', 'Additional Charge Reason', 'Invoice amount',
  'Payment Status', 'Pending Days', 'Payment Type', 'Payment Details',
  'Payment Date', 'Bank', 'Payment Month',
];

interface CsvRow {
  slNo: number;
  month: string;
  invoiceDate: string;
  vendor: string;
  invoiceNo: string;
  poNumber: string;
  head: string;
  site: string;
  baseAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  invoiceAmount: number;
}

function emitCsv(rows: CsvRow[]): string {
  const lines = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.slNo, r.month, r.invoiceDate, r.vendor, r.invoiceNo, r.poNumber,
        r.head, r.site, r.baseAmount.toFixed(2), r.cgst, r.sgst, r.igst,
        '', '', '', '', '', r.invoiceAmount.toFixed(2),
        'Not Paid', '', '', '', '', '', '',
      ].map(csvCell).join(',')
    );
  }
  return lines.join('\n') + '\n';
}

// ── Main ────────────────────────────────────────────────────────────────────
function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const text = pdfToText(args.input);

  const vendor = detectVendor(text);
  if (!vendor) {
    console.error('Could not detect vendor from PDF header. Aborting.');
    process.exit(1);
  }

  const vouchers = extractVouchers(text, { defaultCategory: args.defaultCategory });

  // Dedupe by (date + invoice no) — Tally exports the same ledger 5x in
  // different "set" views (A/B/C/D/E) which would otherwise be reported.
  const seen = new Set<string>();
  const unique = vouchers.filter(v => {
    const key = `${v.date}|${v.invoiceNo}|${v.total}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort chronologically.
  unique.sort((a, b) => a.date.localeCompare(b.date));

  const cgst = args.gst / 2;
  const sgst = args.gst / 2;
  const igst = 0;
  const factor = 1 + args.gst / 100;

  const rows: CsvRow[] = unique.map((v, i) => ({
    slNo: i + 1,
    month: `${v.date.slice(0, 7)}-01`,
    invoiceDate: v.date,
    vendor,
    invoiceNo: v.invoiceNo,
    poNumber: v.poNumber,
    head: v.category || args.defaultCategory,
    site: args.site,
    baseAmount: Math.round((v.total / factor) * 100) / 100,
    cgst,
    sgst,
    igst,
    invoiceAmount: v.total,
  }));

  const csv = emitCsv(rows);
  const outPath = args.out
    ?? path.join(
      path.dirname(args.input),
      path.basename(args.input, path.extname(args.input)) + '.csv'
    );
  writeFileSync(outPath, csv, 'utf8');

  const grand = rows.reduce((s, r) => s + r.invoiceAmount, 0);
  console.log(`Vendor:   ${vendor}`);
  console.log(`Site:     ${args.site}`);
  console.log(`GST:      ${args.gst}% (CGST ${cgst}% + SGST ${sgst}%, IGST ${igst}%)`);
  console.log(`Invoices: ${rows.length}`);
  console.log(`Total:    ₹${grand.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(`Output:   ${outPath}`);
  console.log('');
  console.log('Review the CSV (especially GST split & category) before uploading.');
}

main();
