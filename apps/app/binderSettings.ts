/**
 * A binder's rules, said the way a customer would say them.
 *
 * Branch protection is Gitea's vocabulary — `required_approvals`,
 * `dismiss_stale_approvals`, `enable_push` — and it is the right vocabulary for
 * the merge and the wrong one for the person who has to check the rule is what
 * they asked for. This turns it into sentences, and is kept out of the
 * component so the wording is decided in one place and tested without
 * rendering anything.
 */

import type { WorkspaceRules } from "../../packages/api-schema/schemas/workspaces";

/** What is true of this binder, in the order that matters most. */
export function describeBinderRules(rules: WorkspaceRules): string[] {
  const said: string[] = [];

  // The product's core claim leads, because it is the one a customer is
  // buying: nothing reaches the record except through a review.
  if (rules.pushBlocked) {
    said.push(
      "Nothing reaches the record except a change that has been approved and published.",
    );
  } else {
    // Worth saying loudly. A binder without this is not making the promise.
    said.push(
      "This binder's main branch is not protected, so a policy could be changed without a review.",
    );
  }

  if (rules.requiredApprovals === null) {
    said.push("How many approvals a change needs could not be read.");
  } else if (rules.requiredApprovals === 0) {
    said.push("A change needs no approvals before it can be published.");
  } else if (rules.requiredApprovals === 1) {
    said.push("A change needs one approval before it can be published.");
  } else {
    said.push(
      `A change needs ${rules.requiredApprovals} approvals before it can be published.`,
    );
  }

  said.push(
    rules.dismissStaleApprovals
      ? "Uploading a new version clears the approvals the last one collected."
      : "Approvals carry over when a new version is uploaded.",
  );

  said.push(
    rules.blockOnUnresolvedThreads
      ? "A change cannot be published while a discussion thread is still open."
      : "A change can be published with a discussion thread still open.",
  );

  return said;
}

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
    note: "Writes policies and publishes approved versions. Uses a seat.",
  },
  {
    value: "admin",
    label: "Admin",
    note: "Runs the binders it is added to: their rules, people and folders.",
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
