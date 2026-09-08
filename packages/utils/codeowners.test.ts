import { describe, expect, test } from "bun:test";

import {
  CODEOWNERS_PATH,
  codeownersToken,
  escapeForTokenizer,
  escapeRegex,
  folderFromPattern,
  folderPattern,
  MAX_CODEOWNERS_BYTES,
  parseCodeowners,
  renderCodeowners,
  tokenizeCodeownersLine,
  validateSignOffRules,
  type SignOffRule,
} from "./codeowners";

/**
 * What Gitea actually compiles for a folder: the file text, put through its
 * tokenizer. Every assertion about matching goes through this, because
 * asserting on the raw line would pass exactly the double-escaping bugs these
 * tests exist to catch.
 */
function compiledFor(folder: string): RegExp {
  const tokens = tokenizeCodeownersLine(`${codeownersToken(folder)}  @owner`);
  return new RegExp(`^${tokens[0]}$`);
}

const ORG = "riverside-health";

function rule(partial: Partial<SignOffRule> & { folder: string }): SignOffRule {
  return { teams: [], users: [], ...partial };
}

describe("folderPattern", () => {
  test("anchors on the folder and matches everything inside it", () => {
    // The mechanic that fails silently: Gitea compiles `^<pattern>$`, so the
    // `policies/nursing/` a GitHub habit produces matches nothing at all.
    expect(folderPattern("policies/nursing")).toBe("policies/nursing/.*");

    const compiled = compiledFor("policies/nursing");
    expect(compiled.test("policies/nursing/infection-control.md")).toBe(true);
    expect(compiled.test("policies/nursing/sub/deeper.md")).toBe(true);
    expect(compiled.test("policies/nursing")).toBe(false);
    expect(compiled.test("policies/hr/conduct.md")).toBe(false);
  });

  test("the binder root is `.*`, not `/.*`", () => {
    // Paths in a git tree are relative, so a leading slash matches nothing.
    expect(folderPattern("")).toBe(".*");
    expect(compiledFor("").test("anywhere/at/all.md")).toBe(true);
  });

  test("escapes metacharacters, so a folder is matched literally", () => {
    // The defect nobody finds until an audit. `Q1 (2026)` is full of regex
    // metacharacters; unescaped, its rule matches the wrong files or none.
    const compiled = compiledFor("reports/Q1 (2026)");

    expect(compiled.test("reports/Q1 (2026)/summary.md")).toBe(true);
    expect(compiled.test("reports/Q1 2026/summary.md")).toBe(false);
    // The bug the double escape exists to prevent: with only one layer of
    // escaping the parentheses survive as a capture group and this matches.
    expect(compiled.test("reports/Q12026/summary.md")).toBe(false);
  });

  test("a dot in a folder name does not become a wildcard", () => {
    const compiled = compiledFor("policies.v2");
    expect(compiled.test("policies.v2/a.md")).toBe(true);
    expect(compiled.test("policiesXv2/a.md")).toBe(false);
  });

  test("tolerates slashes a caller left on either end", () => {
    expect(folderPattern("/policies/nursing/")).toBe("policies/nursing/.*");
  });
});

describe("escaping, which happens twice", () => {
  test("escapeRegex covers every character that would change the match", () => {
    for (const char of ".*+?^${}()|[]\\") {
      expect(new RegExp(`^${escapeRegex(char)}$`).test(char)).toBe(true);
    }
  });

  test("escapeRegex leaves the path separator alone", () => {
    // Not a metacharacter, and escaping it would make every generated rule
    // read `policies\/nursing\/.*` in a file customers review in a change.
    expect(escapeRegex("policies/nursing")).toBe("policies/nursing");
  });

  test("escapeForTokenizer covers what the tokenizer eats", () => {
    // A space splits the line, a `#` truncates it, and a backslash is consumed
    // as an escape. Each has to survive into the regex.
    expect(escapeForTokenizer("a b")).toBe("a\\ b");
    expect(escapeForTokenizer("a#b")).toBe("a\\#b");
    expect(escapeForTokenizer("a\\b")).toBe("a\\\\b");
  });

  test("a backslash written for the regex never reaches the regex on its own", () => {
    // **The trap.** Gitea tokenizes before it compiles, and the tokenizer drops
    // one backslash from every escaped pair. So a single regex escape is eaten
    // and `(2026)` arrives at the regex as a capture group.
    const singleEscaped = `${escapeRegex("Q1 (2026)")}/.*`;
    expect(singleEscaped).toBe("Q1 \\(2026\\)/.*");

    const tokens = tokenizeCodeownersLine(`${singleEscaped}  @owner`);
    // The unescaped space splits the line first, so the pattern is not even
    // the whole folder — it is the word before the space, and everything after
    // it has become an "owner".
    expect(tokens[0]).toBe("Q1");
    expect(tokens[1]).toBe("(2026)/.*");
    expect(new RegExp(`^${tokens[0]}$`).test("Q1 (2026)/a.md")).toBe(false);

    // Escaped for both layers, it survives intact.
    const both = codeownersToken("Q1 (2026)");
    expect(tokenizeCodeownersLine(`${both}  @owner`)[0]).toBe(
      "Q1 \\(2026\\)/.*",
    );
    expect(compiledFor("Q1 (2026)").test("Q1 (2026)/a.md")).toBe(true);
  });

  test("a folder with a `#` in it keeps the rest of its line", () => {
    // Unescaped, the tokenizer treats it as the start of a comment and the
    // owners simply vanish — a rule with a pattern and nobody on it, which
    // Gitea drops with a warning nobody reads.
    const line = `${codeownersToken("ward-#3")}  @riverside-health/ic`;
    expect(tokenizeCodeownersLine(line)).toEqual([
      "ward-#3/.*",
      "@riverside-health/ic",
    ]);
    expect(compiledFor("ward-#3").test("ward-#3/a.md")).toBe(true);
  });
});

