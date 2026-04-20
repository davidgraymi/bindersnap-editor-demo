import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const expectedOrigin = "https://api.bindersnap.com";
const tempDir = mkdtempSync(path.join(os.tmpdir(), "bindersnap-app-build-"));
const outDir = path.join(tempDir, "dist");

function collectJavaScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

beforeAll(() => {
  const buildCommand = [
    "BUN_PUBLIC_API_BASE_URL='https://api.bindersnap.com'",
    "bun build ./apps/app/index.html",
    `--outdir ${JSON.stringify(outDir)}`,
    "--target=browser",
    "--minify",
    "--splitting",
    "--production",
    "--env='BUN_PUBLIC_*'",
  ].join(" ");

  const result = Bun.spawnSync({
    cmd: ["/bin/sh", "-lc", buildCommand],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `bun build failed with exit code ${result.exitCode}\n${Buffer.from(result.stderr).toString()}`,
    );
  }
});

test("production build inlines the configured API base URL origin", () => {
  const jsFiles = collectJavaScriptFiles(outDir);
  expect(jsFiles.length).toBeGreaterThan(0);

  const emittedJs = jsFiles
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  expect(emittedJs).toContain(expectedOrigin);
});

test("production build assigns API base URL unconditionally (no ternary guard)", () => {
  const jsFiles = collectJavaScriptFiles(outDir);
  const emittedJs = jsFiles
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  // The URL must appear as a direct assignment, not gated by a runtime check
  // like `hasProcess ? "https://api.bindersnap.com" : void 0`
  expect(emittedJs).toContain(expectedOrigin);
  expect(emittedJs).not.toMatch(
    /\?\s*["']https:\/\/api\.bindersnap\.com["']\s*:\s*void 0/,
  );
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});
