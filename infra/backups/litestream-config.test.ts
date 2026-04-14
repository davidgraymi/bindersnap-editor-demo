import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const composeFile = readFileSync("docker-compose.prod.yml", "utf8");
const envExample = readFileSync(".env.prod.example", "utf8");
const litestreamConfig = readFileSync("litestream.yml", "utf8");
const terraformModule = readFileSync("infra/backups/main.tf", "utf8");
const readme = readFileSync("README.md", "utf8");

describe("Litestream production wiring", () => {
  test("passes the bucket and region through the prod compose service", () => {
    expect(composeFile).toContain("litestream:");
    expect(composeFile).toContain("AWS_REGION=${AWS_REGION:-us-east-1}");
    expect(composeFile).toContain(
      "LITESTREAM_S3_BUCKET=${LITESTREAM_S3_BUCKET:?set in .env.prod}",
    );
  });

  test("uses environment expansion in the Litestream config", () => {
    expect(litestreamConfig).toContain("bucket: ${LITESTREAM_S3_BUCKET}");
    expect(litestreamConfig).toContain("region: ${AWS_REGION}");
    expect(litestreamConfig).not.toContain("REPLACE_WITH_LITESTREAM_BUCKET");
  });

  test("documents the restore flow and required env vars", () => {
    expect(envExample).toContain("AWS_REGION=us-east-1");
    expect(envExample).toContain("LITESTREAM_S3_BUCKET=");
    expect(readme).toContain("## Production Backups");
    expect(readme).toContain("./scripts/restore.sh gitea");
    expect(readme).toContain("./scripts/restore.sh api");
  });

  test("supports optional attachment to an existing EC2 role", () => {
    expect(terraformModule).toContain('variable "ec2_instance_role_name"');
    expect(terraformModule).toContain(
      'resource "aws_iam_role_policy_attachment" "litestream_s3"',
    );
  });
});
