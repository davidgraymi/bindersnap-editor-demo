/**
 * What happened while you were away, from Gitea's own notifications.
 *
 * **Gitea already keeps this.** Every time somebody asks you to review a
 * change, comments on one you are part of, or publishes one in a binder you
 * are in, Gitea writes a notification thread for you — with unread state, and
 * for every user. Keeping a table of our own would be a second, disagreeing
 * copy of a fact Gitea holds; ADR 0004 says use the primitive.
 *
 * What Gitea does not say is *why* — a thread is "something happened on pull
 * request 7". The reason is read off the change itself: asked of you, yours,
 * published, or closed. That is the difference between a bell nobody reads
 * and one that says "Priya is waiting on you".
 *
 * Pure. The Gitea calls happen in the request handler.
 */

import type { components } from "./gitea-client/spec/gitea";

type NotificationThread = components["schemas"]["NotificationThread"];
type PullRequest = components["schemas"]["PullRequest"];

export type NotificationReason =
  "review_requested" | "your_change" | "published" | "closed" | "activity";

export interface AppNotification {
  id: number;
  unread: boolean;
  org: string;
  binder: string;
  changeNumber: number;
  title: string;
  reason: NotificationReason;
  /** Who did the thing the reason names, when the change says. */
  actor: string | null;
  /** Their name as the product shows it; the login when they gave none. */
  actorName: string | null;
  updatedAt: string;
}

/** `https://…/api/v1/repos/{org}/{binder}/pulls/{n}` → its parts. */
export function readSubjectUrl(
  url: string | undefined,
): { org: string; binder: string; number: number } | null {
  const match = (url ?? "").match(
    /\/repos\/([^/]+)\/([^/]+)\/(?:pulls|issues)\/(\d+)(?:$|[/?#])/,
  );
  if (!match) return null;
  return {
    org: decodeURIComponent(match[1]!),
    binder: decodeURIComponent(match[2]!),
    number: Number(match[3]),
  };
}

export function reasonFor(
  pull: PullRequest | null,
  state: string | undefined,
  viewer: string,
): {
  reason: NotificationReason;
  actor: string | null;
  actorName: string | null;
} {
  const named = (
    user: { login?: string; full_name?: string } | null | undefined,
  ) => ({
    actor: user?.login ?? null,
    actorName: user?.login ? user.full_name?.trim() || user.login : null,
  });
  if (state === "merged" || pull?.merged) {
    return { reason: "published", ...named(pull?.merged_by) };
  }
  if (state === "closed" || pull?.state === "closed") {
    return { reason: "closed", actor: null, actorName: null };
  }
  const requested = (pull?.requested_reviewers ?? []).some(
    (user) => user.login === viewer,
  );
  if (requested) return { reason: "review_requested", ...named(pull?.user) };
  if (pull?.user?.login === viewer) {
    return { reason: "your_change", actor: null, actorName: null };
  }
  return { reason: "activity", ...named(pull?.user) };
}

/**
 * Gitea's threads as the app's notifications: change requests only — a
 * binder has no issues, and a thread about anything else has nowhere in the
 * product to go.
 */
export function toAppNotifications(
  threads: readonly NotificationThread[],
  pulls: ReadonlyMap<string, PullRequest | null>,
  viewer: string,
): AppNotification[] {
  const out: AppNotification[] = [];
  for (const thread of threads) {
    if (thread.subject?.type !== "Pull") continue;
    const subject = readSubjectUrl(thread.subject.url);
    if (!subject || thread.id === undefined) continue;
    const pull =
      pulls.get(pullKey(subject.org, subject.binder, subject.number)) ?? null;
    const { reason, actor, actorName } = reasonFor(
      pull,
      thread.subject.state,
      viewer,
    );
    out.push({
      id: thread.id,
      unread: thread.unread === true,
      org: subject.org,
      binder: subject.binder,
      changeNumber: subject.number,
      title: pull?.title ?? thread.subject.title ?? "",
      reason,
      actor,
      actorName,
      updatedAt: thread.updated_at ?? "",
    });
  }
  return out;
}

export function pullKey(org: string, binder: string, number: number): string {
  return `${org}/${binder}#${number}`;
}
