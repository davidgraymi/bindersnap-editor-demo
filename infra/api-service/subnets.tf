# Dedicated private subnets for Lambda + Aurora.
#
# Background: the default VPC's subnets all share one main route table. If
# the Gitea-as-NAT route (nat.tf) were written into that shared table, it
# would clobber Gitea's own 0.0.0.0/0 → IGW route and break the host. We
# avoid that by carving two new subnets out of the VPC CIDR and giving them
# their own route table — the Gitea-ENI default route lives only there.
#
# To opt in, set `lambda_subnet_cidr_blocks` (two CIDRs, must be unused
# space inside the VPC's CIDR) and `lambda_subnet_azs` (two AZs in
# var.aws_region). The root then creates the subnets, an empty route
# table, and the associations; nat.tf adds the 0.0.0.0/0 → Gitea ENI route
# to that table on a follow-up apply.
#
# If you'd rather use pre-existing subnets, leave these empty and instead
# populate `private_subnet_ids` + `lambda_route_table_ids` directly — the
# existing variables in main.tf and nat.tf still work as a fallback.

variable "lambda_subnet_cidr_blocks" {
  description = "CIDR blocks for the two private subnets created for Lambda + Aurora. Must be unused space inside var.vpc_id's CIDR. Leave empty to use pre-existing subnets via var.private_subnet_ids."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.lambda_subnet_cidr_blocks) == 0 || length(var.lambda_subnet_cidr_blocks) == 2
    error_message = "lambda_subnet_cidr_blocks must contain exactly two CIDR blocks (one per AZ) or be empty."
  }
}

variable "lambda_subnet_azs" {
  description = "Availability zones for the two private subnets. Must align positionally with lambda_subnet_cidr_blocks and be two distinct AZs in var.aws_region (Aurora subnet groups require ≥2 AZs)."
  type        = list(string)
  default     = []

  validation {
    condition     = length(var.lambda_subnet_azs) == 0 || (length(var.lambda_subnet_azs) == 2 && length(distinct(var.lambda_subnet_azs)) == 2)
    error_message = "lambda_subnet_azs must contain exactly two distinct AZs or be empty."
  }
}

locals {
  create_lambda_subnets = length(var.lambda_subnet_cidr_blocks) > 0
}

resource "aws_subnet" "lambda" {
  count = local.create_lambda_subnets ? length(var.lambda_subnet_cidr_blocks) : 0

  vpc_id            = var.vpc_id
  cidr_block        = var.lambda_subnet_cidr_blocks[count.index]
  availability_zone = var.lambda_subnet_azs[count.index]

  # Lambda ENIs and Aurora endpoints don't need public IPs — they egress
  # via the Gitea ENI (nat.tf) and are reached privately from Lambda.
  map_public_ip_on_launch = false

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-${var.lambda_subnet_azs[count.index]}"
  })
}

resource "aws_route_table" "lambda" {
  count = local.create_lambda_subnets ? 1 : 0

  vpc_id = var.vpc_id

  # No routes defined here. 0.0.0.0/0 → Gitea ENI is added by nat.tf via
  # local.effective_route_table_ids on a follow-up apply, once Gitea has
  # source/dest check disabled and forwarding enabled.

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private"
  })
}

resource "aws_route_table_association" "lambda" {
  count = local.create_lambda_subnets ? length(aws_subnet.lambda) : 0

  subnet_id      = aws_subnet.lambda[count.index].id
  route_table_id = aws_route_table.lambda[0].id
}

locals {
  effective_subnet_ids      = local.create_lambda_subnets ? aws_subnet.lambda[*].id : var.private_subnet_ids
  effective_route_table_ids = local.create_lambda_subnets ? [aws_route_table.lambda[0].id] : var.lambda_route_table_ids
}

output "lambda_subnet_ids" {
  description = "IDs of the subnets used by Lambda + Aurora — either the ones created here or the ones passed via var.private_subnet_ids."
  value       = local.effective_subnet_ids
}

output "lambda_subnet_cidrs" {
  description = "CIDR blocks of the Lambda subnets. Pass this to infra/compute's var.lambda_subnet_cidrs so Gitea-as-NAT accepts forwarded traffic and MASQUERADEs it correctly."
  value       = local.create_lambda_subnets ? var.lambda_subnet_cidr_blocks : null
}

output "lambda_route_table_ids" {
  description = "Route table ID(s) associated with the Lambda subnets. nat.tf writes 0.0.0.0/0 → Gitea ENI here."
  value       = local.effective_route_table_ids
}
