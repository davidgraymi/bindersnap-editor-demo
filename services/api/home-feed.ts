/**
 * What has been happening in your binders, for Home, from Gitea's own feed.
 *
 * **Gitea already keeps this.** Every action in a repository is written to the
 * activity feed of each person who can see it — the dashboard Gitea's own home
 * page draws. Keeping a table of our own would be a second, disagreeing copy
 * of a fact Gitea holds; ADR 0004 says use the primitive.
 *
 * What Gitea's feed says is a code host's: commits to branches, tags pushed,
 * branches deleted, and every approval twice (once as a review, once as the
 * comment the review carries). This keeps what a person reading Home cares
 * about — a change opened, approved, sent back, discussed, published or
 * closed, and a binder made — and says each the way the product does.
 *
 * Pure. The Gitea calls happen in the request handler.
 */

import { parseMarker, stripMarkers } from "./gitea-client/discussions";
import type { components } from "./gitea-client/spec/gitea";

type Activity = components["schemas"]["Activity"];

export type FeedEventKind =
  | "opened"
  | "approved"
  | "changes_requested"
  | "commented"
  | "started_discussion"
  | "replied"
  | "resolved"
  | "reopened_discussion"
  | "published"
  | "closed"
  | "reopened"
  | "binder_created";

export interface FeedEvent {
  id: number;
  kind: FeedEventKind;
  actor: string;
  /** Their name as the product shows it; the login when they gave none. */
  actorName: string;
  org: string;
  binder: string;
  /** The change it happened on; null for a binder being made. */
  changeNumber: number | null;
  /** What the change is called, when it is known. */
  title: string | null;
  /** What they wrote, markers removed, cut to a line or two. */
  excerpt: string | null;
  createdAt: string;
}

/** How much of a comment the feed shows. The change holds the rest. */
const EXCERPT_LENGTH = 240;

const PULL_KINDS: Partial<Record<string, FeedEventKind>> = {
  create_pull_request: "opened",
  approve_pull_request: "approved",
  reject_pull_request: "changes_requested",
  comment_pull: "commented",
  merge_pull_request: "published",
  close_pull_request: "closed",
  reopen_pull_request: "reopened",
};

/** `"19|Some text"` — Gitea's content for an action on pull request 19. */
function splitContent(content: string): {
  number: number | null;
  text: string;
} {
  const bar = content.indexOf("|");
  if (bar <= 0) return { number: null, text: content };
  const number = Number(content.slice(0, bar));
  return Number.isInteger(number) && number > 0
    ? { number, text: content.slice(bar + 1) }
    : { number: null, text: content };
}

function excerptOf(text: string): string | null {
  const plain = stripMarkers(text).replace(/\s+/g, " ").trim();
  if (plain === "") return null;
  return plain.length > EXCERPT_LENGTH
    ? `${plain.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
    : plain;
}

/** A comment's kind, from the marker a discussion leaves on it. */
function commentKind(body: string): FeedEventKind {
  const marker = parseMarker(body);
  if (!marker) return "commented";
  if (marker.kind === "thread") return "started_discussion";
  if (marker.kind === "reply") return "replied";
  return marker.state === "resolved" ? "resolved" : "reopened_discussion";
}

/**
 * Gitea's feed, as Home's.
 *
 * `organizations` is the reader's organizations: a repository anywhere else —
 * a personal one, made by a test or by hand in Gitea — is not a binder.
 * `titles` names each change by `org/binder#number`, read by the handler for
 * the changes whose actions do not carry their title.
 */
export function toFeedEvents(
  activities: readonly Activity[],
  organizations: ReadonlySet<string>,
  titles: ReadonlyMap<string, string> = new Map(),
): FeedEvent[] {
  // An approval or a request for changes is written twice — as the review
  // and as the comment the review carries. The review is the event.
  const reviews = new Set<string>();
  for (const activity of activities) {
    if (
      activity.op_type === "approve_pull_request" ||
      activity.op_type === "reject_pull_request"
    ) {
      reviews.add(
        `${activity.repo_id}|${activity.act_user_id}|${activity.content}`,
      );
    }
  }

  const events: FeedEvent[] = [];
  for (const activity of activities) {
    const org = activity.repo?.owner?.login ?? "";
    const binder = activity.repo?.name ?? "";
    if (!org || !binder || !organizations.has(org)) continue;

    const actor = activity.act_user?.login ?? "";
    const actorName = activity.act_user?.full_name?.trim() || actor;
    const base = {
      id: activity.id ?? 0,
      actor,
      actorName,
      org,
      binder,
      createdAt: activity.created ?? "",
    };

    if (activity.op_type === "create_repo") {
      events.push({
        ...base,
        kind: "binder_created",
        changeNumber: null,
        title: null,
        excerpt: null,
      });
      continue;
    }

    const kind = PULL_KINDS[activity.op_type ?? ""];
    if (!kind) continue;

    const content = activity.content ?? "";
    const { number, text } = splitContent(content);
    if (number === null) continue;

    if (
      kind === "commented" &&
      reviews.has(`${activity.repo_id}|${activity.act_user_id}|${content}`)
    ) {
      continue;
    }

    const body = activity.comment?.body ?? text;
    const resolvedKind = kind === "commented" ? commentKind(body) : kind;
    // Opening, publishing and closing carry the change's title as their text;
    // everything else carries what the person wrote.
    const titled =
      kind === "opened" || kind === "published" || kind === "closed";
    events.push({
      ...base,
      kind: resolvedKind,
      changeNumber: number,
      title: titled ? text : (titles.get(`${org}/${binder}#${number}`) ?? null),
      excerpt:
        titled ||
        resolvedKind === "resolved" ||
        resolvedKind === "reopened_discussion"
          ? null
          : excerptOf(body),
    });
  }
  // Gitea sometimes writes one act twice — a comment that is also a review's
  // body, say — so the same sentence back to back is said once.
  return events.filter((event, index) => {
    const previous = events[index - 1];
    return !(
      previous &&
      previous.kind === event.kind &&
      previous.actor === event.actor &&
      previous.org === event.org &&
      previous.binder === event.binder &&
      previous.changeNumber === event.changeNumber &&
      previous.excerpt === event.excerpt
    );
  });
}

/**
 * The changes whose titles the feed needs read, as `org/binder#number`.
 *
 * Only those whose actions do not carry it. The handler reads each once.
 */
export function changesNeedingTitles(
  activities: readonly Activity[],
  organizations: ReadonlySet<string>,
): Array<{ org: string; binder: string; number: number }> {
  const needed = new Map<
    string,
    { org: string; binder: string; number: number }
  >();
  for (const activity of activities) {
    const org = activity.repo?.owner?.login ?? "";
    const binder = activity.repo?.name ?? "";
    if (!organizations.has(org)) continue;
    const kind = PULL_KINDS[activity.op_type ?? ""];
    if (
      !kind ||
      kind === "opened" ||
      kind === "published" ||
      kind === "closed"
    ) {
      continue;
    }
    const { number } = splitContent(activity.content ?? "");
    if (number === null) continue;
    needed.set(`${org}/${binder}#${number}`, { org, binder, number });
  }
  return [...needed.values()];
}
