# EBS snapshots of the data volume.
#
# The data volume holds everything Gitea owns — gitea.db AND the git
# repositories under /data/git (every document, every version, every uploaded
# file). Litestream only replicates the SQLite databases, so these snapshots are
# the ONLY backup of the repositories. A snapshot captures the database and the
# repositories at the same instant, which is also what makes it the consistent
# restore point: restoring gitea.db from Litestream on top of repositories from
# an older snapshot leaves rows pointing at commits that do not exist.
#
# See docs/ops/cloud-architecture-review.md for the RPO/RTO this buys and what
# still has to follow (off-account copy, restore drills).

resource "aws_ec2_tag" "gitea_data_backup" {
  count = var.gitea_data_volume_id == null ? 0 : 1

  resource_id = var.gitea_data_volume_id
  key         = var.daily_backup_tag_key
  value       = var.daily_backup_tag_value
}

resource "aws_ec2_tag" "gitea_data_project" {
  count = var.gitea_data_volume_id == null ? 0 : 1

  resource_id = var.gitea_data_volume_id
  key         = "Project"
  value       = var.project
}

# The execution role used to be assumed to exist
# (AWSDataLifecycleManagerDefaultRole, created by `aws dlm create-default-role`),
# which nothing in this repository creates. On an account where nobody ran that
# command the policy exists but can never take a snapshot. Own it here.
data "aws_iam_policy_document" "dlm_assume" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["dlm.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "dlm" {
  name               = "${var.project}-dlm"
  assume_role_policy = data.aws_iam_policy_document.dlm_assume.json

  tags = {
    Project = var.project
  }
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "daily_ebs_snapshots" {
  description        = "Hourly and daily EBS snapshots for the Bindersnap data volume"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  depends_on = [
    aws_ec2_tag.gitea_data_backup,
    aws_ec2_tag.gitea_data_project,
    aws_iam_role_policy_attachment.dlm,
  ]

  tags = {
    Project = var.project
  }

  policy_details {
    resource_types = ["VOLUME"]

    # Hourly: bounds the loss of repository data to one hour (it was 24).
    # Snapshots are incremental, so an hour of edits costs only the changed blocks.
    schedule {
      name = "hourly-ebs-snapshots"

      create_rule {
        interval      = 1
        interval_unit = "HOURS"
      }

      retain_rule {
        count = var.hourly_snapshot_retain_count
      }

      copy_tags = true
    }

    # Daily: the longer tail, and the copy that leaves the region. When two
    # schedules fire together DLM takes one snapshot and keeps the longer retention.
    schedule {
      name = "daily-ebs-snapshots"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["03:00"]
      }

      retain_rule {
        count = var.daily_snapshot_retain_count
      }

      copy_tags = true

      dynamic "cross_region_copy_rule" {
        for_each = var.dr_region == null ? [] : [var.dr_region]

        content {
          target    = cross_region_copy_rule.value
          encrypted = true
          copy_tags = true

          retain_rule {
            interval      = var.dr_copy_retain_days
            interval_unit = "DAYS"
          }
        }
      }
    }

    target_tags = {
      (var.daily_backup_tag_key) = var.daily_backup_tag_value
    }
  }
}

output "dlm_policy_id" {
  description = "DLM policy ID (consumed by the monitoring module's backup alarms)"
  value       = aws_dlm_lifecycle_policy.daily_ebs_snapshots.id
}
