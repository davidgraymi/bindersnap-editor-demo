/**
 * `.gitea/CODEOWNERS` — generated, parsed, and validated before it is written.
 *
 * A sign-off rule says "the Infection Control group signs off on anything in
 * `policies/nursing`". Gitea reads that from a file in the binder, at pull
 * request time, and — from 28.0.0, with `block_on_codeowner_reviews` — refuses
 * the merge until one of that rule's owners has approved. The file is the
 * source of truth: there is no `folder_approvers` table, because a table would
 * shadow a git object Gitea enforces at merge time, and a shadow that disagrees
 * with Gitea is a bug in the direction that matters.
 *
 * Shared between the API, which generates and commits it, and the app, which
 * shows a customer what their binder's rules currently say. One rule, one copy:
 * two parsers would eventually disagree about who has to sign something off,
 * which is the disagreement least worth having.
 *
 * ## The two layers, which is the whole difficulty
 *
 * A line goes through **two** transformations before it matches anything, and
 * every subtle bug here comes from treating it as one.
 *
 * 1. **`TokenizeCodeOwnersLine` splits the line**, on spaces, and it *consumes
 *    backslashes*: `\x` becomes a bare `x` in the token, whatever `x` is. It
 *    also ends the line at an unescaped `#`.
 * 2. **`ParseCodeOwnersLine` compiles the first token** as `^<token>$`, using
 *    `regexp2`.
 *
 * So a backslash written to escape a regex metacharacter never reaches the
 * regex — the tokenizer eats it first. `Q1 \(2026\)` tokenizes to `Q1 (2026)`,
 * and `(2026)` compiles as a **capture group**, not as literal parentheses. The
 * rule then matches `Q12026/…` and not the folder it was written for.
 *
 * Escaping therefore has to be applied twice, in order: escape for the regex,
 * then escape that result for the tokenizer. `escapeRegex` and
 * `escapeForTokenizer` are separate functions for exactly that reason, and
 * `codeownersToken` is the only thing that should compose them.
 *
 * ## Three more mechanics that fail silently
 *
 * **Patterns are anchored regexes, not gitignore globs.** The
 * `policies/nursing/` a GitHub habit produces matches nothing at all — it has
 * to be `policies/nursing/.*`.
 *
 * **A pattern that does not compile is dropped, not refused.** Verified against
 * a running Gitea 28.0.0 on 2026-09-08, and it is the opposite of what the
 * design assumed: `GetCodeOwnersFromContent` returns `(rules, warnings)`, logs
 * the warnings, and leaves the bad line out. The gate then finds no matching
 * rule and passes. A malformed file does not stop publishing — it stops
 * *enforcing*, silently, while every screen still says sign-off is required.
 *
 * **A rule that compiles but matches the wrong paths is worse**, because
 * nothing anywhere reports it. That is why `validateSignOffRules` checks that
 * each pattern matches inside its own folder and not a sibling, rather than
 * only that it compiles.
 */

/**
 * How much of a binder one rule covers.
 *
 * Three, because those are the three answers a customer actually gives to
 * "what has to be signed off?" — everything here, this drawer, this policy.
 * Anything narrower is a folder; anything broader is the binder.
 */
export type SignOffScope = "binder" | "folder" | "document";

/** Something in a binder, and who signs off on changes to it. */
export interface SignOffRule {
  scope: SignOffScope;
  /**
   * What the scope names:
   *
   * - `binder` — the empty string. There is only one binder.
   * - `folder` — a folder inside it, with no leading or trailing slash.
   * - `document` — the document's **identity**, not its path (ADR 0005).
   *
   * The last one is the reason this is a `target` rather than a `path`. A rule
   * written against `nursing/hand-hygiene.md` stops applying the moment
   * somebody retitles the policy — silently, because Gitea finds no matching
   * rule and lets the merge through. Written against the identity segment, it
   * follows the document through a rename and a move both.
   */
  target: string;
  /** Org team handles, written as `@org/team`. The preferred form. */
  teams: string[];
  /** Individual logins, written as `@login`. Supported, rarely the right answer. */
  users: string[];
}

