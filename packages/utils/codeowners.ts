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

/** One folder, and who signs off on what is in it. */
export interface SignOffRule {
  /**
   * A folder inside the binder, with no leading or trailing slash. The empty
   * string is the binder's root — a rule over everything in it.
   */
  folder: string;
  /** Org team handles, written as `@org/team`. The preferred form. */
  teams: string[];
  /** Individual logins, written as `@login`. Supported, rarely the right answer. */
  users: string[];
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
 * The regex Gitea will compile for a folder — after tokenizing, before
 * anchoring.
 *
 * A rule over the root is `.*`, because `escapeRegex("") + "/.*"` would be
 * `/.*`; Gitea strips a leading `/` from a pattern, so that would collapse to
 * the same thing by accident rather than on purpose.
 */
export function folderPattern(folder: string): string {
  const trimmed = trimFolder(folder);
  return trimmed === "" ? ".*" : `${escapeRegex(trimmed)}/.*`;
}

/**
 * The text that actually goes in the file for a folder: the pattern above,
 * escaped a second time for the tokenizer.
 */
export function codeownersToken(folder: string): string {
  const trimmed = trimFolder(folder);
  return trimmed === ""
    ? ".*"
    : `${escapeForTokenizer(escapeRegex(trimmed))}/.*`;
}

function trimFolder(folder: string): string {
  return folder.replace(/^\/+/, "").replace(/\/+$/, "");
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
    "# Each line is a folder and the groups or people who sign off on changes",
    "# to it. Patterns are anchored regular expressions, not shell globs, and",
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
    lines.push(`${codeownersToken(rule.folder)}  ${owners.join(" ")}`);
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

    const folder = folderFromPattern(pattern);
    if (folder === null) {
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

    rules.push({ folder, teams, users });
  });

  return { rules, unreadable };
}

/**
 * Recover the folder a generated pattern came from, or `null` if this is not a
 * pattern this module would have produced.
 *
 * Takes the **tokenized** pattern — what Gitea compiles — not the raw text of
 * the line.
 *
 * Only our own shape is recognised. A hand-written rule using the full
 * expressive power of a regex is legal, enforced by Gitea, and simply not
 * something a folder picker can represent, so it is reported as unreadable and
 * shown verbatim rather than silently reinterpreted as a folder it is not.
 */
export function folderFromPattern(pattern: string): string | null {
  if (pattern === ".*") return "";
  if (!pattern.endsWith("/.*")) return null;

  const escaped = pattern.slice(0, -"/.*".length);
  const folder = escaped.replace(/\\(.)/g, "$1");

  // Round-trip, so anything that only *looks* like an escaped folder is
  // rejected: an unescaped metacharacter comes back differently.
  return folderPattern(folder) === pattern ? folder : null;
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
}): SignOffValidation {
  const { org, rules, knownTeams } = params;
  const problems: string[] = [];

  const known = new Set(knownTeams.map((team) => team.toLowerCase()));
  const seen = new Set<string>();

  for (const rule of rules) {
    const where = rule.folder === "" ? "the whole binder" : `“${rule.folder}”`;

    if (rule.teams.length === 0 && rule.users.length === 0) {
      problems.push(
        `${where} has a sign-off rule with nobody on it. Name at least one group or person, or remove the rule.`,
      );
      continue;
    }

    // Two rules over one folder is not an error to Gitea — both match and both
    // have to be satisfied — but it is never what somebody meant, and on screen
    // it reads as one rule having lost its owners.
    const key = trimFolder(rule.folder).toLowerCase();
    if (seen.has(key)) {
      problems.push(
        `${where} has two sign-off rules. Put every group for a folder on one rule.`,
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
      `${codeownersToken(rule.folder)}  @placeholder`,
    );
    const compiledSource = tokens[0];

    if (tokens.length < 2 || compiledSource === undefined) {
      problems.push(
        `${where} produced a rule Gitea would read as an incomplete line. That folder would go unprotected.`,
      );
      continue;
    }

    let compiled: RegExp;
    try {
      compiled = new RegExp(`^${compiledSource}$`);
    } catch {
      problems.push(
        `${where} produced a rule Gitea cannot read. It would be ignored and the folder would go unprotected.`,
      );
      continue;
    }

    // Stronger than "it compiles". A wrongly escaped folder compiles perfectly
    // and matches the wrong paths, so the pattern must be shown to match inside
    // its own folder and to leave a sibling alone.
    const folder = trimFolder(rule.folder);
    const inside = folder === "" ? "anything.md" : `${folder}/a-policy.md`;
    if (!compiled.test(inside)) {
      problems.push(
        `${where} produced a rule that does not match its own folder. That folder would go unprotected.`,
      );
    }

    if (folder !== "") {
      const sibling = `${folder}-elsewhere/a-policy.md`;
      if (compiled.test(sibling)) {
        problems.push(
          `${where} produced a rule that also matches “${folder}-elsewhere”. It would demand sign-off on folders nobody chose.`,
        );
      }
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
