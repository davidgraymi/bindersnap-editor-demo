/**
 * Write the public site into `dist` as ordinary files, for GitHub Pages:
 * pricing, the templates and the rest of `apps/site/content`, plus
 * `sitemap.xml`, `robots.txt`, `llms.txt` and `llms-full.txt`, and each
 * template as a Word file.
 *
 * A page at `/templates/{slug}` is written as `templates/{slug}.html`, which
 * Pages serves at the address without the extension, and a collection's index
 * as `templates/index.html`. Run after the SPA build, which empties `dist`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  publicSiteBinaryFiles,
  publicSiteFiles,
} from "../apps/site/publicSite";

const outDir = process.argv[2] ?? "dist";
const files = publicSiteFiles();
const pagePaths = new Set(files.keys());

for (const [path, body] of files) {
  const hasChildren = [...pagePaths].some((other) =>
    other.startsWith(`${path}/`),
  );
  const file = /\.[a-z]+$/.test(path)
    ? path.slice(1)
    : hasChildren
      ? `${path.slice(1)}/index.html`
      : `${path.slice(1)}.html`;
  const target = join(outDir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

// Each template as a Word file, beside its page: /templates/{slug}.docx.
const binaries = await publicSiteBinaryFiles();
for (const [path, bytes] of binaries) {
  const target = join(outDir, path.slice(1));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

console.log(
  `Wrote ${files.size} public site files and ${binaries.size} downloads to ${outDir}`,
);
