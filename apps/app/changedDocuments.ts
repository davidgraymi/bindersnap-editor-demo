/**
 * Everything one change would do to a binder, as one list.
 *
 * ADR 0004: "the unit of approval is the change, not the document." A reviewer
 * is asked to approve a change, so the question they open it with is what the
 * *change* does — and until there was a screen that answered that, the only
 * way to find out was to pick one document out of a selector, read its
 * comparison, go back, and pick the next one.
 *
 * This decides what that screen says: which documents are in the change, what
 * each one is having done to it, and which version each is read against. It is
 * here rather than in the component so the wording can be checked without a
 * browser — the same reason `documentComparison.ts` exists.
 */

import { describeMove } from "./binderChange";
import { downloadFileName } from "./binderDocument";
import { formatDocumentName } from "./documentDisplay";
import {
  resolveComparisonBase,
  type ComparisonBase,
} from "./documentComparison";
import type { ComparisonSummary } from "./documentComparison";
import type {
  WorkspaceChangedDocument,
  WorkspaceRemovedDocument,
} from "../../packages/api-schema/schemas/workspaces";

/**
 * What the change does to one document.
 *
 * Four verbs, because there are four answers a reviewer needs told apart at a
 * glance: something new arrives on the record, something on it is rewritten,
 * something comes back out of the archive, or something goes into it. The
 * last two are the ones a compliance customer cares most about and the ones a
 * diff is least able to show — a restore diffs exactly like a revision.
 */
export type ChangedDocumentKind = "added" | "revised" | "restored" | "removed";

export interface ChangedDocumentRow {
  /**
   * The anchor this document's section carries, so a reviewer can send a
   * colleague the diff rather than the change. Derived from the address, not
   * from the position in the list: a link should survive another document
   * being added to the change above it.
   */
  anchor: string;
  /** `clinical/infection-control` — what the file APIs take. */
  slugPath: string;
  /** `clinical/infection-control.01J8XZ….pdf` — shown in mono, so it is exact. */
  path: string;
  /** "Infection Control". */
  name: string;
  /** `infection-control.pdf` — what a download lands under. */
  fileName: string;
  kind: ChangedDocumentKind;
  /** "v2 → v3", "New · becomes v1", "Was v4". */
  versionStep: string;
  /**
   * Where it was before this change, when that is somewhere else:
   * `nursing/hand-hygiene` for a document now at `clinical/hand-hygiene`.
   *
   * **The one thing on this screen the comparison below it cannot say.** The
   * identity survives a rename and the address does not (ADR 0005), so a
   * renamed policy reads identically at both refs. The file's bar draws the
   * old address struck out beside the new one — the way a diff draws any
   * other line that moved.
   */
  previousSlugPath: string | null;
  /**
   * "Renamed from Hand Hygiene", "Moved from Nursing", or null — the same
   * fact as {@link previousSlugPath}, as a sentence, for a screen reader that
   * cannot see a strike-through. From the same `describeMove` the change's
   * own document list uses, so the two screens cannot drift apart.
   */
  move: string | null;
  /**
   * The version this document is read against, or null when there is nothing
   * to read it against — the first version of a document replaces nothing.
   *
   * For a removal it is the last version on record: there is no diff to draw,
   * but "what exactly is coming off the record" is still a question with an
   * answer, and this is the ref that answers it.
   */
  base: ComparisonBase | null;
  /** The version this document reaches if the change is published. */
  nextVersion: number;
}

/** `cmp-clinical-infection-control` — safe in an `id` and in a fragment. */
function toAnchor(slugPath: string, taken: Set<string>): string {
  const base = `cmp-${slugPath.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}`;
  let anchor = base === "cmp-" ? "cmp-document" : base;

  // Two documents whose addresses differ only in punctuation would otherwise
  // land on the same anchor, and one of the two links would scroll to the
  // wrong policy — which on this screen means showing a reviewer the wrong
  // diff under the right name.
  for (let suffix = 2; taken.has(anchor); suffix += 1) {
    anchor = `${base}-${suffix}`;
  }
  taken.add(anchor);
  return anchor;
}

/**
 * The documents a change versions, and the ones it retires, in one list.
 *
 * `decided` is what a published change is read against: it replaced the
 * version *below* the one it became, so reading it against today's record
 * would compare it with itself. The same rule `resolveComparisonBase` already
 * applies per document — this only hands it the right facts per row.
 */
