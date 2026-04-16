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

function makeFakeLitestream(logPath: string): string {
  const dir = mkdtempSync(join(tmpdir(), "bindersnap-restore-test-"));
  const binPath = join(dir, "litestream");
  tempDirs.push(dir);

  writeFileSync(
    binPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${logPath}"
`,
  );
  chmodSync(binPath, 0o755);
  return binPath;
}

async function runRestore(
  target: "gitea" | "api",
  logPath: string,
): Promise<string[]> {
  const fakeLitestream = makeFakeLitestream(logPath);
  const proc = Bun.spawn({
    cmd: ["bash", "scripts/restore.sh", target],
    cwd: process.cwd(),
    env: {
      ...process.env,
      LITESTREAM_S3_BUCKET: "bindersnap-litestream-test",
      LITESTREAM_BIN: fakeLitestream,
      RESTORE_ASSUME_YES: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  return (await Bun.file(logPath).text()).trim().split("\n");
}

describe("restore.sh", () => {
  test("maps the gitea target to the expected database path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bindersnap-restore-log-"));
    const logPath = join(dir, "gitea.log");
    tempDirs.push(dir);

    const args = await runRestore("gitea", logPath);
    expect(args).toEqual([
      "restore",
      "-o",
      "/data/gitea/gitea.db",
      "s3://bindersnap-litestream-test/gitea",
    ]);
  });

  test("maps the api target to the expected database path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bindersnap-restore-log-"));
    const logPath = join(dir, "api.log");
    tempDirs.push(dir);

    const args = await runRestore("api", logPath);
    expect(args).toEqual([
      "restore",
      "-o",
      "/data/api/sessions.db",
      "s3://bindersnap-litestream-test/api",
    ]);
  });

  test("fails fast when the bucket env var is missing", async () => {
    const proc = Bun.spawn({
      cmd: ["bash", "scripts/restore.sh", "gitea"],
      cwd: process.cwd(),
      env: {
        ...process.env,
        RESTORE_ASSUME_YES: "1",
        LITESTREAM_S3_BUCKET: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(1);
    expect(stdout).toContain(
      "LITESTREAM_S3_BUCKET environment variable is not set",
    );
  });
});
