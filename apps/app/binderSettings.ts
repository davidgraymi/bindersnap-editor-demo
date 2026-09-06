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
