# S3 Bucket for test code and results
resource "aws_s3_bucket" "storage" {
  bucket = "${var.project_name}-${var.environment}-storage-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${var.project_name}-${var.environment}-storage"
  }
}

# Block public access
resource "aws_s3_bucket_public_access_block" "storage" {
  bucket = aws_s3_bucket.storage.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle policy for test results
resource "aws_s3_bucket_lifecycle_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id

  rule {
    id     = "cleanup-old-runs"
    status = "Enabled"

    expiration {
      days = var.s3_retention_days
    }

    filter {
      prefix = "runs/"
    }
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning (optional, for safety)
resource "aws_s3_bucket_versioning" "storage" {
  bucket = aws_s3_bucket.storage.id

  versioning_configuration {
    status = "Disabled" # Enable if you want version history
  }
}

# Data source for current AWS account
data "aws_caller_identity" "current" {}