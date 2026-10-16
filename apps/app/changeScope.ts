/**
 * Which binder a change lives in, and which document inside it the change's
 * file operations are about.
 *
 * **This used to be a two-variant union**, because ADR 0004 gave documents a
 * second shape: one used to be a repository of its own, and became a file
 * inside a binder. A change request is identical in both — it is a Gitea pull
 * request either way — so the review screens stayed one set of components and
 * this was the only thing that differed between them.
 *
 * The old shape is gone, so the seam has collapsed to the one that remains. It
 * is kept as a named type rather than three loose props because five components
 * and a dozen `api.ts` functions pass it around whole, and because the comment
 * about `documentPath` below is worth having somewhere.
 */

export interface ChangeScope {
  org: string;
  binder: string;
  /**
   * The document whose file this change proposes, by identity.
   *
   * Only the file operations need it — a change's discussions, reviewers and
   * updates belong to the change, not to any one document it touches, and a
   * change may touch several. Empty for a change that is about no document at
   * all, which is what a sign-off rules change is.
   */
  documentPath: string;
}

/** `riverside-health/clinical`, as Gitea addresses the repository. */
export function scopeRepo(scope: ChangeScope): { owner: string; repo: string } {
  return { owner: scope.org, repo: scope.binder };
}

/**
 * The API path a change's operations hang off.
 *
 * Only used to decide whether a 402 is the paywall talking — the generated
 * client builds the real URLs — but it has to name the route that was actually
 * called, or a delinquent organization gets a raw error instead of the banner.
 */
export function scopeChangeBase(
  scope: ChangeScope,
  pullNumber: number,
): string {
  return `/api/app/binders/${scope.org}/${scope.binder}/changes/${pullNumber}`;
}

/** A stable key for effect dependencies, so a scope object can be inline. */
export function scopeKey(scope: ChangeScope): string {
  return `${scope.org}/${scope.binder}:${scope.documentPath}`;
}
