/**
 * What a change does to who signs off, said the way the change page says it.
 *
 * Pure, so the rule section on the Changes tab, the approvals table's reasons
 * and footnotes, and the approve step's "this also changes who signs off" can
 * be tested without a browser. The facts come from the change's detail:
 * `signOffChange` (what each rule becomes) and each approval rule's `reason`.
 */

import type { WorkspaceChangeDetailPayload } from "../../packages/api-schema/schemas/workspaces";
import { describeGroupName } from "../../packages/utils/groupName";
import { describeDocumentPath, describeFolder } from "./signOffPanel";

export type SignOffChangeRule = NonNullable<
  WorkspaceChangeDetailPayload["signOffChange"]
>["rules"][number];
export type ApprovalRuleRow =
  WorkspaceChangeDetailPayload["approvalRules"][number];

function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** One owner chip in a rule's diff. */
export interface OwnerChip {
  kind: "group" | "person";
  name: string;
  label: string;
  change: "added" | "removed" | "unchanged";
}

/** One changed rule, as the Changes tab draws it. */
export interface RuleChangeRow {
  key: string;
  /** "Clinical Standards", "The whole binder", "Hand Hygiene", "Who signs off". */
  where: string;
  /** For the icon: a folder, the binder, a document, or the rules. */
  kind: SignOffChangeRule["scope"];
  /** The folder's path, the document's path, or "" — for a link. */
  place: string;
  owners: OwnerChip[];
  /** "After this is published, every document in Clinical Standards needs…". */
  effect: string;
}

function whereOf(rule: SignOffChangeRule): string {
  switch (rule.scope) {
    case "folder":
      return describeFolder(rule.target);
    case "document":
      return rule.place ? describeDocumentPath(rule.place) : "A document";
    case "rules":
      return "Who signs off";
    default:
      return "The whole binder";
  }
}

function chips(rule: SignOffChangeRule): OwnerChip[] {
  const out: OwnerChip[] = [];
  for (const change of ["unchanged", "added", "removed"] as const) {
    for (const team of rule.teams[change]) {
      out.push({
        kind: "group",
        name: team,
        label: describeGroupName(team),
        change,
      });
    }
    for (const user of rule.users[change]) {
      out.push({ kind: "person", name: user, label: user, change });
    }
  }
  return out;
}

/** "both of the documents in it today", "the one document in it today". */
function coverage(count: number): string {
  if (count === 0) return "none are in it today";
  if (count === 1) return "the one document in it today";
  if (count === 2) return "both of the documents in it today";
  return `all ${count} of the documents in it today`;
}

function effectOf(rule: SignOffChangeRule, binderName: string): string {
  const added = [
    ...rule.teams.added.map((team) => `the ${describeGroupName(team)}`),
    ...rule.users.added,
  ];
  const removed = [
    ...rule.teams.removed.map((team) => `the ${describeGroupName(team)}`),
    ...rule.users.removed,
  ];
  const where =
    rule.scope === "folder"
      ? `every document in ${describeFolder(rule.target)}`
      : rule.scope === "document"
        ? whereOf(rule)
        : rule.scope === "rules"
          ? "any change to who signs off"
          : `everything in ${binderName}`;
  const tail =
    rule.scope === "folder" ? ` — ${coverage(rule.covers.length)}` : "";

  if (rule.status === "removed") {
    return `After this is published, ${where} no longer has a sign-off rule of its own.`;
  }
  if (added.length > 0 && removed.length === 0) {
    return `After this is published, ${where} needs an approval from ${listSentence(added)} as well${tail}.`;
  }
  if (removed.length > 0 && added.length === 0) {
    return `After this is published, ${where} no longer needs an approval from ${listSentence(removed)}${tail}.`;
  }
  return `After this is published, ${where} needs an approval from ${listSentence(added)} instead of ${listSentence(removed)}${tail}.`;
}

/** The rule section's rows, in the change's order. */
export function ruleChangeRows(
  rules: readonly SignOffChangeRule[],
  binderName: string,
): RuleChangeRow[] {
  return rules.map((rule) => ({
    key: `${rule.scope}:${rule.target}`,
    where: whereOf(rule),
    kind: rule.scope,
    place: rule.place,
    owners: chips(rule),
    effect: effectOf(rule, binderName),
  }));
}

/** "Who signs off · 1 rule", for the tree's first entry. */
export function ruleChangeCount(rules: readonly unknown[]): string {
  return rules.length === 1 ? "1 rule" : `${rules.length} rules`;
}

