import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { ICON } from "../../packages/ui-tokens/icons";

/**
 * The app and the editor draw every icon from the vocabulary
 * (packages/ui-tokens/icons.tsx) through AppIcon, at a size on the scale and the token's weight. CI does not
 * typecheck, so these hold the line the types would: one call site reaching
 * for lucide-react directly is how three pictures for "draft" came about.
 */

const ROOT = join(import.meta.dir, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "public") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      out.push(full);
  }
  return out;
}

const files = [
  ...sourceFiles(import.meta.dir),
  ...sourceFiles(join(ROOT, "packages/editor")),
].map((file) => ({
  name: relative(ROOT, file),
  text: readFileSync(file, "utf8"),
}));

/** Where `pattern` matches, as file:line. A tag may span several lines. */
const offenders = (pattern: RegExp) =>
  files.flatMap(({ name, text }) =>
    [...text.matchAll(new RegExp(pattern.source, "g"))].map(
      (match) => `${name}:${text.slice(0, match.index).split("\n").length}`,
    ),
  );

describe("icons in the app and the editor", () => {
  test("come from the vocabulary, never from lucide-react directly", () => {
    expect(offenders(/from "lucide-react"/)).toEqual([]);
  });

  test("never set their own stroke", () => {
    expect(offenders(/strokeWidth/)).toEqual([]);
  });

  test("take a size from the scale, never a number", () => {
    expect(offenders(/<AppIcon\b[^>]*\bsize=\{[^}]*\d/)).toEqual([]);
    expect(offenders(/<AppIcon\b[^>]*\bsize="(?!(xs|sm|md|lg)")/)).toEqual([]);
  });

  test("name an idea the vocabulary has", () => {
    const unknown = files.flatMap(({ name, text }) =>
      [...text.matchAll(/\bICON\.(\w+)/g)]
        .map((match) => match[1]!)
        .filter((key) => !(key in ICON))
        .map((key) => `${name}: ICON.${key}`),
    );
    expect(unknown).toEqual([]);
  });
});
