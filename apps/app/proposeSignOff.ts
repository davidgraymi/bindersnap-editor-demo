/**
 * What a change will need to be published, said where it is proposed.
 *
 * The propose step asked "Who should review it" over a list of everybody in
 * the binder, and said nothing about approval. An author could ask three
 * people whose approval does not count and wait a week to find out. The
 * binder's own rule is known before the change exists — how many approvals,
 * and from whom — so the step says it, and marks who can give one.
 *
 * Only the binder's rule: a folder or a document may add its own, and which
 * of those apply depends on what the change touches. The change request
 * lists every rule once it is open, and the step says so.
 */

import type { BinderSignOffPayload } from "../../packages/api-schema/schemas/workspaces";

type SignOff = Pick<
  BinderSignOffPayload,
  "requiredApprovals" | "approvers" | "groups"
>;

/** Everybody whose approval counts in this binder, by login, in lower case. */
export function approverLogins(signOff: SignOff | null): Set<string> {
  const logins = new Set<string>();
  if (!signOff?.approvers) return logins;
  for (const login of signOff.approvers.people) logins.add(login.toLowerCase());
  const named = new Set(signOff.approvers.groups);
  for (const group of signOff.groups) {
    if (!named.has(group.name)) continue;
    for (const member of group.members) logins.add(member.login.toLowerCase());
  }
  return logins;
}

export interface ApprovalNeed {
  /** What the binder asks for, in a sentence. */
  line: string;
  /** Nothing can be published as things stand. */
  blocked: boolean;
}

/**
 * The sentence above the list of people. `others` is how many approvers
 * there are besides the author, who can never approve their own change.
 * When every one of them can approve, the sentence says so and the list
 * carries no marks: a mark on every row marks nothing.
 * Null while the rule could not be read: say nothing rather than guess.
 */
export function describeApprovalNeed(
  required: number | null,
  others: number,
  /** Everybody listed can approve, so nobody needs marking. */
  everybody = false,
): ApprovalNeed | null {
  if (required === null) return null;
  if (required === 0) {
    return {
      line: "This binder needs no approvals, so you can publish this yourself. Ask somebody if you want their view first.",
      blocked: false,
    };
  }
  const need = required === 1 ? "1 approval" : `${required} approvals`;
  if (others < required) {
    return {
      line:
        others === 0
          ? `This binder needs ${need} before a change is published, and nobody but you can give one. A binder admin chooses its approvers in Settings.`
          : `This binder needs ${need} before a change is published, and only ${others} other ${others === 1 ? "person" : "people"} can approve. A binder admin chooses its approvers in Settings.`,
      blocked: true,
    };
  }
  if (everybody) {
    return {
      line: `This binder needs ${need} before a change is published. Anybody listed here can give ${required === 1 ? "it" : "one"}.`,
      blocked: false,
    };
  }
  return {
    line: `This binder needs ${need} before a change is published. Only the people marked “Can approve” count toward ${required === 1 ? "it" : "them"}; anybody can comment.`,
    blocked: false,
  };
}

/** Approvers first, each group in the order it came. */
export function approversFirst<T extends { login: string }>(
  people: readonly T[],
  approvers: ReadonlySet<string>,
): T[] {
  const can = (person: T) => approvers.has(person.login.toLowerCase());
  return [...people.filter(can), ...people.filter((person) => !can(person))];
}