/** A rule over everything in the binder. */
export function binderRule(
  teams: string[] = [],
  users: string[] = [],
): SignOffRule {
  return { scope: "binder", target: "", teams, users };
}

/**
 * A conservative ceiling, far below the 8 MiB at which Gitea gives up and fails
 * closed. Nothing legitimate approaches it: a thousand folders with three
 * groups each is well under 100 KB. A generated file bigger than this means a
 * bug upstream of the writer, and committing it would leave a binder protected
 * by a file Gitea refuses to read.
 */
export const MAX_CODEOWNERS_BYTES = 64 * 1024;

/** Where Gitea looks. It reads the first of several candidates; this is ours. */
export const CODEOWNERS_PATH = ".gitea/CODEOWNERS";

/**
 * Escape every regex metacharacter, so a folder name is matched literally.
 *
 * `.` is the one that looks harmless and is not: a folder called `policies.v2`
 * would otherwise also match `policiesXv2`.
 *
 * **`/` is deliberately not escaped.** It is not a metacharacter, so escaping
 * it would change nothing about the match while making every rule read
 * `policies\/nursing\/.*` in a file customers review in a change.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Escape a token so Gitea's tokenizer hands the regex exactly these characters.
 *
 * The tokenizer drops one backslash from every escaped pair, splits on spaces
 * and truncates at `#`. So a backslash the regex needs has to be doubled here,
 * and a space or a `#` that is part of the path has to be escaped or the line
 * silently becomes two tokens — or half a line.
 *
 * Applied to the output of {@link escapeRegex}, never to a raw folder name:
 * the order matters and getting it backwards produces a rule that compiles,
 * matches the wrong files, and reports nothing.
 */
