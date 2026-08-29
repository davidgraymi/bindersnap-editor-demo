import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Enforces the design system so every fix in
 * docs/design/design-system-audit.md stays fixed (Task 6 of that audit).
 *
 * Parses the CSS/HTML/TS source with regexes rather than a real CSS
 * parser — good enough for "does this literal/token exist", which is all
 * five rules below need.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");
const TOKENS_CSS_REL = "packages/ui-tokens/css/bindersnap-tokens.css";
const TOKENS_CSS_PATH = join(REPO_ROOT, TOKENS_CSS_REL);
const AGENTS_MD_PATH = join(REPO_ROOT, "AGENTS.md");

const tokensCss = readFileSync(TOKENS_CSS_PATH, "utf8");

// A literal hex/rgba() outside the token file that is documented as
// deliberately fixed rather than a discipline lapse.
const LITERAL_ALLOWLIST: ReadonlyArray<{ file: string; literal: string }> = [
  // .doc-compare-blend: mix-blend-mode: difference requires a true black
  // ground, not the warm-ink --brand-ink.
  { file: "apps/app/app.css", literal: "#000" },
];

// Custom properties set at runtime via an inline style (React `style={{}}`),
// not declared with `--name: value;` anywhere — packages/editor/Editor.tsx
// positions the selection menu and sidebar this way. Each has a static
// fallback (`var(--x, 0px)`) so the CSS reads correctly on its own too.
const RUNTIME_DEFINED_TOKENS = new Set([
  "bs-selection-x",
  "bs-selection-y",
  "bs-editor-sidebar-width",
]);

const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git", "img"]);

/** Every source file under `dir` with one of `extensions`, recursively. */
function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** CSS and HTML that ship real (non-editor-only, non-report) styling. */
const STYLE_FILES = [
  ...walk(join(REPO_ROOT, "apps/app"), [".css", ".html"]),
  join(REPO_ROOT, "packages/editor/assets/bindersnap-editor.css"),
].filter((f) => f !== TOKENS_CSS_PATH);

/** Everywhere a token could reasonably be referenced: CSS, HTML, TS/TSX. */
const SOURCE_FILES = [
  ...walk(join(REPO_ROOT, "apps/app"), [".css", ".html", ".ts", ".tsx"]),
  ...walk(join(REPO_ROOT, "packages/editor"), [".css", ".tsx", ".ts"]),
  TOKENS_CSS_PATH,
];

const TOKEN_NAME = "[a-zA-Z0-9][a-zA-Z0-9-]*";
// (?<![a-zA-Z0-9-]) keeps this from matching a BEM modifier selector like
// `.bs-btn--danger:hover` — the "--danger" there is preceded by "n", a real
// custom-property declaration is always preceded by whitespace or "{"/";".
const TOKEN_DEF_RE = new RegExp(`(?<![a-zA-Z0-9-])--(${TOKEN_NAME})\\s*:`, "g");
const VAR_REF_RE = new RegExp(`var\\(--(${TOKEN_NAME})`, "g");

function matchesOf(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => m[1] as string);
}

const definedTokens = new Set(matchesOf(TOKEN_DEF_RE, tokensCss));

describe("design tokens (docs/design/design-system-audit.md, Task 6)", () => {
  test("no hex or rgba() literal appears outside bindersnap-tokens.css", () => {
    const offenders: string[] = [];
    for (const file of STYLE_FILES) {
      const rel = relative(REPO_ROOT, file);
      const text = readFileSync(file, "utf8");
      const allowed = LITERAL_ALLOWLIST.filter((a) => a.file === rel).map(
        (a) => a.literal,
      );
      const found = [
        ...(text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
        ...(text.match(/rgba?\([^)]*\)/g) ?? []),
      ];
      for (const literal of found) {
        if (!allowed.includes(literal)) {
          offenders.push(`${rel}: ${literal}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every var(--…) reference resolves to a defined token", () => {
    // A handful of files run their own self-contained, locally-scoped
    // custom-property system on top of the shared one: the editor's --e-*
    // aliases and .bs-editor-only --bs-* names (packages/editor/assets/
    // bindersnap-editor.css), and the audit-record print stylesheet's
    // --ink/--rule family (apps/app/auditRecord.ts). A reference resolves
    // if it names a token from bindersnap-tokens.css OR one defined
    // anywhere else in that same file.
    const unresolved = new Set<string>();
    for (const file of SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      const localTokens = new Set(matchesOf(TOKEN_DEF_RE, text));
      for (const name of matchesOf(VAR_REF_RE, text)) {
        if (name.endsWith("-")) continue; // "var(--bs-*)" in a doc comment
        if (RUNTIME_DEFINED_TOKENS.has(name)) continue;
        if (!definedTokens.has(name) && !localTokens.has(name)) {
          unresolved.add(`${relative(REPO_ROOT, file)}: --${name}`);
        }
      }
    }
    expect([...unresolved]).toEqual([]);
  });

  test("every defined token is referenced at least once", () => {
    const referenced = new Set<string>();
    for (const file of SOURCE_FILES) {
      const text = readFileSync(file, "utf8");
      for (const name of matchesOf(VAR_REF_RE, text)) referenced.add(name);
    }
    const unreferenced = [...definedTokens].filter((t) => !referenced.has(t));
    expect(unreferenced).toEqual([]);
  });

  test("every token name mentioned in AGENTS.md exists", () => {
    const agentsMd = readFileSync(AGENTS_MD_PATH, "utf8");
    const mentioned = [
      ...agentsMd.matchAll(/(?<![a-zA-Z0-9-])--[a-zA-Z0-9][a-zA-Z0-9-]*/g),
    ].map((m) => m[0].slice(2));
    // A name ending in "-" is a family mention ("--bs-status-warn-*"
    // written without the asterisk our regex can't match), not a literal
    // token — nothing to resolve.
    const literalNames = mentioned.filter((t) => !t.endsWith("-"));
    const missing = [...new Set(literalNames)].filter(
      (t) => !definedTokens.has(t),
    );
    expect(missing).toEqual([]);
  });

  test("computed contrast for each text token meets its documented ratio", () => {
    const rootBlock = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const hexOf = (name: string): string => {
      const m = rootBlock.match(
        new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`),
      );
      if (!m) throw new Error(`--${name} not found in :root as a hex value`);
      return m[1] as string;
    };

    const pageBg = hexOf("bs-page-bg");
    const documented = [
      ...tokensCss.matchAll(
        /--(bs-text-[a-z]+)\s+on --bs-page-bg:\s+([0-9]+\.[0-9]+):1/g,
      ),
    ].map((m) => ({ token: m[1] as string, ratio: Number(m[2]) }));

    expect(documented.length).toBeGreaterThan(0);

    for (const { token, ratio } of documented) {
      const actual = contrastRatio(hexOf(token), pageBg);
      expect(actual).toBeCloseTo(ratio, 1);
    }
  });
});

// ── WCAG 2.1 contrast, as used throughout the audit ──────────────────────

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}
