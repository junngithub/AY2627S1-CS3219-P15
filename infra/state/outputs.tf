output "bucket" {
  description = "Pass to every cloud root: terraform init -backend-config=\"bucket=<this>\"."
  value       = aws_s3_bucket.state.bucket
}
