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
#                            dynamodb:GetItem/PutItem/DeleteItem/Query on the
#                              sessions table only (no Scan).
#                            kms:Decrypt/GenerateDataKey on the session
#                              envelope CMK.
#                            secretsmanager:GetSecretValue scoped to the
#                              api/* secrets.
#                            (Aurora access is via DB auth, not IAM, so no
#                             rds-data:* — we use a long-lived connection pool
#                             with credentials from Secrets Manager.)
#
# Break-glass: ssmmessages:* + ssm:StartSession + DescribeSessions to enable
# `aws ecs execute-command` (#222).
#
# TODO(#224): aws_iam_role.task_execution + aws_iam_role.task + policies
