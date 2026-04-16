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
  description = "AWS region for SSM and KMS resources"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used for resource tagging"
  type        = string
  default     = "bindersnap"
}

variable "environment" {
  description = "Environment name for the Parameter Store path prefix"
  type        = string
  default     = "prod"
}

variable "ssm_parameter_path" {
  description = "SSM Parameter Store path prefix used for production env generation"
  type        = string
  default     = "/bindersnap/prod"
}

variable "ec2_instance_role_name" {
  description = "Existing EC2 IAM role name to attach the Parameter Store access policy to"
  type        = string
  default     = null
}

variable "gitea_admin_user" {
  description = "Gitea admin username for first-boot setup"
  type        = string
  default     = "gitea-admin"
}

variable "gitea_admin_pass" {
  description = "Gitea admin password for first-boot setup"
  type        = string
  sensitive   = true
  default     = "CHANGE_ME_USE_openssl_rand_base64_20"
}

variable "gitea_secret_key" {
  description = "Gitea SECRET_KEY value"
  type        = string
  sensitive   = true
  default     = "CHANGE_ME_USE_openssl_rand_base64_32"
}

variable "gitea_internal_token" {
  description = "Gitea INTERNAL_TOKEN value"
  type        = string
  sensitive   = true
  default     = "CHANGE_ME_USE_openssl_rand_base64_32"
}

variable "bindersnap_user_email_domain" {
  description = "Placeholder email domain used when creating signup email addresses in Gitea"
  type        = string
  default     = "users.bindersnap.com"
}

variable "litestream_s3_bucket" {
  description = "S3 bucket name used by the production Litestream sidecar"
  type        = string
  default     = "bindersnap-litestream-REPLACE_WITH_ACCOUNT_ID"
}

data "aws_caller_identity" "current" {}

locals {
  parameter_path = trimsuffix(var.ssm_parameter_path, "/")

  parameters = {
    gitea_admin_user             = var.gitea_admin_user
    gitea_admin_pass             = var.gitea_admin_pass
    gitea_secret_key             = var.gitea_secret_key
    gitea_internal_token         = var.gitea_internal_token
    bindersnap_user_email_domain = var.bindersnap_user_email_domain
    litestream_s3_bucket         = var.litestream_s3_bucket
  }

  parameter_arn_prefix = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_path}/*"
}

resource "aws_kms_key" "ssm" {
  description             = "KMS key for Bindersnap production Parameter Store values"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

resource "aws_kms_alias" "ssm" {
  name          = "alias/${var.project}-${var.environment}-ssm"
  target_key_id = aws_kms_key.ssm.key_id
}

resource "aws_ssm_parameter" "prod" {
  for_each = local.parameters

  name   = "${local.parameter_path}/${each.key}"
  type   = "SecureString"
  value  = each.value
  key_id = aws_kms_key.ssm.arn

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

data "aws_iam_policy_document" "instance_ssm_access" {
  statement {
    sid    = "ReadBindersnapProdParameters"
    effect = "Allow"

    actions = [
      "ssm:GetParametersByPath",
    ]

    resources = [
      local.parameter_arn_prefix,
    ]
  }

  statement {
    sid    = "DecryptBindersnapProdParameters"
    effect = "Allow"

    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]

    resources = [
      aws_kms_key.ssm.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:PARAMETER_ARN"
      values   = [local.parameter_arn_prefix]
    }
  }
}

resource "aws_iam_policy" "instance_ssm_access" {
  name        = "${var.project}-${var.environment}-ssm-read"
  description = "Read-only access to the Bindersnap production Parameter Store path"
  policy      = data.aws_iam_policy_document.instance_ssm_access.json

  tags = {
    Project = var.project
  }
}

resource "aws_iam_role_policy_attachment" "instance_ssm_access" {
  count = var.ec2_instance_role_name == null ? 0 : 1

  role       = var.ec2_instance_role_name
  policy_arn = aws_iam_policy.instance_ssm_access.arn
}

output "ssm_parameter_path" {
  description = "SSM Parameter Store prefix consumed by the EC2 boot script"
  value       = local.parameter_path
}

output "instance_ssm_access_policy_arn" {
  description = "IAM policy ARN granting the EC2 role read access to the production SSM path"
  value       = aws_iam_policy.instance_ssm_access.arn
}

output "ssm_kms_key_arn" {
  description = "KMS key ARN used to encrypt the production SSM parameters"
  value       = aws_kms_key.ssm.arn
}
