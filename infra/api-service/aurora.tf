# Aurora Serverless v2 Postgres for subscription + webhook idempotency state.
#
# Why Aurora Serverless v2 instead of DynamoDB:
#   - subscriptions has a uniqueness invariant on stripe_customer_id enforced
#     today via SQLite BEGIN IMMEDIATE + dedup. Postgres preserves that as a
#     single UNIQUE constraint. DynamoDB would require conditional-write logic.
#   - listKnownAccessStates() unions subscriptions and subscription_access_overrides
#     and is used by the admin UI. Trivial in SQL, painful in DynamoDB.
#   - getByCustomerId() is a secondary lookup; DynamoDB needs a GSI; Postgres
#     just needs an index.
#   - Aurora Serverless v2 supports min_capacity = 0 ACU (auto-pause) since
#     late 2024. At zero traffic we pay storage only.
#
# Capacity:
#   min_capacity = 0     # auto-pause when idle
#   max_capacity = 1     # solo-dev cap; raise when load justifies it
#
# Tables (DDL applied by migration job, not by Terraform):
#   subscriptions                   — username PK, stripe_customer_id UNIQUE
#   subscription_access_overrides   — username PK
#   processed_webhook_events        — event_id PK
#   webhook_customer_state          — customer_id PK
#
# DB credentials live in Secrets Manager (see secrets.tf), rotated on a
# schedule. The Fargate task fetches them at boot via the task role.
#
# TODO(#224): aws_rds_cluster.api + aws_rds_cluster_instance.api +
#             aws_db_subnet_group.api + db parameter group
