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

describe("deploy .env.prod render (env_render.py)", () => {
  // The control-plane SSM render is the security-sensitive logic (admin-cred
  // dropping, newline rejection, sort/transform). It's pure Python in
  // env_render.py; run its real assertions here so a regression fails
  // `bun run test:ops` without adding a Python test toolchain.
  test("env_render.py unit tests pass", () => {
    const result = Bun.spawnSync(
      ["python3", join(repoRoot, "deploy", "env_render_test.py")],
      { stdout: "pipe", stderr: "pipe" },
    );
    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString();
    expect(stderr).toBe("");
    expect(stdout).toContain("env_render tests passed");
    expect(result.exitCode).toBe(0);
  });
});
