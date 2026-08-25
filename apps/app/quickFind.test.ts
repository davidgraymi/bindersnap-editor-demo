import { describe, expect, test } from "bun:test";

import type { WorkspaceRepo } from "./api";
import {
  appendQuickFindPage,
  buildQuickFindResults,
  describeQuickFindEmptyState,
  isQuickFindQuery,
  moveQuickFindHighlight,
  shouldLoadNextQuickFindPage,
} from "./quickFind";

const NOW = new Date("2026-08-25T12:00:00Z").getTime();

function repo(overrides: Partial<WorkspaceRepo> = {}): WorkspaceRepo {
  return {
    id: 1,
    name: "vendor-agreement",
    full_name: "alice/vendor-agreement",
    description: "",
    updated_at: "2026-08-25T10:00:00Z",
    owner: { login: "alice" },
    ...overrides,
  };
}

describe("building rows", () => {
  test("a row is a document name and one line about it", () => {
    const [result] = buildQuickFindResults([repo()], "bob", NOW);

    expect(result).toEqual({
      key: "alice/vendor-agreement",
      owner: "alice",
      repo: "vendor-agreement",
      name: "Vendor Agreement",
      meta: "Alice owns · updated 2h ago",
    });
  });

  test("the reader's own document says so", () => {
    const [result] = buildQuickFindResults([repo()], "alice", NOW);
    expect(result?.meta).toBe("You own · updated 2h ago");
  });

  test("the owner is matched regardless of case or a leading @", () => {
    const [result] = buildQuickFindResults([repo()], "@Alice", NOW);
    expect(result?.meta).toStartWith("You own");
  });
});

describe("paging", () => {
  test("a page is appended after what is already on screen", () => {
    const first = buildQuickFindResults([repo()], "bob", NOW);
    const second = buildQuickFindResults(
      [repo({ id: 2, name: "nda", full_name: "alice/nda" })],
      "bob",
      NOW,
    );

    expect(appendQuickFindPage(first, second).map((r) => r.repo)).toEqual([
      "vendor-agreement",
      "nda",
    ]);
  });

  test("a document that shifted between pages is not listed twice", () => {
    const first = buildQuickFindResults([repo()], "bob", NOW);
    const second = buildQuickFindResults(
      [repo(), repo({ id: 2, name: "nda", full_name: "alice/nda" })],
      "bob",
      NOW,
    );

    expect(appendQuickFindPage(first, second)).toHaveLength(2);
  });

  test("a page with nothing new leaves the list identical", () => {
    const first = buildQuickFindResults([repo()], "bob", NOW);
    expect(appendQuickFindPage(first, first)).toBe(first);
  });

  test("scrolling near the bottom asks for the next page", () => {
    expect(shouldLoadNextQuickFindPage(0, 264, 264)).toBe(true);
    expect(shouldLoadNextQuickFindPage(240, 264, 520)).toBe(true);
  });

  test("scrolling in the middle of a long list does not", () => {
    expect(shouldLoadNextQuickFindPage(0, 264, 1000)).toBe(false);
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
