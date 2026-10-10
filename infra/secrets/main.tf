terraform {
  required_version = ">= 1.7" # `removed` blocks
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

variable "gitea_admin_user" {
  description = "First-boot Gitea admin username used to bootstrap the bindersnap-service account"
  type        = string
  default     = "gitea-admin"
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

variable "stripe_price_id" {
  description = "Stripe writer-seat price ID (price_...) used when creating Checkout Sessions. Not a secret. apply-all.sh passes infra/billing's seat_price_id; set it in tfvars only to plan this module alone."
  type        = string
}

data "aws_caller_identity" "current" {}

locals {
  parameter_path = trimsuffix(var.ssm_parameter_path, "/")

  # Settings, not secrets: Terraform owns their values.
  config_parameters = {
    gitea_admin_user             = var.gitea_admin_user
    bindersnap_user_email_domain = var.bindersnap_user_email_domain
    litestream_s3_bucket         = var.litestream_s3_bucket
    stripe_price_id              = var.stripe_price_id
  }

  # Secrets. Terraform never sees their values: aws_ssm_parameter reads a
  # parameter's decrypted value back into state on every refresh, so managing
  # them here put the live Stripe key in secrets/terraform.tfstate.
  # put-secrets.sh writes them straight to SSM. Listed here so this module's
  # output names every leaf the deploy needs.
  secret_parameters = [
    "gitea_secret_key",
    "gitea_internal_token",
    "gitea_admin_pass",
    "gitea_service_token", # minted by the deploy bootstrap
    "gitea_admin_token",   # minted by the deploy bootstrap
    "stripe_secret_key",
    "stripe_webhook_secret",
    "cloudflare_tunnel_token", # infra/edge/put-tunnel-token.sh
    "restic_repository",       # docs/ops/restore.md
    "restic_password",
    "restic_r2_access_key_id",
    "restic_r2_secret_access_key",
  ]

  parameter_arn_base          = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.parameter_path}"
  parameter_arn_prefix        = "${local.parameter_arn_base}/*"
  service_token_parameter_arn = "${local.parameter_arn_base}/gitea_service_token"
  admin_token_parameter_arn   = "${local.parameter_arn_base}/gitea_admin_token"
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

resource "aws_ssm_parameter" "config" {
  for_each = local.config_parameters

  name   = "${local.parameter_path}/${each.key}"
  type   = "SecureString"
  value  = each.value
  key_id = aws_kms_key.ssm.arn

  tags = {
    Project     = var.project
    Environment = var.environment
  }
}

# The settings keep their parameters; only their address changes.
moved {
  from = aws_ssm_parameter.prod["gitea_admin_user"]
  to   = aws_ssm_parameter.config["gitea_admin_user"]
}

moved {
  from = aws_ssm_parameter.prod["bindersnap_user_email_domain"]
  to   = aws_ssm_parameter.config["bindersnap_user_email_domain"]
}

moved {
  from = aws_ssm_parameter.prod["litestream_s3_bucket"]
  to   = aws_ssm_parameter.config["litestream_s3_bucket"]
}

moved {
  from = aws_ssm_parameter.prod["stripe_price_id"]
  to   = aws_ssm_parameter.config["stripe_price_id"]
}

# The secrets leave Terraform's state but stay in SSM: forget them, never
# delete them. Older versions of the state file still hold their values, so
# put-secrets.sh --rotate replaces them at cutover.
removed {
  from = aws_ssm_parameter.prod

  lifecycle {
    destroy = false
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
      local.admin_token_parameter_arn,
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
      values   = [local.service_token_parameter_arn, local.admin_token_parameter_arn]
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

output "secret_parameter_names" {
  description = "SSM leaves that hold secrets. put-secrets.sh and the scripts it names set them; Terraform never does."
  value       = [for name in local.secret_parameters : "${local.parameter_path}/${name}"]
}
