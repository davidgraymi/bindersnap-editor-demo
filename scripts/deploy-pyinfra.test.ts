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

  // The data volume counts as mounted unless a test sets MOUNTPOINT_EXIT=1.
  const mountpointStub = join(binDir, "mountpoint");
  writeFileSync(
    mountpointStub,
    `#!/usr/bin/env bash
exit "\${MOUNTPOINT_EXIT:-0}"
`,
  );
  chmodSync(mountpointStub, 0o755);

  const envFile = join(appDir, ".env.prod");
  writeFileSync(envFile, "API_TAG=test\n");

  return { root, appDir, binDir, stateDir, logPath, envFile };
}

function runStackUp(
  workspace: ReturnType<typeof makeWorkspace>,
  extraEnv: Record<string, string> = {},
) {
  return Bun.spawnSync(["bash", stackUpPath], {
    env: {
      ...process.env,
      ...extraEnv,
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
    // No changed-<file> marker exists this run.
    try {
      const result = runStackUp(workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("pull");
      expect(log).toContain("up -d --remove-orphans\n");
      expect(log).not.toContain("--force-recreate");
      expect(log).toContain("ps");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("refuses to start anything when the data volume is not mounted", () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace.stateDir, "changed-litestream.yml"), "");

    try {
      const result = runStackUp(workspace, { MOUNTPOINT_EXIT: "1" });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("is not mounted");
      // Not even a pull: nothing may run against a data-root on the root disk.
      expect(readFileSync(workspace.logPath, "utf8")).toBe("");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("recreates only Litestream when litestream.yml changed this run", () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace.stateDir, "changed-litestream.yml"), "");

    try {
      const result = runStackUp(workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("up -d --force-recreate --no-deps litestream\n");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("a marker left for a retired Caddy file recreates nothing", () => {
    const workspace = makeWorkspace();
    writeFileSync(join(workspace.stateDir, "changed-Caddyfile.prod"), "");
    writeFileSync(join(workspace.stateDir, "changed-Dockerfile.caddy"), "");

    try {
      const result = runStackUp(workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).not.toContain("--force-recreate");
      expect(log).not.toContain("--build");
      expect(log).not.toContain("caddy");
    } finally {
      rmSync(workspace.root, { force: true, recursive: true });
    }
  });

  test("leaves an env change to Compose, which recreates only the services it touches", () => {
    const workspace = makeWorkspace();

    try {
      const result = runStackUp(workspace);
      expect(result.exitCode).toBe(0);

      const log = readFileSync(workspace.logPath, "utf8");
      expect(log).toContain("pull --ignore-buildable");
      expect(log).not.toContain("--force-recreate");
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

describe("bindersnap-health-gate", () => {
  const healthGatePath = join(
    repoRoot,
    "deploy",
    "files",
    "bin",
    "bindersnap-health-gate",
  );

  // A docker stub: every container is running and healthy, and the API
  // answers, unless UNHEALTHY names a container or HEALTHZ_EXIT is non-zero.
  function runHealthGate(extraEnv: Record<string, string> = {}) {
    const root = mkdtempSync(join(tmpdir(), "bindersnap-healthgate-"));
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, "docker"),
      `#!/usr/bin/env bash
case "$1" in
  inspect)
    container="\${@: -1}"
    if [ "$container" = "\${UNHEALTHY:-}" ]; then
      echo "running starting"
    else
      echo "running healthy"
    fi
    ;;
  exec) exit "\${HEALTHZ_EXIT:-0}" ;;
esac
`,
    );
    chmodSync(join(binDir, "docker"), 0o755);

    try {
      return Bun.spawnSync(["bash", healthGatePath], {
        env: {
          ...process.env,
          ...extraEnv,
          HEALTH_GATE_ATTEMPTS: "2",
          HEALTH_GATE_INTERVAL: "0",
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }

  test("passes when every container is up and the API answers", () => {
    const result = runHealthGate();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Stack healthy");
  });

  test("fails when a container never becomes healthy", () => {
    const result = runHealthGate({ UNHEALTHY: "bindersnap-gitea-prod" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "bindersnap-gitea-prod is running starting",
    );
  });

  test("fails when the API does not answer /healthz at api:8787", () => {
    const result = runHealthGate({ HEALTHZ_EXIT: "1" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "does not answer /healthz at http://api:8787",
    );
  });

  test("no longer waits for Caddy, which #831 removed", () => {
    const script = readFileSync(healthGatePath, "utf8");
    expect(script).not.toMatch(/caddy/i);
  });
});

describe("deploy.py image prune (issue #810)", () => {
  const deployPy = readFileSync(join(repoRoot, "deploy", "deploy.py"), "utf8");

  // pyinfra runs operations in definition order, so the order of their names
  // in deploy.py is the order of the deploy's operation list.
  function operationIndex(name: string) {
    const index = deployPy.indexOf(`name="${name}`);
    expect(index).toBeGreaterThan(-1);
    return index;
  }

  test("prunes only after the stack is up and the health gate passes", () => {
    const up = operationIndex("Compose up");
    const gate = operationIndex("Wait for the stack to be healthy");
    const prune = operationIndex("Prune images");
    expect(up).toBeLessThan(gate);
    expect(gate).toBeLessThan(prune);
  });

  test("ships the health gate script to the host", () => {
    expect(deployPy).toContain('"bindersnap-health-gate",');
  });

  test("removes unused images and the build cache, never volumes", () => {
    const prune = operationIndex("Prune images");
    const operation = deployPy.slice(prune, deployPy.indexOf("\n)\n", prune));
    expect(operation).toContain('"docker image prune -af"');
    expect(operation).toContain('"docker builder prune -af"');
    expect(operation).not.toMatch(/--volumes|volume prune|system prune/);
  });
});
