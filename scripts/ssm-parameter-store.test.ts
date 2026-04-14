import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const composeFile = readFileSync("docker-compose.prod.yml", "utf8");
const envExample = readFileSync(".env.prod.example", "utf8");
const readme = readFileSync("README.md", "utf8");
const secretsTerraform = readFileSync("infra/secrets/main.tf", "utf8");
const userData = readFileSync("infra/compute/user-data.sh", "utf8");

describe("SSM Parameter Store production wiring", () => {
  test("stores the production env contract in a dedicated secrets module", () => {
    expect(secretsTerraform).toContain('variable "ssm_parameter_path"');
    expect(secretsTerraform).toContain('default     = "/bindersnap/prod"');
    expect(secretsTerraform).toContain('resource "aws_ssm_parameter" "prod"');
    expect(secretsTerraform).toContain('type   = "SecureString"');
    expect(secretsTerraform).toContain("gitea_admin_user");
    expect(secretsTerraform).toContain("gitea_admin_pass");
    expect(secretsTerraform).toContain("gitea_secret_key");
    expect(secretsTerraform).toContain("gitea_internal_token");
    expect(secretsTerraform).toContain("bindersnap_user_email_domain");
    expect(secretsTerraform).toContain("litestream_s3_bucket");
  });

  test("limits the instance role to the production SSM path and KMS key", () => {
    expect(secretsTerraform).toContain("ssm:GetParametersByPath");
    expect(secretsTerraform).toContain("kms:Decrypt");
    expect(secretsTerraform).toContain("kms:DescribeKey");
    expect(secretsTerraform).toContain("parameter${local.parameter_path}/*");
    expect(secretsTerraform).toContain("kms:EncryptionContext:PARAMETER_ARN");
    expect(secretsTerraform).toContain('variable "ec2_instance_role_name"');
    expect(secretsTerraform).not.toContain('resources = ["*"]');
  });

  test("boot-time setup refreshes the env file before compose starts", () => {
    expect(userData).toContain("aws ssm get-parameters-by-path");
    expect(userData).toContain('APP_DIR="${APP_DIR:-/opt/bindersnap}"');
    expect(userData).toContain('ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.prod}"');
    expect(userData).toContain("chmod 600");
    expect(userData).toContain("chown root:root");
    expect(userData).toContain("bindersnap-refresh-env.service");
    expect(userData).toContain("bindersnap-compose.service");
    expect(userData).toContain(
      "docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d",
    );
  });

  test("documents the generated env schema and no longer instructs a checked-in prod env workflow", () => {
    expect(envExample).toContain("GITEA_ADMIN_PASS=CHANGE_ME_USE_openssl_rand_base64_20");
    expect(envExample).toContain("GITEA_SECRET_KEY=CHANGE_ME_USE_openssl_rand_base64_32");
    expect(envExample).toContain(
      "GITEA_INTERNAL_TOKEN=CHANGE_ME_USE_openssl_rand_base64_32",
    );
    expect(envExample).toContain("LITESTREAM_S3_BUCKET=bindersnap-litestream-");
    expect(composeFile).toContain("/opt/bindersnap/.env.prod");
    expect(composeFile).not.toContain("Copy .env.prod.example to .env.prod");
    expect(readme).toContain("/opt/bindersnap/.env.prod");
    expect(readme).toContain("Parameter Store");
  });
});
