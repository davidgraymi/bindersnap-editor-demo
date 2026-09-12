import { describe, expect, test } from "bun:test";

import {
  CODEOWNERS_PATH,
  codeownersToken,
  escapeForTokenizer,
  escapeRegex,
  MAX_CODEOWNERS_BYTES,
  parseCodeowners,
  renderCodeowners,
  ruleFromPattern,
  rulePattern,
  tokenizeCodeownersLine,
  validateSignOffRules,
  type SignOffRule,
} from "./codeowners";

/**
 * What Gitea actually compiles for a rule: the file text, put through its
 * tokenizer. Every assertion about matching goes through this, because
 * asserting on the raw line would pass exactly the double-escaping bugs these
 * tests exist to catch.
 */
function compiledFor(target: { scope: SignOffRule["scope"]; target: string }) {
  const tokens = tokenizeCodeownersLine(`${codeownersToken(target)}  @owner`);
  return new RegExp(`^${tokens[0]}$`);
}

const ORG = "riverside-health";

/** A real identity, so the tests exercise the shape the product writes. */
const HAND_HYGIENE = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";

function folder(
  target: string,
  partial: Partial<SignOffRule> = {},
): SignOffRule {
  return { scope: "folder", target, teams: [], users: [], ...partial };
}

function binder(partial: Partial<SignOffRule> = {}): SignOffRule {
  return { scope: "binder", target: "", teams: [], users: [], ...partial };
}

function document(
  target: string,
  partial: Partial<SignOffRule> = {},
): SignOffRule {
  return { scope: "document", target, teams: [], users: [], ...partial };
}

describe("a rule over a folder", () => {
  test("anchors on the folder and matches everything inside it", () => {
    // The mechanic that fails silently: Gitea compiles `^<pattern>$`, so the
    // `policies/nursing/` a GitHub habit produces matches nothing at all.
    expect(rulePattern(folder("policies/nursing"))).toBe("policies/nursing/.*");

    const compiled = compiledFor(folder("policies/nursing"));
    expect(compiled.test("policies/nursing/infection-control.md")).toBe(true);
    expect(compiled.test("policies/nursing/sub/deeper.md")).toBe(true);
    expect(compiled.test("policies/nursing")).toBe(false);
    expect(compiled.test("policies/hr/conduct.md")).toBe(false);
  });

  test("escapes metacharacters, so a folder is matched literally", () => {
    // The defect nobody finds until an audit. `Q1 (2026)` is full of regex
    // metacharacters; unescaped, its rule matches the wrong files or none.
    const compiled = compiledFor(folder("reports/Q1 (2026)"));

    expect(compiled.test("reports/Q1 (2026)/summary.md")).toBe(true);
    expect(compiled.test("reports/Q1 2026/summary.md")).toBe(false);
    // The bug the double escape exists to prevent: with only one layer of
    // escaping the parentheses survive as a capture group and this matches.
    expect(compiled.test("reports/Q12026/summary.md")).toBe(false);
  });

  test("a dot in a folder name does not become a wildcard", () => {
    const compiled = compiledFor(folder("policies.v2"));
    expect(compiled.test("policies.v2/a.md")).toBe(true);
    expect(compiled.test("policiesXv2/a.md")).toBe(false);
  });

  test("tolerates slashes a caller left on either end", () => {
    expect(rulePattern(folder("/policies/nursing/"))).toBe(
      "policies/nursing/.*",
    );
  });
});

describe("a rule over the whole binder", () => {
  test("is `.*`, not `/.*`", () => {
    // Paths in a git tree are relative, so a leading slash matches nothing.
    expect(rulePattern(binder())).toBe(".*");
    expect(compiledFor(binder()).test("anywhere/at/all.md")).toBe(true);
  });

  test("a folder rule with no folder is the same thing, not `/.*`", () => {
    // Not reachable through the UI, and the one shape Gitea would silently
    // reinterpret if it ever were.
    expect(rulePattern(folder(""))).toBe(".*");
  });
});

