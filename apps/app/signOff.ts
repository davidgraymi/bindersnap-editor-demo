/**
 * A binder's sign-off rules, said the way a customer reads them.
 *
 * One copy of the wording, in a module with no React in it, because the same
 * sentences are now needed in two places that must not drift: the Settings tab
 * where somebody writes a rule, and a change request's Changes tab where
 * somebody is asked to approve one changing (issue 921). A rule described one way
 * on the screen that sets it and another on the screen that reviews it is a
 * rule two people can read differently.
 */

import { describeGroupName } from "../../packages/utils/groupName";
import {
  diffSignOffRules,
  type SignOffRuleDelta,
} from "../../packages/utils/codeowners";
import type {
  SignOffDocumentView,
  SignOffRuleView,
} from "../../packages/api-schema/schemas/workspaces";
import { formatDocumentName } from "./documentDisplay";

/** "A", "A and B", "A, B and C" — the way a person would say a list. */
export function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `clinical/nursing` → "Clinical / Nursing". A folder is a slug too. */
export function describeFolder(folder: string): string {
  return folder.split("/").map(formatDocumentName).join(" / ");
}

/**
 * What a rule covers, as a customer reads it.
 *
 * A document rule carries an identity, which is not a thing to put in front of
 * anybody, so it is looked up in the binder's own list. One that is not there
 * is **said**, not hidden: a rule about a document this binder no longer holds
 * enforces nothing.
 */
export function describeTarget(
  rule: Pick<SignOffRuleView, "scope" | "target">,
  documents: readonly SignOffDocumentView[],
): string {
  switch (rule.scope) {
    case "binder":
      return "Everything in this binder";
    case "folder":
      return `Anything filed in ${describeFolder(rule.target)}`;
    case "document": {
      const match = documents.find((entry) => entry.uid === rule.target);
      return match
        ? formatDocumentName(match.name)
        : "A document that is no longer in this binder";
    }
    case "rules":
      // Said as what it governs rather than as the file it is. Nobody here is
      // thinking about `.gitea/CODEOWNERS`.
      return "Who signs things off in this binder";
  }
}

/**
 * Who signs a rule off, on the rule's own row.
 *
 * **A group with nobody in it is said here, and only here.** Verified against a
 * running Gitea: a rule whose owners are an empty team waits for nobody and
 * lets the publish through. This is the one screen in the product that could
 * ever say so, and it says it on the row that is holding nothing rather than in
 * a paragraph above the list.
 */
export function describeOwners(
  rule: Pick<SignOffRuleView, "teams" | "users">,
  emptyGroups: readonly string[],
): { text: string; holdingNothing: boolean } {
  const empty = new Set(emptyGroups);
  const owners = [
    ...rule.teams.map((team) =>
      empty.has(team)
        ? `the ${describeGroupName(team)} group, which has nobody in it`
        : describeGroupName(team),
    ),
    ...rule.users,
  ];

  if (owners.length === 0) {
    return { text: "Nobody signs this off yet", holdingNothing: true };
  }

  const text = listSentence(owners);
  return {
    text: `${text.charAt(0).toUpperCase()}${text.slice(1)}`,
    holdingNothing:
      rule.users.length === 0 && rule.teams.every((team) => empty.has(team)),
  };
}

/** One rule a change would add, take away, or hand to somebody else. */
export interface SignOffChangeRow extends SignOffRuleDelta {
  /** "Anything filed in Nursing" — what the rule is about. */
  target: string;
  /** Who signs it off today, or null when nobody had to. */
  from: string | null;
  /** Who would sign it off, or null when nobody would. */
  to: string | null;
  /**
   * Whether this row loosens the binder: a gate coming down.
   *
   * The one distinction worth drawing in colour. A rule arriving or changing
   * hands still holds the publish for somebody; a rule going away means a
   * folder that needed a named group's sign-off this morning needs nobody's
   * this afternoon, and that is the change a reviewer must not miss.
   */
  loosens: boolean;
}

/**
 * What a change would do to who signs things off, row by row.
 *
 * Built from the two committed files the API read at the change's base and
 * head — **not from the change's description**, which its author can rewrite
 * after an approval (issue 921).
 *
 * Ordered with what is taken away first. A reviewer reading a change to a
 * control should meet the gate that is coming down before the two that are
 * going up, whatever order the file happens to list them in.
 */
export function buildSignOffChangeRows(params: {
  base: readonly SignOffRuleView[];
  proposed: readonly SignOffRuleView[];
  documents: readonly SignOffDocumentView[];
}): SignOffChangeRow[] {
  const { base, proposed, documents } = params;

  const rows = diffSignOffRules(base, proposed).map((delta) => ({
    ...delta,
    target: describeTarget(delta, documents),
    from: delta.before ? describeOwners(delta.before, []).text : null,
    to: delta.after ? describeOwners(delta.after, []).text : null,
    loosens: delta.kind === "removed",
  }));

  const rank = (row: SignOffChangeRow) =>
    row.kind === "removed" ? 0 : row.kind === "reassigned" ? 1 : 2;

  return rows.sort(
    (left, right) =>
      rank(left) - rank(right) || left.target.localeCompare(right.target),
  );
}

/**
 * The one line above the rows: what this change does to the rules.
 *
 * Said as counts rather than as a verb, because a change can do all three at
 * once and "changes the sign-off rules" is the sentence that was already on
 * the page and already told nobody anything.
 */
export function summarizeSignOffChange(
  rows: readonly SignOffChangeRow[],
): string {
  if (rows.length === 0) {
    // The file moved — a comment, a reordering — and not one rule did. Worth
    // saying plainly: a panel that appeared and then described nothing would
    // read as the screen having failed to load.
    return "This change rewrites the rules file without changing who signs anything off.";
  }

  const say = (count: number, what: string) =>
    `${count} ${count === 1 ? "rule" : "rules"} ${what}`;
  const removed = rows.filter((row) => row.kind === "removed").length;
  const reassigned = rows.filter((row) => row.kind === "reassigned").length;
  const added = rows.filter((row) => row.kind === "added").length;

  return [
    removed > 0 ? say(removed, "taken away") : null,
    reassigned > 0 ? say(reassigned, "handed to somebody else") : null,
    added > 0 ? say(added, "added") : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** What a row did, for a screen reader and for the row's own badge. */
export function describeSignOffChangeKind(
  kind: SignOffRuleDelta["kind"],
  open = true,
): string {
  if (kind === "removed") return open ? "Being taken away" : "Taken away";
  if (kind === "reassigned") return open ? "Changing hands" : "Changed hands";
  return open ? "Being added" : "Added";
}
