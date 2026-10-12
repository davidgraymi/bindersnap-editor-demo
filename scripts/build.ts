/**
 * Build both origins, each into its own directory for its own Worker:
 *
 *   dist/app   app.bindersnap.com — the SPA (apps/app/wrangler.jsonc)
 *   dist/site  bindersnap.com     — the landing page, the marketing pages,
 *                                  help and legal (wrangler.jsonc)
 *
 * Two origins since issue #718: an organization's address is `/{org}` on the
 * app, so no marketing page there could ever take a word a customer wants,
 * and the site can measure its visitors without seeing a customer.
 *
 * `BUN_PUBLIC_*` variables are inlined into both bundles: the API's address,
 * where each origin finds the other (`BUN_PUBLIC_APP_URL`,
 * `BUN_PUBLIC_SITE_URL`), and the Turnstile keys.
 */
import { cpSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const APP = join(DIST, "app");
const SITE = join(DIST, "site");
const SHARED_PUBLIC = join(ROOT, "apps/app/public");

/** The app's own: the site has a set of each, written below. */
const APP_ONLY = new Set(["_headers", "robots.txt"]);

function run(cmd: string[]): void {
  const result = Bun.spawnSync({
    cmd,
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(" ")} exited with ${result.exitCode}`);
  }
}

function bundle(entry: string, outDir: string): void {
  run([
    "bun",
    "build",
    entry,
    `--outdir=${outDir}`,
    "--target=browser",
    "--minify",
    "--splitting",
    "--public-path=/",
    `--define:process.env.NODE_ENV="production"`,
    "--env=BUN_PUBLIC_*",
  ]);
}

rmSync(DIST, { recursive: true, force: true });

// The app.
bundle("./apps/app/index.html", APP);
cpSync(SHARED_PUBLIC, APP, { recursive: true });

// The site: the landing page, then the icons and fonts it shares with the
// app, its own headers and redirects, and the pages the renderers write.
bundle("./apps/site/index.html", SITE);
for (const entry of readdirSync(SHARED_PUBLIC)) {
  if (APP_ONLY.has(entry)) continue;
  cpSync(join(SHARED_PUBLIC, entry), join(SITE, entry), { recursive: true });
}
cpSync(join(ROOT, "apps/site/public"), SITE, { recursive: true });
run(["bun", "scripts/build-help.ts", SITE]);
run(["bun", "scripts/build-legal.ts", SITE]);
run(["bun", "scripts/build-site.ts", SITE]);

console.log(`Built the app into ${APP} and the site into ${SITE}`);
