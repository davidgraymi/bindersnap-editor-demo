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
 *
 * **ADR 0005 gives it a second job.** A version tag is now named after the
 * document's identity — `01J8XZ4K7MQ9V3B0RN7YHS2E1D/v4` — which is exactly as
 * unreadable as it looks. What the tag name stopped saying, the message says
 * instead, and says better: the title and the path *as they stood at this
 * publish*, which are point-in-time facts a rename makes unrecoverable from
 * anywhere else. `git tag -n1` still reads as English.
 */

export interface PublishedPolicy {
  /**
   * What the document was called at this publish — "Hand Hygiene and PPE".
   *
   * A point-in-time fact. Rename the policy tomorrow and nothing else records
   * what it was called when this version was signed off.
   */
  title: string;
  /** `nursing/hand-hygiene-and-ppe` — where it was filed, as a person reads it. */
  slugPath: string;
  /**
   * `nursing/hand-hygiene-and-ppe.01J8XZ4K7M….md` — the file this version is.
   *
   * The whole filename, identity segment included, because this is the line
   * somebody uses to find the blob in a bare clone.
   */
  path: string;
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
 * The first line is the summary git shows everywhere a tag is listed. Under
 * ADR 0004 the tag name was `nursing/infection-control/v4` and this line only
 * had to repeat it; now the name is a ULID, so the summary carries the title,
 * the version and the file — everything somebody scanning `git tag -n1` needs
 * to know which policy they are looking at.
 */
export function buildVersionStamp(policy: PublishedPolicy): string {
  const lines = [
    // Title and path on the summary line, because the tag name no longer
    // carries either and this is the line every listing shows.
    `${policy.title} v${policy.version} — ${policy.path}`,
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
    "",
    // Repeated below the summary in full, so a tool that only shows the first
    // line and a person reading the whole message get the same two facts.
    `  Title at this version: ${policy.title}`,
    `  Filed at: ${policy.slugPath}`,
  ];

  return `${lines.join("\n")}\n`;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
