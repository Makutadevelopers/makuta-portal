# Local backup — installation walkthrough

This sets up your Mac to pull the database dump and invoice-attachment mirror from AWS S3 every day, to **three independent destinations**:

| Destination | Path | Survives | Keeps |
|---|---|---|---|
| Internal disk | `~/Makuta-Backups/` | AWS gone, hosting down, app retired | 14 days |
| External drive | `/Volumes/mac-scratch/Backups/invoice portal/` | the Mac dying | 30 days |
| iCloud Drive (encrypted) | `Makuta-Backups/` | losing the Mac **and** the drive | 7 newest |

Each destination also gets **CSV exports** next to the `.sql.gz`. That matters: a Postgres dump needs a Postgres server to read, which is exactly what you won't have in a disaster. The CSVs open straight in Excel. `invoice_register.csv` is the one to reach for — every invoice with vendor, site, amount, paid and outstanding.

Recovery instructions live in [RESTORE.md](RESTORE.md), and a copy is written into the iCloud folder automatically so it's readable even if this repo is gone.

You only do this once. After it's installed, it runs automatically.

> Keep the AWS keys **and the backup encryption passphrase** in your password manager. The Keychain is for the launchd job's daily use; the password manager is for "Mac is dead, I need to recover". Without the passphrase the iCloud copy cannot be decrypted.

---

## 1. One-time AWS setup — create a read-only IAM user (~3 min)

This user can only **read** the backup S3 bucket. If your Mac is ever lost or stolen, deleting this user immediately is harmless to anything else.

