# Security groups: ALB → tasks → {Gitea, Aurora, AWS APIs over endpoints}.
#
#   alb_sg
#     ingress: 443 from 0.0.0.0/0
#     egress: to tasks_sg on container port
#
#   tasks_sg
#     ingress: container port from alb_sg
#     egress:  443 to 0.0.0.0/0 (DynamoDB / Secrets Manager / KMS / ECR)
#              5432 to aurora_sg
#              <gitea_port> to gitea_security_group_id (var)
#
#   aurora_sg
#     ingress: 5432 from tasks_sg only
#     egress: none
#
# A reciprocal ingress rule on var.gitea_security_group_id allows the task
# subnet to talk to Gitea. That rule is owned by THIS root so the dependency
# direction stays one-way (api-service depends on compute).
#
# TODO(#224): aws_security_group.alb + tasks + aurora + reciprocal Gitea rule
