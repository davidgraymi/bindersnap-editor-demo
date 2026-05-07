# ECS service + task definition + autoscaling for services/api.
#
# Task:
#   cpu/memory:    512 / 1024 (sized for Bun runtime + Stripe SDK + driver overhead)
#   image:         ${ecr_repo}:${var.image_tag}
#   command:       bun services/api/server.ts
#   port:          8787
#   logging:       awslogs → /aws/ecs/${name_prefix}
#   secrets[]:     stripe.*, gitea service token, postgres password, session-envelope KMS ARN
#   env:           BINDERSNAP_STORAGE_BACKEND=postgres, DATABASE_URL host/port/db,
#                  cluster identifiers, etc.
#
# Service:
#   launch_type:    FARGATE (capacity providers handle Spot mix)
#   desired_count:  1 (min)
#   network_configuration:
#     subnets:         var.private_subnet_ids
#     security_groups: [tasks_sg]
#     assign_public_ip: false (NAT or VPC endpoints handle egress)
#   load_balancer:    target_group_arn from alb.tf, container_port = 8787
#   enable_execute_command: true   # break-glass shell access (#222)
#   deployment_circuit_breaker: enabled, rollback on failure
#
# Autoscaling:
#   target tracking on ECSServiceAverageCPUUtilization at 60%
#   min 1, max 4
#
# TODO(#224): aws_ecs_task_definition.api + aws_ecs_service.api +
#             aws_appautoscaling_target + aws_appautoscaling_policy
