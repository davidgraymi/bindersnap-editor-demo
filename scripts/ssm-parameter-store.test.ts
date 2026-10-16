import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const composeFile = readFileSync(
  "deploy/files/docker-compose.prod.yml",
  "utf8",
);
const envExample = readFileSync(".env.prod.example", "utf8");
const readme = readFileSync("README.md", "utf8");
const secretsTerraform = readFileSync("infra/secrets/main.tf", "utf8");
const giteaServiceTokenKey = ["GITEA", "SERVICE", "TOKEN"].join("_");
const giteaSecretKeyKey = ["GITEA", "SECRET", "KEY"].join("_");
const giteaInternalTokenKey = ["GITEA", "INTERNAL", "TOKEN"].join("_");

describe("SSM Parameter Store production wiring", () => {
  test("stores the production env contract in a dedicated secrets module", () => {
    expect(secretsTerraform).toContain('variable "ssm_parameter_path"');
    expect(secretsTerraform).toContain('default     = "/bindersnap/prod"');
    expect(secretsTerraform).toContain('resource "aws_ssm_parameter" "config"');
    expect(secretsTerraform).toContain('type   = "SecureString"');
    expect(secretsTerraform).toContain("gitea_secret_key");
    expect(secretsTerraform).toContain("gitea_internal_token");
    expect(secretsTerraform).toContain("gitea_service_token");
    expect(secretsTerraform).toContain("gitea_admin_user");
    expect(secretsTerraform).toContain("gitea_admin_pass");
    expect(secretsTerraform).toContain("bindersnap_user_email_domain");
    expect(secretsTerraform).toContain("litestream_s3_bucket");
  });

  test("keeps every secret out of Terraform, and so out of its state", () => {
    // aws_ssm_parameter reads a decrypted value back into state on refresh,
    // so a secret Terraform manages is a secret in the state file.
    for (const secret of [
      "gitea_secret_key",
      "gitea_internal_token",
      "gitea_admin_pass",
      "stripe_secret_key",
      "stripe_webhook_secret",
    ]) {
      expect(secretsTerraform).not.toContain(`variable "${secret}"`);
      expect(secretsTerraform).not.toContain(`var.${secret}`);
    }
    expect(secretsTerraform).not.toContain("sensitive   = true");
    // The old parameters leave state without being deleted from SSM.
    expect(secretsTerraform).toMatch(
      /removed \{\s*from = aws_ssm_parameter\.prod\s*lifecycle \{\s*destroy = false/,
    );
  });

  test("limits the instance role to the production SSM path and KMS key", () => {
    expect(secretsTerraform).toContain("ssm:GetParametersByPath");
    expect(secretsTerraform).toContain("ssm:PutParameter");
    expect(secretsTerraform).toContain("kms:Decrypt");
    expect(secretsTerraform).toContain("kms:Encrypt");
    expect(secretsTerraform).toContain("kms:GenerateDataKey");
    expect(secretsTerraform).toContain("kms:DescribeKey");
    expect(secretsTerraform).toContain('parameter${local.parameter_path}"');
    expect(secretsTerraform).toContain("local.parameter_arn_base,");
    expect(secretsTerraform).toContain("local.parameter_arn_prefix,");
    expect(secretsTerraform).toContain("local.service_token_parameter_arn");
    expect(secretsTerraform).toContain("kms:EncryptionContext:PARAMETER_ARN");
    expect(secretsTerraform).toContain('variable "ec2_instance_role_name"');
    expect(secretsTerraform).not.toContain('resources = ["*"]');
  });

  test("documents the generated env schema and no longer instructs a checked-in prod env workflow", () => {
    expect(envExample).toContain(
      `${giteaSecretKeyKey}=CHANGE_ME_USE_openssl_rand_base64_32`,
    );
    expect(envExample).toContain(
      `${giteaInternalTokenKey}=CHANGE_ME_USE_openssl_rand_base64_32`,
    );
    expect(envExample).toContain(
      `${giteaServiceTokenKey}=BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts`,
    );
    expect(envExample).toContain("# GITEA_ADMIN_USER=gitea-admin");
    expect(envExample).toContain(
      "# GITEA_ADMIN_PASS=SET_MANUALLY_FOR_INITIAL_GITEA_BOOTSTRAP_ONLY",
    );
    expect(envExample).toContain("LITESTREAM_S3_BUCKET=bindersnap-litestream-");
    expect(composeFile).toContain(
      "BINDERSNAP_GITEA_SERVICE_TOKEN=${GITEA_SERVICE_TOKEN:?set in the generated env file}",
    );
    expect(composeFile).toContain("/opt/bindersnap/.env.prod");
    expect(composeFile).not.toContain("Copy .env.prod.example to .env.prod");
    expect(readme).toContain("/opt/bindersnap/.env.prod");
    expect(readme).toContain("Parameter Store");
  });
});
