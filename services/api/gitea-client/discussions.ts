import type { components } from "./spec/gitea";

import { GiteaApiError, unwrap, type GiteaClient } from "./client";
import {
  listCommentReactions,
  setCommentReaction,
  type ThreadReaction,
} from "./reactions";

type Comment = components["schemas"]["Comment"];

/**
 * Threaded review discussions, stored entirely in Gitea.
 *
 * Gitea has no native "review thread" primitive: its pull review comments are
 * anchored to a file path and line number, which is meaningless for the file
 * vault (the reviewed artifact is usually a binary .docx or .pdf). So threads
 * are modelled on top of plain pull-request issue comments.
 *
 * Every comment carries a trailing HTML-comment marker that records which
 * thread it belongs to and what kind of event it is:
 *
 *   <!-- bindersnap:v1 kind=thread thread=<id> -->    thread root
 *   <!-- bindersnap:v1 kind=reply thread=<id> -->     reply in a thread
 *   <!-- bindersnap:v1 kind=resolve thread=<id> state=resolved -->
 *
 * The marker is invisible once Gitea renders the comment as markdown.
 *
 * Resolution is an **append-only event log**, not a mutation: resolving a
 * thread posts a new `kind=resolve` comment rather than editing the root.
 * Current state is derived by replaying that log in chronological order: a
 * resolve event settles the thread and any comment after it reopens the
 * thread, because a new question about a settled concern is exactly what
 * "unresolved" means. This is deliberate — an audit product must never lose
 * the history of who reopened a concern and when, and Gitea comment edits
 * would do exactly that.
 *
 * Comments without a marker (written directly in the Gitea UI, produced by a
 * review submission, or predating this feature) are surfaced as single-comment
 * threads keyed `c<id>` so nothing in the record is hidden — but they are
 * marked `origin: "external"` and deliberately do NOT count toward
 * `unresolvedCount`. Only threads Bindersnap created can gate publication.
 * Otherwise every "changes requested" review body would register as a
 * permanently unresolvable thread and wedge the document shut.
 */

const MARKER_PREFIX = "bindersnap:v1";
const MARKER_PATTERN = /<!--\s*bindersnap:v1\s+([^>]*?)\s*-->/g;

/** Any HTML comment mentioning our namespace, used to strip forged markers. */
const FORGED_MARKER_PATTERN = /<!--(?:(?!-->)[\s\S])*?bindersnap:[\s\S]*?-->/gi;

const THREAD_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export type DiscussionEventKind = "thread" | "reply" | "resolve";

export interface DiscussionAuthor {
  login: string;
  fullName: string;
  avatarUrl: string;
}

