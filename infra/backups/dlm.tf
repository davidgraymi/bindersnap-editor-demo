resource "aws_iam_service_linked_role" "dlm" {
  aws_service_name = "dlm.amazonaws.com"
}

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

resource "aws_dlm_lifecycle_policy" "daily_ebs_snapshots" {
  description        = "Daily EBS snapshots for the Bindersnap data volume"
  execution_role_arn = aws_iam_service_linked_role.dlm.arn
  state              = "ENABLED"

  depends_on = [
    aws_ec2_tag.gitea_data_backup,
    aws_ec2_tag.gitea_data_project,
  ]

  tags = {
    Project = var.project
  }

  policy_details {
    resource_types = ["VOLUME"]

    schedule {
      name = "daily-ebs-snapshots"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["03:00"]
      }

      retain_rule {
        count = 7
      }

      copy_tags = true
    }

    target_tags = {
      (var.daily_backup_tag_key) = var.daily_backup_tag_value
    }
  }
}
