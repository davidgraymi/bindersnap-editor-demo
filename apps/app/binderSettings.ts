/**
 * A binder's rules, said the way a customer would say them.
 *
 * Branch protection is Gitea's vocabulary — `required_approvals`,
 * `dismiss_stale_approvals`, `enable_push` — and it is the right vocabulary for
 * the merge and the wrong one for the person who has to check the rule is what
 * they asked for. This turns it into the product's words, and is kept out of
 * the component so the wording is decided in one place and tested without
 * rendering anything.
 */

/**
 * What a group's access means, in the ADR's own terms.
 *
 * Worded without naming where it is shown, because it is shown in two places:
 * on a binder, beside a team granted onto it, and on the organization, beside
 * a group that may be granted onto any binder. "Administers this binder" was
 * true on the first and a lie on the second.
 *
 * `read` is deliberately named as free: ADR 0004 promises reviewers cost
 * nothing, and this is the screen where somebody would check that.
 *
 * **`owner` is a level, and the highest one.** Gitea reports the organization's
 * built-in Owners team as `repo.code: "owner"` on every repository the org
 * holds, and a switch that only knew admin/write/read called that "No access"
 * — beside the person who owns the organization. ADR 0004 warns about exactly
 * this: "Counting by name suffix would miss the Owners team, whose members have
 * write access to every repository in the org." They are billable seats, and
 * the page has to say so.
 */
export function describeTeamAccess(access: string): string {
  switch (access) {
    case "owner":
      return "Owns the organization · paid seat";
    case "admin":
      return "Can administer · paid seat";
    case "write":
      return "Can publish · paid seat";
    case "read":
      return "Can review · free";
    default:
      return "No access";
  }
}

/**
 * The levels a group can be created at, in the product's words.
 *
 * **Admin, not "Manager".** "Admin" is already the word in Gitea, in the API
 * and in the code, and inventing a second word for the same thing means every
 * conversation between a customer, a support reply and a log line has to be
 * translated. A word that is merely imperfect beats a word that is unique to
 * us — invent vocabulary only where the underlying word is actively
 * misleading, which exactly one of these three is.
 *
 * **Editor, not "Author" — the one invented word, and why it earns it.** An
 * author is the person who *wrote* something: a claim about history. This role
 * is about who may write *next*, and a compliance manager reading
 * "Author: Priya" on a policy Priya never touched would reasonably conclude she
 * drafted it. On a product whose output is evidence, a role label that reads as
 * a false attribution is the one place inventing a word costs less than keeping
 * ours.
 */
export const GROUP_LEVELS = [
  {
    value: "reviewer",
    label: "Reviewer",
    // Said on the form, because the free tier depends on it being understood
    // without a footnote.
    note: "Reads, comments, approves or asks for changes. Free.",
  },
  {
    value: "editor",
    label: "Editor",
    note: "Writes documents and publishes approved versions. Uses a seat.",
  },
  {
    value: "admin",
    label: "Admin",
    note: "Runs the binders it is added to: their rules, people and folders. Uses a seat.",
  },
] as const;

/** What level a group holds, read back from the access Gitea reports. */
export function groupLevelLabel(access: string): string {
  switch (access) {
    // `owner` is what Gitea reports for the built-in Owners team on every
    // repository the organization holds. It is a level above admin, and a
    // switch that did not know it called the org's owner "No access".
    case "owner":
    case "admin":
      return "Admin";
    case "write":
      return "Editor";
    case "read":
      return "Reviewer";
    default:
      return "No access";
  }
}

/**
 * How many different people can approve a change in this binder: everyone in
 * a group with any access, since reviewers approve too. Someone in two groups
 * is one person.
 */
export function countApprovers(
  teams: readonly { access: string; members: readonly { login: string }[] }[],
): number {
  const people = new Set<string>();
  for (const team of teams) {
    if (groupLevelLabel(team.access) === "No access") continue;
    for (const member of team.members) people.add(member.login);
  }
  return people.size;
}

/**
 * What to say when a binder asks for more approvals than it can collect.
 *
 * Nobody approves their own change, so the author never counts: with four
 * people who can approve, the most any one change can collect is three.
 * Allowed anyway — the administrator may be about to invite people — but said
 * plainly, because otherwise the first sign is a change that never publishes.
 */
export function unreachableApprovalsNote(
  required: number,
  approvers: number,
): string | null {
  const most = Math.max(approvers - 1, 0);
  if (required <= most) return null;
  const people = approvers === 1 ? "1 person" : `${approvers} people`;
  return `Only ${people} can approve in this binder, and nobody approves their own change, so nothing can be published until more people join.`;
}

