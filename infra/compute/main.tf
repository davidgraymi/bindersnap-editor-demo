# Compute module: EC2 instance, security group, EBS, IAM instance profile.
#
# This is the missing piece the architect flagged — the actual box that runs
# Gitea + the API was created by hand. This module makes it reproducible.
#
# Usage:
#   cd infra/compute
#   terraform init -backend-config=../state/backend.hcl
#   terraform plan -var-file=terraform.tfvars
#   terraform apply -var-file=terraform.tfvars
#
# To rebuild from scratch: terraform destroy && terraform apply
# The EBS data volume is RETAINED on destroy to protect Gitea data.

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    key = "compute/terraform.tfstate"
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------- Variables ----------

variable "aws_region" {
  description = "AWS region for all compute resources"
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

variable "instance_type" {
  description = "EC2 instance type (ARM recommended: t4g.small for MVP, t4g.medium for growth). Root volume is 30 GB (AL2023 ARM64 snapshot minimum)."
  type        = string
  default     = "t4g.small"
}

variable "ami_id" {
  description = "AMI ID — use latest Amazon Linux 2023 ARM64. Set to null to auto-discover."
  type        = string
  default     = null
}

variable "key_pair_name" {
  description = "EC2 key pair name for SSH access (break-glass only; prefer SSM Session Manager)"
  type        = string
  default     = null
}

variable "vpc_id" {
  description = "VPC ID. Defaults to the default VPC if null."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Subnet ID for the instance. Defaults to the first default subnet if null."
  type        = string
  default     = null
}

variable "data_volume_size_gb" {
  description = "EBS gp3 volume size in GB for Gitea data + API sessions"
  type        = number
  default     = 20
}

variable "data_volume_device_name" {
  description = "Device name for the data EBS volume"
  type        = string
  default     = "/dev/xvdf"
}

variable "allowed_ssh_cidrs" {
  description = "CIDRs allowed to SSH (empty list disables SSH ingress entirely)"
  type        = list(string)
  default     = []
}

variable "ssm_parameter_path" {
  description = "SSM path prefix for the env refresh script (must match secrets module)"
  type        = string
  default     = "/bindersnap/prod"
}

# ---------- Data sources ----------

# Auto-discover latest AL2023 ARM64 AMI if not pinned
data "aws_ami" "al2023_arm64" {
  count       = var.ami_id == null ? 1 : 0
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_vpc" "selected" {
  id      = var.vpc_id
  default = var.vpc_id == null ? true : null
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.selected.id]
  }

  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

data "aws_subnet" "selected" {
  id = var.subnet_id != null ? var.subnet_id : data.aws_subnets.default.ids[0]
}

locals {
  ami_id    = var.ami_id != null ? var.ami_id : data.aws_ami.al2023_arm64[0].id
  subnet_id = var.subnet_id != null ? var.subnet_id : data.aws_subnets.default.ids[0]

  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------- Security Group ----------

resource "aws_security_group" "app" {
  name_prefix = "${var.project}-app-"
  description = "Bindersnap prod: HTTP/S inbound, all outbound"
  vpc_id      = data.aws_vpc.selected.id

  tags = merge(local.common_tags, { Name = "${var.project}-app" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS from anywhere (Caddy terminates TLS)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.app.id
  description       = "HTTP from anywhere (Caddy redirects to HTTPS)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  count = length(var.allowed_ssh_cidrs)

  security_group_id = aws_security_group.app.id
  description       = "SSH from allowed CIDR"
  cidr_ipv4         = var.allowed_ssh_cidrs[count.index]
  from_port         = 22
  to_port           = 22
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.app.id
  description       = "All outbound"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# ---------- IAM Instance Profile ----------

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "instance" {
  name               = "${var.project}-${var.environment}-instance"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = local.common_tags
}

# SSM Session Manager (replaces SSH for most ops)
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# CloudWatch agent (needed for disk metrics — concern #6)
resource "aws_iam_role_policy_attachment" "cloudwatch_agent" {
  role       = aws_iam_role.instance.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "instance" {
  name = "${var.project}-${var.environment}-instance"
  role = aws_iam_role.instance.name
  tags = local.common_tags
}

# ---------- Elastic IP ----------

resource "aws_eip" "app" {
  domain = "vpc"
  tags   = merge(local.common_tags, { Name = "${var.project}-app" })
}

# ---------- EBS Data Volume ----------
# Retained on destroy to protect Gitea data.

resource "aws_ebs_volume" "data" {
  availability_zone = data.aws_subnet.selected.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  tags = merge(local.common_tags, {
    Name   = "${var.project}-data"
    Backup = "daily" # Picked up by DLM policy in backups module
  })

  lifecycle {
    prevent_destroy = true
  }
}

# ---------- EC2 Instance ----------

resource "aws_instance" "app" {
  ami                    = local.ami_id
  instance_type          = var.instance_type
  subnet_id              = local.subnet_id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.instance.name
  key_name               = var.key_pair_name

  user_data_base64 = base64gzip(templatefile("${path.module}/user-data.sh.tftpl", {
    compose_b64          = base64encode(file("${path.root}/../../docker-compose.prod.yml"))
    caddyfile_b64        = base64encode(file("${path.root}/../../Caddyfile.prod"))
    litestream_b64       = base64encode(file("${path.root}/../../litestream.yml"))
    bootstrap_script_b64 = base64encode(file("${path.root}/../../scripts/bootstrap-gitea-service-account.ts"))
    ssm_parameter_path   = var.ssm_parameter_path
  }))
  user_data_replace_on_change = false

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  tags = merge(local.common_tags, { Name = "${var.project}-app" })

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64] # Prevent accidental rebuilds on AMI rotation
  }
}

resource "aws_volume_attachment" "data" {
  device_name = var.data_volume_device_name
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

# ---------- Outputs ----------

output "instance_id" {
  description = "EC2 instance ID (consumed by monitoring and CI modules)"
  value       = aws_instance.app.id
}

output "instance_public_ip" {
  description = "Elastic IP address"
  value       = aws_eip.app.public_ip
}

output "instance_role_name" {
  description = "IAM role name (consumed by secrets and backups modules for policy attachment)"
  value       = aws_iam_role.instance.name
}

output "instance_profile_name" {
  description = "IAM instance profile name"
  value       = aws_iam_instance_profile.instance.name
}

output "security_group_id" {
  description = "Security group ID"
  value       = aws_security_group.app.id
}

output "data_volume_id" {
  description = "EBS data volume ID (consumed by backups module for DLM tagging)"
  value       = aws_ebs_volume.data.id
}

output "eip_allocation_id" {
  description = "Elastic IP allocation ID (for Route53 A records)"
  value       = aws_eip.app.id
}
