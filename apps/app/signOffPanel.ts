/**
 * "Who signs off here", worked out without the page.
 *
 * One panel on the binder, folder and document pages and in the editor's
 * right-hand panel. It splits what applies into **Set here** — rules whose
 * target is exactly this place, editable in the editor — and **From above** —
 * every parent folder's rule, nearest first, then the binder's, then the
 * binder's approvals count — read only, each with a link to where it is set.
 *
 * The matching is `signOffRulesFor`, Gitea's own anchored compile, so the
 * panel never claims a rule Gitea would not apply.
 */

import type { BinderSignOffPayload } from "../../packages/api-schema/schemas/workspaces";
import {
  signOffRulesFor,
  type SignOffPlace,
  type SignOffRule,
} from "../../packages/utils/codeowners";
import { describeGroupName } from "../../packages/utils/groupName";
import { formatDocumentName } from "../../packages/utils/documentTitle";
import { parseDocumentFilename } from "../../packages/utils/documentPath";

export type { SignOffPlace };

/** One person on a row: their face, and whether they can read the binder. */
export interface PanelPerson {
  login: string;
  fullName: string;
  hasAccess: boolean;
}

/** Where a row's rule is set, for its origin link. */
export type PanelOrigin =
  | { kind: "binder" }
  | { kind: "folder"; path: string }
  | { kind: "document"; path: string };

export interface PanelRow {
  key: string;
  /** A group, a person, the approvals count, or the rules rule's group. */
  kind: "group" | "person" | "approvals";
  /** The group's handle, for its link. */
  group?: string;
  /** "Infection Control", "Priya Raman", "2 approvals". */
  title: string;
  /** "Set on this folder", "The whole binder", "Any change to who signs off". */
  detail: string;
  /** For a row from above: where it is set, said and linked. */
  origin: { label: string; to: PanelOrigin } | null;
  /** Faces: a group's people, or the one person. */
  people: PanelPerson[];
  /** False when a rule names a group or person who cannot read the binder. */
  hasAccess: boolean;
  /** The rule the row comes from, for an edit; null for the approvals row. */
  rule: SignOffRule | null;
  /** For a group or person row: the owner this row removes. */
  owner?: { kind: "team" | "user"; name: string };
  /** The rules rule's row, shown on the binder only. */
  isRulesRule?: boolean;
}

export interface SignOffPanelView {
  lead: string;
  here: PanelRow[];
  /** "Nothing is set on this document alone." when `here` is empty. */
  hereEmpty: string;
  above: PanelRow[];
  /** The line under the panel, or null. */
  foot: string | null;
  /** The rule to add an owner to: this place's own, or a new one. */
  ownRule: SignOffRule | null;
  /** What a new rule here covers, for "Add a group or a person". */
  ownTarget: { scope: SignOffRule["scope"]; target: string } | null;
}

/** "Clinical Standards / ICU". */
export function describeFolder(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => formatDocumentName(part))
    .join(" / ");
}

/** A document's name from its path: "Hand Hygiene". */
export function describeDocumentPath(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return formatDocumentName(parseDocumentFilename(file).name);
}

function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function leadFor(place: SignOffPlace, editing: boolean): string {
  const needs = editing ? "will need" : "needs";
  switch (place.kind) {
    case "binder":
      return `Everything in this binder ${needs} these, whatever folder it is in.`;
    case "folder":
      return `Publishing anything in this folder ${needs} one approval from each of these.`;
    case "document":
      return `Publishing a new version ${needs} one approval from each of these.`;
  }
}

/**
 * The panel for one place, from the binder's rules.
 *
 * `binderName` names the binder in origin lines ("The whole binder ·
 * Governance"). `editing` is the editor's panel: the lead says "will need"
 * and the read view's foot is left off, because Edit is where the reader is.
 */
