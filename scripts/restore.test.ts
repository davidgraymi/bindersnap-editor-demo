import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A stand-in for `docker`. `docker ps` prints `running` (a container name, or
 * nothing); `docker run` records its arguments, one per line, in `logPath`.
 */
function makeFakeDocker(logPath: string, running = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "bindersnap-restore-test-"));
  const binPath = join(dir, "docker");
  tempDirs.push(dir);

  writeFileSync(
    binPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "ps" ]; then
  printf '%s' "${running}"
  exit 0
fi
printf '%s\\n' "$@" > "${logPath}"
`,
  );
  chmodSync(binPath, 0o755);
  return binPath;
}

function logFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bindersnap-restore-log-"));
  tempDirs.push(dir);
  return join(dir, name);
}

async function runRestore(
  target: string,
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bash", "scripts/restore.sh", target],
    cwd: process.cwd(),
    env: { ...process.env, RESTORE_ASSUME_YES: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  return {
    exitCode,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

async function restoreArgs(target: "gitea" | "api"): Promise<string[]> {
  const logPath = logFile(`${target}.log`);
  const result = await runRestore(target, {
    LITESTREAM_S3_BUCKET: "bindersnap-litestream-test",
    DOCKER_BIN: makeFakeDocker(logPath),
  });
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  return (await Bun.file(logPath).text()).trim().split("\n");
}

describe("restore.sh", () => {
  test("restores gitea.db into the gitea-data volume through the Litestream image", async () => {
    const args = await restoreArgs("gitea");

    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-v"]);
    expect(args[3]).toBe("bindersnap_gitea-data:/data/gitea");
    expect(args).toContain("--entrypoint");
    expect(
      args.find((arg) =>
        arg.startsWith("litestream/litestream:0.3.14@sha256:"),
      ),
    ).toBeDefined();
    // The trailing positional arguments the inline script reads as $1..$3.
    expect(args.at(-3)).toBe("/data/gitea/gitea.db");
    expect(args.at(-1)).toBe("s3://bindersnap-litestream-test/gitea");
  });

  test("restores sessions.db into the api-data volume", async () => {
    const args = await restoreArgs("api");

    expect(args[3]).toBe("bindersnap_api-data:/data/api");
    expect(args.at(-3)).toBe("/data/api/sessions.db");
    expect(args.at(-1)).toBe("s3://bindersnap-litestream-test/api");
  });

  test("moves the old database aside instead of deleting it", async () => {
    const args = await restoreArgs("gitea");
    const script = args.join("\n");

    expect(script).toContain('mv "$f" "$f.pre-restore-$2"');
    expect(script).toContain('litestream restore -o "$1" "$3"');
    expect(args.at(-2)).toMatch(/^\d{8}T\d{6}Z$/);
  });

  test("refuses while the database's container is running", async () => {
    const logPath = logFile("running.log");
    const result = await runRestore("gitea", {
      LITESTREAM_S3_BUCKET: "bindersnap-litestream-test",
      DOCKER_BIN: makeFakeDocker(logPath, "bindersnap-gitea-prod"),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("bindersnap-gitea-prod is running");
    expect(await Bun.file(logPath).exists()).toBe(false);
  });

  test("fails fast when the bucket env var is missing", async () => {
    const result = await runRestore("gitea", { LITESTREAM_S3_BUCKET: "" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "LITESTREAM_S3_BUCKET environment variable is not set",
    );
  });
});
