import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const build = readFileSync(join(ROOT, "scripts/build.ts"), "utf8");

test("the build tells React it is in production", () => {
  // Bun ignores `--define:`; the app shipped React's development build while
  // the flag was spelled that way.
  expect(build).toContain('`--define=process.env.NODE_ENV="production"`');
  expect(build).not.toContain("`--define:process");
});

test("what the bundler names for its content is cached for good, on both origins", () => {
  expect(build).toContain('"--chunk-naming=_assets/[name]-[hash].[ext]"');
  expect(build).toContain('"--asset-naming=_assets/[name]-[hash].[ext]"');
  for (const origin of ["apps/app", "apps/site"]) {
    const headers = readFileSync(join(ROOT, origin, "public/_headers"), "utf8");
    expect(headers, origin).toMatch(
      /^\/_assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m,
    );
  }
});
