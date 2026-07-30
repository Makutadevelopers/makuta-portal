#!/usr/bin/env python3
"""dump-to-csv.py — turn a pg_dump .sql.gz into plain CSV files.

Why this exists: a Postgres dump is only readable by a Postgres server. If the
hosting is down, the AWS account is gone, or the app is retired, a .sql.gz is
not something you can open. These CSVs are — Excel, Numbers, Sheets, anything.

Reads the plain-text COPY blocks straight out of the dump, so it needs no
database, no psql, and no third-party Python packages.

Usage:
    ./dump-to-csv.py <dump.sql.gz> <output-dir>

Output:
    <output-dir>/invoice_register.csv   derived: invoices + paid + balance
    <output-dir>/<table>.csv            one per business table
    <output-dir>/_internal/<table>.csv  repair snapshots, migrations, etc.
"""

import csv
import gzip
import os
import re
import sys
from collections import defaultdict

# Tables a person would actually want to read. Everything else (repair
# snapshots, schema_migrations, dedupe scratch tables) still gets exported,
# just tucked into _internal/ so the top level stays legible.
CORE_TABLES = {
    "invoices", "payments", "vendors", "bank_transactions", "credit_notes",
    "credit_note_allocations", "invoice_line_items", "attachments",
    "categories", "banks", "users", "petty_cash_disbursements",
    "petty_cash_expenses", "alerts", "audit_logs", "vendor_merges",
}

COPY_RE = re.compile(r"^COPY public\.(\w+) \(([^)]*)\) FROM stdin;")

_SIMPLE_ESCAPES = {
    "b": "\b", "f": "\f", "n": "\n", "r": "\r",
    "t": "\t", "v": "\v", "\\": "\\",
}
_HEX = "0123456789abcdefABCDEF"
_OCT = "01234567"


def unescape(field):
    """Decode one field of Postgres COPY TEXT format."""
    if "\\" not in field:
        return field
    out = []
    i, n = 0, len(field)
    while i < n:
        ch = field[i]
        if ch != "\\" or i + 1 >= n:
            out.append(ch)
            i += 1
            continue
        nxt = field[i + 1]
        if nxt in _SIMPLE_ESCAPES:
            out.append(_SIMPLE_ESCAPES[nxt])
            i += 2
        elif nxt == "x":
            j, digits = i + 2, ""
            while j < n and len(digits) < 2 and field[j] in _HEX:
                digits += field[j]
                j += 1
            if digits:
                out.append(chr(int(digits, 16)))
                i = j
            else:
                out.append(nxt)
                i += 2
        elif nxt in _OCT:
            j, digits = i + 1, ""
            while j < n and len(digits) < 3 and field[j] in _OCT:
                digits += field[j]
                j += 1
            out.append(chr(int(digits, 8)))
            i = j
        else:
            out.append(nxt)
            i += 2
    return "".join(out)


def parse_row(line):
    """Split a COPY data line into fields. '\\N' becomes '' (empty CSV cell)."""
    return ["" if f == "\\N" else unescape(f) for f in line.split("\t")]


def extract(dump_path):
    """Yield (table_name, columns, rows) for every COPY block in the dump."""
    with gzip.open(dump_path, "rt", encoding="utf-8", errors="replace") as fh:
        table = None
        for line in fh:
            line = line.rstrip("\n")
            if table is None:
                m = COPY_RE.match(line)
                if m:
                    table = m.group(1)
                    columns = [c.strip() for c in m.group(2).split(",")]
                    rows = []
                continue
            if line == "\\.":
                yield table, columns, rows
                table = None
                continue
            rows.append(parse_row(line))


def write_csv(path, columns, rows):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    # utf-8-sig: the BOM makes Excel on Windows read ₹ and Indian names correctly.
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(columns)
        w.writerows(rows)


