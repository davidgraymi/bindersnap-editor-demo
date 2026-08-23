import type { DocumentVersionRecord } from "./api";
import {
  capitalizeFirst,
  formatShortDate,
  formatTimestamp,
  parseChangeTitle,
} from "./documentDisplay";
import { routeToPath } from "./routes";

/**
 * The History tab, decided here.
 *
 * History is a spline of published versions, and every one of them came from a
 * change somebody reviewed. What a knot on that spline reads — the change's
 * own title, who wrote it, who published it, when — is a set of decisions, so
 * they are made in one place and tested without a browser. The component only
 * draws the rail.
 */

/** One person named on the spline. */
export interface HistoryPerson {
  /** "Maya" — a login, made presentable. */
  name: string;
  /** What the avatar and the tint key off. */
  login: string;
}

function toPerson(login: string | null | undefined): HistoryPerson | null {
  const trimmed = (login ?? "").trim();
  if (!trimmed) return null;
  return { name: capitalizeFirst(trimmed), login: trimmed };
}

/** One published version, as the spline states it. */
export interface HistoryEntry {
  key: string;
  version: number;
  tagName: string;
  /** "v3". */
  label: string;
  /**
   * What the change review that produced this version was called. Falls back
   * to the version itself when no submission record survived.
   */
  title: string;
  /** The change this version came from, or null when the record is gone. */
  changeNumber: number | null;
  /** Where the title points. Null when there is no change to point at. */
  changeHref: string | null;
  /** Who submitted the change. */
  author: HistoryPerson | null;
  /** Who published it. Often, but not always, someone else. */
  publisher: HistoryPerson | null;
  /** The raw stamp, for the `datetime` attribute. */
  createdAt: string;
  /** "Jan 12, 2026". */
  publishedOn: string;
  /** The full stamp, for the title attribute. */
  publishedAt: string;
  /** "3 comments", or null when the change drew none. */
  comments: string | null;
}

export function buildHistoryEntries(
  versions: DocumentVersionRecord[],
  owner: string,
  repo: string,
): HistoryEntry[] {
  return versions.map((entry) => {
    const submission = entry.submission;
    const changeNumber = submission?.number ?? null;

    return {
      key: entry.tagName,
      version: entry.version,
      tagName: entry.tagName,
      label: `v${entry.version}`,
      title: submission
        ? parseChangeTitle(submission.body, submission.submittedBy)
        : `Version ${entry.version}`,
      changeNumber,
      changeHref:
        changeNumber === null
          ? null
          : routeToPath({
              kind: "document",
              owner,
              repo,
              tab: "changes",
              changeNumber,
            }),
      author: toPerson(submission?.submittedBy),
      publisher: toPerson(submission?.mergedBy),
      createdAt: entry.createdAt,
      publishedOn: formatShortDate(entry.createdAt) || "Unknown",
      publishedAt: formatTimestamp(entry.createdAt) || "Unknown",
      comments:
        entry.discussionCount > 0
          ? `${entry.discussionCount} comment${
              entry.discussionCount === 1 ? "" : "s"
            }`
          : null,
    };
  });
}
