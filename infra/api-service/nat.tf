# NAT path for Lambda's outbound public-internet traffic.
#
# Lambda runs inside the VPC so it can reach Aurora and Gitea privately.
# The only outbound public destination is api.stripe.com. Rather than
# provisioning a NAT Gateway (~$32/mo) or a dedicated NAT instance, we route
# Lambda's egress through the existing Gitea EC2 host.
#
# This file adds the route in the Lambda subnets' route tables pointing
# 0.0.0.0/0 at the Gitea instance's primary ENI. Two complementary changes
# live in infra/compute/ and will land in a separate PR:
#
#   1. Disable source_dest_check on the Gitea ENI.
#   2. IP forwarding + iptables MASQUERADE in user-data for the Lambda
#      subnet CIDRs.
#
# Until those land, the route is created but packets won't successfully
# return through Gitea. The route alone is harmless and easier to review
# in isolation.

variable "lambda_route_table_ids" {
  description = "Pre-existing route table IDs to write the 0.0.0.0/0 → Gitea ENI route into. Leave empty when using subnets.tf to create dedicated subnets (its route table is consumed automatically via local.effective_route_table_ids)."
  type        = list(string)
  default     = []
}

variable "enable_gitea_nat_route" {
  description = "When true, writes 0.0.0.0/0 → Gitea ENI into local.effective_route_table_ids. Set false on the first apply so the subnets + route table exist before the route is written (the route alone is harmless but the corresponding Gitea-side changes in infra/compute must be applied first)."
  type        = bool
  default     = false
}

data "aws_instance" "gitea" {
  instance_id = var.gitea_instance_id
}

resource "aws_route" "lambda_egress_via_gitea" {
  count = var.enable_gitea_nat_route ? length(local.effective_route_table_ids) : 0

  route_table_id         = local.effective_route_table_ids[count.index]
  destination_cidr_block = "0.0.0.0/0"
  network_interface_id   = data.aws_instance.gitea.network_interface_id
}

output "gitea_primary_eni_id" {
  description = "Primary ENI of the Gitea instance. Used by both the egress route here and by infra/compute/ when disabling source_dest_check."
  value       = data.aws_instance.gitea.network_interface_id
}
