variable "aws_region" {
  description = "AWS region for the backup bucket (keep close to source bucket to minimise transfer cost)."
  type        = string
  default     = "ap-south-1"
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
