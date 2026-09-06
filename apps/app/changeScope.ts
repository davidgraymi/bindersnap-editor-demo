/**
 * Which repository a change lives in, and how to address it.
 *
 * ADR 0004 gave documents a second shape: one used to be a repository of its
 * own, and now it is a file inside a binder. A change request is identical in
 * both — it is a Gitea pull request either way — so the review screens are
 * one set of components, and this is the only thing that differs between them.
 *
 * Kept as data rather than a bag of callbacks because that is all it is: a
 * pair of names and, for a binder, which document inside it the change
 * carries. `api.ts` turns it into a URL; nothing else needs to know.
 */

export type ChangeScope =
  | { kind: "document"; owner: string; repo: string }
  | {
      kind: "binder";
      org: string;
      binder: string;
      /**
       * The document whose file this change proposes, by identity. Only the
       * file operations need it — a binder's discussions, reviewers and
       * updates belong to the change, not to any one document it touches.
       */
      documentPath: string;
    };

/** `alice/contract`, or `riverside-health/clinical`. */
export function scopeRepo(scope: ChangeScope): { owner: string; repo: string } {
  return scope.kind === "binder"
    ? { owner: scope.org, repo: scope.binder }
    : { owner: scope.owner, repo: scope.repo };
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
  return scope.kind === "binder"
    ? `/api/app/binders/${scope.org}/${scope.binder}/changes/${pullNumber}`
    : `/api/app/documents/${scope.owner}/${scope.repo}/pull-requests/${pullNumber}`;
}

/** A stable key for effect dependencies, so a scope object can be inline. */
export function scopeKey(scope: ChangeScope): string {
  const { owner, repo } = scopeRepo(scope);
  return scope.kind === "binder"
    ? `binder:${owner}/${repo}:${scope.documentPath}`
    : `document:${owner}/${repo}`;
}