describe("tokenizeCodeownersLine", () => {
  test("splits on runs of spaces and tabs", () => {
    expect(tokenizeCodeownersLine("a/.*   @one\t@two")).toEqual([
      "a/.*",
      "@one",
      "@two",
    ]);
  });

  test("truncates at an unescaped comment", () => {
    expect(tokenizeCodeownersLine("a/.*  @one # and the rest")).toEqual([
      "a/.*",
      "@one",
    ]);
  });

  test("a blank or comment line yields nothing", () => {
    expect(tokenizeCodeownersLine("")).toEqual([]);
    expect(tokenizeCodeownersLine("   ")).toEqual([]);
    expect(tokenizeCodeownersLine("# just a comment")).toEqual([]);
  });
});

describe("renderCodeowners", () => {
  test("writes a team as @org/team and a person as @login", () => {
    const file = renderCodeowners(ORG, [
      rule({ folder: "policies/nursing", teams: ["infection-control"] }),
      rule({ folder: "policies/hr", users: ["priya"] }),
    ]);

    expect(file).toContain(
      "policies/nursing/.*  @riverside-health/infection-control",
    );
    expect(file).toContain("policies/hr/.*  @priya");
  });

  test("puts several owners on one line", () => {
    const file = renderCodeowners(ORG, [
      rule({
        folder: "policies/nursing",
        teams: ["infection-control", "quality-committee"],
        users: ["priya"],
      }),
    ]);

    expect(file).toContain(
      "policies/nursing/.*  @riverside-health/infection-control @riverside-health/quality-committee @priya",
    );
  });

  test("drops a rule with nobody on it rather than writing a half line", () => {
    // Gitea needs a pattern *and* an owner; a lone pattern is a line it cannot
    // read, and an unreadable line is dropped silently rather than refused.
    const file = renderCodeowners(ORG, [rule({ folder: "policies/nursing" })]);
    expect(file).not.toContain("policies/nursing");
  });

  test("keeps the caller's order, because the gate is per rule", () => {
    // Unlike a .gitignore, order carries no precedence here — every matching
    // rule has to be satisfied. Stable order is for a readable diff, since
    // changing these rules is a change somebody has to review.
    const file = renderCodeowners(ORG, [
      rule({ folder: "zebra", teams: ["a"] }),
      rule({ folder: "alpha", teams: ["b"] }),
    ]);
    expect(file.indexOf("zebra")).toBeLessThan(file.indexOf("alpha"));
  });

  test("says it is generated, and where to change it", () => {
    const file = renderCodeowners(ORG, []);
    expect(file).toContain("Generated by Bindersnap");
    expect(file).toContain("Settings");
  });
});

