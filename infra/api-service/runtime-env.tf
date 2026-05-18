# Runtime environment for the Lambda function.
#
# We deliberately pass secrets to Lambda as plain environment variables
# rather than fetching them from Secrets Manager at cold-start. The trade-off:
#
#   Pros
#     - One fewer AWS service in the cold-start path (no SDK call, faster boot).
#     - No SDK dependency or bootstrap module in services/api.
#     - No ~$0.40/secret/month or per-call charges.
#     - Lambda env is encrypted at rest by KMS automatically.
#
#   Cons
#     - Sensitive values live in Lambda's function configuration. Anyone with
#       lambda:GetFunction sees them in cleartext.
#     - Sensitive values live in Terraform state. Anyone with read access to
#       the S3 state bucket sees them in cleartext.
#     - Rotation requires `terraform apply`, not just a Secrets Manager update.
#
# This is acceptable for the solo-founder phase: the only IAM principal with
# either of those permissions is the operator. Long-term we plan to swap this
# for a Secrets Manager bootstrap (a small ts module that resolves *_SECRET_ARN
# → value in services/api at cold-start, gated by AWS_LAMBDA_RUNTIME_API). The
# infrastructure shape here keeps that future migration simple — one file to
# rewrite, no SDK changes in services/api required up front.
#
# Aurora's master password is a special case. Aurora manages it in its own
# Secrets Manager entry (manage_master_user_password = true on the cluster).
# We resolve that secret at terraform-apply time via a data source and bake
# the full Postgres URL into the Lambda env. Runtime Lambda never reads
# Secrets Manager.

# ---------- Sensitive runtime variables (set in terraform.tfvars) ----------

variable "stripe_secret_key" {
  description = "Stripe live secret key. Maps to STRIPE_SECRET_KEY env var."
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret. Maps to STRIPE_WEBHOOK_SECRET env var."
  type        = string
  sensitive   = true
}

variable "stripe_price_id" {
  description = "Stripe price ID for the paid plan. Maps to STRIPE_PRICE_ID env var."
  type        = string
  sensitive   = true
}

variable "gitea_service_token" {
  description = "Gitea service-account API token used by the API to act on behalf of users. Maps to BINDERSNAP_GITEA_SERVICE_TOKEN env var."
  type        = string
  sensitive   = true
}

variable "token_encryption_key" {
  description = "Base64-encoded 32-byte key for envelope-encrypting gitea_token in the sessions table (see services/api/token-crypto.ts). Generate with `openssl rand -base64 32`. Maps to BINDERSNAP_TOKEN_ENCRYPTION_KEY env var."
  type        = string
  sensitive   = true
}

# ---------- Non-sensitive runtime variables ----------

variable "session_cookie_domain" {
  description = "Cookie Domain attribute for the session cookie. Maps to BINDERSNAP_SESSION_COOKIE_DOMAIN env var. Leave empty to scope the cookie to the API origin only."
  type        = string
  default     = ""
}

variable "session_cookie_same_site" {
  description = "SameSite attribute for the session cookie (Strict, Lax, or None). Maps to BINDERSNAP_SESSION_COOKIE_SAME_SITE env var."
  type        = string
  default     = "Lax"
}

variable "user_email_domain" {
  description = "Synthetic email domain used for Gitea user records. Maps to BINDERSNAP_USER_EMAIL_DOMAIN env var."
  type        = string
  default     = "users.bindersnap.local"
}

variable "extra_env" {
  description = "Additional environment variables to set on the Lambda function. Useful for one-off knobs without adding a Terraform variable for each."
  type        = map(string)
  default     = {}
  sensitive   = true
}

# ---------- Aurora master credentials -> Postgres URL ----------

data "aws_secretsmanager_secret_version" "aurora_master" {
  secret_id = aws_rds_cluster.api.master_user_secret[0].secret_arn
}

locals {
  aurora_master_credentials = jsondecode(data.aws_secretsmanager_secret_version.aurora_master.secret_string)

  database_url = format(
    "postgres://%s:%s@%s:5432/%s?sslmode=require",
    local.aurora_master_credentials.username,
    urlencode(local.aurora_master_credentials.password),
    aws_rds_cluster.api.endpoint,
    aws_rds_cluster.api.database_name,
  )

  gitea_internal_url = "http://${data.aws_instance.gitea.private_ip}:${var.gitea_internal_port}"

  api_runtime_env = merge(
    {
      # Lambda Web Adapter — see services/api/Dockerfile.
      AWS_LWA_PORT        = "8787"
      AWS_LWA_INVOKE_MODE = "BUFFERED"
      PORT                = "8787"

      NODE_ENV = "production"

      # Postgres backend selection + assembled URL.
      BINDERSNAP_DB_BACKEND   = "postgres"
      BINDERSNAP_DATABASE_URL = local.database_url

      # Token-at-rest envelope encryption key.
      BINDERSNAP_TOKEN_ENCRYPTION_KEY = var.token_encryption_key

      # Gitea (reached privately via the in-VPC EC2 host).
      GITEA_INTERNAL_URL             = local.gitea_internal_url
      BINDERSNAP_GITEA_SERVICE_TOKEN = var.gitea_service_token

      # Stripe.
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
      STRIPE_PRICE_ID       = var.stripe_price_id

      # Browser origins / cookies.
      BINDERSNAP_ALLOWED_ORIGINS          = join(",", var.cors_allowed_origins)
      BINDERSNAP_SESSION_COOKIE_DOMAIN    = var.session_cookie_domain
      BINDERSNAP_SESSION_COOKIE_SAME_SITE = var.session_cookie_same_site
      BINDERSNAP_USER_EMAIL_DOMAIN        = var.user_email_domain
    },
    var.extra_env,
  )
}
