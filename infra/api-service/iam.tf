# IAM roles for the Fargate task.
#
# Two roles, deliberately split:
#
#   task_execution_role  — used by the ECS agent. Pulls the image from ECR,
#                          fetches secrets from Secrets Manager / SSM, writes
#                          logs to CloudWatch. Should NOT have application data
#                          permissions.
#
#   task_role            — assumed by the running container. Grants:
#                            kms:Decrypt/GenerateDataKey on the session
#                              envelope CMK (used to wrap Gitea tokens before
#                              writing to the sessions row).
#                            secretsmanager:GetSecretValue scoped to the
#                              api/* secrets (Postgres password, Stripe keys,
#                              Gitea service token).
#                            (Aurora access is via DB password auth held in
#                             Secrets Manager, not IAM — we use a long-lived
#                             connection pool, not data-API per-call IAM.)
#
# Break-glass: ssmmessages:* + ssm:StartSession + DescribeSessions to enable
# `aws ecs execute-command` (#222).
#
# TODO(#224): aws_iam_role.task_execution + aws_iam_role.task + policies
