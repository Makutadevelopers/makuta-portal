# How to get your data back

Read this if the portal is down, the AWS account is gone, or you just want to
open the numbers in Excel. Nothing here needs the app to be running.

There are three copies of everything. Use whichever you can reach:

| Where | Path | Holds | Keeps |
|---|---|---|---|
| Internal disk | `~/Makuta-Backups/` | dumps, CSVs, invoice files | 14 days |
| External drive | `/Volumes/mac-scratch/Backups/invoice portal/` | same, dated | 30 days |
| iCloud Drive | `Makuta-Backups/` | newest dump + CSVs, **encrypted** | 7 newest |

---

## Case 1 — "I just need to see the data" (no software required)

Open the CSVs. This is the normal case and needs nothing installed:

```
~/Makuta-Backups/<YYYY-MM-DD>/csv/
```

Start with **`invoice_register.csv`** — one row per invoice with the vendor,
site, amount, what's been paid, and what's still outstanding. Double-click it;
it opens in Excel or Numbers.

The other files are one CSV per table (`invoices.csv`, `payments.csv`,
`vendors.csv`, …). `_internal/` holds repair-snapshot tables you can ignore.

### Reading `invoice_register.csv`

| Column | Means |
|---|---|
| `invoice_amount` | what the vendor billed |
| `cash_paid` | money that actually left the bank (includes any GST added at payment) |
| `tds_withheld` | income-tax TDS + GST-TDS — withheld from the vendor and paid to the department on their behalf |
| `credit_notes_applied` | value settled by credit note instead of cash |
| `settled` | `cash_paid − GST-added + tds_withheld + credit_notes_applied` |
| `balance` | `invoice_amount − settled` — what's still owed |
| `is_deleted` | `yes` = soft-deleted in the app; kept here so nothing is hidden |

Two things worth knowing so the numbers don't surprise you:

- **GST added at payment is not settlement.** When GST is added on top at
  payment time it's extra cash to the vendor, so it's in `cash_paid` but
  deliberately excluded from `settled`. This matches the app exactly.
- **The app treats anything within ₹1 as Paid.** So an invoice can show
  `payment_status = Paid` while `balance` reads ₹0.02. That's the app's
  rounding tolerance, not a missing payment.

## Case 2 — "I need the database back" (restoring the dump)

The `.sql.gz` files are plain `pg_dump` output. Into any Postgres 17:

```bash
gunzip -c ~/Makuta-Backups/<date>/db/makuta_makuta_portal_<stamp>.sql.gz \
  | psql -h <host> -U <user> -d <new_empty_database>
```

No Postgres to hand? Run one in Docker with no setup:

```bash
docker run -d --name pgrestore -e POSTGRES_PASSWORD=temp -p 5433:5432 postgres:17-alpine
gunzip -c <dump>.sql.gz | docker exec -i pgrestore psql -U postgres -d postgres
docker exec -it pgrestore psql -U postgres          # then query it
```

Use `postgres:17-alpine` — production is Postgres 17. Postgres 16 also works
but prints a harmless `transaction_timeout` error.

## Case 3 — "The Mac and the drive are both gone" (iCloud copy)

Sign in to iCloud, open the `Makuta-Backups` folder, and download the newest
`.gpg` pair. They're AES-256 encrypted; you need the passphrase from your
password manager (entry: *Makuta backup encryption key*).

```bash
# the database dump
gpg --decrypt makuta_makuta_portal_<stamp>.sql.gz.gpg > dump.sql.gz

# the CSVs
gpg --decrypt makuta_makuta_portal_<stamp>-csv.tar.gz.gpg | tar -xzf -
```

`gpg` will prompt for the passphrase. Install it with `brew install gnupg`
(macOS) or `apt install gnupg` (Linux). Then continue from Case 1 or 2.

> **The passphrase is not stored in iCloud, on purpose** — that would defeat
> the encryption. It lives in this Mac's Keychain (`makuta-backup` /
> `makuta-backup-encryption-key`) and in your password manager. If both are
> lost, the iCloud copy cannot be recovered — the internal-disk and external
> drive copies are unencrypted, so they remain readable.

## Case 4 — "Is there anything else?"

Yes, two more copies exist without you doing anything:

- **S3**: `s3://makuta-backup-use1/db-backups/` — every nightly dump since
  13 May 2026, never expired.
- **GitHub Actions artifacts**: the `Daily backup mirror` and `Daily files
  backup mirror` workflows keep a copy off AWS entirely, for 90 days.
  Repo → Actions → pick a run → Artifacts.

---

## Checking the backups are healthy

```bash
launchctl list | grep com.makuta.daily-backup     # 0 = last run fine
tail -40 ~/Library/Logs/makuta-backup.log         # look for the [done] lines
```

Run one on demand at any time:

```bash
~/Desktop/makuta-portal/scripts/local-backup/makuta-backup.sh
```

If the external drive is unmounted the run still succeeds — the internal and
iCloud copies are made anyway, and the drive is backfilled next time it's
plugged in.
