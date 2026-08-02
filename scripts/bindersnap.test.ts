import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const scriptPath = join(
  process.cwd(),
  "deploy",
  "files",
  "scripts",
  "bindersnap",
);

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "bindersnap-cli-"));
  const appDir = join(root, "app");
  const binDir = join(root, "bin");
  const logPath = join(root, "commands.log");

  mkdirSync(appDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(logPath, "");

  const dockerStub = join(binDir, "docker");
  writeFileSync(
    dockerStub,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\\n' "$*" >> "$LOG_PATH"
`,
  );
  chmodSync(dockerStub, 0o755);

  const ghcrLoginStub = join(binDir, "bindersnap-ghcr-login");
  writeFileSync(
    ghcrLoginStub,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'ghcr-login\\n' >> "$LOG_PATH"
`,
  );
  chmodSync(ghcrLoginStub, 0o755);

  return { root, appDir, binDir, logPath };
}

function runCli(args: string[], workspace: ReturnType<typeof makeWorkspace>) {
  return Bun.spawnSync(["bash", scriptPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_DIR: workspace.appDir,
      PATH: `${workspace.binDir}:${process.env.PATH ?? ""}`,
      LOG_PATH: workspace.logPath,
      ENV_FILE: join(workspace.appDir, ".env.prod"),
      COMPOSE_FILE: "docker-compose.prod.yml",
      CADDY_VALIDATE_IMAGE: "bindersnap-caddy-validate:test",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("bindersnap host CLI", () => {
  test("the retired S3 config sync command is gone", () => {
    const workspace = makeWorkspace();

    try {
      const result = runCli(["config", "sync"], workspace);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("Usage:");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("stack validate checks compose config and validates the custom Caddy build", () => {
    const workspace = makeWorkspace();

    writeFileSync(
      join(workspace.appDir, "docker-compose.prod.yml"),
      "services: {}\n",
    );
    writeFileSync(
      join(workspace.appDir, "Caddyfile.prod"),
      "example.com {\n\treverse_proxy localhost:3000\n}\n",
    );
    writeFileSync(join(workspace.appDir, "Dockerfile.caddy"), "FROM caddy:2\n");

    try {
      const result = runCli(["stack", "validate"], workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("docker compose --env-file");
      expect(log).toContain(
        "docker build -q -t bindersnap-caddy-validate:test",
      );
      expect(log).toContain("caddy validate --config /etc/caddy/Caddyfile");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("stack restart logs into GHCR, refreshes compose, and force-recreates caddy and litestream", () => {
    const workspace = makeWorkspace();

    writeFileSync(
      join(workspace.appDir, "docker-compose.prod.yml"),
      "services: {}\n",
    );
    writeFileSync(join(workspace.appDir, ".env.prod"), "API_TAG=test\n");

    try {
      const result = runCli(["stack", "restart"], workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("ghcr-login");
      expect(log).toContain("docker compose --env-file");
      expect(log).toContain("pull api");
      expect(log).toContain("up -d --build --force-recreate caddy litestream");
      expect(log).toContain("ps");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });
});
