/**
 * Write the legal pages into `dist/legal` as ordinary files, for the static host.
 *
 * `/legal/{slug}` is written as `legal/{slug}.html`, which Pages serves at the
 * address without the extension, and `/legal` as `legal/index.html`. Run after
 * the SPA build, which empties `dist`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { readLegalDocuments } from "../apps/legal/legalDocuments";
import { legalFiles } from "../apps/legal/renderLegal";

const outDir = process.argv[2] ?? "dist";

for (const [path, body] of legalFiles(readLegalDocuments())) {
  const file =
    path === "/legal"
      ? "legal/index.html"
      : /\.[a-z]+$/.test(path)
        ? path.slice(1)
        : `${path.slice(1)}.html`;
  const target = join(outDir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

console.log(`Wrote the legal pages to ${join(outDir, "legal")}`);
