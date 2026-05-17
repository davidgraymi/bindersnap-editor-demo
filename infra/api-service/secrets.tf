# Secrets Manager + KMS for runtime credentials.
#
# Stripe + Gitea secrets are created here with placeholder JSON values; the
# operator fills in real values out-of-band via `aws secretsmanager
# put-secret-value`. The schema is documented inline so the value format is
# unambiguous.
#
# Aurora's master credentials are NOT here — `aws_rds_cluster` is configured
# with `manage_master_user_password = true`, which lets RDS create and
# rotate the password in its own AWS-managed secret. Lambda fetches that
# secret by ARN (exposed as an output).
#
# Session-envelope KMS CMK is also here: a customer-managed key (vs the
# default aws/secretsmanager key) so we can grant Lambda kms:GenerateDataKey
# without touching the account-wide default key policy.

# ---------- KMS CMK for session envelope encryption ----------

resource "aws_kms_key" "session_envelope" {
  description             = "Envelope encryption for gitea_token in the sessions table"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-session-envelope" })
}

resource "aws_kms_alias" "session_envelope" {
  name          = "alias/${local.name_prefix}-session-envelope"
  target_key_id = aws_kms_key.session_envelope.key_id
}

# ---------- Stripe ----------

resource "aws_secretsmanager_secret" "stripe" {
  name        = "${local.name_prefix}/stripe"
  description = "Stripe live keys for the API. JSON: { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID }"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "stripe_placeholder" {
  secret_id = aws_secretsmanager_secret.stripe.id
  secret_string = jsonencode({
    STRIPE_SECRET_KEY     = "REPLACE_ME"
    STRIPE_WEBHOOK_SECRET = "REPLACE_ME"
    STRIPE_PRICE_ID       = "REPLACE_ME"
  })

  lifecycle {
    # Operator updates the real value via the AWS CLI; we don't want
    # `terraform apply` to clobber it back to placeholder on every run.
    ignore_changes = [secret_string]
  }
}

# ---------- Gitea service token ----------

resource "aws_secretsmanager_secret" "gitea" {
  name        = "${local.name_prefix}/gitea"
  description = "Gitea service-account token used by the API. JSON: { BINDERSNAP_GITEA_SERVICE_TOKEN }"

  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "gitea_placeholder" {
  secret_id = aws_secretsmanager_secret.gitea.id
  secret_string = jsonencode({
    BINDERSNAP_GITEA_SERVICE_TOKEN = "REPLACE_ME"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------- Outputs ----------

output "session_envelope_kms_key_arn" {
  description = "KMS CMK ARN for session token envelope encryption. Consumed by Lambda env."
  value       = aws_kms_key.session_envelope.arn
}

output "stripe_secret_arn" {
  description = "Stripe secret ARN. Consumed by Lambda env."
  value       = aws_secretsmanager_secret.stripe.arn
}

output "gitea_secret_arn" {
  description = "Gitea service-token secret ARN. Consumed by Lambda env."
  value       = aws_secretsmanager_secret.gitea.arn
}
