import type { ChangeUser } from "../../packages/api-schema/schemas/documents";
import type { SignOffRule } from "../../packages/utils/codeowners";
import { rulePattern } from "../../packages/utils/codeowners";
import { latestReviewByUser, toChangeUser } from "./change-assignments";
import type { components } from "./gitea-client/spec/gitea";

type PullReview = components["schemas"]["PullReview"];

/**
 * What has to be true before a change can be published, rule by rule, and who
 * has met each one — the approval panel at the top of a change.
 *
 * **Required is not assigned.** Who was *asked* to review is the reviewers
 * list, Gitea's review requests. This is who *counts*: the binder's approvers,
 * and the owners of every sign-off rule matching a changed file. Somebody can
 * be one without the other, and the page keeps them apart the way GitLab's
 * approval widget and its Reviewers sidebar do.
 *
 * **The author is never listed.** Nobody approves their own change, so naming
 * them as eligible would offer a sign-off that cannot happen.
 */
export interface ApprovalRuleView {
  kind: "approvers" | "sign-off";
  /** For a sign-off rule: what it covers. Empty for the binder's approvers. */
  scope: SignOffRule["scope"] | null;
  target: string;
  /** The groups and people the rule names, as written. */
  groups: string[];
  people: string[];
  /** Approvals the rule needs: the binder's count, or 1 for a sign-off rule. */
  required: number;
  /** Everyone whose approval meets the rule, the author left out. */
  eligible: ChangeUser[];
  /** Who has, with an approval that still stands. */
  approvedBy: ChangeUser[];
}

/** The sign-off rules a change is under: those matching a file it touches. */
export function matchingSignOffRules(
  rules: readonly SignOffRule[],
  paths: readonly string[],
): SignOffRule[] {
  return rules.filter((rule) => {
    let pattern: RegExp;
    try {
      pattern = new RegExp(`^${rulePattern(rule)}$`);
    } catch {
      return false;
    }
    return paths.some((path) => pattern.test(path));
  });
}

/**
 * The approvals that stand, by login: each person's latest word, an approval,
 * not dismissed, and not stale where the binder lets stale approvals lapse.
 */
function standingApprovals(
  reviews: PullReview[],
  ignoresStale: boolean,
): Map<string, PullReview> {
  const standing = new Map<string, PullReview>();
  for (const [login, review] of latestReviewByUser(reviews)) {
    if ((review.state ?? "").toUpperCase() !== "APPROVED") continue;
    if (ignoresStale && review.stale === true) continue;
    standing.set(login, review);
  }
  return standing;
}

/**
 * Build the panel's rules.
 *
 * `members` expands a group to its people; a group that could not be read
 * expands to nobody, which shows as a rule nobody can meet rather than one
 * that pretends to know.
 *
 * The binder's approvers count only **official** approvals — Gitea decided
 * when each was given whether the reviewer was an approver. A sign-off rule
 * counts any standing approval from one of its owners, because Gitea's
 * code-owner gate ignores officialness.
 */
export function buildApprovalRules(params: {
  author: string;
  requiredApprovals: number | null;
  approvers: { groups: string[]; people: string[] } | null;
  signOff: readonly SignOffRule[];
  reviews: PullReview[];
  ignoresStale: boolean;
  members: (group: string) => ChangeUser[];
  /** A person by login, for someone named directly with no review to read. */
  person: (login: string) => ChangeUser;
}): ApprovalRuleView[] {
  const { author, reviews, ignoresStale, members, person } = params;
  const standing = standingApprovals(reviews, ignoresStale);
  const authorKey = author.toLowerCase();

  const eligibleFor = (groups: string[], people: string[]): ChangeUser[] => {
    const byLogin = new Map<string, ChangeUser>();
    for (const group of groups) {
      for (const member of members(group)) byLogin.set(member.login, member);
    }
    for (const login of people) {
      if (!byLogin.has(login)) byLogin.set(login, person(login));
    }
    return [...byLogin.values()]
      .filter((user) => user.login.toLowerCase() !== authorKey)
      .sort((left, right) =>
        (left.fullName || left.login).localeCompare(
          right.fullName || right.login,
        ),
      );
  };

  const approvedFrom = (
    eligible: ChangeUser[],
    officialOnly: boolean,
  ): ChangeUser[] =>
    eligible.flatMap((user) => {
      const review = standing.get(user.login);
      if (!review) return [];
      if (officialOnly && review.official === false) return [];
      return [toChangeUser(review.user) ?? user];
    });

  const rules: ApprovalRuleView[] = [];

  if ((params.requiredApprovals ?? 0) > 0 && params.approvers) {
    const eligible = eligibleFor(
      params.approvers.groups,
      params.approvers.people,
    );
    rules.push({
      kind: "approvers",
      scope: null,
      target: "",
      groups: params.approvers.groups,
      people: params.approvers.people,
      required: params.requiredApprovals ?? 0,
      eligible,
      approvedBy: approvedFrom(eligible, true),
    });
  }

  for (const rule of params.signOff) {
    const eligible = eligibleFor(rule.teams, rule.users);
    rules.push({
      kind: "sign-off",
      scope: rule.scope,
      target: rule.target,
      groups: rule.teams,
      people: rule.users,
      required: 1,
      eligible,
      approvedBy: approvedFrom(eligible, false),
    });
  }

  return rules;
}
