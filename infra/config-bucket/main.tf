# Terraform module for the configuration-as-code S3 bucket.
#
# Holds the runtime config files that the EC2 host needs but that aren't
# baked into the API image: docker-compose.prod.yml, Caddyfile.prod,
# litestream.yml, Dockerfile.caddy, and the Gitea bootstrap script.
#
# Why this exists:
#   The deploy workflow only updates the API image. Before this module,
#   compose/Caddy changes only landed on a fresh instance via user-data.
#   Now the deploy job (and on-host refresh timer) can `aws s3 sync`
#   /opt/bindersnap from this bucket and recreate containers.
#
# Usage:
#   terraform init -backend-config=../state/backend.hcl
#   terraform apply -var="ec2_instance_role_name=bindersnap-prod-instance"
#
# Importing the existing bucket (if you created it manually first):
#   terraform import aws_s3_bucket.config bindersnap-config

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "config-bucket/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------- Variables ----------

variable "aws_region" {
  description = "AWS region for the bucket"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name for resource tagging"
  type        = string
  default     = "bindersnap"
}

variable "bucket_name" {
  description = "S3 bucket name. Must be globally unique."
  type        = string
  default     = "bindersnap-config"
}

variable "ec2_instance_role_name" {
  description = "Existing EC2 IAM role name to attach the read policy to. Set null to skip the attachment (e.g. on first apply before compute exists)."
  type        = string
  default     = null
}

# Path from this module to the repo root. The module lives at
# infra/config-bucket/ so the repo root is two levels up.
locals {
  repo_root = "${path.module}/../.."

  # Map of S3 object key → local file path. Add new entries here when
  # introducing new config files that must land on the host.
  config_files = {
    "docker-compose.prod.yml"                    = "${local.repo_root}/docker-compose.prod.yml"
    "Caddyfile.prod"                             = "${local.repo_root}/Caddyfile.prod"
    "litestream.yml"                             = "${local.repo_root}/litestream.yml"
    "Dockerfile.caddy"                           = "${local.repo_root}/Dockerfile.caddy"
    "scripts/bootstrap-gitea-service-account.ts" = "${local.repo_root}/scripts/bootstrap-gitea-service-account.ts"
  }

  common_tags = {
    Project   = var.project
    ManagedBy = "terraform"
    Purpose   = "Runtime config files synced to /opt/bindersnap"
  }
}

# ---------- Bucket ----------

resource "aws_s3_bucket" "config" {
  bucket = var.bucket_name

  tags = local.common_tags
}

resource "aws_s3_bucket_versioning" "config" {
  bucket = aws_s3_bucket.config.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "config" {
  bucket = aws_s3_bucket.config.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "config" {
  bucket = aws_s3_bucket.config.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Expire noncurrent versions after 30 days (matches litestream policy).
resource "aws_s3_bucket_lifecycle_configuration" "config" {
  bucket = aws_s3_bucket.config.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ---------- Object uploads ----------
# etag tracks file content; Terraform re-uploads when the source file changes.

resource "aws_s3_object" "config_file" {
  for_each = local.config_files

  bucket       = aws_s3_bucket.config.id
  key          = each.key
  source       = each.value
  etag         = filemd5(each.value)
  content_type = "text/plain"

  tags = local.common_tags
}

# ---------- IAM ----------

data "aws_iam_policy_document" "config_read" {
  statement {
    sid    = "ListConfigBucket"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]
    resources = [aws_s3_bucket.config.arn]
  }

  statement {
    sid    = "ReadConfigObjects"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["${aws_s3_bucket.config.arn}/*"]
  }
}

resource "aws_iam_policy" "config_read" {
  name        = "${var.project}-config-bucket-read"
  description = "Read-only access to the Bindersnap runtime config bucket"
  policy      = data.aws_iam_policy_document.config_read.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "config_read" {
  count = var.ec2_instance_role_name == null ? 0 : 1

  role       = var.ec2_instance_role_name
  policy_arn = aws_iam_policy.config_read.arn
}

# ---------- Outputs ----------

output "config_bucket_name" {
  description = "S3 bucket name (consumed by user-data and the deploy workflow)"
  value       = aws_s3_bucket.config.id
}

output "config_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.config.arn
}

output "config_read_policy_arn" {
  description = "IAM policy ARN granting read access (attach to EC2 instance profile)"
  value       = aws_iam_policy.config_read.arn
}
