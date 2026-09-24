import { expect, test } from "bun:test";

import {
  buildChangedDocumentRows,
  describeChangedBadge,
  describeChangedKind,
  describeReadProgress,
  summarizeChangeScale,
} from "./changedDocuments";
import type { ComparisonSummary } from "./documentComparison";
import type {
  WorkspaceChangedDocument,
  WorkspaceRemovedDocument,
} from "../../packages/api-schema/schemas/workspaces";

/**
 * What the all-documents comparison screen says a change does.
 *
 * Every sentence on that page is a claim about the record, so each one is
 * decided here and checked without a browser — the same bargain
 * `documentComparison.ts` makes.
 */

function version(number: number) {
  return {
    tag: `hand-hygiene-v${number}`,
    version: number,
    commitSha: `sha${number}`,
    publishedAt: "2026-04-01T00:00:00Z",
  };
}

function changed(
  overrides: Partial<WorkspaceChangedDocument> = {},
): WorkspaceChangedDocument {
  return {
    path: "clinical/hand-hygiene.01J8XZ4K7MQ1RSTVWXYZ0ABCDE.md",
    slugPath: "clinical/hand-hygiene",
    name: "hand-hygiene",
    uid: "01J8",
    folder: "clinical",
    size: 120,
    sha: "blob",
    nextVersion: 3,
    currentVersion: version(2),
    versions: [version(2), version(1)],
    previousSlugPath: null,
    restored: false,
    ...overrides,
  };
}

function removed(
  overrides: Partial<WorkspaceRemovedDocument> = {},
): WorkspaceRemovedDocument {
  return {
    path: "clinical/visitor-policy.01J9XZ4K7MQ1RSTVWXYZ0ABCDE.md",
    slugPath: "clinical/visitor-policy",
    name: "visitor-policy",
    uid: "01J9",
    folder: "clinical",
    size: 90,
    sha: "blob",
    lastVersion: version(4),
    ...overrides,
  };
}

test("a revised document is read against the version it replaces", () => {
  const [row] = buildChangedDocumentRows({
    documents: [changed()],
    removedDocuments: [],
    open: true,
  });

  expect(row?.kind).toBe("revised");
  expect(row?.versionStep).toBe("v2 → v3");
  expect(row?.base).toEqual({ ref: "hand-hygiene-v2", label: "v2" });
  expect(row?.name).toBe("Hand Hygiene");
  expect(row?.fileName).toBe("hand-hygiene.md");
});

test("a document nobody has published has nothing to be read against", () => {
  const [row] = buildChangedDocumentRows({
    documents: [
      changed({ currentVersion: null, versions: [], nextVersion: 1 }),
    ],
    removedDocuments: [],
    open: true,
  });

  expect(row?.kind).toBe("added");
  expect(row?.versionStep).toBe("New · becomes v1");
  // Not an error state: the screen reads the new document instead of
  // refusing, which is what "compare" means for something with no before.
  expect(row?.base).toBeNull();
});

test("a published change is read against the version below the one it became", () => {
  const [row] = buildChangedDocumentRows({
    documents: [
      changed({
        currentVersion: version(3),
        versions: [version(3), version(2), version(1)],
        nextVersion: 4,
      }),
    ],
    removedDocuments: [],
    open: false,
  });

  // Against v2, not against today's record — which is v3, this change itself.
  expect(row?.base).toEqual({ ref: "hand-hygiene-v2", label: "v2" });
  expect(row?.versionStep).toBe("v3");
});

test("a removal carries what is going into the archive, and sorts last", () => {
  const rows = buildChangedDocumentRows({
    documents: [changed({ path: "zz/late.01JA.md", slugPath: "zz/late" })],
    removedDocuments: [removed()],
    open: true,
  });

  expect(rows.map((row) => row.kind)).toEqual(["revised", "removed"]);
  const retired = rows[1];
  expect(retired?.versionStep).toBe("Was v4");
  expect(retired?.base).toEqual({ ref: "hand-hygiene-v4", label: "v4" });
  expect(describeChangedKind("removed")).toBe("Being archived");
  expect(describeChangedKind("removed", false)).toBe("Archived");
  expect(describeChangedBadge("removed")).toBe("Archiving");
  expect(describeChangedBadge("removed", false)).toBe("Archived");
});

test("a policy coming back out of the archive says so, and is still diffed", () => {
  const [row] = buildChangedDocumentRows({
    documents: [changed({ restored: true })],
    removedDocuments: [],
    open: true,
  });

  // A restore reads exactly like a revision — same step, same base — so the
  // kind is the only thing that says the policy was in the archive.
  expect(row?.kind).toBe("restored");
  expect(row?.versionStep).toBe("v2 → v3");
  expect(row?.base).toEqual({ ref: "hand-hygiene-v2", label: "v2" });
  expect(describeChangedBadge("restored")).toBe("Restoring");
  expect(describeChangedBadge("restored", false)).toBe("Restored");
  expect(describeChangedKind("restored")).toBe("Coming out of the archive");
  expect(describeChangedBadge("revised")).toBeNull();
});

