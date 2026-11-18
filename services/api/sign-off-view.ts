/**
 * Who signs off, put the way the screens read it.
 *
 * Pure: everything here is a function of rules already read from
 * `.gitea/CODEOWNERS` and a tree already read from Gitea, so what the panels
 * and the change page say can be tested without one. Nothing here is stored —
 * the rules' only home is the file (non-negotiable 2).
 */

import {
  CODEOWNERS_PATH,
  diffSignOffRules,
  rulePattern,
  type SignOffRule,
  type SignOffRuleDiff,
} from "../../packages/utils/codeowners";

/** A document as these views need it: where it is, what it is called. */
export interface SignOffDocument {
  path: string;
  uid: string | null;
  name: string;
}

function compiled(rule: SignOffRule): RegExp | null {
  try {
    return new RegExp(`^${rulePattern(rule)}$`);
  } catch {
    return null;
  }
}

/** The documents a rule covers in a tree: what "both of the documents in it today" counts. */
export function documentsCoveredBy(
  rule: SignOffRule,
  documents: readonly SignOffDocument[],
): SignOffDocument[] {
  if (rule.scope === "rules") return [];
  const pattern = compiled(rule);
  if (pattern === null) return [];
  return documents.filter((document) => pattern.test(document.path));
}

/** One rule a change edits, with the documents it covers once published. */
export type SignOffChangeRule = SignOffRuleDiff & {
  /** For a folder or document rule: where it is, as a path on the change. */
  place: string;
  covers: SignOffDocument[];
};

/**
 * What a change does to who signs off: each rule it edits, against the rules
 * where it started, with the documents each will cover once it is published.
 * Null when the change does not touch the rules file, so the page can tell
 * "no rule change" from "a rule change that changed nothing".
 */
export function buildSignOffChange(params: {
  paths: readonly string[];
  before: readonly SignOffRule[];
  after: readonly SignOffRule[];
  /** The tree on the change's branch. */
  documents: readonly SignOffDocument[];
}): { rules: SignOffChangeRule[] } | null {
  if (!params.paths.includes(CODEOWNERS_PATH)) return null;
  return {
    rules: diffSignOffRules(params.before, params.after).map((diff) => {
      const rule: SignOffRule = {
        scope: diff.scope,
        target: diff.target,
        teams: [...diff.teams.unchanged, ...diff.teams.added],
        users: [...diff.users.unchanged, ...diff.users.added],
      };
      const covers = documentsCoveredBy(rule, params.documents);
      const place =
        diff.scope === "folder"
          ? diff.target
          : diff.scope === "document"
            ? (covers[0]?.path ?? "")
            : "";
      return { ...diff, place, covers };
    }),
  };
}

/** Why a rule is on a change, for the approvals table's third line. */
export interface ApprovalRuleReason {
  kind: "approvers" | "rules" | "binder" | "folder" | "document";
  /** The changed documents' paths the rule matched; empty for the rest. */
  matched: string[];
}

/** Why each matching rule applies to a change that touches these paths. */
export function reasonFor(
  rule: SignOffRule | null,
  paths: readonly string[],
): ApprovalRuleReason {
  if (rule === null) return { kind: "approvers", matched: [] };
  if (rule.scope === "rules" || rule.scope === "binder") {
    return { kind: rule.scope, matched: [] };
  }
  const pattern = compiled(rule);
  return {
    kind: rule.scope,
    matched: pattern
      ? paths.filter((path) => path !== CODEOWNERS_PATH && pattern.test(path))
      : [],
  };
}

/** Where a group signs off in one binder, for the group's page. */
export interface GroupSignOffPlace {
  binder: string;
  scope: SignOffRule["scope"];
  /** The folder path, the document's path, or "" for the binder and the rules. */
  place: string;
  /** The documents the rule covers today. */
  covers: SignOffDocument[];
}

/** Every rule in one binder that names a group, as the group page lists them. */
export function placesGroupSignsOff(params: {
  binder: string;
  group: string;
  rules: readonly SignOffRule[];
  documents: readonly SignOffDocument[];
}): GroupSignOffPlace[] {
  const wanted = params.group.toLowerCase();
  return params.rules
    .filter((rule) => rule.teams.some((team) => team.toLowerCase() === wanted))
    .map((rule) => {
      const covers = documentsCoveredBy(rule, params.documents);
      return {
        binder: params.binder,
        scope: rule.scope,
        place:
          rule.scope === "folder"
            ? rule.target
            : rule.scope === "document"
              ? (covers[0]?.path ?? "")
              : "",
        covers,
      };
    });
}

/**
 * Who can read a binder, for the "No access to this binder" marker beside a
 * group or person a rule names. The groups granted onto it, the Owners, and
 * every member of those; with the binder open to the organization, everyone.
 */
export function signOffReach(params: {
  grantedGroups: readonly { name: string; members: readonly string[] }[];
  owners: readonly string[];
  openToOrganization: boolean;
}): { group: (name: string) => boolean; person: (login: string) => boolean } {
  const groups = new Set(
    [...params.grantedGroups.map((group) => group.name), "Owners"].map((name) =>
      name.toLowerCase(),
    ),
  );
  const people = new Set(params.owners.map((login) => login.toLowerCase()));
  for (const group of params.grantedGroups) {
    for (const login of group.members) people.add(login.toLowerCase());
  }
  return {
    group: (name) =>
      params.openToOrganization || groups.has(name.toLowerCase()),
    person: (login) =>
      params.openToOrganization || people.has(login.toLowerCase()),
  };
}
