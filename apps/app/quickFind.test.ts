import { describe, expect, test } from "bun:test";

import type { LibraryDocument } from "./api";
import {
  buildQuickFindResults,
  describeQuickFindEmptyState,
  isQuickFindQuery,
  moveQuickFindHighlight,
} from "./quickFind";

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

describe("building rows", () => {
  test("a row names the policy and says which binder it is in", () => {
    // **The binder, not the owner.** A document used to be a repository
    // somebody owned, so the line under the name said whose it was. Nobody
    // owns a document now — the question a reader is disambiguating with is
    // which binder, and after that which folder.
    const [result] = buildQuickFindResults([policy()]);

    expect(result).toEqual({
      key: "riverside-health/clinical/nursing/infection-control",
      organization: "riverside-health",
      binder: "clinical",
      slugPath: "nursing/infection-control",
      name: "Infection Control Policy",
      meta: "clinical · nursing · v3",
    });
  });

  test("a policy at the binder's root has no folder in its line", () => {
    const [result] = buildQuickFindResults([
      policy({ folder: "", slugPath: "handbook" }),
    ]);
    expect(result?.meta).toBe("clinical · v3");
  });

  test("a policy nobody has published says so rather than showing a version", () => {
    const [result] = buildQuickFindResults([
      policy({ state: "proposed", latestVersion: null }),
    ]);
    expect(result?.meta).toBe("clinical · nursing · not published yet");
  });

  test("two binders can hold a policy of the same name without colliding", () => {
    // The key is what dedupes rows and what the arrow keys address, so two
    // genuinely different policies must not share one.
    const [first] = buildQuickFindResults([policy()]);
    const [second] = buildQuickFindResults([policy({ binder: "corporate" })]);
    expect(first?.key).not.toBe(second?.key);
  });
});

describe("the arrow keys", () => {
  test("down from nothing highlighted lands on the first result", () => {
    expect(moveQuickFindHighlight(-1, 1, 3)).toBe(0);
  });

  test("up from nothing highlighted lands on the last", () => {
    expect(moveQuickFindHighlight(-1, -1, 3)).toBe(2);
  });

  test("the list wraps at both ends", () => {
    expect(moveQuickFindHighlight(2, 1, 3)).toBe(0);
    expect(moveQuickFindHighlight(0, -1, 3)).toBe(2);
  });

  test("an empty list has nothing to highlight", () => {
    expect(moveQuickFindHighlight(-1, 1, 0)).toBe(-1);
  });
});

describe("when to ask", () => {
  test("one character is not yet a question", () => {
    expect(isQuickFindQuery("v")).toBe(false);
    expect(isQuickFindQuery("  ")).toBe(false);
  });

  test("two are", () => {
    expect(isQuickFindQuery("ve")).toBe(true);
  });

  test("the empty state repeats what was asked", () => {
    expect(describeQuickFindEmptyState(" nda ")).toBe(
      "No documents match “nda”",
    );
  });
});
