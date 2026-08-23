/**
 * What a change has proposed, and how many times it has proposed it.
 *
 * A reviewer asks for a correction and the submitter uploads a fixed file.
 * That upload is a commit on the change's own branch, so the branch history
 * already *is* the list of updates — nothing about them is stored anywhere
 * else, per the "all data lives in Gitea" rule.
 *
 * The only work is turning that history into something a person reads: oldest
 * first, numbered from one, so "update 2 of 3" means what it says.
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
 */
export function buildChangeUpdates(commits: UpdateCommit[]): ChangeUpdate[] {
  return [...commits]
    .filter((commit) => commit.sha.trim().length > 0)
    .sort((left, right) => timeOf(left.timestamp) - timeOf(right.timestamp))
    .map((commit, index) => ({
      index: index + 1,
      sha: commit.sha,
      author: commit.author,
      at: commit.timestamp,
    }));
}