export function buildChangedDocumentRows(params: {
  documents: readonly WorkspaceChangedDocument[];
  removedDocuments: readonly WorkspaceRemovedDocument[];
  /** Whether the change is still awaiting a decision. */
  open: boolean;
}): ChangedDocumentRow[] {
  const { documents, removedDocuments, open } = params;
  const taken = new Set<string>();

  const versioned: ChangedDocumentRow[] = documents.map((document) => {
    const added = document.currentVersion === null;

    return {
      anchor: toAnchor(document.slugPath, taken),
      slugPath: document.slugPath,
      path: document.path,
      name: formatDocumentName(document.name),
      fileName: downloadFileName(document),
      kind: added ? "added" : document.restored ? "restored" : "revised",
      versionStep: describeStep(document, open),
      previousSlugPath:
        document.previousSlugPath &&
        document.previousSlugPath !== document.slugPath
          ? document.previousSlugPath
          : null,
      move: describeMove(document),
      base: resolveComparisonBase({
        open,
        // What this change published for this document. A published change is
        // read against the version below the one it became.
        publishedVersion: open
          ? null
          : (document.currentVersion?.version ?? null),
        tags: document.versions.map((version) => ({
          name: version.tag,
          version: version.version,
          sha: version.commitSha,
        })),
      }),
      nextVersion: document.nextVersion,
    };
  });

  const retired: ChangedDocumentRow[] = removedDocuments.map((document) => ({
    anchor: toAnchor(document.slugPath, taken),
    slugPath: document.slugPath,
    path: document.path,
    name: formatDocumentName(document.name),
    fileName: downloadFileName(document),
    kind: "removed",
    versionStep: document.lastVersion
      ? `Was v${document.lastVersion.version}`
      : "Never published",
    // A removal has no "was filed at": the server has already subtracted the
    // renames, so anything left here left the binder rather than moved in it.
    previousSlugPath: null,
    move: null,
    base: document.lastVersion
      ? {
          ref: document.lastVersion.tag,
          label: `v${document.lastVersion.version}`,
        }
      : null,
    // A removal publishes no version. Zero rather than a guess, and nothing on
    // the screen reads it for a removed row.
    nextVersion: 0,
  }));

  // Removals last, and both halves in path order. What a change *adds* is what
  // it is for; what it retires is the footnote — and a reviewer who scrolls to
  // the bottom of this page should find the removals together rather than
  // interleaved with the policies they are still reading.
  return [
    ...versioned.sort((left, right) => left.path.localeCompare(right.path)),
    ...retired.sort((left, right) => left.path.localeCompare(right.path)),
  ];
}

/**
 * "v2 → v3", "New · becomes v1", or "v3" once it has been published.
 *
 * Once the change has been decided the arrow is a lie: the version on record
 * *is* what this change wrote, and the next one belongs to somebody else's
 * change.
 */
function describeStep(
  document: WorkspaceChangedDocument,
  open: boolean,
): string {
  if (!open) {
    return document.currentVersion
      ? `v${document.currentVersion.version}`
      : "Published";
  }

  return document.currentVersion
    ? `v${document.currentVersion.version} → v${document.nextVersion}`
    : `New · becomes v${document.nextVersion}`;
}

/**
 * "Revised", "New document", "Being archived" — said to a screen reader.
 *
 * `open` because an archiving that has not been decided has not happened: the
 * same row reads "Being archived" on the change awaiting sign-off and
 * "Archived" once it is published.
 */
export function describeChangedKind(
  kind: ChangedDocumentKind,
  open = true,
): string {
  if (kind === "added") return "New document";
  if (kind === "removed") return open ? "Being archived" : "Archived";
  if (kind === "restored")
    return open ? "Coming out of the archive" : "Restored from the archive";
  return "Revised";
}

/**
 * The pill in a file's bar, or null when there is nothing to say.
 *
 * **A revision gets no pill.** Revising is what nearly every document in a
 * change is having done to it, and the bar already shows the proof — the word
 * counts and the version step. A badge reading "Revised" on every row told a
 * reviewer nothing they did not know, and trained them to ignore the badge on
 * the two rows where it mattered: a policy arriving, and one leaving.
 */