export interface DiscussionComment {
  id: number;
  threadId: string;
  author: DiscussionAuthor;
  body: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface DiscussionResolutionEvent {
  id: number;
  actor: DiscussionAuthor;
  resolved: boolean;
  at: string;
}

export type DiscussionOrigin = "bindersnap" | "external";

export interface DiscussionThread {
  id: string;
  /**
   * `bindersnap` threads were created through this API and can be resolved and
   * can gate publication. `external` threads came from Gitea directly and are
   * read-only here.
   */
  origin: DiscussionOrigin;
  comments: DiscussionComment[];
  events: DiscussionResolutionEvent[];
  /**
   * Reactions on the comment that opened the thread. Empty unless the caller
   * asked for them by naming a viewer — see `ListDiscussionsParams`.
   */
  reactions: ThreadReaction[];
  resolved: boolean;
  resolvedBy: DiscussionAuthor | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscussionSummary {
  threads: DiscussionThread[];
  totalCount: number;
  unresolvedCount: number;
}

export interface ListDiscussionsParams {
  client: GiteaClient;
  owner: string;
  repo: string;
  pullNumber: number;
  /**
   * Fetch each thread's reactions.
   *
   * Gitea returns reactions per comment rather than alongside the comment
   * list, so asking for them costs one extra round trip per thread. Callers
   * that only count threads or gate publishing never render a reaction, so
   * they leave this off and pay nothing.
   */
  withReactions?: boolean;
  /**
   * Who is reading, so their own chips come back marked. Empty for a signed
   * out visitor on a public document: they still see what everyone left, they
   * just have nothing of their own in it.
   */
  viewer?: string;
}

export interface CreateDiscussionThreadParams extends ListDiscussionsParams {
  body: string;
}

export interface ReplyToDiscussionParams extends ListDiscussionsParams {
  threadId: string;
  body: string;
}

export interface SetDiscussionResolutionParams extends ListDiscussionsParams {
  threadId: string;
  resolved: boolean;
}

export function isValidThreadId(value: string): boolean {
  return THREAD_ID_PATTERN.test(value);
}

/**
 * Remove any bindersnap marker a user typed into their own comment body.
 *
 * Without this, a reviewer could paste
 * `<!-- bindersnap:v1 kind=resolve thread=x state=resolved -->` into a comment
 * and silently resolve a thread they were not resolving — forging the record
 * that gates publication. User text never gets to carry our namespace.
 */
export function stripForgedMarkers(body: string): string {
  return body.replace(FORGED_MARKER_PATTERN, "").trimEnd();
}

function buildMarker(
  kind: DiscussionEventKind,
  threadId: string,
  extra?: Record<string, string>,
): string {
  const attrs = [`kind=${kind}`, `thread=${threadId}`];
  for (const [key, value] of Object.entries(extra ?? {})) {
    attrs.push(`${key}=${value}`);
  }
  return `<!-- ${MARKER_PREFIX} ${attrs.join(" ")} -->`;
}

function composeBody(
  body: string,
  kind: DiscussionEventKind,
  threadId: string,
  extra?: Record<string, string>,
): string {
  const safeBody = stripForgedMarkers(body).trim();
  const marker = buildMarker(kind, threadId, extra);
  return safeBody ? `${safeBody}\n\n${marker}` : marker;
}

interface ParsedMarker {
  kind: DiscussionEventKind;
  threadId: string;
  state?: string;
}

/**
 * Read the trailing bindersnap marker from a stored comment body.
 * Returns null for unmarked comments (legacy or Gitea-UI-authored).
 */
export function parseMarker(body: string): ParsedMarker | null {
  MARKER_PATTERN.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;

  // Take the final marker: composeBody always appends ours last, so a body
  // that somehow still contains an earlier marker cannot override it.
  while ((match = MARKER_PATTERN.exec(body)) !== null) {
    last = match;
  }

  if (!last?.[1]) {
    return null;
  }

  const attrs: Record<string, string> = {};
  for (const pair of last[1].trim().split(/\s+/)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    attrs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }

  const kind = attrs.kind;
  const threadId = attrs.thread;

  if (
    (kind !== "thread" && kind !== "reply" && kind !== "resolve") ||
    !threadId ||
    !isValidThreadId(threadId)
  ) {
    return null;
  }

  return { kind, threadId, state: attrs.state };
}

/** Remove every bindersnap marker so the body renders as the user wrote it. */
export function stripMarkers(body: string): string {
  return body.replace(MARKER_PATTERN, "").trimEnd();
}

function toAuthor(comment: Comment): DiscussionAuthor {
  const user = comment.user;
  return {
    login: user?.login ?? comment.original_author ?? "unknown",
    fullName: user?.full_name ?? "",
    avatarUrl: user?.avatar_url ?? "",
  };
}

function commentTimestamp(comment: Comment): string {
  return comment.created_at ?? "";
}

function chronological(left: Comment, right: Comment): number {
  const leftTime = Date.parse(commentTimestamp(left));
  const rightTime = Date.parse(commentTimestamp(right));

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
  }