1. Sign in to https://console.aws.amazon.com/iam
2. **Users** → **Create user**
3. Name: `makuta-backup-reader`
4. Skip "Provide user access to the AWS Management Console" (no console login needed)
5. **Next** → **Attach policies directly** → **Create policy**
6. Switch to the JSON tab and paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["s3:ListBucket"],
         "Resource": "arn:aws:s3:::makuta-backup-use1"
       },
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject"],
         "Resource": "arn:aws:s3:::makuta-backup-use1/*"
       }
     ]
   }
   ```

7. **Next** → name the policy `MakutaBackupReadOnly` → **Create policy**
8. Back on the user-creation tab, refresh the policy list, tick `MakutaBackupReadOnly`, click **Next** → **Create user**
9. Open the user → **Security credentials** tab → **Create access key**
10. Use case: **Application running outside AWS** → Next → Description tag: `Mac local backup` → **Create access key**
11. Copy the **Access key ID** and **Secret access key**. You'll paste them in the next step. **Save them in your Google Password Manager too** — if your Mac dies before you set up the next step, you'll need them.

---

## 2. Save the AWS keys to your Mac's Keychain (~30 s)

Open Terminal and run these two lines, pasting the keys when prompted:

```bash
security add-generic-password -a makuta-backup -s makuta-backup-access-key -w
security add-generic-password -a makuta-backup -s makuta-backup-secret-key -w
```

After each command, paste the value and press Enter.

(`-w` with no value tells `security` to read the secret from stdin so it never appears in your shell history.)

Verify they're stored:

```bash
security find-generic-password -a makuta-backup -s makuta-backup-access-key -w   # → prints your access key ID
```

---

## 3. Create the encryption passphrase for the iCloud copy (~1 min)

The iCloud copy is AES-256 encrypted, because company financial data should not sit in plaintext in personal cloud storage. Generate a passphrase and store it in the Keychain:

```bash
# generate a readable 5-word passphrase and store it
PASS=$(python3 -c "
import secrets
w=[x.strip().lower() for x in open('/usr/share/dict/words') if 4<=len(x.strip())<=7 and x.strip().isalpha()]
print('-'.join(secrets.choice(w) for _ in range(5))+'-'+str(secrets.randbelow(9000)+1000))")
security add-generic-password -a makuta-backup -s makuta-backup-encryption-key -w "$PASS" \
  -D "Makuta portal backup encryption key" -U
echo "$PASS"   # ← copy this into your password manager NOW
```

> **Save that passphrase in your password manager before moving on.** It is not stored in iCloud — that would defeat the encryption. If both the Keychain and the password manager lose it, the iCloud copy is unrecoverable. (The internal-disk and external-drive copies are unencrypted, so those stay readable regardless.)

If you skip this step everything else still works; the script logs `[skip] iCloud copy` and the other two destinations are unaffected.

---

## 4. Install the tools if you don't have them (~1 min)

```bash
brew install awscli gnupg
aws --version  # should print something like "aws-cli/2.x.x"
gpg --version  # needed only for the encrypted iCloud copy
```

If you don't have Homebrew: https://brew.sh — single-line install.

---

## 5. Install the scripts + LaunchAgent (~1 min)

The backup script, the CSV exporter and RESTORE.md must sit **in the same folder** — the script finds the other two next to itself.

From the repo root:

```bash
# 1. Put all three somewhere stable on your Mac
INST="$HOME/Library/Application Support/makuta-backup"
mkdir -p "$INST"
cp scripts/local-backup/makuta-backup.sh "$INST/"
cp scripts/local-backup/dump-to-csv.py   "$INST/"
cp scripts/local-backup/RESTORE.md       "$INST/"
chmod +x "$INST/makuta-backup.sh" "$INST/dump-to-csv.py"

# 2. Render the LaunchAgent plist with absolute paths and install it
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
sed \
  -e "s|__SCRIPT_PATH__|$INST/makuta-backup.sh|g" \
  -e "s|__LOG_PATH__|$HOME/Library/Logs/makuta-backup.log|g" \
  scripts/local-backup/com.makuta.daily-backup.plist \
  > ~/Library/LaunchAgents/com.makuta.daily-backup.plist

# 3. Activate it
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.makuta.daily-backup.plist
```

> If you later edit the script in the repo, **re-run step 1** — the LaunchAgent runs the installed copy, not the repo file.

If `launchctl bootstrap` says the agent is already loaded, unload first:

```bash
launchctl bootout gui/$(id -u)/com.makuta.daily-backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.makuta.daily-backup.plist
```

---

## 6. Run it once now to verify (~2 min)

```bash
"$HOME/Library/Application Support/makuta-backup/makuta-backup.sh"
tail -40 ~/Library/Logs/makuta-backup.log
```

The log should end with three `[done]` lines, one per destination:

```
[done] internal /Users/<you>/Makuta-Backups — 111M
[done] drive    /Volumes/mac-scratch/Backups/invoice portal — 2.0G
[done] icloud   .../Makuta-Backups — 2.8M (2 encrypted files)
```

Layout on the internal disk and the drive:

```
~/Makuta-Backups/
├── 2026-07-30/
│   ├── db/   makuta_makuta_portal_<timestamp>.sql.gz
│   └── csv/  invoice_register.csv, invoices.csv, payments.csv, …
└── files-latest/   (rolling mirror of the S3 invoice attachments)
```

The internal disk keeps **one** rolling `files-latest/` mirror rather than a dated copy per day — it's the same ~76 MB of scans daily, so dated copies would waste gigabytes for no recovery benefit. The external drive, which has the room, does keep them dated.

---

## What runs daily after this

- **14:00 local time** every day (~2 PM IST), the LaunchAgent fires.
- If your Mac is off at 14:00, it runs the moment you next log in.
- If `mac-scratch` isn't connected, the internal-disk and iCloud copies are **still made**; only the drive mirror is deferred, and the next mounted run backfills it. (This used to abort the whole run — that's how 24–27 Jul 2026 ended up with no local copy.)
- Retention is per destination and each is overridable:
  `INTERNAL_RETENTION_DAYS=30 DRIVE_RETENTION_DAYS=60 ICLOUD_KEEP=14 ./makuta-backup.sh`

## How to stop it / uninstall

```bash
launchctl bootout gui/$(id -u)/com.makuta.daily-backup
rm ~/Library/LaunchAgents/com.makuta.daily-backup.plist
rm -rf "$HOME/Library/Application Support/makuta-backup"
# Optionally, remove keys from Keychain:
security delete-generic-password -a makuta-backup -s makuta-backup-access-key
security delete-generic-password -a makuta-backup -s makuta-backup-secret-key
security delete-generic-password -a makuta-backup -s makuta-backup-encryption-key
```

## Troubleshooting

| Symptom | Cause + fix |
|---|---|
| `[skip] External drive … not mounted` | Plug the `mac-scratch` drive in. Not a failure — the other two destinations still ran |
| `[skip] iCloud copy — no encryption passphrase` | Step 3 |
| `[skip] iCloud copy — gpg not installed` | `brew install gnupg` (step 4) |
| `[warn] CSV export failed` | The `.sql.gz` copies are unaffected. Check `dump-to-csv.py` sits next to the script |
| `[fatal] AWS creds missing from Keychain` | Re-run step 2 |
| `[fatal] aws CLI not found` | Step 4 |
| `An error occurred (AccessDenied)` | Step 1 — confirm the policy is attached |
| `aws s3 sync` is slow | First run only: thousands of files. Subsequent runs only pull what's new |
| Edited the script but nothing changed | The LaunchAgent runs the installed copy — re-run step 5.1 |
