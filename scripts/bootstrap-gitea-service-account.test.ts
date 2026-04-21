import { describe, expect, test } from "bun:test";
import {
  BOOTSTRAP_SERVICE_TOKEN_PLACEHOLDER,
  buildRemoteBootstrapCommands,
  buildPutParameterArgs,
  DEFAULT_SERVICE_ACCOUNT_USERNAME,
  DEFAULT_SERVICE_TOKEN_NAME,
  renderDockerEnvFromSsmPayload,
  resolveBootstrapConfig,
  resolveServiceTokenScopes,
  resolveSsmParameterName,
} from "./bootstrap-gitea-service-account";

describe("bootstrap-gitea-service-account", () => {
  test("defaults to the minimum admin scope required by the API", () => {
    expect(resolveServiceTokenScopes()).toEqual(["write:admin"]);
    expect(
      resolveServiceTokenScopes("write:admin,write:admin,read:user"),
    ).toEqual(["write:admin", "read:user"]);
  });

  test("builds the expected SSM parameter name", () => {
    expect(resolveSsmParameterName()).toBe(
      "/bindersnap/prod/gitea_service_token",
    );
    expect(resolveSsmParameterName("/custom/path/")).toBe(
      "/custom/path/gitea_service_token",
    );
  });

  test("resolves bootstrap config from the production-style env contract", () => {
    const config = resolveBootstrapConfig({
      GITEA_ADMIN_USER: "gitea-admin",
      GITEA_ADMIN_PASS: "break-glass",
      GITEA_INTERNAL_URL: "http://gitea:3000",
      BINDERSNAP_USER_EMAIL_DOMAIN: "users.bindersnap.com",
      AWS_REGION: "us-east-1",
    });

    expect(config.adminUsername).toBe("gitea-admin");
    expect(config.adminPassword).toBe("break-glass");
    expect(config.giteaUrl).toBe("http://gitea:3000");
    expect(config.serviceUsername).toBe(DEFAULT_SERVICE_ACCOUNT_USERNAME);
    expect(config.serviceEmail).toBe(
      `${DEFAULT_SERVICE_ACCOUNT_USERNAME}@users.bindersnap.com`,
    );
    expect(config.serviceTokenName).toBe(DEFAULT_SERVICE_TOKEN_NAME);
    expect(config.serviceTokenScopes).toEqual(["write:admin"]);
    expect(config.ssmParameterName).toBe(
      "/bindersnap/prod/gitea_service_token",
    );
  });

  test("uses the service username as the login_name fallback for hosted Gitea users", () => {
    const config = resolveBootstrapConfig({
      GITEA_ADMIN_USER: "gitea-admin",
      GITEA_ADMIN_PASS: "break-glass",
      GITEA_INTERNAL_URL: "http://gitea:3000",
    });

    expect(config.serviceUsername).toBe(DEFAULT_SERVICE_ACCOUNT_USERNAME);
    expect(config.serviceEmail).toBe(
      `${DEFAULT_SERVICE_ACCOUNT_USERNAME}@users.bindersnap.local`,
    );
  });

  test("builds the aws put-parameter command with an optional region", () => {
    expect(
      buildPutParameterArgs(
        "/bindersnap/prod/gitea_service_token",
        "secret-token",
        "us-east-1",
      ),
    ).toEqual([
      "aws",
      "ssm",
      "put-parameter",
      "--name",
      "/bindersnap/prod/gitea_service_token",
      "--type",
      "SecureString",
      "--value",
      "secret-token",
      "--overwrite",
      "--region",
      "us-east-1",
    ]);
  });

  test("exports the production bootstrap placeholder token value", () => {
    expect(BOOTSTRAP_SERVICE_TOKEN_PLACEHOLDER).toBe(
      "BOOTSTRAP_WITH_scripts/bootstrap-gitea-service-account.ts",
    );
  });

  test("renders a Docker env file from SSM payloads and hides bootstrap-only admin creds after token rotation", () => {
    const rendered = renderDockerEnvFromSsmPayload(
      {
        Parameters: [
          {
            Name: "/bindersnap/prod/gitea_admin_user",
            Value: "gitea-admin",
          },
          {
            Name: "/bindersnap/prod/gitea_admin_pass",
            Value: "break-glass",
          },
          {
            Name: "/bindersnap/prod/gitea_service_token",
            Value: "real-token",
          },
          {
            Name: "/bindersnap/prod/litestream_s3_bucket",
            Value: "bindersnap-litestream-123",
          },
        ],
      },
      "/bindersnap/prod",
    );

    expect(rendered).toContain("GITEA_SERVICE_TOKEN=real-token");
    expect(rendered).toContain(
      "LITESTREAM_S3_BUCKET=bindersnap-litestream-123",
    );
    expect(rendered).not.toContain("GITEA_ADMIN_USER=");
    expect(rendered).not.toContain("GITEA_ADMIN_PASS=");
  });

  test("builds remote bootstrap commands without embedding inline python", () => {
    const commands = buildRemoteBootstrapCommands("ZHVtbXk=", "Y2FkZHk=");

    expect(commands.some((command) => command.includes("python3 -c"))).toBe(
      false,
    );
    expect(commands.some((command) => command.includes("render-env"))).toBe(
      true,
    );
    expect(
      commands.some((command) =>
        command.includes("bun scripts/bootstrap-gitea-service-account.ts"),
      ),
    ).toBe(true);
    expect(
      commands.some((command) => command.includes("docker exec --user")),
    ).toBe(true);
    expect(commands.some((command) => command.includes("mint-token"))).toBe(
      true,
    );
    expect(
      commands.some((command) => command.includes("aws ssm put-parameter")),
    ).toBe(true);
    expect(
      commands.some((command) => command.includes('"$APP_DIR/Caddyfile.prod"')),
    ).toBe(true);
  });
});
