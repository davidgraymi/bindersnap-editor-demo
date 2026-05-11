# Security groups for Lambda ↔ Aurora ↔ Gitea inside the shared VPC.
#
#   lambda_sg
#     ingress: none        (API Gateway invokes Lambda via the AWS control
#                          plane, not via the VPC — no inbound SG rule)
#     egress:  443/tcp to 0.0.0.0/0   (Stripe via the Gitea-as-NAT path; AWS
#                                      APIs reached via the same path or via
#                                      VPC interface endpoints if added)
#              5432/tcp to aurora_sg
#              <gitea_internal_port>/tcp to gitea_security_group_id
#
#   aurora_sg
#     ingress: 5432/tcp from lambda_sg only
#     egress:  none
#
# Reciprocal Gitea ingress rule (Lambda → Gitea on the internal port) is
# added to var.gitea_security_group_id from THIS root so the dependency
# direction stays one-way (api-service depends on compute, not the other
# way around).

resource "aws_security_group" "lambda" {
  name_prefix = "${local.name_prefix}-lambda-"
  description = "Lambda function ENIs (egress only)"
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-lambda" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "aurora" {
  name_prefix = "${local.name_prefix}-aurora-"
  description = "Aurora Serverless v2 cluster (Postgres from Lambda only)"
  vpc_id      = var.vpc_id

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-aurora" })

  lifecycle {
    create_before_destroy = true
  }
}

# Lambda → Aurora (Postgres)
resource "aws_vpc_security_group_ingress_rule" "aurora_from_lambda" {
  security_group_id            = aws_security_group.aurora.id
  description                  = "Postgres from Lambda"
  referenced_security_group_id = aws_security_group.lambda.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "lambda_to_aurora" {
  security_group_id            = aws_security_group.lambda.id
  description                  = "Postgres to Aurora"
  referenced_security_group_id = aws_security_group.aurora.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# Lambda → Gitea (internal HTTP)
resource "aws_vpc_security_group_egress_rule" "lambda_to_gitea" {
  security_group_id            = aws_security_group.lambda.id
  description                  = "Internal HTTP to Gitea"
  referenced_security_group_id = var.gitea_security_group_id
  from_port                    = var.gitea_internal_port
  to_port                      = var.gitea_internal_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "gitea_from_lambda" {
  security_group_id            = var.gitea_security_group_id
  description                  = "Internal HTTP from Lambda (api-service)"
  referenced_security_group_id = aws_security_group.lambda.id
  from_port                    = var.gitea_internal_port
  to_port                      = var.gitea_internal_port
  ip_protocol                  = "tcp"
}

# Lambda → public internet on 443 (Stripe via Gitea-as-NAT; AWS APIs)
resource "aws_vpc_security_group_egress_rule" "lambda_https_egress" {
  security_group_id = aws_security_group.lambda.id
  description       = "HTTPS to public internet (Stripe + AWS APIs via Gitea-as-NAT)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}
