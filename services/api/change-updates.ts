/**
 * What a change has proposed, and how many times it has proposed it.
 *
 * A reviewer asks for a correction and the submitter uploads a fixed file.
 * That upload is a commit on the change's own branch, so the branch history
 * already *is* the list of updates — nothing about them is stored anywhere
 * else, per the "all data lives in Gitea" rule.
 *
 * **An update is a commit made after the change opened, and that distinction
 * is the whole of this module.** A draft is a branch that accumulates work —
 * rename a folder, move four policies, add one — and every act on it is a
 * commit. Counting commits meant proposing a draft with eight acts in it
 * opened a change request whose discussion already held seven entries reading
 * "Alice updated the proposed version", before a single person had looked at
 * it. Nobody updated anything: that work *is* what was proposed.
 *
 * So everything on the branch when the change opened is update 1 — the
 * submission, however many commits it took to write — and only what lands
 * afterwards counts up. Which is what "update 2 of 3" is asking, and what
 * every other review tool means by it.
 */

import type { ChangeUpdate } from "../../packages/api-schema/schemas/documents";

/** A commit as the Gitea client reports it. */
export interface UpdateCommit {
  sha: string;
  author: string;
  timestamp: string;
}

function timeOf(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Number the commits on a change's branch, oldest first.
 *
 * Gitea serves commits newest-first, which is backwards for a count: the first
 * thing that happened is update 1, and a reader counting down from the top
 * would have to know the total before they could name the one in front of them.
 *
 * Commits with no sha are dropped rather than numbered — an update nobody can
 * open is not an update, and giving it a number would shift every real one.
 *
 * `openedAt` is when the change request was made. Everything committed at or
 * before it is the submission, and collapses into update 1 under the newest of
 * those commits — which is the branch head as it stood when reviewers were
 * asked, and so the right thing for "open the proposed version" to open.
 * Omitted, every commit counts, which is the old behaviour and is right for a
 * caller that has no change to date from.
 */
export function buildChangeUpdates(
  commits: UpdateCommit[],
  openedAt?: string | null,
): ChangeUpdate[] {
  const ordered = [...commits]
    .filter((commit) => commit.sha.trim().length > 0)
    .sort((left, right) => timeOf(left.timestamp) - timeOf(right.timestamp));

  const opened = openedAt ? timeOf(openedAt) : 0;
  if (opened === 0) {
    return ordered.map((commit, index) => ({
      index: index + 1,
      sha: commit.sha,
      author: commit.author,
      at: commit.timestamp,
    }));
  }

  // A commit whose timestamp we could not read is treated as part of the
  // submission rather than as an update: claiming somebody revised a change
  // they did not is the worse of the two mistakes on a record product.
  const submitted = ordered.filter(
    (commit) => timeOf(commit.timestamp) <= opened,
  );
  const after = ordered.filter((commit) => timeOf(commit.timestamp) > opened);

  const first = submitted[submitted.length - 1] ?? null;
  const updates: ChangeUpdate[] = first
    ? [
        {
          index: 1,
          sha: first.sha,
          author: first.author,
          at: first.timestamp,
        },
      ]
    : [];

  for (const commit of after) {
    updates.push({
      index: updates.length + 1,
      sha: commit.sha,
      author: commit.author,
      at: commit.timestamp,
    });
  }

  return updates;
}
