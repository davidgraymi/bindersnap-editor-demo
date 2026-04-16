import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const userData = readFileSync("infra/compute/user-data.sh", "utf8");
const helperMatch = userData.match(
  /cat >\/usr\/local\/bin\/bindersnap-refresh-env <<'SCRIPT'\n([\s\S]*?)\nSCRIPT/,
);

if (!helperMatch) {
  throw new Error("Unable to locate embedded bindersnap-refresh-env helper");
}

const refreshHelper = helperMatch[1];
const giteaAdminPassKey = ["GITEA", "ADMIN", "PASS"].join("_");
const giteaInternalTokenKey = ["GITEA", "INTERNAL", "TOKEN"].join("_");
const giteaSecretKeyKey = ["GITEA", "SECRET", "KEY"].join("_");

function createFixtureWorkspace(parameters: Array<{ Name: string; Value: string }>) {
  const workspace = mkdtempSync(join(tmpdir(), "bindersnap-refresh-env-"));
  const appDir = join(workspace, "app");
  const envFile = join(appDir, ".env.prod");
  const binDir = join(workspace, "bin");
  const jsonPath = join(workspace, "parameters.json");
  const helperPath = join(workspace, "bindersnap-refresh-env");
  const awsPath = join(binDir, "aws");

  mkdirSync(appDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(jsonPath, JSON.stringify({ Parameters: parameters }), "utf8");
  writeFileSync(helperPath, refreshHelper, "utf8");
  writeFileSync(
    awsPath,
    `#!/usr/bin/env bash
set -euo pipefail
cat "${jsonPath}"
`,
    "utf8",
  );

  chmodSync(helperPath, 0o755);
  chmodSync(awsPath, 0o755);

  return {
    workspace,
    appDir,
    envFile,
    binDir,
    helperPath,
    updateParameters(nextParameters: Array<{ Name: string; Value: string }>) {
      writeFileSync(
        jsonPath,
        JSON.stringify({ Parameters: nextParameters }),
        "utf8",
      );
    },
    cleanup() {
      rmSync(workspace, { force: true, recursive: true });
    },
  };
}

function runHelper(
  helperPath: string,
  appDir: string,
  envFile: string,
  binDir: string,
) {
  const result = Bun.spawnSync(["bash", helperPath], {
    cwd: appDir,
    env: {
      ...process.env,
      APP_DIR: appDir,
      ENV_FILE: envFile,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      SSM_PARAMETER_PATH: "/bindersnap/prod",
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `refresh helper failed: ${result.exitCode}\n${result.stderr.toString()}`,
    );
  }
}

describe("bindersnap-refresh-env helper", () => {
  test("renders a Docker env file from SSM parameter output", () => {
    const fixture = createFixtureWorkspace([
      {
        Name: "/bindersnap/prod/gitea_secret_key",
        Value: "secret-value",
      },
      {
        Name: "/bindersnap/prod/gitea_admin_pass",
        Value: "password-value",
      },
      {
        Name: "/bindersnap/prod/bindersnap_user_email_domain",
        Value: "users.bindersnap.com",
      },
    ]);

    try {
      runHelper(
        fixture.helperPath,
        fixture.appDir,
        fixture.envFile,
        fixture.binDir,
      );

      expect(readFileSync(fixture.envFile, "utf8")).toBe(
        [
          "BINDERSNAP_USER_EMAIL_DOMAIN=users.bindersnap.com",
          `${giteaAdminPassKey}=password-value`,
          `${giteaSecretKeyKey}=secret-value`,
          "",
        ].join("\n"),
      );
      expect(statSync(fixture.envFile).mode & 0o777).toBe(0o600);
    } finally {
      fixture.cleanup();
    }
  });

  test("overwrites the generated env file when parameter values rotate", () => {
    const fixture = createFixtureWorkspace([
      {
        Name: "/bindersnap/prod/gitea_internal_token",
        Value: "old-token",
      },
    ]);

    try {
      runHelper(
        fixture.helperPath,
        fixture.appDir,
        fixture.envFile,
        fixture.binDir,
      );
      expect(readFileSync(fixture.envFile, "utf8")).toContain(
        `${giteaInternalTokenKey}=old-token`,
      );

      fixture.updateParameters([
        {
          Name: "/bindersnap/prod/gitea_internal_token",
          Value: "new-token",
        },
      ]);

      runHelper(
        fixture.helperPath,
        fixture.appDir,
        fixture.envFile,
        fixture.binDir,
      );
      const rotated = readFileSync(fixture.envFile, "utf8");
      expect(rotated).toContain(`${giteaInternalTokenKey}=new-token`);
      expect(rotated).not.toContain("old-token");
    } finally {
      fixture.cleanup();
    }
  });
});
