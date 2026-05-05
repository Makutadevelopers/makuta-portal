variable "aws_region" {
  description = "AWS region for the backup bucket. Default matches the production RDS + S3 region (us-east-1) so cross-region transfer cost is zero."
  type        = string
  default     = "us-east-1"
}

variable "backup_bucket_name" {
  description = "Name of the dedicated backup bucket. Must be globally unique and DIFFERENT from source_bucket_name."
  type        = string
  # Example: "makuta-backups-prod"
}

variable "source_bucket_name" {
  description = "Name of the live invoice attachments bucket the IAM user reads from."
  type        = string
  default     = "makuta-invoice-attachments"
}

variable "backup_iam_user_name" {
  description = "IAM user name for the backup automation."
  type        = string
  default     = "makuta-backup-automation"
}
