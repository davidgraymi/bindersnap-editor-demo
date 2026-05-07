# DynamoDB table for session storage.
#
# Access pattern: pure key-value GET/PUT on session_id. TTL on expires_at
# handles session cleanup with no cron. On-demand billing absorbs cold-start
# storms without provisioning headroom.
#
# Schema:
#   bindersnap-${env}-api-sessions
#     PK:    session_id (string)
#     Attrs: gitea_token_ciphertext (binary), gitea_token_dek (binary),
#            username (string), created_at (number), expires_at (number)
#     TTL:   expires_at (auto-delete)
#     SSE:   AWS-managed KMS key
#
# Token-at-rest encryption: gitea_token is wrapped with a per-session data
# encryption key (DEK) which is itself encrypted by a KMS CMK (envelope
# encryption). Stored as gitea_token_ciphertext + gitea_token_dek so a raw
# table scan reveals no plaintext tokens.
#
# Subscriptions and webhook idempotency do NOT live here — they go in Aurora
# Postgres (see aurora.tf) because their access patterns include secondary
# lookups, UNION queries, and a uniqueness invariant enforced via transaction.
# See plan-verification comment on #224.
#
# TODO(#224): aws_dynamodb_table.sessions + aws_kms_key.sessions_envelope