  // Gitea comment ids are monotonic, so they break timestamp ties reliably.
  return (left.id ?? 0) - (right.id ?? 0);
}

/**
 * Fold a flat list of Gitea comments into resolved/unresolved threads.
 * Exported separately from the network call so the grouping rules can be
 * tested without a Gitea instance.
 */
export function buildThreads(comments: Comment[]): DiscussionThread[] {
  const ordered = [...comments].sort(chronological);
  const threads = new Map<string, DiscussionThread>();

  function ensureThread(
    id: string,
    origin: DiscussionOrigin,
    createdAt: string,
  ): DiscussionThread {
    let thread = threads.get(id);
    if (!thread) {
      thread = {
        id,
        origin,
        comments: [],
        events: [],
        reactions: [],
        resolved: false,
        resolvedBy: null,
        resolvedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      threads.set(id, thread);
    }
    return thread;
  }

  for (const comment of ordered) {
    if (comment.id === undefined) {
      continue;
    }

    const marker = parseMarker(comment.body ?? "");
    const createdAt = commentTimestamp(comment);

    // Unmarked comment: its own single-comment thread, keyed by comment id.
    const threadId = marker ? marker.threadId : `c${comment.id}`;
    const thread = ensureThread(
      threadId,
      marker ? "bindersnap" : "external",
      createdAt,
    );

    if (marker?.kind === "resolve") {
      const resolved = marker.state !== "open";
      const actor = toAuthor(comment);
      thread.events.push({ id: comment.id, actor, resolved, at: createdAt });
      thread.resolved = resolved;
      thread.resolvedBy = resolved ? actor : null;
      thread.resolvedAt = resolved ? createdAt : null;
      thread.updatedAt = createdAt || thread.updatedAt;
      continue;
    }

    thread.comments.push({
      id: comment.id,
      threadId,
      author: toAuthor(comment),
      body: stripMarkers(comment.body ?? ""),
      createdAt,
      updatedAt: comment.updated_at ?? createdAt,
      htmlUrl: comment.html_url ?? "",
    });
    // Saying something new about a settled concern unsettles it. Somebody had
    // to reopen the thread by hand before, which meant the common case — one
    // more question after "resolved" — sat under a green check nobody read.
    thread.resolved = false;
    thread.resolvedBy = null;
    thread.resolvedAt = null;
    thread.updatedAt = createdAt || thread.updatedAt;
  }

  // A thread with only resolve events and no comments is corrupt data; drop it
  // rather than render an empty conversation.
  return [...threads.values()]
    .filter((thread) => thread.comments.length > 0)
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        return leftTime - rightTime;
      }
      return 0;
    });
}

export function summarizeThreads(
  threads: DiscussionThread[],
): DiscussionSummary {
  const gating = threads.filter((thread) => thread.origin === "bindersnap");
  return {
    threads,
    totalCount: gating.length,
    unresolvedCount: gating.filter((thread) => !thread.resolved).length,
  };
}

/**
 * Gitea's issueGetComments returns every comment on the pull request in one
 * response — it exposes only `since`/`before` filters, not page/limit — so
 * there is no pagination loop to run here.
 */
