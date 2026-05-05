# Backup infrastructure for the Makuta Accounts portal.
#
# Provisions:
#   - A dedicated, versioned S3 bucket for daily backups (DB dumps + invoice
#     file snapshots), separate from the live invoice bucket so a compromised
#     app cannot delete history.
#   - Public-access block + bucket-owner-enforced ACL.
#   - Lifecycle rules: file snapshots → Glacier IR after 30 days, expire after
#     365; DB dumps stay on STANDARD_IA, expire after 365; old versions
#     expire after 90 days.
#   - An IAM user the GitHub Actions workflow uses, with read-only on the
#     source bucket and put/list-only on the backup bucket (no delete).
#
# Apply standalone:
#   cd infra/terraform/backup
#   cp terraform.tfvars.example terraform.tfvars   # edit values
#   terraform init && terraform apply
#
# After apply, retrieve the IAM access keys with:
#   terraform output -raw backup_user_access_key_id
#   terraform output -raw backup_user_secret_access_key
# and add them to the GitHub repo secrets (see BACKUP.md).

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ─── Backup bucket ────────────────────────────────────────────────────────

resource "aws_s3_bucket" "backups" {
  bucket = var.backup_bucket_name

  tags = {
    Project = "makuta-accounts"
    Purpose = "daily-backups"
  }
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket     = aws_s3_bucket.backups.id
  depends_on = [aws_s3_bucket_versioning.backups]

  # File snapshots: warm for a month, cold for a year, then delete.
  rule {
    id     = "file-snapshots"
    status = "Enabled"
    filter { prefix = "file-backups/" }

    transition {
      days          = 30
      storage_class = "GLACIER_IR"
    }
    expiration {
      days = 365
    }
  }

  # DB dumps: keep on cheap warm storage for a year.
  rule {
    id     = "db-dumps"
    status = "Enabled"
    filter { prefix = "db-backups/" }

    expiration {
      days = 365
    }
  }

  # Versioning safety net: old versions of any object expire after 90 days.
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ─── IAM user for backups (used by GitHub Actions) ────────────────────────

resource "aws_iam_user" "backup" {
  name = var.backup_iam_user_name
  tags = {
    Project = "makuta-accounts"
    Purpose = "backup-automation"
  }
}

resource "aws_iam_access_key" "backup" {
  user = aws_iam_user.backup.name
}

# Read-only on the live invoice bucket, write-only (no delete) on the backup
# bucket. Notice: no s3:Delete* anywhere — a compromised key cannot erase
# either side.
data "aws_iam_policy_document" "backup" {
  statement {
    sid    = "ReadSourceBucket"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:GetBucketLocation",
    ]
    resources = [
      "arn:aws:s3:::${var.source_bucket_name}",
      "arn:aws:s3:::${var.source_bucket_name}/*",
    ]
  }

  statement {
    sid    = "WriteBackupBucket"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:PutObjectAcl",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:GetBucketLocation",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = [
      aws_s3_bucket.backups.arn,
      "${aws_s3_bucket.backups.arn}/*",
    ]
  }
}

resource "aws_iam_user_policy" "backup" {
  name   = "${var.backup_iam_user_name}-policy"
  user   = aws_iam_user.backup.name
  policy = data.aws_iam_policy_document.backup.json
}