def build_register(tables, out_dir):
    """Derived invoice register: one row per invoice with settlement + balance.

    This is the single most useful file if the app is unavailable — it answers
    "what do I owe, to whom, on which site" without needing to join anything.

    Settlement follows the app's own rule (migrations 027 / 050 / 052, and
    payment.controller.ts):

        settled = SUM(amount + tds_amount + gst_tds_amount)
                  + SUM(credit-note allocations)

    TDS and GST-TDS settle the invoice without cash moving — they're withheld
    and remitted to the department on the vendor's behalf. gst_added_amount is
    deliberately EXCLUDED: it's extra cash to the vendor, not settlement. So
    'cash that left the bank' and 'value that settled the invoice' are two
    different numbers, and both are reported here rather than conflated.
    """
    inv = tables.get("invoices")
    if not inv:
        return None

    def num(v):
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    cash = defaultdict(float)      # amount + gst_added — actually left the bank
    settle_cash = defaultdict(float)  # amount only — the part that settles
    withheld = defaultdict(float)  # tds + gst_tds — settles without cash
    cn_applied = defaultdict(float)

    pay = tables.get("payments")
    if pay:
        pcols, prows = pay
        col = {c: i for i, c in enumerate(pcols)}
        if "invoice_id" in col:
            iv = col["invoice_id"]

            def get(row, name):
                i = col.get(name)
                return num(row[i]) if i is not None and i < len(row) else 0.0

            for r in prows:
                key = r[iv]
                amt = get(r, "amount")
                settle_cash[key] += amt
                cash[key] += amt + get(r, "gst_added_amount")
                withheld[key] += get(r, "tds_amount") + get(r, "gst_tds_amount")

    cna = tables.get("credit_note_allocations")
    if cna:
        ccols, crows = cna
        col = {c: i for i, c in enumerate(ccols)}
        if "invoice_id" in col and "allocated_amount" in col:
            iv, av = col["invoice_id"], col["allocated_amount"]
            for r in crows:
                cn_applied[r[iv]] += num(r[av])

    icols, irows = inv
    icol = {c: i for i, c in enumerate(icols)}
    i_id, i_amt = icol.get("id"), icol.get("invoice_amount")
    i_del = icol.get("deleted_at")
    keep = [c for c in ("invoice_date", "internal_no", "invoice_no", "vendor_name",
                        "site", "purpose", "invoice_amount", "payment_status",
                        "po_number", "remarks") if c in icol]

    header = keep + ["cash_paid", "tds_withheld", "credit_notes_applied",
                     "settled", "balance", "is_deleted"]
    out = []
    for r in irows:
        key = r[i_id]
        amount = num(r[i_amt])
        c, w, cn = cash.get(key, 0.0), withheld.get(key, 0.0), cn_applied.get(key, 0.0)
        settled = settle_cash.get(key, 0.0) + w + cn
        out.append(
            [r[icol[k]] for k in keep]
            + ["%.2f" % c, "%.2f" % w, "%.2f" % cn,
               "%.2f" % settled, "%.2f" % (amount - settled),
               "yes" if (i_del is not None and r[i_del]) else "no"]
        )

    # Newest invoices first — most useful ordering for a human reading it.
    if "invoice_date" in keep:
        d = keep.index("invoice_date")
        out.sort(key=lambda r: r[d] or "", reverse=True)

    write_csv(os.path.join(out_dir, "invoice_register.csv"), header, out)
    return len(out)


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip())
        return 2
    dump_path, out_dir = sys.argv[1], sys.argv[2]
    if not os.path.isfile(dump_path):
        print("error: no such dump: %s" % dump_path, file=sys.stderr)
        return 1

    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(os.path.join(out_dir, "_internal"), exist_ok=True)

    tables = {}
    for table, columns, rows in extract(dump_path):
        tables[table] = (columns, rows)
        sub = "" if table in CORE_TABLES else "_internal"
        write_csv(os.path.join(out_dir, sub, "%s.csv" % table), columns, rows)

    if not tables:
        print("error: no COPY blocks found — is this a plain-format pg_dump?",
              file=sys.stderr)
        return 1

    n = build_register(tables, out_dir)

    core = sorted(t for t in tables if t in CORE_TABLES)
    print("CSV export → %s" % out_dir)
    for t in core:
        print("  %-28s %d rows" % (t + ".csv", len(tables[t][1])))
    other = len(tables) - len(core)
    if other:
        print("  _internal/                   %d more tables" % other)
    if n is not None:
        print("  invoice_register.csv         %d rows (derived: paid + balance)" % n)
    return 0


if __name__ == "__main__":
    sys.exit(main())
