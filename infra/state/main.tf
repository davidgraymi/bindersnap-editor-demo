# Bootstrap module: S3 backend + DynamoDB lock table for Terraform state.
#
# This module uses LOCAL state intentionally — it's the one resource that
# bootstraps everything else. Run once, then never touch it again.
#
# Usage:
#   cd infra/state
#   terraform init
#   terraform apply -var="aws_account_id=123456789012"
#
# After apply, copy the backend config from the output into each module's
# terraform { backend "s3" { ... } } block, or use the generated
# backend.hcl partial config with: terraform init -backend-config=../state/backend.hcl

terraform {
  required_version = ">= 1.0"
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

variable "aws_region" {
  description = "AWS region for the state bucket and lock table"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID (used in bucket name for global uniqueness)"
  type        = string
}

variable "project" {
  description = "Project name for resource tagging"
  type        = string
  default     = "bindersnap"
}

locals {
  bucket_name = "${var.project}-tfstate-${var.aws_account_id}"
  table_name  = "${var.project}-tfstate-lock"
  common_tags = {
    Project = var.project
    Purpose = "Terraform state management"
  }
}

# --- S3 bucket for state files ---

resource "aws_s3_bucket" "state" {
  bucket = local.bucket_name
  tags   = local.common_tags
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {} # required by AWS provider ~> 5.0 — applies to all objects

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# --- DynamoDB table for state locking ---

resource "aws_dynamodb_table" "lock" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = local.common_tags
}

# --- Outputs ---

output "bucket_name" {
  description = "S3 bucket name for Terraform state"
  value       = aws_s3_bucket.state.id
}

output "bucket_arn" {
  description = "S3 bucket ARN for Terraform state"
  value       = aws_s3_bucket.state.arn
}

output "lock_table_name" {
  description = "DynamoDB table name for state locking"
  value       = aws_dynamodb_table.lock.name
}

output "backend_config" {
  description = "Copy this block into each module's terraform { backend \"s3\" { ... } } section"
  value       = <<-EOT
    bucket         = "${local.bucket_name}"
    region         = "${var.aws_region}"
    dynamodb_table = "${local.table_name}"
    encrypt        = true
  EOT
}
