import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const computeTerraform = readFileSync("infra/compute/main.tf", "utf8");
const ciTerraform = readFileSync("infra/ci/oidc.tf", "utf8");
const applyAll = readFileSync("infra/apply-all.sh", "utf8");
const userData = readFileSync(
  "infra/compute/user-data.sh.tftpl",
  "utf8",
).replaceAll("$${", "${");
const deployPy = readFileSync("deploy/deploy.py", "utf8");

describe("Terraform is decoupled from configuration-as-code (#306)", () => {
  test("the S3 config-as-code path is retired", () => {
    expect(existsSync("infra/config-bucket/main.tf")).toBe(false);
    expect(existsSync(".github/workflows/deploy-config.yml")).toBe(false);
    expect(applyAll).not.toContain("config-bucket");
  });

  test("Terraform references no config files or config bucket", () => {
    expect(computeTerraform).not.toContain("config_bucket_name");
    expect(computeTerraform).not.toContain("ssm_parameter_path");
    expect(ciTerraform).not.toContain("config_bucket_name");
    expect(ciTerraform).not.toContain("s3:PutObject");
  });

  test("user-data carries no host configuration — only the SSM agent check and Gitea-as-NAT", () => {
    expect(userData).toContain("amazon-ssm-agent");
    // Gitea-as-NAT stays until the serverless stack is removed in phase 5.
    expect(userData).toContain("MASQUERADE");

    expect(userData).not.toContain("dnf install -y awscli docker");
    expect(userData).not.toContain("mkfs.xfs");
    expect(userData).not.toContain("aws s3 sync");
    expect(userData).not.toContain("bindersnap-refresh-env");
    expect(userData).not.toContain("/etc/systemd/system/bindersnap");
    expect(userData).not.toContain("docker compose");
  });

  test("host configuration moved to pyinfra, including the CloudWatch agent", () => {
    expect(deployPy).toContain("amazon-cloudwatch-agent");
    expect(existsSync("deploy/files/cloudwatch-agent-config.json")).toBe(true);
    expect(existsSync("infra/compute/cloudwatch-agent-config.json")).toBe(
      false,
    );
  });
});
