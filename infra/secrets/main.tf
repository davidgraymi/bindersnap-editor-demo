terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "secrets/terraform.tfstate"
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

variable "gitea_service_token" {
  description = "Dedicated sysadmin service-account token used by the API for signup and token lifecycle operations"
  type        = string
  sensitive   = true
  default     = "BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts"
}

variable "gitea_admin_user" {
  description = "First-boot Gitea admin username used to bootstrap the bindersnap-service account"
  type        = string
  sensitive   = true
  default     = "gitea-admin"
}

variable "gitea_admin_pass" {
  description = "First-boot Gitea admin password used to bootstrap the bindersnap-service account"
  type        = string
  sensitive   = true
  default     = "CHANGE_ME_USE_openssl_rand_base64_20"
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

variable "stripe_secret_key" {
  description = "Stripe live secret key (sk_live_...) used by the API for Checkout Sessions and billing portal"
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret (whsec_...) used to verify inbound webhook signatures"
  type        = string
  sensitive   = true
}

variable "stripe_price_id" {
  description = "Stripe subscription price ID (price_...) used when creating Checkout Sessions"
  type        = string
  sensitive   = true
}

data "aws_caller_identity" "current" {}

locals {
  parameter_path = trimsuffix(var.ssm_parameter_path, "/")

  parameters = {
    gitea_secret_key             = var.gitea_secret_key
    gitea_internal_token         = var.gitea_internal_token
    gitea_service_token          = var.gitea_service_token
    gitea_admin_user             = var.gitea_admin_user
    gitea_admin_pass             = var.gitea_admin_pass
    bindersnap_user_email_domain = var.bindersnap_user_email_domain
    litestream_s3_bucket         = var.litestream_s3_bucket
    stripe_secret_key            = var.stripe_secret_key
    stripe_webhook_secret        = var.stripe_webhook_secret
    stripe_price_id              = var.stripe_price_id
  }

  parameter_arn_base          = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_path}"
  parameter_arn_prefix        = "${local.parameter_arn_base}/*"
  service_token_parameter_arn = "${local.parameter_arn_base}/gitea_service_token"
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
      local.parameter_arn_base,
      local.parameter_arn_prefix,
    ]
  }

  statement {
    sid    = "WriteBindersnapServiceTokenParameter"
    effect = "Allow"

    actions = [
      "ssm:PutParameter",
    ]

    resources = [
      local.service_token_parameter_arn,
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

  statement {
    sid    = "EncryptBindersnapServiceTokenParameter"
    effect = "Allow"

    actions = [
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
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
      test     = "StringEquals"
      variable = "kms:EncryptionContext:PARAMETER_ARN"
      values   = [local.service_token_parameter_arn]
    }
  }
}

resource "aws_iam_policy" "instance_ssm_access" {
  name        = "${var.project}-${var.environment}-ssm-access"
  description = "Read access to the Bindersnap production Parameter Store path plus service-token bootstrap writes"
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
  description = "IAM policy ARN granting the EC2 role production SSM access plus service-token bootstrap writes"
  value       = aws_iam_policy.instance_ssm_access.arn
}

output "ssm_kms_key_arn" {
  description = "KMS key ARN used to encrypt the production SSM parameters"
  value       = aws_kms_key.ssm.arn
}
