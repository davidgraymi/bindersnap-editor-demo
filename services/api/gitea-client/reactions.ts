import type { components } from "./spec/gitea";

import {
  GiteaApiError,
  toGiteaApiError,
  unwrap,
  type GiteaClient,
} from "./client";

type Reaction = components["schemas"]["Reaction"];

/**
 * Reactions on a review thread, stored entirely in Gitea.
 *
 * A thread is a run of pull-request issue comments tied together by a marker
 * (see `discussions.ts`). Gitea already reacts to issue comments natively, so a
 * reaction on a thread is a reaction on the comment that opened it — no new
 * storage, no marker, no shadow state. That keeps the rule the rest of the
 * product follows: Gitea holds the record, and the record is the same whether
 * you read it here or in Gitea.
 *
 * Reactions deliberately do NOT gate publication. An unresolved thread blocks a
 * version because somebody raised a concern in words; a thumbs-down is a
 * feeling, and a feeling should never be the reason a document cannot ship.
 */

/**
 * What Bindersnap offers in the picker.
 *
 * Six, each with a job in a review: agreement, disagreement, "I'm on it",
 * thanks, praise, and "I don't follow". All six are in Gitea's default
 * `ALLOWED_REACTIONS` set, so an out-of-the-box Gitea accepts every one.
 */
export const REACTION_KINDS = [
  "+1",
  "-1",
  "eyes",
  "heart",
  "hooray",
  "confused",
] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export function isReactionKind(value: string): value is ReactionKind {
  return (REACTION_KINDS as readonly string[]).includes(value);
}

export interface ThreadReaction {
  /**
   * Gitea's reaction name. Usually one of `REACTION_KINDS`, but anything the
   * Gitea instance allows can appear here — see `groupReactions`.
   */
  content: string;
  count: number;
  /** Everyone who reacted, in the order Gitea returned them. */
  users: string[];
  /** Whether the person reading the page is one of them. */
  reactedByViewer: boolean;
}

function sameLogin(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Fold Gitea's flat reaction list into one entry per emoji.
 *
 * Reactions Bindersnap does not offer are kept rather than dropped. Somebody
 * may have reacted from the Gitea UI on an instance with a wider
 * `ALLOWED_REACTIONS`, and silently hiding part of a comment's record would
 * contradict the whole point of the product — the picker stays at six, but
 * what is already there is shown.
 *
 * The order is fixed: the six offered kinds in their canonical order, then
 * anything else alphabetically. Sorting by count instead would make chips swap
 * places under the reader's cursor as votes come in.
 */
export function groupReactions(
  reactions: Reaction[],
  viewer: string,
): ThreadReaction[] {
  const groups = new Map<string, ThreadReaction>();

  for (const reaction of reactions) {
    const content = reaction.content?.trim();
    if (!content) continue;

    const login = reaction.user?.login?.trim();
    if (!login) continue;

    let group = groups.get(content);
    if (!group) {
      group = { content, count: 0, users: [], reactedByViewer: false };
      groups.set(content, group);
    }

    // Gitea allows one reaction of a kind per user, but a duplicate in the
    // payload would otherwise inflate the count and read as two people.
    if (group.users.some((existing) => sameLogin(existing, login))) continue;

    group.users.push(login);
    group.count += 1;
    if (viewer && sameLogin(login, viewer)) {
      group.reactedByViewer = true;
    }
  }

  return [...groups.values()].sort((left, right) => {
    const leftRank = REACTION_KINDS.indexOf(left.content as ReactionKind);
    const rightRank = REACTION_KINDS.indexOf(right.content as ReactionKind);
    const leftOrder = leftRank === -1 ? REACTION_KINDS.length : leftRank;
    const rightOrder = rightRank === -1 ? REACTION_KINDS.length : rightRank;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.content.localeCompare(right.content);
  });
}

export interface CommentReactionParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  commentId: number;
}

export interface ListCommentReactionsParams extends CommentReactionParams {
  /** The reading user's login, so the chips know which ones are theirs. */
  viewer: string;
}

export async function listCommentReactions(
  params: ListCommentReactionsParams,
): Promise<ThreadReaction[]> {
  const { client, owner, repo, commentId, viewer } = params;

  const reactions = await unwrap(
    client.GET("/repos/{owner}/{repo}/issues/comments/{id}/reactions", {
      params: { path: { owner, repo, id: commentId } },
    }),
  );

  return groupReactions(reactions ?? [], viewer);
}

export interface SetCommentReactionParams extends CommentReactionParams {
  content: string;
  /** The state the reader wants, not a flip — see `setCommentReaction`. */
  reacted: boolean;
}

/**
 * Add or remove one reaction for the calling user.
 *
 * The caller states the intended end state rather than asking for a toggle.
 * Two quick clicks against a toggle race each other and land on whichever
 * order the server saw; an explicit `reacted` is idempotent, so the worst a
 * double click can do is ask for something that is already true.
 */
export async function setCommentReaction(
  params: SetCommentReactionParams,
): Promise<void> {
  const { client, owner, repo, commentId, content, reacted } = params;

  if (!isReactionKind(content)) {
    throw new GiteaApiError(400, "That is not a reaction you can leave here.");
  }

  const path = "/repos/{owner}/{repo}/issues/comments/{id}/reactions" as const;
  const options = {
    params: { path: { owner, repo, id: commentId } },
    body: { content },
  };

  // Neither call's body is needed — the thread is re-read afterwards — and
  // Gitea answers the delete with an empty 204, which `unwrap` would read as a
  // missing payload. So both are checked on the response itself.
  const { error, response } = reacted
    ? await client.POST(path, options)
    : await client.DELETE(path, options);

  // Asking for a reaction that is already there, or removing one that was
  // never there, is the state the caller wanted; Gitea says 200 and means it.
  if (error !== undefined || !response.ok) {
    throw toGiteaApiError(response.status, error);
  }
}
