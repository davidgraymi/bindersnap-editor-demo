# Secrets Manager + KMS for runtime credentials.
#
# Secrets:
#   - bindersnap/${env}/api/stripe          — STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID
#   - bindersnap/${env}/api/gitea           — BINDERSNAP_GITEA_SERVICE_TOKEN
#   - bindersnap/${env}/api/postgres        — Aurora master password (rotated)
#   - bindersnap/${env}/api/session-kms-arn — KMS CMK ARN for session token envelope encryption
#
# Injected into the task definition via the secrets[] field; never written to
# disk. No .env files anywhere on the task.
#
# TODO(#224): aws_secretsmanager_secret.* + aws_kms_key.session_envelope
