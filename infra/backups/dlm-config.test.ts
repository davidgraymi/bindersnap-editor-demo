import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const mainTf = readFileSync("infra/backups/main.tf", "utf8");
const dlmTf = readFileSync("infra/backups/dlm.tf", "utf8");

describe("DLM daily EBS snapshot wiring", () => {
  test("exposes backup tag inputs for the target volume", () => {
    expect(mainTf).toContain('variable "gitea_data_volume_id"');
    expect(mainTf).toContain('variable "daily_backup_tag_key"');
    expect(mainTf).toContain('variable "daily_backup_tag_value"');
    expect(mainTf).toContain(
      'description = "Existing gitea-data EBS volume ID to tag for the daily DLM policy"',
    );
    expect(mainTf).toContain('default     = "Backup"');
    expect(mainTf).toContain('default     = "daily"');
  });

  test("creates the DLM service-linked role and lifecycle policy", () => {
    expect(dlmTf).toContain('resource "aws_iam_service_linked_role" "dlm"');
    expect(dlmTf).toContain('aws_service_name = "dlm.amazonaws.com"');
    expect(dlmTf).toContain('resource "aws_dlm_lifecycle_policy" "daily_ebs_snapshots"');
    expect(dlmTf).toContain('execution_role_arn = aws_iam_service_linked_role.dlm.arn');
    expect(dlmTf).toContain('state              = "ENABLED"');
  });

  test("can tag an existing gitea data volume for the snapshot policy", () => {
    expect(dlmTf).toContain('resource "aws_ec2_tag" "gitea_data_backup"');
    expect(dlmTf).toContain('resource "aws_ec2_tag" "gitea_data_project"');
    expect(dlmTf).toContain('count = var.gitea_data_volume_id == null ? 0 : 1');
    expect(dlmTf).toContain('resource_id = var.gitea_data_volume_id');
    expect(dlmTf).toContain('key         = var.daily_backup_tag_key');
    expect(dlmTf).toContain('value       = var.daily_backup_tag_value');
    expect(dlmTf).toContain('key         = "Project"');
    expect(dlmTf).toContain("depends_on = [");
  });

  test("targets tagged volumes and retains seven daily snapshots", () => {
    expect(dlmTf).toContain('resource_types = ["VOLUME"]');
    expect(dlmTf).toContain('interval      = 24');
    expect(dlmTf).toContain('interval_unit = "HOURS"');
    expect(dlmTf).toContain('times         = ["03:00"]');
    expect(dlmTf).toContain('count = 7');
    expect(dlmTf).toContain('copy_tags = true');
    expect(dlmTf).toContain('(var.daily_backup_tag_key) = var.daily_backup_tag_value');
    expect(dlmTf).toContain('Project = var.project');
  });
});
