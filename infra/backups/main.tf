# Terraform module for Litestream S3 backup bucket and IAM policy
#
# This module creates:
#   - S3 bucket for continuous SQLite replication
#   - Versioning enabled (30-day expiry for noncurrent versions)
#   - IAM policy granting litestream operations (attach to EC2 instance profile)
#
# Usage:
#   terraform init
#   terraform plan -var="aws_account_id=123456789012"
#   terraform apply -var="aws_account_id=123456789012"

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "backups/terraform.tfstate"
    # Remaining config (bucket, region, dynamodb_table, encrypt) loaded from:
    #   terraform init -backend-config=../state/backend.hcl
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_account_id" {
  description = "AWS account ID (used to make bucket name globally unique)"
  type        = string
}

variable "aws_region" {
  description = "AWS region for S3 bucket"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name for resource tagging"
  type        = string
  default     = "bindersnap"
}

variable "gitea_data_volume_id" {
  description = "Existing gitea-data EBS volume ID to tag for the daily DLM policy"
  type        = string
  default     = null
}

variable "daily_backup_tag_key" {
  description = "Tag key used to opt EBS volumes into the daily DLM policy"
  type        = string
  default     = "Backup"
}

variable "daily_backup_tag_value" {
  description = "Tag value used to opt EBS volumes into the daily DLM policy"
  type        = string
  default     = "daily"
}

variable "ec2_instance_role_name" {
  description = "Existing EC2 IAM role name to attach the Litestream S3 policy to"
  type        = string
  default     = null
}

# S3 bucket for Litestream replication
resource "aws_s3_bucket" "litestream" {
  bucket = "bindersnap-litestream-${var.aws_account_id}"

  tags = {
    Project = var.project
    Purpose = "SQLite continuous replication"
  }
}

# Enable versioning
resource "aws_s3_bucket_versioning" "litestream" {
  bucket = aws_s3_bucket.litestream.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Lifecycle rule: expire noncurrent versions after 30 days
resource "aws_s3_bucket_lifecycle_configuration" "litestream" {
  bucket = aws_s3_bucket.litestream.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {} # required by AWS provider ~> 5.0 — applies to all objects

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "litestream" {
  bucket = aws_s3_bucket.litestream.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM policy document for litestream S3 operations
data "aws_iam_policy_document" "litestream_s3" {
  statement {
    sid    = "LitestreamS3Access"
    effect = "Allow"

    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]

    resources = [
      aws_s3_bucket.litestream.arn,
      "${aws_s3_bucket.litestream.arn}/*",
    ]
  }
}

# IAM policy resource
resource "aws_iam_policy" "litestream_s3" {
  name        = "bindersnap-litestream-s3"
  description = "Grants Litestream access to S3 backup bucket"
  policy      = data.aws_iam_policy_document.litestream_s3.json

  tags = {
    Project = var.project
  }
}

resource "aws_iam_role_policy_attachment" "litestream_s3" {
  count = var.ec2_instance_role_name == null ? 0 : 1

  role       = var.ec2_instance_role_name
  policy_arn = aws_iam_policy.litestream_s3.arn
}

# Output the bucket name for CI/ops scripts
output "litestream_bucket_name" {
  description = "S3 bucket name for Litestream replication"
  value       = aws_s3_bucket.litestream.id
}

output "litestream_policy_arn" {
  description = "IAM policy ARN (attach to EC2 instance profile)"
  value       = aws_iam_policy.litestream_s3.arn
}
