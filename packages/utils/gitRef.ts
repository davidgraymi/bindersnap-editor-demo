/**
 * Whether a git ref is a full commit id — the one kind of ref whose files can
 * never change.
 *
 * A branch, `main` and a tag can all move: a version tag is not protected in
 * Gitea, so even `<uid>/v3` is a name that could be pointed elsewhere. A full
 * object name cannot. SHA-1 or SHA-256; a short hash is ambiguous and is not
 * one.
 */
export function isCommitRef(ref: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref);
}

/**
 * The ref to read a published version at: its commit, when the server said
 * which, else its tag.
 *
 * The same bytes either way — the tag points at that commit — but a read at a
 * commit can be kept by the browser for good, and a read at a tag cannot.
 */
export function versionRef(version: {
  tag: string;
  commitSha: string;
}): string {
  return isCommitRef(version.commitSha) ? version.commitSha : version.tag;
}
