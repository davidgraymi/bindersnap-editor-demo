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
#
# No alb_sg, no tasks_sg — no ALB, no ECS.
#
# TODO(#224):
#   aws_security_group.lambda
#   aws_security_group.aurora
#   aws_security_group_rule.lambda_to_aurora
#   aws_security_group_rule.lambda_to_gitea
#   aws_security_group_rule.gitea_from_lambda  (on the existing Gitea SG)
