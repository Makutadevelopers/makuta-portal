// exportTable.ts
// Generic table exporter shared by every /export/* endpoint.
//
// A caller supplies a column spec + rows (already in column order) and the
// desired format; this module renders a CSV, an Excel sheet (with real
// number/date cell types so totals and sorting work), or a landscape PDF
// (title + active-filter line + paginated striped table). Keeping all three
// renderers in one place means a new export is just "define columns + fetch
// rows", not another bespoke CSV/XLSX/PDF implementation.

import { Response } from 'express';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';

export type ColType = 'text' | 'amount' | 'pct' | 'int' | 'date' | 'datetime';

export interface ExportColumn {
  header: string;
  type?: ColType;     // default 'text'
  pdfWidth?: number;  // explicit PDF width (pts); omitted columns share the rest
}

export interface TableExportOptions {
  format: 'csv' | 'xlsx' | 'pdf';
  filenameBase: string;        // without extension
  title: string;               // PDF heading
  filters?: string[];          // human-readable active filters, shown on the PDF
  columns: ExportColumn[];
  rows: unknown[][];           // values in column order; dates as ISO strings or null
  sheetName?: string;          // Excel sheet name (default derived from title)
}

const NUMERIC_TYPES: ReadonlySet<ColType> = new Set<ColType>(['amount', 'pct', 'int']);

export function sendTableExport(res: Response, opts: TableExportOptions): void {
  if (opts.format === 'csv') return sendCsv(res, opts);
  if (opts.format === 'xlsx') return sendXlsx(res, opts);
  return sendPdf(res, opts);
}

