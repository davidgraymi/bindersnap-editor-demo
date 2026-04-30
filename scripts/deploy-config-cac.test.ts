import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const configDeployWorkflow = readFileSync(
  ".github/workflows/deploy-config.yml",
  "utf8",
);
const ciTerraform = readFileSync("infra/ci/oidc.tf", "utf8");
const ciTerraformVars = readFileSync(
  "infra/ci/terraform.tfvars.example",
  "utf8",
);
const configBucketTerraform = readFileSync(
  "infra/config-bucket/main.tf",
  "utf8",
);
const computeTerraform = readFileSync("infra/compute/main.tf", "utf8");
const userData = readFileSync(
  "infra/compute/user-data.sh.tftpl",
  "utf8",
).replaceAll("$${", "${");
const deployDoc = readFileSync("docs/ops/deploy.md", "utf8");

describe("config-as-code deploy wiring", () => {
  test("workflow publishes the tracked bundle to S3 and applies it over SSM", () => {
    expect(configDeployWorkflow).toContain("BINDERSNAP_CONFIG_BUCKET");
    expect(configDeployWorkflow).toContain("publish_from_repo");
    expect(configDeployWorkflow).toContain(
      'aws s3 sync ./ "s3://${CONFIG_BUCKET}/"',
    );
    expect(configDeployWorkflow).toContain(
      '--include "docker-compose.prod.yml"',
    );
    expect(configDeployWorkflow).toContain('--include "scripts/bindersnap"');
    expect(configDeployWorkflow).toContain("bindersnap config sync");
    expect(configDeployWorkflow).toContain("bindersnap stack validate");
    expect(configDeployWorkflow).toContain("bindersnap stack restart");
    expect(configDeployWorkflow).toContain("branches:\n      - main");
  });

  test("deploy role can publish objects into the config bucket", () => {
    expect(ciTerraform).toContain('variable "config_bucket_name"');
    expect(ciTerraformVars).toContain(
      '# config_bucket_name = "bindersnap-config"',
    );
    expect(ciTerraform).toContain("s3:ListBucket");
    expect(ciTerraform).toContain("s3:GetBucketLocation");
    expect(ciTerraform).toContain("s3:PutObject");
    expect(ciTerraform).toContain(
      "arn:${data.aws_partition.current.partition}:s3:::${var.config_bucket_name}",
    );
    expect(ciTerraform).toContain(
      "arn:${data.aws_partition.current.partition}:s3:::${var.config_bucket_name}/*",
    );
  });

  test("the config bundle and first-boot seed include the host CLI, and user-data drift is no longer ignored", () => {
    expect(configBucketTerraform).toContain('"scripts/bindersnap"');
    expect(computeTerraform).toContain("bindersnap_cli_b64");
    expect(userData).toContain(
      'install -m 0755 "${APP_DIR}/scripts/bindersnap" /usr/local/bin/bindersnap',
    );
    expect(userData).toContain('--include "scripts/bindersnap"');
    expect(computeTerraform).toContain("ignore_changes = [ami]");
    expect(computeTerraform).not.toContain(
      "ignore_changes = [ami, user_data, user_data_base64]",
    );
  });

  test("ops docs explain the config deploy flow and rollback path", () => {
    expect(deployDoc).toContain("Deploy Production Config");
    expect(deployDoc).toContain("bindersnap stack validate");
    expect(deployDoc).toContain("publish_from_repo=false");
    expect(deployDoc).toContain("aws s3api copy-object");
  });
});
