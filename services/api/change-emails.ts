import type { EmailContent } from "./mail/layout";
import type { EmailTopic } from "./email-preferences";

/**
 * What Bindersnap emails about a change, and to whom (issue #665).
 *
 * Four moments, each one somebody is waiting on: a review asked of you, work
 * asked of you, your change ready to publish, and a change you were part of
 * published. Pure: the server reads Gitea and calls these.
 */

export type ChangeEmailEvent =
  | { kind: "review-requested"; reviewers: string[] }
  | { kind: "changes-requested"; comment: string }
  | { kind: "ready-to-publish" }
  | { kind: "published"; participants: string[] };

export const TOPIC_OF: Record<ChangeEmailEvent["kind"], EmailTopic> = {
  "review-requested": "reviewRequested",
  "changes-requested": "changesRequested",
  "ready-to-publish": "readyToPublish",
  published: "published",
};

export interface ChangeFacts {
  owner: string;
  repo: string;
  number: number;
  title: string;
  /** Who opened the change. */
  author: string;
  /** Who did the thing this email is about. */
  actor: string;
  actorName: string;
}

function same(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Who hears about it. Never the person who did it. */
export function recipientsFor(
  event: ChangeEmailEvent,
  facts: Pick<ChangeFacts, "author" | "actor">,
): string[] {
  const people =
    event.kind === "review-requested"
      ? event.reviewers
      : event.kind === "published"
        ? [facts.author, ...event.participants]
        : [facts.author];
  const seen: string[] = [];
  for (const person of people) {
    if (!person || same(person, facts.actor)) continue;
    if (seen.some((other) => same(other, person))) continue;
    seen.push(person);
  }
  return seen;
}

export function changeUrl(
  appOrigin: string,
  facts: Pick<ChangeFacts, "owner" | "repo" | "number">,
): string {
  return `${appOrigin.replace(/\/+$/, "")}/${encodeURIComponent(facts.owner)}/${encodeURIComponent(facts.repo)}/-/changes/${facts.number}`;
}

/** At most this much of a reviewer's comment goes in the email. */
const COMMENT_PREVIEW = 600;

export function changeEmail(
  event: ChangeEmailEvent,
  facts: ChangeFacts,
  link: string,
): Omit<EmailContent, "optOut"> {
  const binder = `${facts.owner}/${facts.repo}`;
  const change = `“${facts.title}”`;
  switch (event.kind) {
    case "review-requested":
      return {
        subject: `Review requested: ${facts.title}`,
        preview: `${facts.actorName} asked you to review a change in ${binder}.`,
        heading: `${facts.actorName} asked you to review a change`,
        paragraphs: [
          `${change} in ${binder} is waiting for your review. Approve it, or ask for changes and say what needs to change.`,
        ],
        action: { label: "Review the change", url: link },
      };
    case "changes-requested": {
      const comment =
        event.comment.length > COMMENT_PREVIEW
          ? `${event.comment.slice(0, COMMENT_PREVIEW).trimEnd()}…`
          : event.comment;
      return {
        subject: `Changes requested: ${facts.title}`,
        preview: `${facts.actorName} asked for changes before approving.`,
        heading: `${facts.actorName} asked for changes`,
        paragraphs: [
          `${facts.actorName} reviewed ${change} in ${binder} and asked for changes before it can be approved.`,
          ...(comment ? [`“${comment}”`] : []),
        ],
        action: { label: "Open the change", url: link },
      };
    }
    case "ready-to-publish":
      return {
        subject: `Ready to publish: ${facts.title}`,
        preview: "It has the approvals it needs.",
        heading: "Your change is ready to publish",
        paragraphs: [
          `${change} in ${binder} has the approvals it needs. Publishing it puts the new version on the record.`,
        ],
        action: { label: "Publish the change", url: link },
      };
    case "published":
      return {
        subject: `Published: ${facts.title}`,
        preview: `${facts.actorName} published it to ${binder}.`,
        heading: "A change you were part of is published",
        paragraphs: [
          `${facts.actorName} published ${change} in ${binder}. Its new version is now the one on the record.`,
        ],
        action: { label: "See what changed", url: link },
      };
  }
}

/** One email per person per event, however often the event is reported. */
export function changeEmailKey(
  event: ChangeEmailEvent,
  facts: Pick<ChangeFacts, "owner" | "repo" | "number">,
  recipient: string,
  discriminator: string,
): string {
  return [
    "change",
    event.kind,
    `${facts.owner}/${facts.repo}#${facts.number}`,
    recipient.toLowerCase(),
    discriminator,
  ].join(":");
}

export const OPT_OUT_REASON: Record<EmailTopic, string> = {
  reviewRequested: "You get this because you were asked to review.",
  changesRequested: "You get this because you opened this change.",
  readyToPublish: "You get this because you opened this change.",
  published: "You get this because you were part of this change.",
};