/** A typed approval count, or null when it is not a whole number, 0 or more. */
export function parseApprovalCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return Number.isSafeInteger(count) ? count : null;
}

/** The organization's built-in team, which is never granted onto a binder. */
const OWNERS = "Owners";
/** Everyone in the organization, kept in step as people join and leave. */
const EVERYONE = "everyone";

/** Everyone, by its name or by the `staff` it had before 2026-10-31. */
function isEveryone(name: string): boolean {
  return name === EVERYONE || name === "staff";
}

interface ApproverTeam {
  name: string;
  members: readonly { login: string; fullName?: string }[];
}

/** Whose approvals count, as the rules read reports it. */
export interface ApproversView {
  groups: readonly string[];
  people: readonly string[];
}

/**
 * Every group in the organization, Owners and Everyone included (Everyone
 * last), and every person in it — all shown when choosing who approves
 * changes, whether or not they can be picked.
 */
export function approverOptions(
  orgGroups: readonly string[],
  orgPeople: readonly { login: string; fullName?: string }[],
): {
  groups: string[];
  people: { login: string; name: string }[];
} {
  const everyone = orgGroups.find(isEveryone) ?? EVERYONE;
  const groups = [
    ...new Set([...orgGroups.filter((g) => !isEveryone(g)), OWNERS]),
  ].sort((left, right) => left.localeCompare(right));
  groups.push(everyone);
  const people = new Map<string, string>();
  for (const person of orgPeople) {
    if (!people.has(person.login)) {
      people.set(person.login, person.fullName || person.login);
    }
  }
  return {
    groups,
    people: [...people.entries()]
      .map(([login, name]) => ({ login, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

/**
 * Who could approve in this binder: the groups granted onto it, Owners, and
 * everybody in one of those. Gitea counts nobody who cannot read the binder,
 * so the picker shows the whole organization and lets only these be picked.
 *
 * `teams` is what is granted onto the binder; `owners` can read every binder.
 */
export function approverReach(
  teams: readonly ApproverTeam[],
  owners: readonly string[],
): (kind: "group" | "person", value: string) => boolean {
  const groups = new Set([...teams.map((team) => team.name), OWNERS]);
  const people = new Set(owners.map((login) => login.toLowerCase()));
  for (const team of teams) {
    for (const member of team.members) people.add(member.login.toLowerCase());
  }
  return (kind, value) =>
    kind === "group" ? groups.has(value) : people.has(value.toLowerCase());
}

/**
 * How many people's approvals count, for the "can never be met" warning: the
 * people named, plus everyone in a group named that the page can see into.
 * Owners' members are not on the settings read, so a binder relying on them
 * alone is under-counted — which errs toward warning, the safer way to be
 * wrong.
 */
export function countChosenApprovers(
  approvers: ApproversView | null,
  teams: readonly ApproverTeam[],
): number {
  if (!approvers) return 0;
  const people = new Set(approvers.people);
  for (const team of teams) {
    if (!approvers.groups.includes(team.name)) continue;
    for (const member of team.members) people.add(member.login);
  }
  return people.size;
}

/** The approvers in a sentence: "Board and Dr. Okafor", or "Nobody yet". */
export function describeApprovers(
  approvers: ApproversView,
  people: readonly { login: string; name: string }[],
  groupName: (handle: string) => string,
): string {
  const names = [
    ...approvers.groups.map(groupName),
    ...approvers.people.map(
      (login) => people.find((person) => person.login === login)?.name ?? login,
    ),
  ];
  if (names.length === 0) return "Nobody yet";
  return names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What to say when approvals are needed and nobody can give them.
 *
 * Allowed — an admin may be about to name approvers, and Gitea itself accepts
 * an empty list — but said, because otherwise the first sign is a change that
 * never publishes.
 */
export function noApproversNote(
  required: number | null,
  approvers: ApproversView | null,
): string | null {
  if (!required || !approvers) return null;
  if (approvers.groups.length + approvers.people.length > 0) return null;
  return "Nobody can approve changes in this binder, so nothing can be published until you choose who approves changes.";
}

/** One thing a search for approvers can find: a group or a person. */
export type ApproverMatch = (
  | { kind: "group"; value: string; label: string }
  | { kind: "person"; value: string; label: string; login: string }
) & {
  /** Whether it can read the binder, and so can be picked. */
  canPick: boolean;
};

/**
 * What a search for approvers finds: groups and people whose name or login
 * contains every word typed, not already chosen. With nothing typed, the whole
 * organization. Those who can be picked come first, groups before people;
 * the rest are still shown, so nobody wonders where somebody went.
 */
export function searchApprovers(
  options: ReturnType<typeof approverOptions>,
  query: string,
  chosen: { groups: readonly string[]; people: readonly string[] },
  groupName: (handle: string) => string,
  canPick: (kind: "group" | "person", value: string) => boolean,
): ApproverMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (...texts: string[]) => {
    const haystack = texts.join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  };

  const groups: ApproverMatch[] = options.groups
    .filter((group) => !chosen.groups.includes(group))
    .map((group) => ({
      kind: "group" as const,
      value: group,
      label: groupName(group),
      canPick: canPick("group", group),
    }))
    .filter((match) => hit(match.label, match.value));

  const people: ApproverMatch[] = options.people
    .filter((person) => !chosen.people.includes(person.login))
    .filter((person) => hit(person.name, person.login))
    .map((person) => ({
      kind: "person" as const,
      value: person.login,
      label: person.name,
      login: person.login,
      canPick: canPick("person", person.login),
    }));

  const all = [...groups, ...people];
  return [
    ...all.filter((match) => match.canPick),
    ...all.filter((match) => !match.canPick),
  ];
}

/**
 * Whether a team is one of this binder's own per-person teams —
 * `{binder}-admins`, `-authors`, `-reviewers` (`workspaceTeamName` in the
 * API) — which hold the people added to this binder one by one.
 *
 * **Not a group anybody made.** Listed as one, "Clinical Authors · 4 people"
 * sat under the same four people already listed one by one, so everyone
 * added individually appeared twice. Their people are the rows; the team is
 * our bookkeeping.
 */
export function isBinderRoleTeam(binder: string, team: string): boolean {
  const name = team.toLowerCase();
  return ["admins", "authors", "reviewers"].some(
    (role) => name === `${binder.toLowerCase()}-${role}`,
  );
}

/**
 * A group's name as a binder's settings say it. A binder's own per-person
 * teams have no name anybody gave them — `clinical-authors` is our
 * bookkeeping — so they are said as what they are: the people added to this
 * binder at that level. Every other group keeps its own name.
 */
export function describeBinderGroup(
  binder: string,
  name: string,
  groupName: (handle: string) => string,
): string {
  if (!isBinderRoleTeam(binder, name)) return groupName(name);
  const role = name.slice(binder.length + 1).toLowerCase();
  return role === "admins"
    ? "This binder's admins"
    : role === "authors"
      ? "This binder's editors"
      : "This binder's reviewers";
}

/**
 * Some binder's per-person team, by the binders the group reaches: Corporate
 * Authors is the people added to Corporate as editors, not a group to give
 * another binder.
 */
export function isAnyBinderRoleTeam(group: {
  name: string;
  binders: readonly string[];
}): boolean {
  return group.binders.some((binder) => isBinderRoleTeam(binder, group.name));
}

/**
 * Who is in a group, on its row: "Alice Nguyen and Priya Raman", "Hugo, Dan,
 * Ines and 2 more". A group is a set of people, and the names are what tells
 * somebody whether the person they are looking for is in.
 */
export function describeMembers(
  members: readonly { login: string; fullName: string }[],
  shown = 3,
): string {
  const names = members.map((member) => member.fullName || member.login);
  if (names.length === 0) return "Nobody in it yet";
  if (names.length <= shown) {
    return names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, shown).join(", ")} and ${names.length - shown} more`;
}

export type MemberMatch =
  | { kind: "group"; name: string; label: string; access: string }
  | { kind: "person"; login: string; label: string };

/**
 * The one search for adding to a binder: groups and people together, since
 * giving a committee access and giving one person access are the same act.
 * Groups first — a binder is usually opened to a committee, then to the odd
 * person outside it.
 */
export function searchMembers(
  groups: readonly { name: string; access: string }[],
  people: readonly { login: string; fullName: string }[],
  query: string,
  groupName: (handle: string) => string,
): MemberMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (...texts: string[]) => {
    const haystack = texts.join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  return [
    ...groups
      .map((group) => ({
        kind: "group" as const,
        name: group.name,
        label: groupName(group.name),
        access: group.access,
      }))
      .filter((match) => hit(match.label, match.name)),
    ...people
      .map((person) => ({
        kind: "person" as const,
        login: person.login,
        label: person.fullName || person.login,
      }))
      .filter((match) => hit(match.label, match.login)),
  ];
}
