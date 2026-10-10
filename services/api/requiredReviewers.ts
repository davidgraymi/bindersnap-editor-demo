import type { SignOffRule } from "../../packages/utils/codeowners";
import { signOffOwnersForPaths } from "../../packages/utils/codeowners";

/**
 * Which reviewers a change is actually held for.
 *
 * **Gitea puts them there; branch protection decides whether they block.** A
 * review request is written for every `.gitea/CODEOWNERS` rule matching a
 * changed file, read from the base branch, the moment a change opens — so a
 * sign-off rule's owners are on the change before anybody asks them. Whether
 * that request holds the merge is the part the interface has to read rather
 * than assume:
 *
 * - a **user** code owner is an official request, and blocks;
 * - a **team** code owner is written and then has its own `official` flag
 *   cleared by Gitea (`AddTeamReviewRequest`, still true on 28.0.0), so under
 *   the officialness gate it blocks nothing;
 * - on 28.0.0 `block_on_codeowner_reviews` ignores officialness entirely, and
 *   under that gate a team code owner does block.
 *
 * **A required marker that is wrong on a compliance product is worse than no
 * marker**, which is why a gate that could not be read marks nobody: an
 * unmarked reviewer is one nothing is waiting on, and that is the safer thing
 * to be wrong about.
 *
 * Its own module, and pure, because the rule above is three sentences of
 * Gitea's behaviour that nobody should have to rediscover from a route
 * handler — and because it is the one place in this plan where being
 * approximately right is worse than not shipping it.
 */
export interface SignOffGate {
  /** `block_on_official_review_requests` on the branch's protection. */
  officialBlocks: boolean;
  /** `block_on_codeowner_reviews`, which exists from Gitea 28.0.0. */
  codeownersBlock: boolean;
}

export function requiredReviewersFor(params: {
  rules: readonly SignOffRule[];
  /** The files this change touches, as the repository names them. */
  paths: readonly string[];
  /** Null when the protection could not be read. */
  gate: SignOffGate | null;
}): { users: string[]; teams: string[] } {
  const { rules, paths, gate } = params;
  if (!gate) return { users: [], teams: [] };

  const owners = signOffOwnersForPaths(rules, paths);

  return {
    // A user code owner's request is official, so either gate holds it.
    users: gate.officialBlocks || gate.codeownersBlock ? owners.users : [],
    // A team's is not: Gitea clears its own `official` flag, so only the
    // code-owner gate reaches it.
    teams: gate.codeownersBlock ? owners.teams : [],
  };
}