/** The approvals table's third line: why the rule is on this change. */
export function reasonLine(rule: ApprovalRuleRow, binderName: string): string {
  switch (rule.reason.kind) {
    case "rules":
      return "This change edits a sign-off rule";
    case "binder":
      return `Applies to everything in ${binderName}`;
    case "approvers":
      return `${binderName} needs ${rule.required} ${rule.required === 1 ? "approval" : "approvals"}`;
    case "document":
      return "This document has its own rule";
    case "folder": {
      const names = rule.reason.matched.map(describeDocumentPath);
      if (names.length === 0) return "Something in this folder changed";
      return `${listSentence(names)} ${names.length === 1 ? "is" : "are"} in this folder`;
    }
  }
}

/** The approvals table's head: "Needs sign-off under 4 rules · none met yet". */
export function approvalsHead(rules: readonly ApprovalRuleRow[]): string {
  if (rules.length === 0) return "No sign-off is needed";
  const met = rules.filter(
    (rule) => rule.approvedBy.length >= rule.required,
  ).length;
  const under = `Needs sign-off under ${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
  const state =
    met === 0
      ? "none met yet"
      : met === rules.length
        ? rules.length === 1
          ? "met"
          : "all met"
        : `${met} of ${rules.length} met`;
  return `${under} · ${state}`;
}

/**
 * "One approval from Alice or Priya meets both Policy Office rules." — when
 * someone is eligible for more than one unmet rule that names the same group.
 * Verified against Gitea 28 (`tests/gitea-permission-model.pw.ts`, D11): one
 * approval counts toward every rule its approver is an owner of.
 */
export function sharedApprovalNote(
  rules: readonly ApprovalRuleRow[],
): string | null {
  const unmet = rules.filter(
    (rule) =>
      rule.kind === "sign-off" && rule.approvedBy.length < rule.required,
  );
  const byGroup = new Map<string, ApprovalRuleRow[]>();
  for (const rule of unmet) {
    for (const group of rule.groups) {
      byGroup.set(group, [...(byGroup.get(group) ?? []), rule]);
    }
  }
  for (const [group, sharing] of byGroup) {
    if (sharing.length < 2) continue;
    const people = [
      ...new Map(
        sharing
          .flatMap((rule) => rule.eligible)
          .map((user) => [user.login, user.fullName.trim() || user.login]),
      ).values(),
    ];
    if (people.length === 0) continue;
    const who =
      people.length <= 1
        ? (people[0] ?? "")
        : `${people.slice(0, -1).join(", ")} or ${people[people.length - 1]}`;
    const count = sharing.length === 2 ? "both" : `all ${sharing.length}`;
    return `One approval from ${who} meets ${count} ${describeGroupName(group)} rules.`;
  }
  return null;
}

/**
 * "The Quality Committee is not asked: its rule starts with the next change
 * after this one is published." — Gitea reads the rules from the base, so an
 * owner this change adds does not govern it.
 */
export function startsNextNote(
  rules: readonly SignOffChangeRule[],
): string | null {
  const added = [
    ...new Set(
      rules.flatMap((rule) => [
        ...rule.teams.added.map((team) => `The ${describeGroupName(team)}`),
        ...rule.users.added,
      ]),
    ),
  ];
  if (added.length === 0) return null;
  const who = listSentence(added);
  return added.length === 1
    ? `${who} is not asked: its rule starts with the next change after this one is published.`
    : `${who} are not asked: their rules start with the next change after this one is published.`;
}

/**
 * At the moment of approval, for a change that edits rules: what it does,
 * and which rules this approval counts toward (D13).
 */
export function approvalCountsToward(
  rules: readonly ApprovalRuleRow[],
  approver: string,
): string[] {
  const me = approver.toLowerCase();
  return rules
    .filter((rule) =>
      rule.eligible.some((user) => user.login.toLowerCase() === me),
    )
    .map((rule) => {
      const owners = rule.groups.map(describeGroupName).join(", ");
      switch (rule.reason.kind) {
        case "rules":
          return `Who signs off · ${owners}`;
        case "binder":
          return `The whole binder · ${owners}`;
        case "approvers":
          return `Binder approvers · ${Math.min(rule.approvedBy.length + 1, rule.required)} of ${rule.required}`;
        case "document":
          return `This document · ${owners}`;
        default:
          return `${describeFolder(rule.target)} · ${owners}`;
      }
    });
}

/** The approve step's warning, for a change that edits rules. */
export function rulesWarning(
  rules: readonly SignOffChangeRule[],
  binderName: string,
): string {
  const rows = ruleChangeRows(rules, binderName);
  const first = rows[0]?.effect.replace(/^After this is published, /, "") ?? "";
  return rows.length === 1
    ? `Once it is published, ${first}`
    : `Once it is published, ${rows.length} sign-off rules change.`;
}
