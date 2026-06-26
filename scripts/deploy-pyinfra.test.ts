import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = process.cwd();
const stackUpPath = join(
  repoRoot,
  "deploy",
  "files",
  "bin",
  "bindersnap-stack-up",
);

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "bindersnap-stackup-"));
  const appDir = join(root, "app");
  const binDir = join(root, "bin");
  const stateDir = join(root, "state");
  const logPath = join(root, "commands.log");

  mkdirSync(appDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
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

  const envFile = join(appDir, ".env.prod");
  writeFileSync(envFile, "API_TAG=test\n");

  return { root, appDir, binDir, stateDir, logPath, envFile };
}

function runStackUp(workspace: ReturnType<typeof makeWorkspace>) {
  return Bun.spawnSync(["bash", stackUpPath], {
    env: {
      ...process.env,
      APP_DIR: workspace.appDir,
      ENV_FILE: workspace.envFile,
      COMPOSE_FILE: "docker-compose.prod.yml",
      STATE_DIR: workspace.stateDir,
      PATH: `${workspace.binDir}:${process.env.PATH ?? ""}`,
      LOG_PATH: workspace.logPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("bindersnap-stack-up change detection", () => {
  test("reconciles without recreate when no change markers are present", () => {
    const workspace = makeWorkspace();
    // Neither the config-changed nor env-changed marker exists this run.
    try {
      const result = runStackUp(workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("pull");
      expect(log).toContain("up -d");
      expect(log).not.toContain("--force-recreate");
      expect(log).toContain("ps");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("force-recreates when a config file changed this run", () => {
    const workspace = makeWorkspace();
    // pyinfra drops this marker when an uploaded config file changed.
    writeFileSync(join(workspace.stateDir, "config-changed"), "");

    try {
      const result = runStackUp(workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("up -d --build --force-recreate");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("force-recreates when the SSM-rendered env file changed this run", () => {
    const workspace = makeWorkspace();
    // pyinfra drops this marker when `files.put` of .env.prod reported a change.
    writeFileSync(join(workspace.stateDir, "env-changed"), "");

    try {
      const result = runStackUp(workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("up -d --build --force-recreate");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });
});

describe("deploy.py wiring", () => {
  const deployScript = readFileSync(
    join(repoRoot, "deploy", "deploy.py"),
    "utf8",
  );

  test("uploads the runtime config bundle from deploy/files", () => {
    for (const file of [
      "docker-compose.prod.yml",
      "Caddyfile.prod",
      "litestream.yml",
      "Dockerfile.caddy",
    ]) {
      expect(deployScript).toContain(`"${file}"`);
    }
  });

  test("deploys remaining host helper scripts (bootstrap-gitea, stack-up)", () => {
    for (const script of [
      "bindersnap-bootstrap-gitea",
      "bindersnap-stack-up",
    ]) {
      expect(deployScript).toContain(script);
    }
  });

  test("uses native docker.login for GHCR (no ghcr-login shell script)", () => {
    expect(deployScript).toContain("docker.login");
    expect(deployScript).toContain("ghcr.io");
    expect(deployScript).toContain("GHCR_TOKEN");
    expect(deployScript).not.toContain("bindersnap-ghcr-login");
  });

  test("uses native pyinfra ops for storage setup (no setup-storage shell script)", () => {
    expect(deployScript).toContain("DataDevice");
    expect(deployScript).toContain("BlockDeviceFilesystem");
    expect(deployScript).toContain("daemon.json");
    expect(deployScript).toContain("daemon_put.did_change");
    expect(deployScript).not.toContain("bindersnap-setup-storage");
  });

  test("renders .env.prod from SSM on the control plane (no refresh-env shell script)", () => {
    // Control-plane boto3 read + files.put, not a host-side refresh script.
    expect(deployScript).toContain("boto3");
    expect(deployScript).toContain("get_parameters_by_path");
    expect(deployScript).toContain("render_env_file");
    expect(deployScript).toContain("env_put = files.put");
    expect(deployScript).not.toContain("bindersnap-refresh-env");
  });

  test("flags config and env changes for a conditional recreate", () => {
    expect(deployScript).toContain("did_change");
    expect(deployScript).toContain("config-changed");
    expect(deployScript).toContain("env-changed");
    expect(deployScript).toContain("env_put.did_change");
  });
});
