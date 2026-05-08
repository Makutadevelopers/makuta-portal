# Local-drive backup — installation walkthrough

This sets up your Mac to download yesterday's database dump and invoice-attachment mirror from AWS S3 to your `mac-scratch` external drive every day. The Mac is your **third independent backup mirror** alongside AWS and GitHub.

You only do this once. After it's installed, it runs automatically.

> Mac and Google Password managers — keep both the AWS keys and a copy of the recovery info in either one. The Keychain is for the launchd job's daily use; the password manager is for "Mac is dead, I need to recover".

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

## 3. Install the AWS CLI if you don't have it (~30 s)

```bash
brew install awscli
aws --version  # should print something like "aws-cli/2.x.x"
```

If you don't have Homebrew: https://brew.sh — single-line install.

---

## 4. Install the script + LaunchAgent (~1 min)

From the repo root:

```bash
# 1. Put the script somewhere stable on your Mac
mkdir -p ~/.local/bin
cp scripts/local-backup/makuta-backup.sh ~/.local/bin/makuta-backup.sh
chmod +x ~/.local/bin/makuta-backup.sh

# 2. Render the LaunchAgent plist with absolute paths and install it
mkdir -p ~/Library/LaunchAgents ~/Library/Logs
sed \
  -e "s|__SCRIPT_PATH__|$HOME/.local/bin/makuta-backup.sh|g" \
  -e "s|__LOG_PATH__|$HOME/Library/Logs/makuta-backup.log|g" \
  scripts/local-backup/com.makuta.daily-backup.plist \
  > ~/Library/LaunchAgents/com.makuta.daily-backup.plist

# 3. Activate it
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.makuta.daily-backup.plist
```

If `launchctl bootstrap` says the agent is already loaded, unload first:

```bash
launchctl bootout gui/$(id -u)/com.makuta.daily-backup
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.makuta.daily-backup.plist
```

---

## 5. Run it once now to verify (~1 min)

```bash
~/.local/bin/makuta-backup.sh
tail -50 ~/Library/Logs/makuta-backup.log
```

The log should end with `[done] Backup at /Volumes/mac-scratch/Backups/invoice portal/<today> — <size>`.

Inspect the result in Finder:

```
/Volumes/mac-scratch/Backups/invoice portal/2026-05-08/
├── db/
│   └── makuta_portal_<timestamp>.sql.gz
└── files/
    └── (mirror of S3 invoice attachments folder)
```

---

## What runs daily after this

- **14:00 local time** every day (~2 PM IST), the LaunchAgent fires.
- If your Mac is off at 14:00, it runs the moment you next log in.
- If `mac-scratch` isn't connected, the script logs a `[skip]` and exits cleanly — no email/no errors. It'll catch up the next day the drive is plugged in.
- Local copies older than 30 days are deleted automatically. Override with `RETENTION_DAYS=60 ~/.local/bin/makuta-backup.sh`.

## How to stop it / uninstall

```bash
launchctl bootout gui/$(id -u)/com.makuta.daily-backup
rm ~/Library/LaunchAgents/com.makuta.daily-backup.plist
rm ~/.local/bin/makuta-backup.sh
# Optionally, remove keys from Keychain:
security delete-generic-password -a makuta-backup -s makuta-backup-access-key
security delete-generic-password -a makuta-backup -s makuta-backup-secret-key
```

## Troubleshooting

| Symptom | Cause + fix |
|---|---|
| `[skip] External drive not mounted` | Plug the `mac-scratch` drive in; will run on next schedule |
| `[fatal] AWS creds missing from Keychain` | Re-run step 2 |
| `[fatal] aws CLI not found` | Step 3 |
| `An error occurred (AccessDenied)` | Step 1 — confirm the policy is attached |
| `aws s3 sync` is slow | First run only: thousands of files. Subsequent runs only pull what's new |
