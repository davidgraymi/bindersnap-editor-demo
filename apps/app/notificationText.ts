import type { AppNotification } from "./api";

/**
 * What a notification says, in a sentence a compliance manager would use.
 *
 * "Pull request #7 updated" is Gitea's sentence. The bell's job is to say
 * whose desk something is on, so the one that is on yours says so first.
 */
export function describeNotification(
  note: Pick<AppNotification, "reason" | "actor"> &
    Partial<Pick<AppNotification, "actorName">>,
  nameOf: (login: string) => string = (login) => login,
): string {
  const who = note.actorName ?? (note.actor ? nameOf(note.actor) : null);
  switch (note.reason) {
    case "review_requested":
      return who ? `${who} asked for your review` : "Waiting on your review";
    case "your_change":
      return "New activity on your change";
    case "published":
      return who ? `Published by ${who}` : "Published";
    case "closed":
      return "Closed without publishing";
    case "activity":
      return who ? `New activity on ${who}’s change` : "New activity";
  }
}
