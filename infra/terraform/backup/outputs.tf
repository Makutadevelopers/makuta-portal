output "backup_bucket_name" {
  description = "Name of the backup bucket — set this as S3_BACKUP_BUCKET."
  value       = aws_s3_bucket.backups.bucket
}

output "backup_bucket_arn" {
  value = aws_s3_bucket.backups.arn
}

output "backup_user_access_key_id" {
  description = "IAM access key — set as the AWS_ACCESS_KEY_ID GitHub secret."
  value       = aws_iam_access_key.backup.id
  sensitive   = true
}

output "backup_user_secret_access_key" {
  description = "IAM secret — set as the AWS_SECRET_ACCESS_KEY GitHub secret."
  value       = aws_iam_access_key.backup.secret
  sensitive   = true
}
