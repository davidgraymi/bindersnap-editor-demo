# Aurora Serverless v2 Postgres — single datastore for all API state.
#
# Holds:
#   sessions                        — session_id PK, expires_at index for reaper
#   subscriptions                   — username PK, stripe_customer_id UNIQUE
#   subscription_access_overrides   — username PK
#   processed_webhook_events        — event_id PK, processed_at index for cleanup
#   webhook_customer_state          — customer_id PK
#
# DDL applied by the standalone migration runner (services/api/db/migrate.ts),
# NOT by Terraform.
#
# Capacity (chosen for cost — see README "Cold-start tradeoff"):
#   min_capacity = 0      # true auto-pause; ~$0 idle, ~5-15s wake-up on first request
#   max_capacity = 1      # solo-dev cap; raise when load justifies it
#
# Master credentials managed by RDS in Secrets Manager (auto-rotated) — see
# `manage_master_user_password` below. Lambda reads the auto-generated
# secret ARN from `aurora_master_secret_arn` output.
#
# Networking: lives in private subnets in the same VPC as Lambda. No public
# IP, no public accessibility. Lambda connects directly over port 5432.

variable "aurora_min_capacity" {
  description = "Aurora Serverless v2 minimum ACU. 0 = auto-pause (default); 0.5 = warm-always (~$43/mo)."
  type        = number
  default     = 0
}

variable "aurora_max_capacity" {
  description = "Aurora Serverless v2 maximum ACU."
  type        = number
  default     = 1
}

variable "aurora_engine_version" {
  description = "Aurora PostgreSQL engine version. Serverless v2 requires 13.12+, 14.6+, 15.2+, or 16.x."
  type        = string
  default     = "16.4"
}

resource "aws_db_subnet_group" "api" {
  name        = "${local.name_prefix}-aurora"
  description = "Aurora subnet group for ${local.name_prefix}"
  subnet_ids  = var.private_subnet_ids

  tags = local.common_tags
}

resource "aws_rds_cluster_parameter_group" "api" {
  name        = "${local.name_prefix}-aurora-pg"
  family      = "aurora-postgresql16"
  description = "Cluster parameters for ${local.name_prefix} Aurora cluster"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  tags = local.common_tags
}

resource "aws_rds_cluster" "api" {
  cluster_identifier              = "${local.name_prefix}-aurora"
  engine                          = "aurora-postgresql"
  engine_mode                     = "provisioned"
  engine_version                  = var.aurora_engine_version
  database_name                   = "bindersnap"
  master_username                 = "bindersnap"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.api.name
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.api.name
  vpc_security_group_ids          = [aws_security_group.aurora.id]

  storage_encrypted         = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-aurora-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"
  backup_retention_period   = 7
  preferred_backup_window   = "03:00-04:00"
  deletion_protection       = true

  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_capacity
    max_capacity = var.aurora_max_capacity
  }

  tags = local.common_tags

  lifecycle {
    ignore_changes = [
      # `timestamp()` would rewrite this every plan; only the actual destroy
      # path needs it for a unique snapshot ID.
      final_snapshot_identifier,
    ]
  }
}

resource "aws_rds_cluster_instance" "api" {
  identifier         = "${local.name_prefix}-aurora-1"
  cluster_identifier = aws_rds_cluster.api.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.api.engine
  engine_version     = aws_rds_cluster.api.engine_version

  tags = local.common_tags
}

# ---------- Outputs ----------

output "aurora_cluster_endpoint" {
  description = "Aurora writer endpoint (Lambda connects here)."
  value       = aws_rds_cluster.api.endpoint
}

output "aurora_master_secret_arn" {
  description = "ARN of the RDS-managed master-user secret. Lambda fetches the password at cold-start."
  value       = aws_rds_cluster.api.master_user_secret[0].secret_arn
}

output "aurora_database_name" {
  description = "Default Postgres database for the API."
  value       = aws_rds_cluster.api.database_name
}