// ── shared value helpers ────────────────────────────────────────────────────
function fmtDateOnly(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function fmtDateTime(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Human-readable string for CSV / PDF cells.
function displayValue(value: unknown, type: ColType): string {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'amount') return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'pct') return Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'int') return String(Math.round(Number(value)));
  if (type === 'date') return fmtDateOnly(String(value));
  if (type === 'datetime') return fmtDateTime(String(value));
  return String(value);
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function sendCsv(res: Response, opts: TableExportOptions): void {
  const lines: string[] = [opts.columns.map(c => csvCell(c.header)).join(',')];
  for (const row of opts.rows) {
    lines.push(
      opts.columns.map((c, i) => csvCell(displayValue(row[i], c.type ?? 'text'))).join(','),
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${opts.filenameBase}.csv"`);
  res.send('﻿' + lines.join('\r\n')); // BOM so Excel reads UTF-8
}

// ── XLSX ──────────────────────────────────────────────────────────────────────
// Excel serial day count from 1899-12-30, computed in UTC so a calendar date
// never shifts when the file opens in another timezone.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function excelSerial(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  const days = Math.round((Date.UTC(+y, +mo - 1, +d) - EXCEL_EPOCH) / 86400000);
  if (hh === undefined) return days;
  return days + ((+hh) * 3600 + (+mi) * 60 + (+(ss ?? '0'))) / 86400;
}

function sendXlsx(res: Response, opts: TableExportOptions): void {
  const header = opts.columns.map(c => c.header);
  // Build rows as raw values first (numbers stay numbers); retype below.
  const aoa: unknown[][] = [header, ...opts.rows.map(row =>
    opts.columns.map((c, i) => {
      const t = c.type ?? 'text';
      const v = row[i];
      if (v === null || v === undefined) return '';
      if (NUMERIC_TYPES.has(t)) return v; // keep raw for retype
      if (t === 'date' || t === 'datetime') return v;
      return String(v);
    }),
  )];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  const range = XLSX.utils.decode_range(sheet['!ref'] as string);
  for (let R = range.s.r + 1; R <= range.e.r; R++) {       // skip header
    for (let C = range.s.c; C <= range.e.c; C++) {
      const col = opts.columns[C];
      if (!col) continue;
      const t = col.type ?? 'text';
      const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })] as XLSX.CellObject | undefined;
      if (!cell || cell.v === '' || cell.v == null) continue;
      if (NUMERIC_TYPES.has(t)) {
        const n = Number(cell.v);
        if (Number.isFinite(n)) {
          cell.t = 'n';
          cell.v = n;
          cell.z = t === 'int' ? '0' : t === 'pct' ? '0.00' : '#,##0.00';
        }
      } else if (t === 'date' || t === 'datetime') {
        const serial = excelSerial(String(cell.v));
        if (serial != null) {
          cell.t = 'n';
          cell.v = serial;
          cell.z = t === 'datetime' ? 'dd mmm yyyy hh:mm' : 'dd mmm yyyy';
        }
      }
    }
  }

  sheet['!cols'] = opts.columns.map((c, i) => {
    const sample = opts.rows.slice(0, 200).map(r => displayValue(r[i], c.type ?? 'text').length);
    const max = Math.max(c.header.length, ...(sample.length ? sample : [0]));
    return { wch: Math.min(45, Math.max(8, max + 2)) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, (opts.sheetName ?? opts.title).slice(0, 31));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${opts.filenameBase}.xlsx"`);
  res.send(buf);
}

// ── PDF ───────────────────────────────────────────────────────────────────────
function sendPdf(res: Response, opts: TableExportOptions): void {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${opts.filenameBase}.pdf"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const usable = right - left;

  // Distribute column widths: honour explicit pdfWidth, share the rest evenly.
  const explicit = opts.columns.reduce((s, c) => s + (c.pdfWidth ?? 0), 0);
  const autoCount = opts.columns.filter(c => !c.pdfWidth).length;
  const autoWidth = autoCount > 0 ? Math.max(40, (usable - explicit) / autoCount) : 0;
  const widths = opts.columns.map(c => c.pdfWidth ?? autoWidth);
  const isRight = opts.columns.map(c => NUMERIC_TYPES.has((c.type ?? 'text') as ColType));

  // Header block
  doc.fontSize(16).font('Helvetica-Bold').text(opts.title, { align: 'center' });
  doc.fontSize(10).font('Helvetica').fillColor('#444')
    .text(`Makuta Developers · ${fmtDateOnly(new Date().toISOString())} · ${opts.rows.length} row${opts.rows.length === 1 ? '' : 's'}`, { align: 'center' });
  if (opts.filters && opts.filters.length > 0) {
    doc.fontSize(8).fillColor('#666').text(`Filters: ${opts.filters.join('  ·  ')}`, { align: 'center' });
  }
  doc.fillColor('black').moveDown(1);

  const rowHeight = 16;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const drawHeader = (): number => {
    let y = doc.y;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('black');
    let x = left;
    opts.columns.forEach((c, i) => {
      doc.text(c.header, x + 2, y, { width: widths[i] - 4, align: isRight[i] ? 'right' : 'left', lineBreak: false });
      x += widths[i];
    });
    y += rowHeight - 2;
    doc.moveTo(left, y).lineTo(right, y).strokeColor('#999').stroke();
    return y + 3;
  };

  let y = drawHeader();
  doc.font('Helvetica').fontSize(7.5);
  opts.rows.forEach((row, idx) => {
    if (y + rowHeight > bottom) {
      doc.addPage();
      doc.moveDown(0.2);
      y = drawHeader();
      doc.font('Helvetica').fontSize(7.5);
    }
    if (idx % 2 === 1) {
      doc.rect(left, y - 2, usable, rowHeight).fill('#f4f6f8').fillColor('black');
    }
    let x = left;
    opts.columns.forEach((c, i) => {
      const text = displayValue(row[i], c.type ?? 'text');
      doc.fillColor('black').text(text, x + 2, y, { width: widths[i] - 4, align: isRight[i] ? 'right' : 'left', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    y += rowHeight;
  });

  if (opts.rows.length === 0) {
    doc.moveDown(1).fontSize(10).fillColor('#888').text('No rows match the selected filters.', { align: 'center' });
  }

  doc.end();
}
