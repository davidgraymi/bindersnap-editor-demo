import { describe, expect, test } from "bun:test";

import type { LibraryDocument } from "./api";
import {
  buildBinderResult,
  buildPersonResult,
  buildQuickFindResults,
  describeQuickFindEmptyState,
  isQuickFindQuery,
  matchesQuickFindQuery,
  moveQuickFindHighlight,
  orderQuickFindResults,
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
      // The kind is in the key because the panel now lists three of them and a
      // binder called "clinical" would otherwise collide with a document.
      key: "document:riverside-health/clinical/nursing/infection-control",
      kind: "document",
      organization: "riverside-health",
      binder: "clinical",
      slugPath: "nursing/infection-control",
      name: "Infection Control Policy",
      meta: "Clinical · nursing · v3",
    });
  });

  test("a policy at the binder's root has no folder in its line", () => {
    const [result] = buildQuickFindResults([
      policy({ folder: "", slugPath: "handbook" }),
    ]);
    expect(result?.meta).toBe("Clinical · v3");
  });

  test("a policy nobody has published says so rather than showing a version", () => {
    const [result] = buildQuickFindResults([
      policy({ state: "proposed", latestVersion: null }),
    ]);
    expect(result?.meta).toBe("Clinical · nursing · not published yet");
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
    // "No documents match" was a lie the moment the panel also searched
    // binders and people.
    expect(describeQuickFindEmptyState(" nda ")).toBe("Nothing matches “nda”");
  });
});

describe("binders and people are findable too", () => {
  test("a binder row is named and described by its own sentence", () => {
    const row = buildBinderResult("riverside-health", {
      name: "clinical",
      description: "Clinical and administrative policies",
    });

    expect(row.kind).toBe("binder");
    expect(row.name).toBe("Clinical");
    expect(row.binder).toBe("clinical");
    expect(row.meta).toBe("Clinical and administrative policies");
  });

  test("a binder with no description still says what it is", () => {
    const row = buildBinderResult("riverside-health", { name: "corporate" });
    expect(row.meta).toBe("Binder");
  });

  test("a person is shown by name and disambiguated by username", () => {
    // Two people called Bob is the case this line exists for.
    const row = buildPersonResult("riverside-health", {
      username: "bob",
      fullName: "Bob Okafor",
      role: "Editor",
    });

    expect(row.kind).toBe("person");
    expect(row.name).toBe("Bob Okafor");
    expect(row.username).toBe("bob");
    expect(row.meta).toBe("Editor · bob");
  });

  test("a person with no full name falls back to the username", () => {
    const row = buildPersonResult("riverside-health", { username: "dan" });
    expect(row.name).toBe("dan");
    expect(row.meta).toBe("dan");
  });

  test("keys cannot collide across kinds", () => {
    // A binder called "clinical" and a document filed at "clinical" would key
    // the same list twice without the prefix.
    const binder = buildBinderResult("riverside-health", { name: "clinical" });
    const person = buildPersonResult("riverside-health", {
      username: "clinical",
    });
    expect(binder.key).not.toBe(person.key);
  });

  test("documents come first, then binders, then people", () => {
    // The order is the answer to "what did you most likely mean".
    const ordered = orderQuickFindResults([
      buildPersonResult("o", { username: "bob" }),
      buildBinderResult("o", { name: "clinical" }),
      ...buildQuickFindResults([policy()]),
    ]);

    expect(ordered.map((row) => row.kind)).toEqual([
      "document",
      "binder",
      "person",
    ]);
  });

  test("matching is case-insensitive and needs something to match", () => {
    expect(matchesQuickFindQuery("Clinical Policies", "clin")).toBe(true);
    expect(matchesQuickFindQuery("Clinical Policies", "POLICIES")).toBe(true);
    expect(matchesQuickFindQuery("Clinical Policies", "nursing")).toBe(false);
    // An empty query matches nothing rather than everything — the panel would
    // otherwise list every binder and person the moment it opened.
    expect(matchesQuickFindQuery("Clinical Policies", "   ")).toBe(false);
  });
});
