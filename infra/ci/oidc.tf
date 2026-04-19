terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "ci/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region used by the production deployment resources"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used for resource tagging"
  type        = string
  default     = "bindersnap"
}

variable "github_owner" {
  description = "GitHub org or user that owns the repository"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository name"
  type        = string
  default     = "bindersnap-editor-demo"
}

variable "github_branch" {
  description = "Git branch allowed to assume the deploy role"
  type        = string
  default     = "main"
}

variable "deploy_role_name" {
  description = "IAM role name assumed by the GitHub Actions deploy workflow"
  type        = string
  default     = "bindersnap-deploy"
}

variable "ssm_document_name" {
  description = "SSM document used by the deploy workflow"
  type        = string
  default     = "AWS-RunShellScript"
}

variable "instance_tag_key" {
  description = "Tag key used to target the production instance over SSM"
  type        = string
  default     = "Project"
}

variable "instance_tag_value" {
  description = "Tag value used to target the production instance over SSM"
  type        = string
  default     = "bindersnap"
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  github_sub = "repo:${var.github_owner}/${var.github_repository}:ref:refs/heads/${var.github_branch}"

  common_tags = {
    Project = var.project
  }
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = [
    "sts.amazonaws.com",
  ]

  tags = local.common_tags
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    effect = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    actions = [
      "sts:AssumeRoleWithWebIdentity",
    ]

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.github_sub]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = var.deploy_role_name
  assume_role_policy = data.aws_iam_policy_document.deploy_trust.json

  tags = local.common_tags
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid    = "RunDeployDocument"
    effect = "Allow"

    actions = [
      "ssm:SendCommand",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:document/${var.ssm_document_name}",
    ]
  }

  statement {
    sid    = "RunDeployOnTaggedTargets"
    effect = "Allow"

    actions = [
      "ssm:SendCommand",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*",
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:managed-instance/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/${var.instance_tag_key}"
      values   = [var.instance_tag_value]
    }
  }

  statement {
    sid    = "ReadDeployCommandStatus"
    effect = "Allow"

    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListCommands",
    ]

    resources = ["*"]
  }
}

resource "aws_iam_policy" "deploy" {
  name        = "${var.deploy_role_name}-policy"
  description = "Least-privilege access for the GitHub Actions production deploy workflow"
  policy      = data.aws_iam_policy_document.deploy.json

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "deploy" {
  role       = aws_iam_role.deploy.name
  policy_arn = aws_iam_policy.deploy.arn
}

output "github_actions_oidc_provider_arn" {
  description = "IAM OIDC provider ARN for GitHub Actions"
  value       = aws_iam_openid_connect_provider.github_actions.arn
}

output "deploy_role_arn" {
  description = "IAM role ARN to store in the BINDERSNAP_DEPLOY_ROLE_ARN GitHub variable"
  value       = aws_iam_role.deploy.arn
}

output "deploy_role_subject" {
  description = "GitHub OIDC subject allowed to assume the deploy role"
  value       = local.github_sub
}
