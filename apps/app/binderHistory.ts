import type { WorkspaceHistoryEntry } from "../../packages/api-schema/schemas/workspaces";

/**
 * A binder's history, grouped the way it actually happened.
 *
 * **The version number was the wrong knot, and it was misleading.** Five
 * entries reading `v1 · v1 · v1 · v2 · v1` look like a sequence and are five
 * unrelated documents' first versions. Nothing counts up, because a version
 * belongs to a document and this timeline belongs to a binder.
 *
 * What does count up on a binder's timeline is the change request, so that is
 * what the spine is made of, and what each change did — the versions it
 * published, the policies it archived — sits inside its entry. A change
 * publishing three cross-referencing policies onto one merge commit is the
 * feature ADR 0004 exists for, and this is the first screen that can draw it.
 *
 * **Both histories come out of this one structure**: the binder's is the whole
 * spine, and a document's is the same spine filtered to the changes that wrote
 * a version of it — where the versions then do read as the sequence they are,
 * because they are one document's.
 */

export interface HistoryChange {
  /** The change's number, or null for a tag written outside Bindersnap. */
  changeNumber: number | null;
  title: string;
  submittedBy: string;
  /** Everyone whose approval stood when it was published. */
  approvers: string[];
  /** When the change was merged. */
  publishedAt: string;
  /** What it did, one row per document. */
  rows: WorkspaceHistoryEntry[];
}

/**
 * The spine: one entry per change, newest first.
 *
 * A tag with no surviving change is its own entry rather than being dropped or
 * lumped in with others — a binder is a git repository and somebody may tag it
 * by hand, which is a fact about the record, not a fault to hide.
 */
export function groupHistoryByChange(
  entries: readonly WorkspaceHistoryEntry[],
): HistoryChange[] {
  const byChange = new Map<string, HistoryChange>();

  for (const entry of entries) {
    const key =
      entry.changeNumber === null
        ? `tag:${entry.tag}`
        : `change:${entry.changeNumber}`;

    const existing = byChange.get(key);
    if (existing) {
      existing.rows.push(entry);
      // The earliest date the change's tags carry. They are written in one
      // pass, so any difference is Gitea's clock rather than the record's.
      if (
        entry.publishedAt !== "" &&
        (existing.publishedAt === "" ||
          entry.publishedAt < existing.publishedAt)
      ) {
        existing.publishedAt = entry.publishedAt;
      }
      continue;
    }

    byChange.set(key, {
      changeNumber: entry.changeNumber,
      title: entry.changeTitle,
      submittedBy: entry.submittedBy,
      approvers: entry.approvers,
      publishedAt: entry.publishedAt,
      rows: [entry],
    });
  }

  const changes = [...byChange.values()];
  for (const change of changes) {
    // Versions before archivings, then by address: a change that published two
    // policies should list them in the same order every time it is read.
    change.rows.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "version" ? -1 : 1;
      return left.slugPath.localeCompare(right.slugPath);
    });
  }

  return changes.sort((left, right) => {
    if (left.publishedAt !== right.publishedAt) {
      return right.publishedAt.localeCompare(left.publishedAt);
    }
    return (right.changeNumber ?? 0) - (left.changeNumber ?? 0);
  });
}

/** Every policy this binder's history mentions, for the picker. */
export function historyPolicies(
  entries: readonly WorkspaceHistoryEntry[],
): Array<{ slugPath: string; name: string; folder: string }> {
  const byPath = new Map<
    string,
    { slugPath: string; name: string; folder: string }
  >();
  for (const entry of entries) {
    if (!byPath.has(entry.slugPath)) {
      byPath.set(entry.slugPath, {
        slugPath: entry.slugPath,
        name: entry.name,
        folder: entry.folder,
      });
    }
  }
  return [...byPath.values()].sort((left, right) =>
    left.slugPath.localeCompare(right.slugPath),
  );
}

/** How far back the spine reaches. */
export type HistorySince = "all" | "year" | "90days";

export const HISTORY_RANGES: Array<{ value: HistorySince; label: string }> = [
  { value: "all", label: "All time" },
  { value: "year", label: "The last year" },
  { value: "90days", label: "The last 90 days" },
];

/**
 * The spine, narrowed to one policy and to a stretch of time.
 *
 * **Filtered by change, not by row.** Picking a policy asks "what happened to
 * this", and the answer is the changes that touched it — with everything else
 * those changes did still on the entry, because a version published alongside
 * it is part of what happened.
 */
export function filterHistory(
  changes: readonly HistoryChange[],
  filter: { slugPath?: string | null; since?: HistorySince },
  now: number = Date.now(),
): HistoryChange[] {
  const { slugPath = null, since = "all" } = filter;
  const days = since === "year" ? 365 : since === "90days" ? 90 : null;
  const earliest = days === null ? null : now - days * 24 * 60 * 60 * 1000;

  return changes.filter((change) => {
    if (slugPath && !change.rows.some((row) => row.slugPath === slugPath)) {
      return false;
    }
    if (earliest === null) return true;
    // A change whose date Gitea did not give is kept: dropping it would be
    // the record losing an entry to a missing field.
    if (change.publishedAt === "") return true;
    const at = new Date(change.publishedAt).getTime();
    return Number.isNaN(at) || at >= earliest;
  });
}

/** "Alice and Bob", or nobody when a tag was written outside the app. */
export function describeApprovers(approvers: readonly string[]): string {
  if (approvers.length === 0) return "no recorded approval";
  if (approvers.length === 1) return `approved by ${approvers[0]}`;
  const last = approvers[approvers.length - 1];
  return `approved by ${approvers.slice(0, -1).join(", ")} and ${last}`;
}

/** How many versions a stretch of the spine published. */
export function countVersions(changes: readonly HistoryChange[]): number {
  return changes.reduce(
    (total, change) =>
      total + change.rows.filter((row) => row.kind === "version").length,
    0,
  );
}
