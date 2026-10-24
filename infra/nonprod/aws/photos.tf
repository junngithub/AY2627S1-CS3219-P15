# Order photos (collection, delivery, dispute; up to 10 MB each). Private.
# The node role writes them (order) and reads them (admin). The frontend
# only shows whether a photo exists.
resource "aws_s3_bucket" "photos" {
  for_each = toset(var.envs)

  bucket        = "foc-${each.value}-order-photos-${data.aws_caller_identity.current.account_id}"
  force_destroy = true # non-prod
}

resource "aws_s3_bucket_public_access_block" "photos" {
  for_each = aws_s3_bucket.photos

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "photos" {
  for_each = aws_s3_bucket.photos

  bucket = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