async function listAllComments(
  client: GiteaClient,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<Comment[]> {
  return unwrap(
    client.GET("/repos/{owner}/{repo}/issues/{index}/comments", {
      params: { path: { owner, repo, index: pullNumber } },
    }),
  );
}

async function postComment(
  client: GiteaClient,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
): Promise<Comment> {
  return unwrap(
    client.POST("/repos/{owner}/{repo}/issues/{index}/comments", {
      params: { path: { owner, repo, index: pullNumber } },
      body: { body },
    }),
  );
}

/**
 * The comment a thread's reactions hang on: the one that opened it.
 *
 * Reacting per comment would mean a picker on every reply and one request per
 * comment to read them back. A thread is one conversation about one point, so
 * the reaction belongs to the point — which is the root comment.
 */
function rootCommentId(thread: DiscussionThread): number | null {
  return thread.comments[0]?.id ?? null;
}

/**
 * Fill in each thread's reactions, in parallel.
 *
 * A thread whose reactions cannot be read keeps its empty list rather than
 * failing the whole page: reactions are the least important thing on a review
 * screen, and losing the conversation because a chip would not load is a bad
 * trade.
 */
async function attachReactions(
  client: GiteaClient,
  owner: string,
  repo: string,
  threads: DiscussionThread[],
  viewer: string,
): Promise<void> {
  await Promise.all(
    threads.map(async (thread) => {
      const commentId = rootCommentId(thread);
      if (commentId === null) return;
      try {
        thread.reactions = await listCommentReactions({
          client,
          owner,
          repo,
          commentId,
          viewer,
        });
      } catch {
        thread.reactions = [];
      }
    }),
  );
}

export async function listDiscussions(
  params: ListDiscussionsParams,
): Promise<DiscussionSummary> {
  const { client, owner, repo, pullNumber, withReactions, viewer } = params;
  const comments = await listAllComments(client, owner, repo, pullNumber);
  const threads = buildThreads(comments);

  if (withReactions) {
    await attachReactions(client, owner, repo, threads, viewer ?? "");
  }

  return summarizeThreads(threads);
}

export async function createDiscussionThread(
  params: CreateDiscussionThreadParams,
): Promise<DiscussionSummary> {
  const { client, owner, repo, pullNumber, body } = params;

  if (stripForgedMarkers(body).trim() === "") {
    throw new GiteaApiError(0, "A comment body is required.");
  }

  const threadId = crypto.randomUUID();
  await postComment(
    client,
    owner,
    repo,
    pullNumber,
    composeBody(body, "thread", threadId),
  );

  return listDiscussions({
    client,
    owner,
    repo,
    pullNumber,
    withReactions: params.withReactions,
    viewer: params.viewer,
  });
}

export async function replyToDiscussion(
  params: ReplyToDiscussionParams,
): Promise<DiscussionSummary> {
  const { client, owner, repo, pullNumber, threadId, body } = params;

  if (!isValidThreadId(threadId)) {
    throw new GiteaApiError(0, "Invalid thread id.");
  }

  if (stripForgedMarkers(body).trim() === "") {
    throw new GiteaApiError(0, "A comment body is required.");
  }

  const existing = await listDiscussions({
    client,
    owner,
    repo,
    pullNumber,
    withReactions: params.withReactions,
    viewer: params.viewer,
  });
  const target = existing.threads.find(
    (thread) => thread.id === threadId && thread.origin === "bindersnap",
  );
  if (!target) {
    throw new GiteaApiError(404, "Thread not found on this version.");
  }

  await postComment(
    client,
    owner,
    repo,
    pullNumber,
    composeBody(body, "reply", threadId),
  );

  return listDiscussions({
    client,
    owner,
    repo,
    pullNumber,
    withReactions: params.withReactions,
    viewer: params.viewer,
  });
}

export async function setDiscussionResolution(
  params: SetDiscussionResolutionParams,
): Promise<DiscussionSummary> {
  const { client, owner, repo, pullNumber, threadId, resolved } = params;

  if (!isValidThreadId(threadId)) {
    throw new GiteaApiError(0, "Invalid thread id.");
  }

  const existing = await listDiscussions({
    client,
    owner,
    repo,
    pullNumber,
    withReactions: params.withReactions,
    viewer: params.viewer,
  });
  const thread = existing.threads.find(
    (candidate) => candidate.id === threadId,
  );
  if (!thread) {
    throw new GiteaApiError(404, "Thread not found on this version.");
  }

  // Comments that originated in Gitea have no thread marker to attach a
  // resolution event to, so they cannot be resolved from here.
  if (thread.origin !== "bindersnap") {
    throw new GiteaApiError(
      400,
      "This comment was not created in Bindersnap and cannot be resolved here.",
    );
  }

  // Posting a duplicate event would add noise to the audit log without
  // changing anything.
  if (thread.resolved === resolved) {
    return existing;
  }

  await postComment(
    client,
    owner,
    repo,
    pullNumber,
    composeBody("", "resolve", threadId, {
      state: resolved ? "resolved" : "open",
    }),
  );

  return listDiscussions({
    client,
    owner,
    repo,
    pullNumber,
    withReactions: params.withReactions,
    viewer: params.viewer,
  });
}

export interface SetDiscussionReactionParams extends ListDiscussionsParams {
  threadId: string;
  content: string;
  /** The state the reader wants, so a double click cannot race itself. */
  reacted: boolean;
}

/**
 * Leave or take back one reaction on a thread.
 *
 * Unlike resolving, this is allowed on `external` threads as well. The origin
 * distinction exists to decide what can gate publication, and a reaction never
 * gates anything — a comment written in Gitea is still a comment somebody can
 * agree with.
 */
export async function setDiscussionReaction(
  params: SetDiscussionReactionParams,
): Promise<DiscussionSummary> {
  const { client, owner, repo, pullNumber, threadId, content, reacted } =
    params;

  if (!isValidThreadId(threadId)) {
    throw new GiteaApiError(0, "Invalid thread id.");
  }

  const existing = await listDiscussions({
    client,
    owner,
    repo,
    pullNumber,
    withReactions: params.withReactions,
    viewer: params.viewer,
  });

  const thread = existing.threads.find(
    (candidate) => candidate.id === threadId,
  );
  if (!thread) {
    throw new GiteaApiError(404, "Thread not found on this version.");
  }

  const commentId = rootCommentId(thread);
  if (commentId === null) {
    throw new GiteaApiError(404, "Thread not found on this version.");
  }

  await setCommentReaction({
    client,
    owner,
    repo,
    commentId,
    content,
    reacted,
  });

  return listDiscussions({
    client,
    owner,
    repo,
    pullNumber,
    withReactions: params.withReactions,
    viewer: params.viewer,
  });
}
