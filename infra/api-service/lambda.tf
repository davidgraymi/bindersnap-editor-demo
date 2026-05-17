# Lambda function for services/api.
#
# Architecture: container-image Lambda running the existing Bun HTTP server
# unchanged via Lambda Web Adapter (LWA). LWA is a small extension that
# proxies API Gateway events to a local HTTP server inside the Lambda
# environment, so the Bun.serve() handler in services/api/server.ts keeps
# working with no code changes.
#
# Image source:
#   ECR repo bindersnap-${env}-api (see ecr.tf)
#   Built by .github/workflows/deploy-api.yml on each push to main.
#   Tagged with the commit SHA; deploy is `aws lambda update-function-code
#   --image-uri <repo>:<sha>` followed by `aws lambda wait function-updated`.
#
# Configuration:
#   memory:        1024 MB    (Bun + Stripe SDK + pg driver headroom)
#   timeout:       29 seconds (max useful — API Gateway HTTP API timeout is 30s)
#   architecture:  arm64      (cheaper, Bun supports it)
#   ephemeral:     512 MB     (default; nothing on-disk persists)
#
# Concurrency:
#   reserved_concurrent_executions: 10   # solo-dev cap; raise when needed
#   provisioned_concurrency: 0           # accept ~1-2s cold-start

variable "lambda_memory_mb" {
  description = "Lambda memory in MB."
  type        = number
  default     = 1024
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout in seconds. API Gateway HTTP API caps at 30s."
  type        = number
  default     = 29
}

variable "lambda_reserved_concurrency" {
  description = "Reserved concurrency. -1 disables the reservation (function uses the account-wide unreserved pool). New AWS accounts cap regional concurrency at 10 with a 10-unit unreserved floor, so any positive reservation is rejected until the quota is raised. Default -1 for that reason; raise both the AWS quota and this value together once traffic justifies it."
  type        = number
  default     = -1
}

variable "lambda_log_retention_days" {
  description = "CloudWatch Logs retention for the Lambda log group."
  type        = number
  default     = 14
}

# Bootstrap image used on first apply (before deploy-api.yml has pushed a
# real SHA-tagged image). After the first CI push, the function's image_uri
# is updated out-of-band by `aws lambda update-function-code` and we ignore
# image_uri drift in `lifecycle.ignore_changes`.
#
# Container-image Lambdas can only pull from a private ECR repo in the same
# account+region — `public.ecr.aws/...` is rejected. So the operator must
# manually push a placeholder to `${ecr}:bootstrap` once, before the first
# `terraform apply` reaches aws_lambda_function. See infra/api-service/README.md.
locals {
  api_image_uri = var.image_tag == "latest" || var.image_tag == "" ? "${aws_ecr_repository.api.repository_url}:bootstrap" : "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.name_prefix}"
  retention_in_days = var.lambda_log_retention_days

  tags = local.common_tags
}

resource "aws_lambda_function" "api" {
  function_name                  = local.name_prefix
  role                           = aws_iam_role.lambda.arn
  package_type                   = "Image"
  image_uri                      = local.api_image_uri
  architectures                  = ["arm64"]
  memory_size                    = var.lambda_memory_mb
  timeout                        = var.lambda_timeout_seconds
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  vpc_config {
    subnet_ids         = local.effective_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      # Lambda Web Adapter — see services/api/Dockerfile.
      AWS_LWA_PORT        = "8787"
      AWS_LWA_INVOKE_MODE = "BUFFERED"
      PORT                = "8787"

      # Backend selection — flips the API onto Postgres (issue #224).
      BINDERSNAP_DB_BACKEND = "postgres"

      # Aurora connection. Lambda fetches the password at cold-start from
      # AURORA_MASTER_SECRET_ARN and assembles the URL; we only pass the
      # non-secret pieces here.
      BINDERSNAP_PG_HOST     = aws_rds_cluster.api.endpoint
      BINDERSNAP_PG_PORT     = "5432"
      BINDERSNAP_PG_DATABASE = aws_rds_cluster.api.database_name

      # Secret ARNs — Lambda reads them via the IAM role; not the values
      # themselves, so a console screenshot does not leak credentials.
      AURORA_MASTER_SECRET_ARN     = aws_rds_cluster.api.master_user_secret[0].secret_arn
      STRIPE_SECRET_ARN            = aws_secretsmanager_secret.stripe.arn
      GITEA_SECRET_ARN             = aws_secretsmanager_secret.gitea.arn
      SESSION_ENVELOPE_KMS_KEY_ARN = aws_kms_key.session_envelope.arn
    }
  }

  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic_execution,
    aws_iam_role_policy_attachment.lambda_vpc_access,
    aws_cloudwatch_log_group.api,
  ]

  lifecycle {
    # deploy-api.yml updates image_uri out-of-band on every push to main;
    # `terraform apply` must not roll it back to the bootstrap image.
    ignore_changes = [image_uri]
  }

  tags = local.common_tags
}

# ---------- Outputs ----------

output "lambda_function_name" {
  description = "Lambda function name. Consumed by deploy-api.yml."
  value       = aws_lambda_function.api.function_name
}

output "lambda_function_arn" {
  description = "Lambda function ARN."
  value       = aws_lambda_function.api.arn
}

output "lambda_invoke_arn" {
  description = "Lambda invoke ARN. Consumed by API Gateway integration."
  value       = aws_lambda_function.api.invoke_arn
}
