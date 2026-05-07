# Aurora Serverless v2 Postgres — single datastore for all API state.
#
# Holds:
#   sessions                        — session_id PK, expires_at index for reaper
#   subscriptions                   — username PK, stripe_customer_id UNIQUE
#   subscription_access_overrides   — username PK
#   processed_webhook_events        — event_id PK, processed_at index for cleanup
#   webhook_customer_state          — customer_id PK
#
# DDL applied by a migration job, not by Terraform.
#
# Why one Postgres instead of Postgres + DynamoDB:
#   - One IAM/networking surface, one backup story, one credential rotation.
#   - At solo-dev volume the per-DB fixed cost dominates; consolidation wins.
#   - Sessions are pure KV but Postgres handles that fine; we lose DynamoDB's
#     native TTL but a tiny reap job (or pg_cron) replaces it.
#
# Capacity (chosen for cost — see README "Cold-start tradeoff"):
#   min_capacity = 0      # true auto-pause; ~$0 idle, ~5-15s wake-up on first request
#   max_capacity = 1      # solo-dev cap; raise when load justifies it
#
# If the cold-start UX is unacceptable on the login path, raise min_capacity
# to 0.5 ACU (~$43/mo) — that change is one number here, no other code moves.
#
# Token-at-rest for sessions:
#   gitea_token is wrapped with a per-session DEK encrypted by a KMS CMK
#   (envelope encryption). Stored as gitea_token_ciphertext + gitea_token_dek
#   columns. A snapshot of the DB never reveals plaintext Gitea tokens.
#
# Credentials:
#   master password lives in Secrets Manager with rotation; task fetches via
#   IAM at boot and holds a connection pool. See secrets.tf.
#
# TODO(#224):
#   aws_rds_cluster.api          (engine = aurora-postgresql)
#   aws_rds_cluster_instance.api (instance_class = db.serverless)
#   aws_db_subnet_group.api
#   aws_rds_cluster_parameter_group.api
#   aws_kms_key.session_envelope
