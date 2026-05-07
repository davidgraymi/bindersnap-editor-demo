# Secrets Manager + KMS for runtime credentials.
#
# Secrets:
#   bindersnap/${env}/api/stripe          — STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID
#   bindersnap/${env}/api/gitea           — BINDERSNAP_GITEA_SERVICE_TOKEN
#   bindersnap/${env}/api/postgres        — Aurora master password (rotated)
#   bindersnap/${env}/api/session-kms-arn — KMS CMK ARN for session token envelope encryption
#
# Lambda fetches these at cold-start via the AWS SDK + the IAM execution
# role (see iam.tf). They are NOT injected as plaintext environment
# variables on the function — the function itself reads from Secrets
# Manager at boot, so a Lambda console screenshot doesn't leak them.
#
# Rotation: enabled on the postgres secret with the standard
# `SecretsManagerRDSPostgreSQLRotationSingleUser` template.
#
# TODO(#224):
#   aws_secretsmanager_secret.stripe + version
#   aws_secretsmanager_secret.gitea + version
#   aws_secretsmanager_secret.postgres + version + rotation
#   aws_kms_key.session_envelope (with key policy granting Lambda role
#     kms:Decrypt + kms:GenerateDataKey only)
