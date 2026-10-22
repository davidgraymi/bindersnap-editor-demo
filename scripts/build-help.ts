/**
 * Write the help guides into `dist/help` as ordinary files, for the static host.
 *
 * `/help/{slug}` is written as `help/{slug}.html`, which Pages serves at the
 * address without the extension, and `/help` as `help/index.html`. Run after
 * the SPA build, which empties `dist`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { HELP_GUIDES } from "../apps/app/helpGuides";
import { helpFiles } from "../apps/help/renderHelp";

const outDir = process.argv[2] ?? "dist";

for (const [path, body] of helpFiles(HELP_GUIDES)) {
  const file =
    path === "/help"
      ? "help/index.html"
      : /\.[a-z]+$/.test(path)
        ? path.slice(1)
        : `${path.slice(1)}.html`;
  const target = join(outDir, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

console.log(`Wrote the help guides to ${join(outDir, "help")}`);