export function buildSignOffPanel(params: {
  payload: BinderSignOffPayload;
  place: SignOffPlace;
  binderName: string;
  editing?: boolean;
}): SignOffPanelView {
  const { payload, place, binderName, editing = false } = params;
  const applying = signOffRulesFor(payload.rules, place);
  const groups = new Map(payload.groups.map((group) => [group.name, group]));
  const people = new Map(
    payload.people.map((person) => [person.login, person]),
  );

  const ownerRows = (
    rule: SignOffRule,
    detail: string,
    origin: PanelRow["origin"],
    rulesRule = false,
  ): PanelRow[] => [
    ...rule.teams.map((team): PanelRow => {
      const known = groups.get(team);
      return {
        key: `${rule.scope}:${rule.target}:team:${team}`,
        kind: "group",
        group: team,
        title: describeGroupName(team),
        detail,
        origin,
        people: known?.members ?? [],
        hasAccess: known?.hasAccess ?? true,
        rule,
        owner: { kind: "team", name: team },
        ...(rulesRule ? { isRulesRule: true } : {}),
      };
    }),
    ...rule.users.map((login): PanelRow => {
      const known = people.get(login);
      const person = known ?? { login, fullName: "", hasAccess: true };
      return {
        key: `${rule.scope}:${rule.target}:user:${login}`,
        kind: "person",
        title: person.fullName.trim() || login,
        detail,
        origin,
        people: [person],
        hasAccess: person.hasAccess,
        rule,
        owner: { kind: "user", name: login },
        ...(rulesRule ? { isRulesRule: true } : {}),
      };
    }),
  ];

  const here: PanelRow[] = [];
  const above: PanelRow[] = [];

  for (const { rule, origin, setAt } of applying) {
    if (origin === "here") {
      const detail =
        rule.scope === "rules"
          ? "Any change to who signs off"
          : rule.scope === "binder"
            ? "The whole binder"
            : rule.scope === "folder"
              ? "Set on this folder"
              : "Set on this document";
      here.push(...ownerRows(rule, detail, null, rule.scope === "rules"));
    } else if (rule.scope === "binder") {
      above.push(
        ...ownerRows(rule, "The whole binder", {
          label: binderName,
          to: { kind: "binder" },
        }),
      );
    } else {
      above.push(
        ...ownerRows(rule, "A folder above", {
          label: describeFolder(setAt),
          to: { kind: "folder", path: setAt },
        }),
      );
    }
  }

  // The binder's approvals count is a rule too: on the binder it is set
  // here; everywhere else it comes from above.
  const count = payload.requiredApprovals ?? 0;
  if (count > 0) {
    const approverGroups = payload.approvers?.groups ?? [];
    const approverPeople = payload.approvers?.people ?? [];
    const faces = new Map<string, PanelPerson>();
    for (const name of approverGroups) {
      for (const member of groups.get(name)?.members ?? []) {
        faces.set(member.login, member);
      }
    }
    for (const login of approverPeople) {
      faces.set(
        login,
        people.get(login) ?? { login, fullName: "", hasAccess: true },
      );
    }
    const row: PanelRow = {
      key: "approvals",
      kind: "approvals",
      title: `${count} ${count === 1 ? "approval" : "approvals"}`,
      detail: "From the binder's approvers",
      origin:
        place.kind === "binder"
          ? null
          : { label: binderName, to: { kind: "binder" } },
      people: [...faces.values()],
      hasAccess: true,
      rule: null,
    };
    if (place.kind === "binder") {
      // After the binder rule, before the rules rule.
      const rulesAt = here.findIndex((entry) => entry.isRulesRule);
      here.splice(rulesAt === -1 ? here.length : rulesAt, 0, row);
    } else {
      above.push(row);
    }
  }

  const ownTarget: SignOffPanelView["ownTarget"] =
    place.kind === "binder"
      ? { scope: "binder", target: "" }
      : place.kind === "folder"
        ? { scope: "folder", target: place.path }
        : (() => {
            const uid =
              payload.documents.find((document) => document.path === place.path)
                ?.uid ?? null;
            return uid ? { scope: "document" as const, target: uid } : null;
          })();
  const ownRule =
    applying.find(
      (entry) =>
        entry.origin === "here" && entry.rule.scope === ownTarget?.scope,
    )?.rule ?? null;

  let foot: string | null = null;
  if (place.kind === "binder") {
    const folders = payload.rules
      .filter((rule) => rule.scope === "folder")
      .map((rule) => describeFolder(rule.target));
    const documents = payload.rules.filter(
      (rule) => rule.scope === "document",
    ).length;
    const named = [
      ...folders,
      ...(documents === 0
        ? []
        : [documents === 1 ? "one document" : `${documents} documents`]),
    ];
    if (named.length === 1 && documents <= 1) {
      foot = `${named[0]![0]!.toUpperCase()}${named[0]!.slice(1)} adds a rule of its own. Open it to see.`;
    } else if (named.length > 0) {
      foot = `${listSentence(named)} add rules of their own. Open them to see.`;
    }
  } else if (!editing && payload.canEdit) {
    const rulesOwners = payload.rules
      .filter((rule) => rule.scope === "rules")
      .flatMap((rule) => [
        ...rule.teams.map((team) => `the ${describeGroupName(team)}`),
        ...rule.users.map(
          (login) => people.get(login)?.fullName.trim() || login,
        ),
      ]);
    foot =
      rulesOwners.length > 0
        ? `To change who signs off here, press Edit. It goes into a draft, and ${listSentence(rulesOwners)} ${rulesOwners.length === 1 ? "approves" : "approve"} it.`
        : "To change who signs off here, press Edit. It goes into a draft, and it is reviewed like any change.";
  }

  return {
    lead: leadFor(place, editing),
    here,
    hereEmpty:
      place.kind === "document"
        ? "Nothing is set on this document alone."
        : place.kind === "folder"
          ? "Nothing is set on this folder alone."
          : "Nothing is set on the whole binder.",
    above,
    foot,
    ownRule,
    ownTarget,
  };
}

/** The rule with one owner taken off: what Remove on a Set here row sends. */
export function withoutOwner(
  rule: SignOffRule,
  owner: { kind: "team" | "user"; name: string },
): SignOffRule {
  return owner.kind === "team"
    ? { ...rule, teams: rule.teams.filter((team) => team !== owner.name) }
    : { ...rule, users: rule.users.filter((user) => user !== owner.name) };
}

/** The rule with one owner added, made if this place has none yet. */
export function withOwner(
  rule: SignOffRule | null,
  target: { scope: SignOffRule["scope"]; target: string },
  owner: { kind: "team" | "user"; name: string },
): SignOffRule {
  const base = rule ?? { ...target, teams: [], users: [] };
  if (owner.kind === "team") {
    return base.teams.includes(owner.name)
      ? base
      : { ...base, teams: [...base.teams, owner.name] };
  }
  return base.users.includes(owner.name)
    ? base
    : { ...base, users: [...base.users, owner.name] };
}
