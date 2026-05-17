# API service module: container-image Lambda fronted by API Gateway HTTP API.
#
# Tracks issue #224. SKELETON ONLY — resource bodies will be filled in
# subsequent PRs so each slice is independently reviewable and applyable.
#
# Architecture summary:
#   API Gateway HTTP API
#     → Lambda (container image, VPC-attached)
#         ├─→ Aurora Serverless v2 Postgres   (same VPC, private)
#         ├─→ Gitea on EC2                    (same VPC, private)
#         └─→ Stripe API                      (via Gitea-as-NAT, see nat.tf)
#
# Pay-per-hour resources: NONE (Aurora min_capacity = 0, no ALB, no NAT
# Gateway, no ECS tasks). The only always-on costs are Aurora storage,
# CloudWatch log retention, and the existing Gitea EC2 (which doubles as
# the NAT for Lambda's egress).
#
# Usage (once complete):
#   cd infra/api-service
#   terraform init -backend-config=../state/backend.hcl
#   terraform plan -var-file=terraform.tfvars
#   terraform apply -var-file=terraform.tfvars

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "api-service/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------- Variables ----------

variable "aws_region" {
  description = "AWS region for all api-service resources."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name for resource tagging."
  type        = string
  default     = "bindersnap"
}

variable "environment" {
  description = "Environment name."
  type        = string
  default     = "prod"
}

variable "vpc_id" {
  description = "VPC shared with the Gitea EC2 instance and the Aurora cluster. Lambda is attached to this VPC."
  type        = string
}

variable "private_subnet_ids" {
  description = "Pre-existing private subnets to use for Lambda ENIs + Aurora. Leave empty to have this root create dedicated subnets via subnets.tf (recommended — see lambda_subnet_cidr_blocks)."
  type        = list(string)
  default     = []
}

variable "gitea_instance_id" {
  description = "EC2 instance ID of the Gitea host that doubles as the NAT for Lambda. Used to look up its primary ENI for the Lambda subnet's egress route."
  type        = string
}

variable "gitea_security_group_id" {
  description = "Security group of the Gitea EC2 instance. A reciprocal ingress rule for Lambda is added to this SG by security-groups.tf."
  type        = string
}

variable "gitea_internal_port" {
  description = "Port on which Gitea listens internally (typically 3000). Lambda's egress SG allows this port to gitea_security_group_id."
  type        = number
  default     = 3000
}

variable "api_domain_name" {
  description = "Public hostname served by the API Gateway custom domain, e.g. api.bindersnap.example.com."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for api_domain_name. Must be issued in var.aws_region (HTTP APIs are regional)."
  type        = string
}

variable "image_tag" {
  description = "ECR image tag to deploy. CI sets this to the commit SHA on each push to main touching services/api/**."
  type        = string
  default     = "latest"
}

variable "cors_allowed_origins" {
  description = "Origins allowed by API Gateway CORS (handles browser preflights without invoking Lambda). Typically the SPA origin and the GitHub Pages origin."
  type        = list(string)
}

# ---------- Locals ----------

locals {
  name_prefix = "${var.project}-${var.environment}-api"

  common_tags = {
    Project     = var.project
    Environment = var.environment
    Component   = "api-service"
    ManagedBy   = "terraform"
    Issue       = "224"
  }
}