describe("parseCodeowners", () => {
  test("round-trips what the generator wrote", () => {
    const rules = [
      rule({
        folder: "policies/nursing",
        teams: ["infection-control", "quality-committee"],
      }),
      rule({ folder: "reports/Q1 (2026)", users: ["priya"] }),
      rule({ folder: "", teams: ["clinical-admins"] }),
    ];

    const parsed = parseCodeowners(ORG, renderCodeowners(ORG, rules));

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.rules).toEqual(rules);
  });

  test("ignores comments and blank lines", () => {
    const parsed = parseCodeowners(
      ORG,
      "# a comment\n\n   \npolicies/nursing/.*  @riverside-health/ic\n",
    );
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.unreadable).toEqual([]);
  });

  test("tells a team from a person by the organization prefix", () => {
    const parsed = parseCodeowners(
      ORG,
      "policies/nursing/.*  @riverside-health/ic @priya\n",
    );
    expect(parsed.rules[0]).toEqual(
      rule({ folder: "policies/nursing", teams: ["ic"], users: ["priya"] }),
    );
  });

  test("reports a line it cannot read instead of dropping it", () => {
    // A rule the screen omits is a rule somebody thinks is not there. Gitea
    // drops what it cannot parse; a page about who signs off must not.
    const parsed = parseCodeowners(
      ORG,
      "policies/nursing/.*\npolicies/[hr/.*  @riverside-health/ic\nnot-a-pattern  bare-owner\n",
    );

    expect(parsed.rules).toEqual([]);
    expect(parsed.unreadable.map((entry) => entry.line)).toEqual([1, 2, 3]);
  });

  test("a hand-written regex is unreadable rather than reinterpreted", () => {
    // Legal, enforced by Gitea, and not something a folder picker can
    // represent. Showing it verbatim beats guessing at a folder it is not.
    const parsed = parseCodeowners(
      ORG,
      "policies/(nursing|hr)/.*  @riverside-health/ic\n",
    );
    expect(parsed.rules).toEqual([]);
    expect(parsed.unreadable).toHaveLength(1);
  });
});

describe("folderFromPattern", () => {
  test("recovers the folder, escaping and all", () => {
    expect(folderFromPattern("policies/nursing/.*")).toBe("policies/nursing");
    expect(folderFromPattern("reports/Q1 \\(2026\\)/.*")).toBe(
      "reports/Q1 (2026)",
    );
    expect(folderFromPattern(".*")).toBe("");
  });

  test("refuses a pattern that only looks like an escaped folder", () => {
    // `policies/.*/.*` unescapes to `policies/./.` and would not re-render to
    // itself, so it is not a folder rule and is not treated as one.
    expect(folderFromPattern("policies/.*/.*")).toBeNull();
    expect(folderFromPattern("policies/nursing")).toBeNull();
  });
});

describe("validateSignOffRules", () => {
  const knownTeams = ["infection-control", "quality-committee"];

  test("passes the rules a customer would actually write", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [
        rule({ folder: "policies/nursing", teams: ["infection-control"] }),
        rule({ folder: "reports/Q1 (2026)", teams: ["quality-committee"] }),
      ],
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  test("refuses a rule naming a group the organization does not have", () => {
    // A rule nobody can satisfy. Gitea would enforce it and no approval could
    // ever clear it, which is a binder that cannot publish.
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [rule({ folder: "policies/nursing", teams: ["ghost-committee"] })],
    });

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("ghost-committee");
    expect(result.problems[0]).toContain("can never be satisfied");
  });

  test("refuses a rule with nobody on it", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [rule({ folder: "policies/nursing" })],
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("nobody on it");
  });

  test("refuses two rules over one folder", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [
        rule({ folder: "policies/nursing", teams: ["infection-control"] }),
        rule({ folder: "policies/nursing", teams: ["quality-committee"] }),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("two sign-off rules");
  });

  test("refuses a file over the size ceiling", () => {
    // Gitea fails closed above `MaxDisplayFileSize`, which would leave a binder
    // unable to publish at all. Refusing to write it is the kinder failure, and
    // the ceiling here is far below Gitea's.
    const many = Array.from({ length: 4000 }, (_, index) =>
      rule({
        folder: `policies/folder-with-a-fairly-long-name-${index}`,
        teams: ["infection-control", "quality-committee"],
      }),
    );

    const result = validateSignOffRules({ org: ORG, knownTeams, rules: many });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain(
      "more than Bindersnap will commit",
    );
    expect(
      new TextEncoder().encode(renderCodeowners(ORG, many)).length,
    ).toBeGreaterThan(MAX_CODEOWNERS_BYTES);
  });

  test("a folder full of metacharacters passes, and matches only itself", () => {
    // The check that is stronger than "it compiles": a wrongly escaped folder
    // compiles perfectly and matches the wrong files, so every pattern must
    // also be shown to match inside its own folder and not a sibling.
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [
        rule({
          folder: "reports/Q1 (2026) [draft]",
          teams: ["infection-control"],
        }),
      ],
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  test("an individual owner needs no group to exist", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams: [],
      rules: [rule({ folder: "policies/hr", users: ["priya"] })],
    });
    expect(result.ok).toBe(true);
  });
});

test("the file goes where Gitea looks for it", () => {
  expect(CODEOWNERS_PATH).toBe(".gitea/CODEOWNERS");
});