test("a restore is counted, and its words are measured like a revision's", () => {
  const rows = buildChangedDocumentRows({
    documents: [changed({ restored: true })],
    removedDocuments: [removed()],
    open: true,
  });
  const counts = new Map([[rows[0]!.anchor, summary(2, 1)]]);

  expect(summarizeChangeScale({ rows, counts })).toBe(
    "2 documents · 1 restored · 1 archived · 2 words added, 1 word removed",
  );
});

test("a renamed policy says so, because its comparison cannot", () => {
  const [row] = buildChangedDocumentRows({
    documents: [
      changed({
        slugPath: "clinical/hand-hygiene",
        previousSlugPath: "nursing/handwashing",
      }),
    ],
    removedDocuments: [],
    open: true,
  });

  // Both halves, told apart: one changes what it is called, the other where
  // it is looked for. The diff below the row will read as "nothing changed".
  expect(row?.move).toBe("Renamed from Handwashing and moved from Nursing");
});

test("a document filed where it always was claims no move", () => {
  const [row] = buildChangedDocumentRows({
    documents: [changed()],
    removedDocuments: [],
    open: true,
  });

  expect(row?.move).toBeNull();
});

test("two addresses that differ only in punctuation get two anchors", () => {
  const rows = buildChangedDocumentRows({
    documents: [
      changed({ path: "a/b.01J1.md", slugPath: "a/b" }),
      changed({ path: "a-b.01J2.md", slugPath: "a-b" }),
    ],
    removedDocuments: [],
    open: true,
  });

  // Sharing one would scroll a link to the wrong policy under the right name.
  expect(rows[0]?.anchor).not.toBe(rows[1]?.anchor);
});

function summary(additions: number, deletions: number): ComparisonSummary {
  return {
    additions,
    deletions,
    identical: additions === 0 && deletions === 0,
  };
}

test("the scale line admits it has not read the files yet", () => {
  const rows = buildChangedDocumentRows({
    documents: [changed(), changed({ path: "b.01J2.md", slugPath: "b" })],
    removedDocuments: [],
    open: true,
  });

  expect(summarizeChangeScale({ rows, counts: new Map() })).toBe(
    "2 documents · measuring the changes…",
  );
});

test("the scale line says how much of itself is still to come", () => {
  const rows = buildChangedDocumentRows({
    documents: [changed(), changed({ path: "b.01J2.md", slugPath: "b" })],
    removedDocuments: [],
    open: true,
  });
  const counts = new Map([[rows[0]!.anchor, summary(112, 8)]]);

  expect(summarizeChangeScale({ rows, counts })).toBe(
    "2 documents · 112 words added, 8 words removed · 1 of 2 compared so far",
  );
});

test("a removal is counted as a document and named as a removal", () => {
  const rows = buildChangedDocumentRows({
    documents: [changed()],
    removedDocuments: [removed()],
    open: true,
  });
  const counts = new Map([[rows[0]!.anchor, summary(3, 0)]]);

  // The removed document is not "compared", so it never holds the count back.
  expect(summarizeChangeScale({ rows, counts })).toBe(
    "2 documents · 1 archived · 3 words added",
  );
});

test("a change with nothing to diff never waits on a count that is not coming", () => {
  const rows = buildChangedDocumentRows({
    documents: [
      changed({ currentVersion: null, versions: [], nextVersion: 1 }),
      changed({
        path: "b.01J2.md",
        slugPath: "b",
        currentVersion: null,
        versions: [],
        nextVersion: 1,
      }),
    ],
    removedDocuments: [removed()],
    open: true,
  });

  // Two new policies and a retirement: three real documents, and not one of
  // them has an earlier version to be counted against. "Measuring…" here would
  // sit there for the life of the page.
  expect(summarizeChangeScale({ rows, counts: new Map() })).toBe(
    "3 documents · 2 new · 1 archived",
  );
});

test("a file a browser cannot read inside says so rather than reading as unchanged", () => {
  const rows = buildChangedDocumentRows({
    documents: [
      changed({ path: "clinical/rota.01J8XZ4K7MQ1RSTVWXYZ0ABCDE.xlsx" }),
    ],
    removedDocuments: [],
    open: true,
  });
  // The comparison reports null for a spreadsheet: settled, and uncountable.
  const counts = new Map([[rows[0]!.anchor, null]]);

  expect(summarizeChangeScale({ rows, counts })).toBe(
    "1 document · a browser cannot read inside these files",
  );
});

test("a change that versions nothing says so rather than counting to zero", () => {
  expect(summarizeChangeScale({ rows: [], counts: new Map() })).toBe(
    "This change versions no document.",
  );
});

test("read progress stays quiet until somebody starts", () => {
  expect(describeReadProgress({ total: 3, read: 0 })).toBeNull();
  expect(describeReadProgress({ total: 3, read: 2 })).toBe("2 of 3 viewed");
  expect(describeReadProgress({ total: 3, read: 3 })).toBe("All 3 viewed");
});
