import { describe, expect, test } from "bun:test";
import {
  buildPutParameterArgs,
  DEFAULT_SERVICE_ACCOUNT_USERNAME,
  DEFAULT_SERVICE_TOKEN_NAME,
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
});
