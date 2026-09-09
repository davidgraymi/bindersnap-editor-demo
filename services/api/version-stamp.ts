/**
 * The policy in force at a publish, written into the version's annotated tag.
 *
 * ADR 0004 states the rule this exists for in one sentence:
 *
 * > Git stores what happened. The database stores how the app is configured.
 * > When configuration shapes what happened, do not version the configuration —
 * > stamp it onto the event.
 *
 * The alternative was a versioned config file, and this is better than one in
 * every way that matters: it is **immutable**, it is **attached to the exact
 * event**, answering it needs **no join against historical settings**, and it is
 * readable from a bare `git clone` with no application and no database running.
 * A surveyor asking "what did approval require when this version was signed
 * off?" is answered by `git show` — which is the point of keeping evidence in
 * git at all.
 *
 * It is deliberately written as plain sentences rather than as JSON. The
 * audience is a person reading `git tag -n99` or a clone in five years, not a
 * parser: nothing in the product reads this back, and a format nothing parses
 * cannot drift out of step with a parser.
 */

export interface PublishedPolicy {
  /** The document's identity inside the binder. */
  slugPath: string;
  version: number;
  /** How many approvals the binder required, or null when it could not be read. */
  requiredApprovals: number | null;
  /**
   * Everyone whose approval stood at the moment of the merge.
   *
   * Stale and dismissed reviews are not sign-offs and must not be here — a
   * record naming somebody who approved a version they never saw is worse than
   * one naming nobody.
   */
  approvedBy: string[];
  /** Whether the binder refused to publish over an unresolved discussion. */
  blockOnUnresolvedThreads: boolean;
  /**
   * Whether Gitea held the merge for per-folder sign-off.
   *
   * Recorded because it is the difference between "the sign-off rules were
   * enforced" and "the sign-off rules were listed" — which is a real
   * distinction on a Gitea without `block_on_codeowner_reviews`, and exactly
   * the sort of thing nobody can reconstruct afterwards.
   */
  signOffEnforced: boolean;
  /** Who pressed publish. Distinct from who approved. */
  publishedBy: string;
  /** The change this came from, so the tag points back at the discussion. */
  changeNumber: number;
}

/**
 * The tag message.
 *
 * The first line is the summary git shows everywhere a tag is listed, so it
 * carries the two facts that identify the version and nothing else.
 */
export function buildVersionStamp(policy: PublishedPolicy): string {
  const lines = [
    `Published ${policy.slugPath} v${policy.version}`,
    "",
    "The approval policy in force when this version was published:",
    "",
    `  Approvals required: ${
      policy.requiredApprovals === null
        ? "unknown"
        : String(policy.requiredApprovals)
    }`,
    `  Approved by: ${
      policy.approvedBy.length === 0 ? "nobody" : policy.approvedBy.join(", ")
    }`,
    `  Unresolved discussions blocked publishing: ${yesNo(
      policy.blockOnUnresolvedThreads,
    )}`,
    `  Per-folder sign-off enforced: ${yesNo(policy.signOffEnforced)}`,
    "",
    `  Published by: ${policy.publishedBy}`,
    `  From change: #${policy.changeNumber}`,
  ];

  return `${lines.join("\n")}\n`;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
