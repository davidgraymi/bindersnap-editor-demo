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
 * parser.
 *
 * **Something does read it back now**, and the sentence that used to be here
 * said nothing would. {@link readVersionStamp} recovers the title and the path
 * a version was published at, which the archive needs and cannot get anywhere
 * else: an archived document is not on `main`, so its tags are the only record
 * of what it was called. The two labelled lines at the foot of the message
 * were already written for exactly this — "repeated below the summary in full,
 * so a tool that only shows the first line and a person reading the whole
 * message get the same two facts."
 *
 * The concern behind the original sentence was drift between a writer and a
 * parser, and the answer is that they are in this file, ten lines apart, and
 * tested against each other. Everything else about the message stays prose
 * nothing parses: the reader takes two labelled lines and ignores the rest,
 * and a message it cannot read costs a title rather than a page.
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

/**
 * A document taken off the record, written into an annotated tag at the merge.
 *
 * **The blob is already safe; this is the audit line.** A tag is a ref, so
 * deleting a file from `main` does not touch the tags pointing at the commits
 * that held it — every archived document's bytes have been permanently
 * reachable since ADR 0005 gave each version a tag. What no tag recorded was
 * the act: who took it off the record, when, and under which change. Without
 * that, "this policy stopped being in force in March" is answerable only by
 * bisecting the history of `main`.
 *
 * Same primitive as a version tag, same publish, same code path — so it is
 * atomic with the merge by construction rather than by a webhook holding two
 * writes together.
 */
export interface ArchivedDocument {
  /** What it was called when it was archived. */
  title: string;
  /** `nursing/hand-hygiene` — where it was filed when it was archived. */
  slugPath: string;
  /** The file that was removed, identity segment included. */
  path: string;
  /** The version it was on. Its last, unless it is restored. */
  lastVersion: number | null;
  /** Which archiving this is: 1 the first time, 2 after a restore. */
  sequence: number;
  archivedBy: string;
  changeNumber: number;
}

export function buildArchiveStamp(archived: ArchivedDocument): string {
  const lines = [
    // The summary line says what happened to what, because the tag name is a
    // ULID and says neither.
    `${archived.title} archived — ${archived.path}`,
    "",
    "This document was taken off the record. Its published versions are",
    "unaffected: every version tag still points at the commit that held it, so",
    "the file remains readable from a bare clone at any version it reached.",
    "",
    `  Last version: ${
      archived.lastVersion === null ? "none" : `v${archived.lastVersion}`
    }`,
    `  Archived by: ${archived.archivedBy}`,
    `  From change: #${archived.changeNumber}`,
    archived.sequence > 1
      ? `  This is archiving number ${archived.sequence} — it was restored and archived again.`
      : null,
    "",
    // The same two labelled lines a version stamp carries, so one reader can
    // recover the display facts from either kind of tag.
    `  Title at this version: ${archived.title}`,
    `  Filed at: ${archived.slugPath}`,
  ].filter((line): line is string => line !== null);

  return `${lines.join("\n")}\n`;
}

/** What a stamp says a document was called and where it was filed. */
export interface StampedIdentity {
  title: string | null;
  slugPath: string | null;
}

/**
 * Read the title and the path back out of a tag message.
 *
 * **The archive has nowhere else to look.** An archived document is not on
 * `main`, so the tree cannot name it; its tags are the whole of what is left,
 * and they were given these two lines for this. A version tag written before
 * those lines existed, or a tag somebody wrote by hand, answers null for both
 * — which costs a heading and not a page, and is why the caller falls back to
 * the tag's own summary line rather than to nothing.
 *
 * Deliberately narrow: two labelled lines, anchored, whitespace-tolerant,
 * and the rest of the message ignored. Making this any cleverer is how a
 * format nothing parses becomes a format one thing parses badly.
 */
export function readVersionStamp(message: string): StampedIdentity {
  return {
    title: labelled(message, "Title at this version"),
    slugPath: labelled(message, "Filed at"),
  };
}

function labelled(message: string, label: string): string | null {
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${label}:`)) continue;
    const value = trimmed.slice(label.length + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}
