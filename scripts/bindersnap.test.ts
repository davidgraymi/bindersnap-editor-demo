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

const scriptPath = join(process.cwd(), "config", "scripts", "bindersnap");
const scriptSource = readFileSync(scriptPath, "utf8");

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "bindersnap-cli-"));
  const appDir = join(root, "app");
  const binDir = join(root, "bin");
  const installBinDir = join(root, "usr-local-bin");
  const mockS3Dir = join(root, "mock-s3");
  const logPath = join(root, "commands.log");

  mkdirSync(appDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(installBinDir, { recursive: true });
  mkdirSync(join(mockS3Dir, "scripts"), { recursive: true });
  writeFileSync(logPath, "");

  const awsStub = join(binDir, "aws");
  writeFileSync(
    awsStub,
    `#!/usr/bin/env bash
set -euo pipefail
printf 'aws %s\\n' "$*" >> "$LOG_PATH"
if [ "$1" = "s3" ] && [ "$2" = "sync" ]; then
  dest="$4"
  install -d -m 0755 "$dest" "$dest/scripts"
  cp "$MOCK_S3_DIR/docker-compose.prod.yml" "$dest/docker-compose.prod.yml"
  cp "$MOCK_S3_DIR/Caddyfile.prod" "$dest/Caddyfile.prod"
  cp "$MOCK_S3_DIR/litestream.yml" "$dest/litestream.yml"
  cp "$MOCK_S3_DIR/Dockerfile.caddy" "$dest/Dockerfile.caddy"
  cp "$MOCK_S3_DIR/scripts/bindersnap" "$dest/scripts/bindersnap"
  cp "$MOCK_S3_DIR/scripts/bootstrap-gitea-service-account.ts" "$dest/scripts/bootstrap-gitea-service-account.ts"
fi
`,
  );
  chmodSync(awsStub, 0o755);

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

  writeFileSync(join(mockS3Dir, "docker-compose.prod.yml"), "services: {}\n");
  writeFileSync(
    join(mockS3Dir, "Caddyfile.prod"),
    "example.com {\n\treverse_proxy localhost:3000\n}\n",
  );
  writeFileSync(join(mockS3Dir, "litestream.yml"), "dbs: []\n");
  writeFileSync(join(mockS3Dir, "Dockerfile.caddy"), "FROM caddy:2\n");
  writeFileSync(join(mockS3Dir, "scripts", "bindersnap"), scriptSource);
  writeFileSync(
    join(mockS3Dir, "scripts", "bootstrap-gitea-service-account.ts"),
    'console.log("bootstrap");\n',
  );

  return { root, appDir, binDir, installBinDir, mockS3Dir, logPath };
}

function runCli(args: string[], workspace: ReturnType<typeof makeWorkspace>) {
  return Bun.spawnSync(["bash", scriptPath, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_DIR: workspace.appDir,
      BIN_DIR: workspace.installBinDir,
      CONFIG_BUCKET: "bindersnap-config",
      PATH: `${workspace.binDir}:${process.env.PATH ?? ""}`,
      LOG_PATH: workspace.logPath,
      MOCK_S3_DIR: workspace.mockS3Dir,
      ENV_FILE: join(workspace.appDir, ".env.prod"),
      COMPOSE_FILE: "docker-compose.prod.yml",
      CADDY_VALIDATE_IMAGE: "bindersnap-caddy-validate:test",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("bindersnap host CLI", () => {
  test("config sync pulls the tracked bundle from S3 and installs the CLI", () => {
    const workspace = makeWorkspace();

    try {
      const result = runCli(["config", "sync"], workspace);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(workspace.logPath, "utf8")).toContain(
        "aws s3 sync s3://bindersnap-config/ ",
      );
      expect(
        readFileSync(join(workspace.appDir, "docker-compose.prod.yml"), "utf8"),
      ).toContain("services: {}");
      expect(
        readFileSync(join(workspace.installBinDir, "bindersnap"), "utf8"),
      ).toContain("Usage:");
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
