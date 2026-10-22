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
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const APP = join(DIST, "app");
const SITE = join(DIST, "site");
const SHARED_PUBLIC = join(ROOT, "apps/app/public");
/** Where the bundler's output is served from, cached for good by _headers. */
const ASSETS = "_assets";

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
    // Everything the bundler writes is named for its content and served from
    // /_assets/, which each origin's _headers caches for good; only the HTML
    // keeps its own name at the root. The directory is in the public path, not
    // in the naming: Bun 1.3 leaves a naming directory out of the imports one
    // chunk makes of another, so the app imported `/index-….js`, got the HTML
    // page back, and drew nothing. Files are moved into it below.
    `--public-path=/${ASSETS}/`,
    "--entry-naming=[dir]/[name].[ext]",
    "--chunk-naming=[name]-[hash].[ext]",
    "--asset-naming=[name]-[hash].[ext]",
    // `=`, not `:`. Bun ignores `--define:` without a word, and the app
    // shipped React's development build for as long as it said that.
    `--define=process.env.NODE_ENV="production"`,
    "--env=BUN_PUBLIC_*",
  ]);
  mkdirSync(join(outDir, ASSETS));
  for (const entry of readdirSync(outDir)) {
    if (entry === ASSETS || entry.endsWith(".html")) continue;
    renameSync(join(outDir, entry), join(outDir, ASSETS, entry));
  }
  checkReferences(outDir);
}

/**
 * Every script, stylesheet and asset the bundle asks for is a file it wrote.
 * A path that is not one gets the HTML page back from Cloudflare, which a
 * browser refuses as a module, so the page draws nothing and says nothing.
 */
function checkReferences(outDir: string): void {
  const missing = new Set<string>();
  const files = [
    ...readdirSync(outDir).filter((name) => name.endsWith(".html")),
    ...readdirSync(join(outDir, ASSETS)).map((name) => join(ASSETS, name)),
  ].filter((name) => /\.(html|js|css)$/.test(name));
  for (const file of files) {
    const text = readFileSync(join(outDir, file), "utf8");
    // Anything under /_assets/, and every module one script imports.
    for (const [, asset, module] of text.matchAll(
      /(\/_assets\/[^"')\s]+)|(?:from|import\s*\()\s*["'](\/[^"']+)/g,
    )) {
      const path = (asset ?? module)!;
      if (!existsSync(join(outDir, path))) missing.add(`${file}: ${path}`);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `The build in ${outDir} asks for files it did not write:\n${[...missing].join("\n")}`,
    );
  }
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