describe("a rule over one document", () => {
  test("follows the document rather than its path", () => {
    // The whole reason a document rule is keyed on the identity. Retitle the
    // policy or refile it and the rule still applies — written against a path,
    // it would stop applying silently, because Gitea finds no matching rule
    // and lets the merge through.
    const compiled = compiledFor(document(HAND_HYGIENE));

    expect(compiled.test(`nursing/hand-hygiene.${HAND_HYGIENE}.md`)).toBe(true);
    expect(
      compiled.test(
        `infection-control/hand-hygiene-and-ppe.${HAND_HYGIENE}.pdf`,
      ),
    ).toBe(true);
    // A document at the binder root, and one with no extension.
    expect(compiled.test(`handover.${HAND_HYGIENE}.md`)).toBe(true);
    expect(compiled.test(`handover.${HAND_HYGIENE}`)).toBe(true);
  });

  test("leaves every other document alone", () => {
    const compiled = compiledFor(document(HAND_HYGIENE));

    expect(
      compiled.test("nursing/handover.01J9A0B1C2D3E4F5G6H7J8K9M0.md"),
    ).toBe(false);
    // The near miss: an identity that merely starts the same.
    expect(compiled.test(`nursing/other.${HAND_HYGIENE}XYZ.md`)).toBe(false);
    // And the folder it happens to be filed in.
    expect(compiled.test("nursing/a-different-policy.md")).toBe(false);
  });

  test("the escaped dots survive both layers", () => {
    // Written once for the regex and once for the tokenizer. A single layer
    // leaves `.` as a wildcard, and the rule would match half the binder.
    expect(rulePattern(document(HAND_HYGIENE))).toBe(
      `.*\\.${HAND_HYGIENE}(\\..*)?`,
    );
    expect(codeownersToken(document(HAND_HYGIENE))).toBe(
      `.*\\\\.${HAND_HYGIENE}(\\\\..*)?`,
    );
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
    const both = codeownersToken(folder("Q1 (2026)"));
    expect(tokenizeCodeownersLine(`${both}  @owner`)[0]).toBe(
      "Q1 \\(2026\\)/.*",
    );
    expect(compiledFor(folder("Q1 (2026)")).test("Q1 (2026)/a.md")).toBe(true);
  });

  test("a folder with a `#` in it keeps the rest of its line", () => {
    // Unescaped, the tokenizer treats it as the start of a comment and the
    // owners simply vanish — a rule with a pattern and nobody on it, which
    // Gitea drops with a warning nobody reads.
    const line = `${codeownersToken(folder("ward-#3"))}  @riverside-health/ic`;
    expect(tokenizeCodeownersLine(line)).toEqual([
      "ward-#3/.*",
      "@riverside-health/ic",
    ]);
    expect(compiledFor(folder("ward-#3")).test("ward-#3/a.md")).toBe(true);
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
      folder("policies/nursing", { teams: ["infection-control"] }),
      folder("policies/hr", { users: ["priya"] }),
    ]);

    expect(file).toContain(
      "policies/nursing/.*  @riverside-health/infection-control",
    );
    expect(file).toContain("policies/hr/.*  @priya");
  });

  test("puts several owners on one line", () => {
    const file = renderCodeowners(ORG, [
      folder("policies/nursing", {
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
    const file = renderCodeowners(ORG, [folder("policies/nursing")]);
    expect(file).not.toContain("policies/nursing");
  });

  test("keeps the caller's order, because the gate is per rule", () => {
    // Unlike a .gitignore, order carries no precedence here — every matching
    // rule has to be satisfied. Stable order is for a readable diff, since
    // changing these rules is a change somebody has to review.
    const file = renderCodeowners(ORG, [
      folder("zebra", { teams: ["a"] }),
      folder("alpha", { teams: ["b"] }),
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
      folder("policies/nursing", {
        teams: ["infection-control", "quality-committee"],
      }),
      folder("reports/Q1 (2026)", { users: ["priya"] }),
      binder({ teams: ["clinical-admins"] }),
      document(HAND_HYGIENE, { teams: ["infection-control"] }),
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
      folder("policies/nursing", { teams: ["ic"], users: ["priya"] }),
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

describe("ruleFromPattern", () => {
  test("recovers each of the three shapes, escaping and all", () => {
    expect(ruleFromPattern("policies/nursing/.*")).toEqual({
      scope: "folder",
      target: "policies/nursing",
    });
    expect(ruleFromPattern("reports/Q1 \\(2026\\)/.*")).toEqual({
      scope: "folder",
      target: "reports/Q1 (2026)",
    });
    expect(ruleFromPattern(".*")).toEqual({ scope: "binder", target: "" });
    expect(ruleFromPattern(`.*\\.${HAND_HYGIENE}(\\..*)?`)).toEqual({
      scope: "document",
      target: HAND_HYGIENE,
    });
  });

  test("refuses a pattern that only looks like one of ours", () => {
    // `policies/.*/.*` unescapes to `policies/./.` and would not re-render to
    // itself, so it is not a folder rule and is not treated as one.
    expect(ruleFromPattern("policies/.*/.*")).toBeNull();
    expect(ruleFromPattern("policies/nursing")).toBeNull();
    // A document shape with an unescaped dot matches different files than the
    // one that would have been written, so it is not read as a document rule.
    expect(ruleFromPattern(`.*.${HAND_HYGIENE}(\\..*)?`)).toBeNull();
  });
});

describe("validateSignOffRules", () => {
  const knownTeams = ["infection-control", "quality-committee"];

  test("passes the rules a customer would actually write", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [
        folder("policies/nursing", { teams: ["infection-control"] }),
        folder("reports/Q1 (2026)", { teams: ["quality-committee"] }),
        binder({ teams: ["quality-committee"] }),
        document(HAND_HYGIENE, { teams: ["infection-control"] }),
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
      rules: [folder("policies/nursing", { teams: ["ghost-committee"] })],
    });

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("ghost-committee");
    expect(result.problems[0]).toContain("can never be satisfied");
  });

  test("refuses a rule with nobody on it", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [folder("policies/nursing")],
    });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("nobody on it");
  });

  test("refuses two rules over one thing", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [
        folder("policies/nursing", { teams: ["infection-control"] }),
        folder("policies/nursing", { teams: ["quality-committee"] }),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("two sign-off rules");
  });

  test("a folder and a document may both cover one file", () => {
    // Not a duplicate: Gitea's gate is per rule and every matching rule has to
    // be satisfied, so "Nursing signs off on this drawer, and Legal also signs
    // off on this one policy" is a thing somebody means.
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [
        folder("nursing", { teams: ["infection-control"] }),
        document(HAND_HYGIENE, { teams: ["quality-committee"] }),
      ],
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  test("refuses a rule naming a document the binder does not hold", () => {
    // It can never be satisfied, and on screen it reads as a rule about
    // nothing.
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      knownDocuments: ["01J9A0B1C2D3E4F5G6H7J8K9M0"],
      rules: [document(HAND_HYGIENE, { teams: ["infection-control"] })],
    });

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("not in this binder");
  });

  test("a caller that has not read the tree checks everything else", () => {
    // Refusing every document rule it cannot corroborate would be worse than
    // skipping the one check it cannot make.
    const result = validateSignOffRules({
      org: ORG,
      knownTeams,
      rules: [document(HAND_HYGIENE, { teams: ["infection-control"] })],
    });
    expect(result.ok).toBe(true);
  });

  test("refuses a file over the size ceiling", () => {
    // Gitea fails closed above `MaxDisplayFileSize`, which would leave a binder
    // unable to publish at all. Refusing to write it is the kinder failure, and
    // the ceiling here is far below Gitea's.
    const many = Array.from({ length: 4000 }, (_, index) =>
      folder(`policies/folder-with-a-fairly-long-name-${index}`, {
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
        folder("reports/Q1 (2026) [draft]", { teams: ["infection-control"] }),
      ],
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  test("an individual owner needs no group to exist", () => {
    const result = validateSignOffRules({
      org: ORG,
      knownTeams: [],
      rules: [folder("policies/hr", { users: ["priya"] })],
    });
    expect(result.ok).toBe(true);
  });
});

test("the file goes where Gitea looks for it", () => {
  expect(CODEOWNERS_PATH).toBe(".gitea/CODEOWNERS");
});