export function describeChangedBadge(
  kind: ChangedDocumentKind,
  open = true,
): string | null {
  if (kind === "revised") return null;
  if (kind === "removed") return open ? "Archiving" : "Archived";
  if (kind === "restored") return open ? "Restoring" : "Restored";
  return describeChangedKind(kind, open);
}

/**
 * The line above everything: how big this change is.
 *
 * Word counts, not file counts, because a change that touches three documents
 * to fix three typos and a change that rewrites one of them whole are the same
 * "3 documents" and nothing like the same review. The counts arrive one
 * document at a time as each comparison finishes, so this has to read as a
 * true sentence while most of them are still null.
 */
export function summarizeChangeScale(params: {
  rows: readonly ChangedDocumentRow[];
  /** Keyed by anchor. Absent until that document's comparison has loaded. */
  counts: ReadonlyMap<string, ComparisonSummary | null>;
}): string {
  const { rows, counts } = params;

  if (rows.length === 0) return "This change versions no document.";

  const parts = [`${rows.length} document${rows.length === 1 ? "" : "s"}`];

  const added = rows.filter((row) => row.kind === "added").length;
  const restored = rows.filter((row) => row.kind === "restored").length;
  const removed = rows.filter((row) => row.kind === "removed").length;
  if (added > 0) parts.push(`${added} new`);
  if (restored > 0) parts.push(`${restored} restored`);
  if (removed > 0) parts.push(`${removed} archived`);

  /**
   * Only a revision has a word count — and a restore, which is read against
   * its last version exactly like one.
   *
   * A new document has nothing to be counted against — the screen reads it
   * whole instead — and a removal is not a diff at all. Counting them as
   * pending is what made this line sit on "measuring the changes…" forever on
   * a change that added two policies and retired one: three documents, and not
   * one of them was ever going to report a number.
   */
  const measurable = rows.filter(
    (row) =>
      (row.kind === "revised" || row.kind === "restored") && row.base !== null,
  );
  if (measurable.length === 0) return parts.join(" · ");

  let additions = 0;
  let deletions = 0;
  /** Comparisons that have finished, including the ones that came back blank. */
  let reported = 0;
  /** Of those, the ones a browser could actually read inside. */
  let comparable = 0;
  for (const row of measurable) {
    if (!counts.has(row.anchor)) continue;
    reported += 1;
    const summary = counts.get(row.anchor);
    if (!summary) continue;
    comparable += 1;
    additions += summary.additions;
    deletions += summary.deletions;
  }

  // Nothing read yet: say the size honestly rather than claiming zero words
  // changed on a page that has not opened a file.
  if (reported === 0) {
    parts.push("measuring the changes…");
    return parts.join(" · ");
  }

  const words: string[] = [];
  if (additions > 0)
    words.push(`${additions} word${additions === 1 ? "" : "s"} added`);
  if (deletions > 0)
    words.push(`${deletions} word${deletions === 1 ? "" : "s"} removed`);
  // Words that did not move are not announced: a pure rename says what it
  // did in its own bar, and "no wording changed" was one more sentence to read
  // on the way to the documents.
  if (comparable === 0) parts.push("a browser cannot read inside these files");
  else if (words.length > 0) parts.push(words.join(", "));

  // A count still missing a document is a count that will change, and a number
  // that moves under a reader without explanation is worse than one that
  // admits it is partial.
  if (reported < measurable.length) {
    parts.push(`${reported} of ${measurable.length} compared so far`);
  }

  return parts.join(" · ");
}

/** "2 of 3 viewed" — where a reviewer is in the stack. Null until they start. */
export function describeReadProgress(params: {
  total: number;
  read: number;
}): string | null {
  const { total, read } = params;
  if (read === 0 || total === 0) return null;
  return read >= total ? `All ${total} viewed` : `${read} of ${total} viewed`;
}

/**
 * "wants to publish 3 documents" — the middle of the line under the title,
 * between who proposed the change and the branch it came from.
 *
 * Counted in documents, because that is what a reviewer is being asked to put
 * on the record. A decided change says "proposed", not "published": the same
 * line serves one that was declined, and it must not claim a publish that
 * never happened.
 */
export function describePublishIntent(params: {
  open: boolean;
  documents: number;
}): string {
  const { open, documents } = params;
  const count = `${documents} document${documents === 1 ? "" : "s"}`;
  return open ? `wants to publish ${count}` : `proposed ${count}`;
}
