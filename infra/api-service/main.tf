# API service module: ECS Fargate deployment of services/api behind an ALB.
#
# Tracks issue #224. SKELETON ONLY — resource bodies will be filled in
# subsequent PRs so each slice is independently reviewable and applyable.
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
  description = "AWS region for all api-service resources"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name for resource tagging"
  type        = string
  default     = "bindersnap"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "vpc_id" {
  description = "VPC where the ALB and Fargate tasks live. Must be the same VPC as the Gitea host so tasks can reach Gitea over the private network."
  type        = string
}

variable "private_subnet_ids" {
  description = "Subnets where Fargate tasks run (Aurora and tasks should share these)."
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "Subnets where the ALB lives. Single-AZ acceptable for solo-dev launch; revisit when traffic justifies multi-AZ."
  type        = list(string)
}

variable "api_domain_name" {
  description = "Public hostname served by the ALB, e.g. api.bindersnap.example.com."
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for api_domain_name. Issued separately to keep this root idempotent."
  type        = string
}

variable "gitea_security_group_id" {
  description = "Security group of the EC2 instance running Gitea. Tasks need egress on the Gitea port; this SG is referenced from security-groups.tf to add the inbound rule."
  type        = string
}

variable "image_tag" {
  description = "Container image tag to deploy. CI sets this to the commit SHA on each push to main."
  type        = string
  default     = "latest"
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
