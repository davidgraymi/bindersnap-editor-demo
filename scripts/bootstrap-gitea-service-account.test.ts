import { describe, expect, test } from "bun:test";
import {
  BOOTSTRAP_SERVICE_TOKEN_PLACEHOLDER,
  buildRemoteBootstrapCommands,
  buildPutParameterArgs,
  DEFAULT_SERVICE_ACCOUNT_USERNAME,
  DEFAULT_ADMIN_TOKEN_NAME,
  DEFAULT_SERVICE_TOKEN_NAME,
  renderDockerEnvFromSsmPayload,
  resolveAdminTokenScopes,
  resolveBootstrapConfig,
  resolveServiceTokenScopes,
  tokenSpec,
  resolveSsmParameterName,
} from "../deploy/files/scripts/bootstrap-gitea-service-account";

describe("bootstrap-gitea-service-account", () => {
  test("the service token reads; only the admin token can write, and only accounts", () => {
    expect(resolveServiceTokenScopes()).toEqual([
      "read:admin",
      "read:issue",
      "read:organization",
      "read:repository",
      "read:user",
    ]);
    expect(resolveAdminTokenScopes()).toEqual(["write:admin"]);
    expect(resolveServiceTokenScopes("read:user,read:user,read:misc")).toEqual([
      "read:user",
      "read:misc",
      "read:admin",
      "read:issue",
      "read:organization",
      "read:repository",
    ]);
  });

  test("a host with no admin token parameter yet mints the old combined token", () => {
    const config = resolveBootstrapConfig({
      GITEA_ADMIN_USER: "gitea-admin",
      GITEA_ADMIN_PASS: "break-glass",
    });
    expect(tokenSpec(config, "service")).toEqual({
      name: DEFAULT_SERVICE_TOKEN_NAME,
      scopes: resolveServiceTokenScopes(),
    });
    expect(tokenSpec(config, "admin")).toEqual({
      name: DEFAULT_ADMIN_TOKEN_NAME,
      scopes: ["write:admin"],
    });
    expect(tokenSpec(config, "combined")).toEqual({
      name: DEFAULT_SERVICE_TOKEN_NAME,
      scopes: [...resolveServiceTokenScopes(), "write:admin"],
    });
  });

  test("builds the expected SSM parameter name", () => {
    expect(resolveSsmParameterName()).toBe(
      "/bindersnap/prod/gitea_service_token",
    );
    expect(resolveSsmParameterName("/custom/path/")).toBe(
      "/custom/path/gitea_service_token",
    );
    expect(resolveSsmParameterName(undefined, "gitea_admin_token")).toBe(
      "/bindersnap/prod/gitea_admin_token",
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
    expect(config.serviceTokenScopes).toEqual(resolveServiceTokenScopes());
    expect(config.ssmParameterName).toBe(
      "/bindersnap/prod/gitea_service_token",
    );
    expect(config.adminTokenName).toBe(DEFAULT_ADMIN_TOKEN_NAME);
    expect(config.adminTokenScopes).toEqual(["write:admin"]);
    expect(config.adminSsmParameterName).toBe(
      "/bindersnap/prod/gitea_admin_token",
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

  test("keeps the admin creds while the admin token still waits to be minted", () => {
    const parameters = (adminToken: string) => ({
      Parameters: [
        { Name: "/bindersnap/prod/gitea_admin_pass", Value: "break-glass" },
        { Name: "/bindersnap/prod/gitea_admin_token", Value: adminToken },
        { Name: "/bindersnap/prod/gitea_admin_user", Value: "gitea-admin" },
        { Name: "/bindersnap/prod/gitea_service_token", Value: "real-token" },
      ],
    });

    const waiting = renderDockerEnvFromSsmPayload(
      parameters(BOOTSTRAP_SERVICE_TOKEN_PLACEHOLDER),
      "/bindersnap/prod",
    );
    expect(waiting).toContain("GITEA_ADMIN_USER=gitea-admin");
    expect(waiting).toContain("GITEA_ADMIN_PASS=break-glass");

    const minted = renderDockerEnvFromSsmPayload(
      parameters("real-admin-token"),
      "/bindersnap/prod",
    );
    expect(minted).toContain("GITEA_ADMIN_TOKEN=real-admin-token");
    expect(minted).not.toContain("GITEA_ADMIN_USER=");
    expect(minted).not.toContain("GITEA_ADMIN_PASS=");
  });

  test("the remote bootstrap mints both tokens, and the old combined one only without an admin parameter", () => {
    const script = buildRemoteBootstrapCommands("ZHVtbXk=").join("\n");
    expect(script).toContain("mint-token --kind");
    expect(script).toContain(
      'if [ -z "$ADMIN_TOKEN" ]; then SERVICE_KIND=combined; else SERVICE_KIND=service; fi',
    );
    expect(script).toContain("$PARAMETER_PATH/gitea_service_token");
    expect(script).toContain("$PARAMETER_PATH/gitea_admin_token");
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