export function escapeForTokenizer(input: string): string {
  return input.replace(/[\\ #]/g, "\\$&");
}

/**
 * The regex Gitea will compile for a rule — after tokenizing, before anchoring.
 *
 * Three shapes, one per scope:
 *
 * | Scope    | Pattern                    | Matches                              |
 * | -------- | -------------------------- | ------------------------------------ |
 * | binder   | `.*`                       | every path in the binder             |
 * | folder   | `nursing/.*`               | every path under `nursing`           |
 * | document | `.*\.<uid>(\..*)?`         | that document, wherever it is filed  |
 *
 * A rule over the binder is `.*` rather than `/.*`, because Gitea strips a
 * leading `/` from a pattern — so `escapeRegex("") + "/.*"` would collapse to
 * the same thing by accident rather than on purpose.
 *
 * **The document pattern deliberately says nothing about where the file is.**
 * The identity segment is the one part of a filename that cannot change (ADR
 * 0005), so a rule keyed on it survives a retitle and a move to another folder,
 * both of which would otherwise silently drop the sign-off requirement. The
 * optional trailing group is for a document with no extension, which is a
 * filename that ends at its identity.
 */
export function rulePattern(rule: {
  scope: SignOffScope;
  target: string;
}): string {
  switch (rule.scope) {
    case "binder":
      return ".*";
    case "folder": {
      const trimmed = trimFolder(rule.target);
      // A folder rule with no folder is a binder rule. Emitting `/.*` here
      // would be a pattern Gitea silently reinterprets.
      return trimmed === "" ? ".*" : `${escapeRegex(trimmed)}/.*`;
    }
    case "document":
      return `.*\\.${rule.target}(\\..*)?`;
  }
}

/**
 * The text that actually goes in the file: the pattern above, escaped a second
 * time for the tokenizer.
 *
 * Applied to the whole pattern rather than to the folder name alone, so every
 * scope goes through the same two layers in the same order. The deliberate
 * metacharacters survive it — only `\`, a space and `#` mean anything to the
 * tokenizer — and a folder containing one of those three is escaped exactly
 * once, which is the bug this module exists to be careful about.
 */
export function codeownersToken(rule: {
  scope: SignOffScope;
  target: string;
}): string {
  return escapeForTokenizer(rulePattern(rule));
}

function trimFolder(folder: string): string {
  return folder.replace(/^\/+/, "").replace(/\/+$/, "");
}

/** What a rule covers, in the customer's words, for a problem message. */
function describeTarget(rule: { scope: SignOffScope; target: string }): string {
  switch (rule.scope) {
    case "binder":
      return "the whole binder";
    case "folder":
      return `\u201c${rule.target}\u201d`;
    case "document":
      // The identity, not a title: this module has no document list and
      // inventing a name it cannot check would be worse than saying "a
      // document". The screen has the list and says the title.
      return "a document";
  }
}

/**
 * Show that a compiled pattern hits what it is for and misses the lookalike.
 *
 * The check that matters, and the one a "does it compile" test would pass while
 * the rule silently protected the wrong files. Each scope has a different near
 * miss, so each gets its own pair.
 */
function checkPatternAim(
  rule: { scope: SignOffScope; target: string },
  compiled: RegExp,
  where: string,
): string[] {
  const problems: string[] = [];

  if (rule.scope === "document") {
    // A document rule follows the document, so it has to match wherever the
    // file is filed and whatever it is called — including with no extension.
    for (const path of [
      `nursing/a-policy.${rule.target}.md`,
      `elsewhere/renamed.${rule.target}.pdf`,
      `a-policy.${rule.target}`,
    ]) {
      if (!compiled.test(path)) {
        problems.push(
          `${where} produced a rule that does not match the document it is for. That document would go unprotected.`,
        );
        break;
      }
    }

    // The near miss: another document whose identity merely starts the same.
    if (compiled.test(`nursing/other.${rule.target}XYZ.md`)) {
      problems.push(
        `${where} produced a rule that also matches other documents. It would demand sign-off on policies nobody chose.`,
      );
    }

    return problems;
  }

  const folder = trimFolder(rule.target);
  const inside = folder === "" ? "anything.md" : `${folder}/a-policy.md`;
  if (!compiled.test(inside)) {
    problems.push(
      `${where} produced a rule that does not match its own folder. That folder would go unprotected.`,
    );
  }

  if (folder !== "" && compiled.test(`${folder}-elsewhere/a-policy.md`)) {
    problems.push(
      `${where} produced a rule that also matches \u201c${folder}-elsewhere\u201d. It would demand sign-off on folders nobody chose.`,
    );
  }

  return problems;
}

/** `@riverside-health/infection-control`, the way Gitea addresses a team. */
export function teamOwner(org: string, team: string): string {
  return `@${org}/${team}`;
}

/**
 * A faithful port of Gitea's `TokenizeCodeOwnersLine`.
 *
 * Here so that what this module parses is what Gitea will parse, rather than an
 * approximation that agrees on the easy lines. The escape handling in
 * particular is not something a `split(/\s+/)` gets right, and disagreeing
 * about it means showing a customer a set of sign-off rules that is not the set
 * being enforced.
 */
export function tokenizeCodeownersLine(line: string): string[] {
  const normalized = line.trim().replaceAll("\t", " ");
  const tokens: string[] = [];

  let token = "";
  let escaped = false;

  for (const char of normalized) {
    if (escaped) {
      token += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "#") {
      break;
    } else if (char === " ") {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += char;
    }
  }

  if (token.length > 0) tokens.push(token);

  return tokens;
}

/**
 * The generated file, exactly as it is committed.
 *
 * Rules are emitted in the order given, because **Gitea's gate is per rule**
 * and every matching rule must be satisfied — so unlike a `.gitignore`, order
 * carries no precedence and there is nothing to sort for correctness. Emitting
 * them in the caller's order keeps a diff between two generations readable,
 * which matters because changing these rules is a change somebody has to
 * review.
 */
export function renderCodeowners(
  org: string,
  rules: readonly SignOffRule[],
): string {
  const lines = [
    "# Generated by Bindersnap. Do not edit by hand.",
    "#",
    "# Each line is something in this binder — the whole binder, one folder, or",
    "# one document — and the groups or people who sign off on changes to it.",
    "# A document is matched by the identity in its filename rather than by its",
    "# path, so its rule survives being retitled or refiled.",
    "#",
    "# Patterns are anchored regular expressions, not shell globs, and",
    "# backslashes are consumed twice — once by Gitea's tokenizer and once by",
    "# its regex. Change these rules from the binder's Settings tab.",
    "",
  ];

  for (const rule of rules) {
    const owners = [
      ...rule.teams.map((team) => teamOwner(org, team)),
      ...rule.users.map((user) => `@${user}`),
    ];
    if (owners.length === 0) continue;
    lines.push(`${codeownersToken(rule)}  ${owners.join(" ")}`);
  }

  return `${lines.join("\n")}\n`;
}

export interface ParsedCodeowners {
  rules: SignOffRule[];
  /** Lines that are not comments and not parseable, with their line numbers. */
  unreadable: Array<{ line: number; text: string }>;
}

/**
 * Read a committed file back into rules.
 *
 * A line it cannot understand is **reported rather than dropped**, because a
 * rule the screen omits is a rule somebody believes is not there. Gitea drops
 * what it cannot parse; a page about who has to sign something off must not.
 */
export function parseCodeowners(
  org: string,
  content: string,
): ParsedCodeowners {
  const rules: SignOffRule[] = [];
  const unreadable: Array<{ line: number; text: string }> = [];

  content.split("\n").forEach((raw, index) => {
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) return;

    const tokens = tokenizeCodeownersLine(raw);
    if (tokens.length < 2) {
      unreadable.push({ line: index + 1, text });
      return;
    }

    const [pattern, ...owners] = tokens as [string, ...string[]];

    const scoped = ruleFromPattern(pattern);
    if (scoped === null) {
      unreadable.push({ line: index + 1, text });
      return;
    }

    const teams: string[] = [];
    const users: string[] = [];
    const prefix = `${org.toLowerCase()}/`;

    for (const owner of owners) {
      const name = owner.startsWith("@") ? owner.slice(1) : owner;
      if (name.includes("/")) {
        if (!name.toLowerCase().startsWith(prefix)) {
          // A team in another organization. Gitea will not resolve it, so the
          // rule it belongs to enforces nothing — say so rather than list it
          // as an owner of this folder.
          unreadable.push({ line: index + 1, text });
          return;
        }
        teams.push(name.slice(prefix.length));
      } else {
        users.push(name);
      }
    }

    rules.push({ ...scoped, teams, users });
  });

  return { rules, unreadable };
}

/**
 * Recover the scope and target a generated pattern came from, or `null` if this
 * is not a pattern this module would have produced.
 *
 * Takes the **tokenized** pattern — what Gitea compiles — not the raw text of
 * the line.
 *
 * Only our own three shapes are recognised. A hand-written rule using the full
 * expressive power of a regex is legal, enforced by Gitea, and simply not
 * something a picker can represent, so it is reported as unreadable and shown
 * verbatim rather than silently reinterpreted as something it is not.
 *
 * Every branch round-trips through {@link rulePattern} before it is believed:
 * anything that only *looks* like one of ours comes back differently, and an
 * unescaped metacharacter is exactly the case that would otherwise be read as a
 * folder it is not.
 */
export function ruleFromPattern(
  pattern: string,
): { scope: SignOffScope; target: string } | null {
  if (pattern === ".*") return { scope: "binder", target: "" };

  const document = pattern.match(/^\.\*\\\.([^.\\]+)\(\\\.\.\*\)\?$/);
  if (document) {
    const candidate = { scope: "document" as const, target: document[1]! };
    return rulePattern(candidate) === pattern ? candidate : null;
  }

  if (!pattern.endsWith("/.*")) return null;

  const escaped = pattern.slice(0, -"/.*".length);
  const candidate = {
    scope: "folder" as const,
    target: escaped.replace(/\\(.)/g, "$1"),
  };
  return rulePattern(candidate) === pattern ? candidate : null;
}

export interface SignOffValidation {
  ok: boolean;
  /** One sentence per problem, in the customer's language. */
  problems: string[];
}

/**
 * Everything that has to be true before the file is committed.
 *
 * The generator owes this because **we** generate the file: a bad rule is not a
 * customer's typo, it is our bug, and it lands as a control that quietly stops
 * controlling. Gitea will not tell anyone.
 *
 * The pattern checks run against the **post-tokenizer** text, because that is
 * what Gitea compiles. Checking the raw line would pass the exact class of bug
 * this is here to catch.
 */
export function validateSignOffRules(params: {
  org: string;
  rules: readonly SignOffRule[];
  /** Team handles that exist in the organization, for the existence check. */
  knownTeams: readonly string[];
  /**
   * The identities of the documents this binder holds, for a document rule.
   *
   * Optional: a caller that has not read the tree checks everything else and
   * skips this one check, rather than refusing every document rule it cannot
   * corroborate.
   */
  knownDocuments?: readonly string[];
}): SignOffValidation {
  const { org, rules, knownTeams, knownDocuments } = params;
  const problems: string[] = [];

  const known = new Set(knownTeams.map((team) => team.toLowerCase()));
  const documents = knownDocuments ? new Set(knownDocuments) : null;
  const seen = new Set<string>();

  for (const rule of rules) {
    const where = describeTarget(rule);

    if (rule.scope === "binder" && trimFolder(rule.target) !== "") {
      problems.push(
        `A rule over the whole binder cannot also name “${rule.target}”. Set it on that folder or that document instead.`,
      );
      continue;
    }

    if (rule.scope !== "binder" && trimFolder(rule.target) === "") {
      problems.push(
        rule.scope === "folder"
          ? "A folder rule has no folder on it. Choose a folder, or set the rule over the whole binder."
          : "A document rule has no document on it. Choose a document, or set the rule over a folder.",
      );
      continue;
    }

    if (rule.scope === "document" && documents && !documents.has(rule.target)) {
      // A rule naming a document the binder does not hold can never be
      // satisfied, and reads on screen as a rule about nothing.
      problems.push(
        "A rule names a document that is not in this binder. Remove the rule, or set it on a document that is.",
      );
      continue;
    }

    if (rule.teams.length === 0 && rule.users.length === 0) {
      problems.push(
        `${where} has a sign-off rule with nobody on it. Name at least one group or person, or remove the rule.`,
      );
      continue;
    }

    // Two rules over one thing is not an error to Gitea — both match and both
    // have to be satisfied — but it is never what somebody meant, and on screen
    // it reads as one rule having lost its owners.
    const key = `${rule.scope}:${trimFolder(rule.target).toLowerCase()}`;
    if (seen.has(key)) {
      problems.push(
        `${where} has two sign-off rules. Put every group for it on one rule.`,
      );
    }
    seen.add(key);

    for (const team of rule.teams) {
      if (!known.has(team.toLowerCase())) {
        problems.push(
          `${where} is signed off by a group called “${team}”, which ${org} does not have. A rule naming a group that is not there can never be satisfied.`,
        );
      }
    }

    // What Gitea will actually compile: the line as written, put through its
    // tokenizer. Anything less than this round trip misses the double-escaping
    // bugs entirely.
    const tokens = tokenizeCodeownersLine(
      `${codeownersToken(rule)}  @placeholder`,
    );
    const compiledSource = tokens[0];

    if (tokens.length < 2 || compiledSource === undefined) {
      problems.push(
        `${where} produced a rule Gitea would read as an incomplete line. It would go unprotected.`,
      );
      continue;
    }

    let compiled: RegExp;
    try {
      compiled = new RegExp(`^${compiledSource}$`);
    } catch {
      problems.push(
        `${where} produced a rule Gitea cannot read. It would be ignored and go unprotected.`,
      );
      continue;
    }

    // Stronger than "it compiles". A wrongly escaped target compiles perfectly
    // and matches the wrong paths, so every pattern must be shown to match what
    // it is for and to leave the nearest lookalike alone.
    for (const problem of checkPatternAim(rule, compiled, where)) {
      problems.push(problem);
    }
  }

  const size = new TextEncoder().encode(renderCodeowners(org, rules)).length;
  if (size > MAX_CODEOWNERS_BYTES) {
    problems.push(
      `These rules come to ${Math.round(size / 1024)} KB, which is more than Bindersnap will commit. Gitea stops enforcing a sign-off file it cannot read, so this is refused rather than written.`,
    );
  }

  return { ok: problems.length === 0, problems };
}
