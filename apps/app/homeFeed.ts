import type { HomeFeedPayload } from "./api";
import { formatDocumentName } from "./documentDisplay";

/**
 * Home's feed, said the way the product says things.
 *
 * Home was a second list of change requests, beside the page that lists them.
 * It is now what has been happening in your binders: who opened, approved,
 * sent back, discussed, published or closed what, newest first, a day at a
 * time — GitHub's dashboard, for a policy manual. The work waiting on you has
 * its own page, and Home points to it.
 *
 * Pure, so the wording is decided in one place and tested without rendering.
 */

export type FeedEvent = HomeFeedPayload["events"][number];

/** "approved", "asked for changes on" — what the actor did, before the subject. */
const VERBS: Record<FeedEvent["kind"], string> = {
  opened: "opened",
  approved: "approved",
  changes_requested: "asked for changes on",
  commented: "commented on",
  started_discussion: "started a discussion on",
  replied: "replied on",
  resolved: "resolved a discussion on",
  reopened_discussion: "reopened a discussion on",
  published: "published",
  closed: "closed",
  reopened: "reopened",
  binder_created: "made the binder",
};

/** The tone of the mark beside an event: what kind of thing happened. */
export type FeedTone = "decision" | "blocked" | "talk" | "neutral";

const TONES: Record<FeedEvent["kind"], FeedTone> = {
  opened: "neutral",
  approved: "decision",
  changes_requested: "blocked",
  commented: "talk",
  started_discussion: "talk",
  replied: "talk",
  resolved: "talk",
  reopened_discussion: "talk",
  published: "decision",
  closed: "neutral",
  reopened: "neutral",
  binder_created: "neutral",
};

export interface FeedLine {
  /** Who, as the product names them. */
  actor: string;
  /** What they did. */
  verb: string;
  /** What they did it to: the change's title, or the binder's name. */
  subject: string;
  /** Which binder it is in, when the subject is not the binder itself. */
  binder: string | null;
  tone: FeedTone;
}

/** One event as a sentence: *Carol Mendes* approved *Retire the 2019 terms* in Corporate. */
export function describeFeedEvent(event: FeedEvent): FeedLine {
  const binder = formatDocumentName(event.binder);
  if (event.kind === "binder_created") {
    return {
      actor: event.actorName,
      verb: VERBS.binder_created,
      subject: binder,
      binder: null,
      tone: TONES.binder_created,
    };
  }
  return {
    actor: event.actorName,
    verb: VERBS[event.kind],
    // A change whose title could not be read is still a change, by number.
    subject: event.title?.trim() || `change ${event.changeNumber ?? ""}`.trim(),
    binder,
    tone: TONES[event.kind],
  };
}

export interface FeedDay {
  /** "Today", "Yesterday", "Tuesday", or "12 October". */
  label: string;
  events: FeedEvent[];
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Which day an event is filed under, said as somebody would say it. */
export function feedDayLabel(
  timestamp: string,
  now: number = Date.now(),
): string {
  const at = new Date(timestamp).getTime();
  if (Number.isNaN(at)) return "Earlier";
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) {
    return new Date(at).toLocaleDateString("en-US", { weekday: "long" });
  }
  return new Date(at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(new Date(at).getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/** Events a day at a time, newest day first, in the order they came. */
export function groupFeedByDay(
  events: readonly FeedEvent[],
  now: number = Date.now(),
): FeedDay[] {
  const days: FeedDay[] = [];
  for (const event of events) {
    const label = feedDayLabel(event.createdAt, now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.events.push(event);
    else days.push({ label, events: [event] });
  }
  return days;
}

/** The time of day an event happened, beside it in its day. */
export function feedTime(timestamp: string): string {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * One change's day, as one row.
 *
 * A change under discussion made a day of Home eight rows long — started a
 * discussion, replied, replied, resolved — and the one event somebody opens
 * Home to learn, that it was approved or published, was the ninth. A day now
 * says each change once: the event that matters most, and how many others
 * there were. The change's own page has every one of them, in order.
 */
export interface FeedGroup {
  /** The event the row is written from. */
  lead: FeedEvent;
  /** How many other events the same change had that day. */
  others: number;
}

/** What a day's row for a change leads with: a decision before talk. */
const WEIGHT: Record<FeedEvent["kind"], number> = {
  published: 5,
  closed: 5,
  reopened: 4,
  approved: 4,
  changes_requested: 4,
  opened: 3,
  binder_created: 3,
  started_discussion: 1,
  reopened_discussion: 1,
  resolved: 1,
  commented: 1,
  replied: 1,
};

/** A day's events, one row per change, in the order each last moved. */
export function foldFeedDay(events: readonly FeedEvent[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  const byChange = new Map<string, FeedGroup>();
  for (const event of events) {
    if (event.changeNumber === null) {
      groups.push({ lead: event, others: 0 });
      continue;
    }
    const key = `${event.org}/${event.binder}#${event.changeNumber}`;
    const group = byChange.get(key);
    if (!group) {
      const made = { lead: event, others: 0 };
      byChange.set(key, made);
      groups.push(made);
      continue;
    }
    group.others += 1;
    // Events arrive newest first, so a tie keeps the later one.
    if (WEIGHT[event.kind] > WEIGHT[group.lead.kind]) group.lead = event;
  }
  return groups;
}

/** "and 3 earlier updates" — what else a change did that day. */
export function describeOthers(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "and 1 other update" : `and ${count} other updates`;
}
