# IAM role for the Lambda function.
#
# Single role (Lambda has no equivalent of ECS's "task execution role" vs
# "task role" split — the function itself uses one execution role).
#
# Permissions:
#
#   Always-on AWS-managed:
#     AWSLambdaBasicExecutionRole              # CloudWatch Logs
#     AWSLambdaVPCAccessExecutionRole          # ENI mgmt for VPC attachment
#
#   Custom:
#     secretsmanager:GetSecretValue            # scoped to api/* secrets
#                                                (Postgres password, Stripe
#                                                keys, Gitea service token)
#     kms:Decrypt, kms:GenerateDataKey         # session_envelope CMK only
#
# What we deliberately do NOT grant:
#   rds-data:*    — not using the RDS Data API; Lambda connects to Aurora
#                   directly over port 5432.
#   ecs:*         — not using ECS at all.
#   dynamodb:*    — not using DynamoDB; all state lives in Aurora.
#
# Trust policy: lambda.amazonaws.com.
#
# TODO(#224):
#   aws_iam_role.lambda
#   aws_iam_role_policy.lambda_secrets
#   aws_iam_role_policy.lambda_kms
#   aws_iam_role_policy_attachment.lambda_basic_execution
#   aws_iam_role_policy_attachment.lambda_vpc_access
