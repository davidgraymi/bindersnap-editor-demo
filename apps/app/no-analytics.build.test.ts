/**
 * The app at app.bindersnap.com runs no analytics. The Privacy Policy, the
 * subprocessor list and the Security page all say so (apps/legal/documents),
 * and the Google tag on bindersnap.com (apps/site/analytics.ts) is the one
 * that must never reach it: an app address names the organization, the
 * binder and the document, and some carry a reset or invitation token.
 *
 * PR 722 had a test like this one; it went when the tag moved to every page of
 * bindersnap.com. Nothing else enforces the promise, since neither origin
 * sets a script-src yet (apps/app/public/_headers).
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const tempDir = mkdtempSync(path.join(os.tmpdir(), "bindersnap-app-no-ga-"));
const outDir = path.join(tempDir, "dist");
/** Set for the build, as static-site.yml sets it, so a leak would show. */
const measurementId = "G-GUARD12345";

const GOOGLE_ANALYTICS = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /\bgtag\b/,
  /\bdataLayer\b/,
  new RegExp(measurementId),
];

function collectFiles(dir: string, extensions: string[]): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some((extension) => fullPath.endsWith(extension))) {
      files.push(fullPath);
    }
  }
  return files;
}

function expectNoGoogleAnalytics(files: string[]): void {
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of GOOGLE_ANALYTICS) {
      expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
    }
  }
}

beforeAll(() => {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "build",
      "./apps/app/index.html",
      `--outdir=${outDir}`,
      "--target=browser",
      "--minify",
      "--splitting",
      "--production",
      "--env=BUN_PUBLIC_*",
    ],
    cwd: repoRoot,
    env: { ...process.env, BINDERSNAP_GA_MEASUREMENT_ID: measurementId },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `bun build failed with exit code ${result.exitCode}\n${Buffer.from(result.stderr).toString()}`,
    );
  }
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("the app's build loads no Google tag", () => {
  const files = collectFiles(outDir, [".html", ".js"]);
  expect(files.some((file) => file.endsWith(".html"))).toBe(true);
  expect(files.some((file) => file.endsWith(".js"))).toBe(true);
  expectNoGoogleAnalytics(files);
});

test("the app's own files load no Google tag", () => {
  // What scripts/build.ts copies into dist/app beside the bundle.
  expectNoGoogleAnalytics([
    path.join(repoRoot, "apps/app/index.html"),
    ...collectFiles(path.join(repoRoot, "apps/app/public"), [
      ".html",
      ".js",
      ".webmanifest",
      "_headers",
    ]),
  ]);
});

test("the app keeps its addresses from the site's Google tag", () => {
  // The app links to bindersnap.com/help, which runs the tag. same-origin
  // sends no Referer there, so the tag never reads an app address from
  // document.referrer (privacy.md: Google "never receives Customer Content").
  const headers = readFileSync(
    path.join(repoRoot, "apps/app/public/_headers"),
    "utf8",
  );
  expect(headers).toMatch(
    /^\/\*\n(?: {2}.+\n)* {2}Referrer-Policy: same-origin$/m,
  );
});
