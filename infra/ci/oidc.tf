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

variable "ssh_session_document_name" {
  description = "SSM document the pyinfra deploy tunnels SSH through (deploy/bin/ssm-connect.sh)"
  type        = string
  default     = "AWS-StartSSHSession"
}

variable "ssh_os_user" {
  description = "OS user the deploy pushes an ephemeral EC2 Instance Connect key for"
  type        = string
  default     = "ec2-user"
}

variable "ssm_parameter_path" {
  description = "SSM Parameter Store prefix deploy.py reads on the control plane to render .env.prod. Must match infra/secrets ssm_parameter_path."
  type        = string
  default     = "/bindersnap/prod"
}

variable "ssm_kms_key_alias" {
  description = "Alias of the KMS key encrypting the production SSM parameters. Must match infra/secrets aws_kms_alias.ssm."
  type        = string
  default     = "alias/bindersnap-prod-ssm"
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

variable "config_bucket_name" {
  description = "S3 bucket that stores the runtime config bundle applied by the production config deploy workflow"
  type        = string
  default     = "bindersnap-config"
}

variable "api_ecr_repository_name" {
  description = "ECR repository pushed to by deploy-api.yml. Must match infra/api-service ecr.tf."
  type        = string
  default     = "bindersnap-prod-api"
}

variable "api_lambda_function_name" {
  description = "Lambda function name updated by deploy-api.yml. Must match infra/api-service lambda.tf."
  type        = string
  default     = "bindersnap-prod-api"
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

# The pyinfra deploy renders .env.prod on the control plane by reading the
# production SSM parameters, which are SecureStrings encrypted with this key
# (provisioned in infra/secrets). Resolve it by alias so the two modules stay
# decoupled — no cross-module remote state wiring needed.
data "aws_kms_alias" "ssm" {
  name = var.ssm_kms_key_alias
}

locals {
  ssm_parameter_path = trimsuffix(var.ssm_parameter_path, "/")

  ssm_parameter_arn_base   = "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm_parameter_path}"
  ssm_parameter_arn_prefix = "${local.ssm_parameter_arn_base}/*"

  github_subs = [
    "repo:${var.github_owner}/${var.github_repository}:ref:refs/heads/${var.github_branch}",
    "repo:${var.github_owner}/${var.github_repository}:ref:refs/tags/*",
  ]

  common_tags = {
    Project = var.project
  }
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = [
    "sts.amazonaws.com",
  ]

  # AWS validates GitHub's OIDC cert chain directly (since July 2023) and
  # ignores this value, but the Terraform provider requires the attribute.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

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
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subs
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
      # AWS-managed documents have no account ID in their ARN.
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/${var.ssm_document_name}",
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

  # ---------- deploy-pyinfra.yml: SSH-over-SSM tunnel + control-plane env render ----------

  statement {
    # DescribeInstances resolves the target host by tag and reads its AZ for the
    # EC2 Instance Connect push. It does not support resource-level scoping.
    sid    = "ResolveDeployTarget"
    effect = "Allow"

    actions = [
      "ec2:DescribeInstances",
    ]

    resources = ["*"]
  }

  statement {
    # Push the ~60s ephemeral SSH key onto the tagged host for the deploy user.
    sid    = "PushEphemeralSshKey"
    effect = "Allow"

    actions = [
      "ec2-instance-connect:SendSSHPublicKey",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/${var.instance_tag_key}"
      values   = [var.instance_tag_value]
    }

    condition {
      test     = "StringEquals"
      variable = "ec2:osuser"
      values   = [var.ssh_os_user]
    }
  }

  statement {
    # Open the SSH-over-SSM tunnel via the AWS-StartSSHSession document against
    # the tagged host. AWS-managed documents carry no account ID in their ARN.
    sid    = "StartSshTunnelSession"
    effect = "Allow"

    actions = [
      "ssm:StartSession",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}::document/${var.ssh_session_document_name}",
      "arn:${data.aws_partition.current.partition}:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/${var.instance_tag_key}"
      values   = [var.instance_tag_value]
    }
  }

  statement {
    # The session-manager-plugin tears the tunnel down on exit; scope termination
    # to sessions this role opened.
    sid    = "TerminateOwnSshSession"
    effect = "Allow"

    actions = [
      "ssm:TerminateSession",
      "ssm:ResumeSession",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:session/${var.deploy_role_name}-*",
    ]
  }

  statement {
    # deploy.py reads the production parameter tree on the control plane (boto3)
    # to render .env.prod, then uploads it to the host at 0600.
    sid    = "ReadProdParameters"
    effect = "Allow"

    actions = [
      "ssm:GetParametersByPath",
    ]

    resources = [
      local.ssm_parameter_arn_base,
      local.ssm_parameter_arn_prefix,
    ]
  }

  statement {
    # Decrypt the SecureString parameters read above, scoped to SSM-mediated use.
    sid    = "DecryptProdParameters"
    effect = "Allow"

    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
    ]

    resources = [
      data.aws_kms_alias.ssm.target_key_arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }

  statement {
    sid    = "PublishRuntimeConfigBundle"
    effect = "Allow"

    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:s3:::${var.config_bucket_name}",
    ]
  }

  statement {
    sid    = "WriteRuntimeConfigObjects"
    effect = "Allow"

    actions = [
      "s3:PutObject",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:s3:::${var.config_bucket_name}/*",
    ]
  }

  # ---------- deploy-api.yml: ECR push + Lambda update + invoke ----------

  statement {
    sid    = "EcrAuth"
    effect = "Allow"

    # GetAuthorizationToken does not support resource-level scoping.
    actions = [
      "ecr:GetAuthorizationToken",
    ]

    resources = ["*"]
  }

  statement {
    sid    = "EcrPushApiImage"
    effect = "Allow"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/${var.api_ecr_repository_name}",
    ]
  }

  statement {
    sid    = "LambdaUpdateApiFunction"
    effect = "Allow"

    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:InvokeFunction",
      "lambda:UpdateFunctionCode",
    ]

    resources = [
      "arn:${data.aws_partition.current.partition}:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.api_lambda_function_name}",
    ]
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

output "deploy_role_subjects" {
  description = "GitHub OIDC subjects allowed to assume the deploy role"
  value       = local.github_subs
}
