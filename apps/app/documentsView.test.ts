import { describe, expect, test } from "bun:test";

import type { LibraryDocument } from "./api";
import {
  applyBinderFilter,
  binderKey,
  buildDocumentRow,
  buildDocumentRows,
  buildDocumentsUrl,
  describeDocumentCount,
  getDocumentRowStatusLabel,
  parseDocumentsViewState,
} from "./documentsView";

/**
 * What this file used to cover, and why it does not any more.
 *
 * The library had saved views — "contributing", "owned", "everything" — and a
 * filter by person, because a document was a repository somebody owned. Under
 * ADR 0004 the organization owns the binder and the binder holds the policy:
 * nobody owns a document, and everyone who can see a binder can see everything
 * in it. Those chips had nothing left to mean, so they are gone rather than
 * reinterpreted into something that would quietly mean something else.
 */

function policy(overrides: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    path: "nursing/infection-control.docx",
    slugPath: "nursing/infection-control",
    name: "Infection Control Policy",
    folder: "nursing",
    size: 1024,
    sha: "abc",
    state: "published",
    openChangeCount: 0,
    latestVersion: {
      tag: "nursing/infection-control/v3",
      version: 3,
      commitSha: "abc",
      publishedAt: "2026-08-25T10:00:00Z",
    },
    organization: "riverside-health",
    binder: "clinical",
    binderDescription: "Clinical and administrative policies",
    ...overrides,
  } as LibraryDocument;
}

describe("the view in the URL", () => {
  test("an empty search is every binder and no words", () => {
    expect(parseDocumentsViewState("")).toEqual({ binder: null, freeText: "" });
  });

  test("a binder and a query round-trip through the address", () => {
    const state = { binder: "riverside-health/clinical", freeText: "hygiene" };
    expect(
      parseDocumentsViewState(buildDocumentsUrl(state).split("?")[1] ?? ""),
    ).toEqual(state);
  });

  test("the unfiltered library is the short address", () => {
    // The page's own address should be the plain one, so a link to "the
    // library" is not a link to whatever filter somebody last had open.
    expect(buildDocumentsUrl({ binder: null, freeText: "" })).toBe(
      "/documents",
    );
  });
});

describe("building rows", () => {
  test("a published policy with nothing in flight says its version", () => {
    const row = buildDocumentRow(policy());
    expect(row).toMatchObject({
      key: "riverside-health/clinical/nursing/infection-control",
      name: "Infection Control Policy",
      folder: "nursing",
      status: "published",
      version: "v3",
    });
  });

  test("a policy with a change in flight says so, whatever its version", () => {
    // What a reader is about to walk into matters more than what is filed.
    expect(buildDocumentRow(policy({ openChangeCount: 1 })).status).toBe(
      "in_review",
    );
  });

  test("a file on the record with no version is not the same as one at v1", () => {
    // Reachable for a file nothing ever tagged. A blank version would read as
    // a rendering fault; saying there is none is the fact.
    const row = buildDocumentRow(
      policy({ latestVersion: null, openChangeCount: 0 }),
    );
    expect(row.status).toBe("unpublished");
    expect(row.version).toBe("");
    expect(getDocumentRowStatusLabel(row.status)).toBe("No published version");
  });

  test("a policy with a change in flight reads as in review", () => {
    // What a reader is about to walk into, so it leads over the version.
    expect(
      buildDocumentRow(policy({ latestVersion: null, openChangeCount: 1 }))
        .status,
    ).toBe("in_review");
  });
});

describe("narrowing to one binder", () => {
  test("two binders can hold a policy of the same name", () => {
    // They are different objects: the binder decides who can see the policy
    // and what has to happen before it changes. A key that collided would let
    // one row stand in for the other.
    const rows = buildDocumentRows([policy(), policy({ binder: "corporate" })]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });

  test("a filter keeps only the binder it names", () => {
    const rows = buildDocumentRows([policy(), policy({ binder: "corporate" })]);
    expect(
      applyBinderFilter(rows, "riverside-health/clinical").map(
        (row) => row.binder,
      ),
    ).toEqual(["clinical"]);
  });

  test("no filter keeps everything", () => {
    const rows = buildDocumentRows([policy(), policy({ binder: "corporate" })]);
    expect(applyBinderFilter(rows, null)).toHaveLength(2);
  });

  test("the key names the organization too", () => {
    // Two organizations may each have a binder called `clinical`, and a person
    // can belong to both.
    expect(
      binderKey({ organization: "riverside-health", binder: "clinical" }),
    ).not.toBe(binderKey({ organization: "mercy", binder: "clinical" }));
  });
});

describe("counting", () => {
  test("says policies, in the customer's words", () => {
    expect(describeDocumentCount(0)).toBe("No policies");
    expect(describeDocumentCount(1)).toBe("1 policy");
    expect(describeDocumentCount(12)).toBe("12 policies");
  });
});
