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
# Networking:
#   Lives in private subnets in the same VPC as the Lambda function and the
#   Gitea EC2 instance. No public IP, no public accessibility. Lambda
#   reaches it directly over the private network using a long-lived
#   connection pool.
#
#   We are NOT using the RDS Data API. Lambda is VPC-attached, so a normal
#   Postgres connection over port 5432 is the right path: lower latency, no
#   per-request Data API fee, full transaction support without the
#   Begin/Commit/Rollback API dance. The Data API path was considered and
#   rejected in favor of keeping Lambda inside the VPC (see issue #224
#   discussion thread).
#
# Capacity (chosen for cost — see README "Cold-start tradeoff"):
#   min_capacity = 0      # true auto-pause; ~$0 idle, ~5-15s wake-up on first request
#   max_capacity = 1      # solo-dev cap; raise when load justifies it
#
# Token-at-rest for sessions:
#   gitea_token is wrapped with a per-session DEK encrypted by a KMS CMK
#   (envelope encryption). Stored as gitea_token_ciphertext + gitea_token_dek
#   columns. A snapshot of the DB never reveals plaintext Gitea tokens.
#
# Credentials:
#   master password lives in Secrets Manager with rotation; Lambda fetches
#   it at cold-start and holds a connection pool for the lifetime of the
#   execution environment.
#
# TODO(#224):
#   aws_rds_cluster.api          (engine = aurora-postgresql)
#   aws_rds_cluster_instance.api (instance_class = db.serverless)
#   aws_db_subnet_group.api
#   aws_rds_cluster_parameter_group.api
#   aws_kms_key.session_envelope
