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
/** Everyone in the organization: the `staff` team, read as "Everyone". */
const STAFF = "staff";

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
 * What a search for approvers can find: every group in the organization,
 * Owners and Everyone included, and every person in it. Anybody can be picked;
 * whether they can read the binder yet is the Access section's business.
 */
export function approverOptions(
  orgGroups: readonly string[],
  orgPeople: readonly { login: string; fullName?: string }[],
): {
  groups: string[];
  people: { login: string; name: string }[];
} {
  const groups = [...new Set([...orgGroups, OWNERS, STAFF])].sort(
    (left, right) => {
      if (left === STAFF) return 1;
      if (right === STAFF) return -1;
      return left.localeCompare(right);
    },
  );
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
 * The chosen approvers who cannot read the binder yet.
 *
 * Gitea keeps an approver only once they can read the binder, so these are
 * the rows of the Access section. `teams` is what is granted onto the binder;
 * `owners` can read every binder already.
 */
export function needsAccess(
  chosen: ApproversView,
  teams: readonly ApproverTeam[],
  owners: readonly string[],
): { groups: string[]; people: string[] } {
  const granted = new Set([...teams.map((team) => team.name), OWNERS]);
  const readers = new Set(owners.map((login) => login.toLowerCase()));
  for (const team of teams) {
    for (const member of team.members) readers.add(member.login.toLowerCase());
  }
  return {
    groups: chosen.groups.filter((group) => !granted.has(group)),
    people: chosen.people.filter((login) => !readers.has(login.toLowerCase())),
  };
}

/**
 * Who was asked for and not kept: the approvers Gitea dropped because they
 * cannot read the binder. Said after Save, by name.
 */
export function droppedApproversNote(
  asked: ApproversView,
  kept: ApproversView,
  name: (value: string, kind: "group" | "person") => string,
): string | null {
  const dropped = [
    ...asked.groups
      .filter((group) => !kept.groups.includes(group))
      .map((group) => name(group, "group")),
    ...asked.people
      .filter(
        (login) =>
          !kept.people.some(
            (keptLogin) => keptLogin.toLowerCase() === login.toLowerCase(),
          ),
      )
      .map((login) => name(login, "person")),
  ];
  if (dropped.length === 0) return null;
  const list =
    dropped.length === 1
      ? dropped[0]!
      : `${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`;
  return dropped.length === 1
    ? `${list} isn't an approver yet: give them access first.`
    : `${list} aren't approvers yet: give them access first.`;
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
export type ApproverMatch =
  | { kind: "group"; value: string; label: string }
  | { kind: "person"; value: string; label: string; login: string };

/**
 * What a search for approvers finds: groups and people whose name or login
 * contains every word typed, not already chosen, groups first.
 *
 * Nothing until something is typed. A list of the whole organization is the
 * thing the search replaces.
 */
export function searchApprovers(
  options: ReturnType<typeof approverOptions>,
  query: string,
  chosen: { groups: readonly string[]; people: readonly string[] },
  groupName: (handle: string) => string,
  limit = 8,
): ApproverMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
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
    }));

  return [...groups, ...people].slice(0, limit);
}
