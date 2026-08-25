import type { components } from "./spec/gitea";

import {
  GiteaApiError,
  toGiteaApiError,
  unwrap,
  type GiteaClient,
} from "./client";

type Reaction = components["schemas"]["Reaction"];

/**
 * Reactions on review comments, stored as Gitea comment reactions.
 *
 * Gitea already has a reaction primitive on issue comments, so a reaction is
 * one more thing that lives in Gitea rather than beside it — same rule as the
 * threads the reactions sit on.
 *
 * A reaction is deliberately NOT part of the approval record: it never counts
 * toward `unresolvedCount`, never gates publication, and never stands in for a
 * review. It exists so that four people who agree with a concern can say so
 * without posting four "+1" comments into a record an auditor has to read.
 *
 * The vocabulary is a short list, not Gitea's full emoji tray. A compliance
 * reviewer needs to say "I agree", "I don't", "this isn't clear", "I'm on it",
 * or "thank you" — a rocket means nothing on a contract, and every extra
 * option is one more thing to interpret two years later. Every key here is in
 * Gitea's default `ui.REACTIONS` allow-list, so no Gitea config change is
 * needed to accept them.
 */
export const REACTION_KINDS = [
  "+1",
  "-1",
  "confused",
  "eyes",
  "heart",
] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export function isSupportedReaction(value: string): value is ReactionKind {
  return (REACTION_KINDS as readonly string[]).includes(value);
}

export interface ReactionUser {
  login: string;
  fullName: string;
}

export interface CommentReaction {
  content: ReactionKind;
  count: number;
  /** Whether the person reading this page is one of the reactors. */
  viewerReacted: boolean;
  users: ReactionUser[];
}

export interface SetCommentReactionParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  commentId: number;
  content: string;
  /** True adds the reaction, false takes it back. */
  on: boolean;
}

const REACTIONS_PATH = "/repos/{owner}/{repo}/issues/comments/{id}/reactions";

/**
 * How many comments' reactions are fetched at once.
 *
 * Gitea has no bulk reaction read — reactions are not on the comment payload —
 * so a thread of N comments costs N requests. Threads are short, but a long
 * change with a long argument on it should not open sixty sockets at once.
 */
const READ_CONCURRENCY = 8;

function toReactionUser(reaction: Reaction): ReactionUser {
  const user = reaction.user;
  return {
    login: user?.login ?? "unknown",
    fullName: user?.full_name ?? "",
  };
}

/**
 * Fold Gitea's flat reaction list into one entry per reaction kind.
 *
 * Exported separately from the network call so the counting rules can be
 * tested without a Gitea instance. Reaction kinds outside our vocabulary are
 * dropped: somebody can still add a rocket from the Gitea UI, and we would
 * rather not render a control this app has no way to take back.
 */
export function summarizeReactions(
  reactions: Reaction[],
  viewerLogin: string | null,
): CommentReaction[] {
  const byContent = new Map<ReactionKind, CommentReaction>();

  for (const reaction of reactions) {
    const content = reaction.content ?? "";
    if (!isSupportedReaction(content)) continue;

    let entry = byContent.get(content);
    if (!entry) {
      entry = { content, count: 0, viewerReacted: false, users: [] };
      byContent.set(content, entry);
    }

    const user = toReactionUser(reaction);
    // Gitea allows one reaction of a kind per user, but a duplicated payload
    // must not double-count somebody into a number an auditor reads.
    if (entry.users.some((existing) => existing.login === user.login)) {
      continue;
    }

    entry.users.push(user);
    entry.count += 1;
    if (viewerLogin && user.login === viewerLogin) {
      entry.viewerReacted = true;
    }
  }

  // A stable order, so a chip never moves under the cursor when somebody else
  // reacts. Vocabulary order, not popularity.
  return REACTION_KINDS.map((kind) => byContent.get(kind)).filter(
    (entry): entry is CommentReaction => entry !== undefined,
  );
}

async function listOne(
  client: GiteaClient,
  owner: string,
  repo: string,
  commentId: number,
): Promise<Reaction[]> {
  return unwrap(
    client.GET(REACTIONS_PATH, {
      params: { path: { owner, repo, id: commentId } },
    }),
  );
}

/**
 * Reactions for a set of comments, keyed by comment id.
 *
 * A comment whose reactions cannot be read comes back with none rather than
 * failing the whole discussion: a reaction is a nicety, and losing the thread
 * because one emoji lookup 404'd would be a bad trade.
 */
export async function listCommentReactions(params: {
  client: GiteaClient;
  owner: string;
  repo: string;
  commentIds: number[];
  viewerLogin: string | null;
}): Promise<Map<number, CommentReaction[]>> {
  const { client, owner, repo, commentIds, viewerLogin } = params;
  const unique = [...new Set(commentIds)];
  const byComment = new Map<number, CommentReaction[]>();

  for (let index = 0; index < unique.length; index += READ_CONCURRENCY) {
    const batch = unique.slice(index, index + READ_CONCURRENCY);
    await Promise.all(
      batch.map(async (commentId) => {
        try {
          const raw = await listOne(client, owner, repo, commentId);
          byComment.set(commentId, summarizeReactions(raw ?? [], viewerLogin));
        } catch {
          byComment.set(commentId, []);
        }
      }),
    );
  }

  return byComment;
}

/** Add or take back one reaction on one comment. */
export async function setCommentReaction(
  params: SetCommentReactionParams,
): Promise<void> {
  const { client, owner, repo, commentId, content, on } = params;

  if (!isSupportedReaction(content)) {
    throw new GiteaApiError(400, "That is not a reaction you can leave here.");
  }

  const request = {
    params: { path: { owner, repo, id: commentId } },
    body: { content },
  };

  if (on) {
    await unwrap(client.POST(REACTIONS_PATH, request));
    return;
  }

  // Gitea answers a removed reaction with 204 and no body, which `unwrap`
  // reads as a failure — so this one checks the response itself.
  const { error, response } = await client.DELETE(REACTIONS_PATH, request);
  if (error !== undefined || !response.ok) {
    throw toGiteaApiError(response.status, error);
  }
}
