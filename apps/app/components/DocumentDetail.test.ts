import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import * as api from "../api";
import type { DocTag } from "../api";

/**
 * The document header, rendered.
 *
 * What has to survive a redesign: the pill says which version is on screen,
 * it opens onto every other one, and an earlier version cannot be mistaken
 * for the record — the pill turns coral and the way back sits beside it.
 */

let detail: Record<string, unknown> = {};

const mockGetDocumentDetail = mock(async () => detail);

// The children of the workspace each reach for their own slice of the API
// client; only the four calls this page makes on mount are stubbed, and the
// rest stay as they are so an unexpected one fails loudly.
mock.module("../api", () => ({
  ...api,
  getDocumentDetail: mockGetDocumentDetail,
  getClosedChanges: async () => ({ changes: [] }),
  listDocumentCollaborators: async () => ({ collaborators: [] }),
  downloadDocument: async () => new Blob(["hello"]),
}));

const { DocumentDetail } = await import("./DocumentDetail");

const DOM_KEYS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "MutationObserver",
  "Event",
] as const;

let originals: Record<string, unknown> = {};

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://bindersnap.com/docs/alice/contract",
  });

  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
  };

  originals = {};
  for (const key of DOM_KEYS) {
    originals[key] = (globalThis as Record<string, unknown>)[key];
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: values[key],
    });
  }
});

afterEach(async () => {
  // React's scheduler reads `window` from a callback of its own; pulling the
  // DOM out from under it mid-flight fails the next test, not this one.
  await new Promise((resolve) => setTimeout(resolve, 20));

  for (const key of DOM_KEYS) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: originals[key],
    });
  }
});

function tag(version: number, created: string): DocTag {
  return { name: `v${version}`, version, sha: `sha-${version}`, created };
}

function documentDetail(tags: DocTag[]) {
  return {
    tags,
    openPullRequests: [],
    branchProtection: null,
    reviewSettings: null,
    currentUserPermission: null,
    canonicalFile: {
      storedFileName: "contract.md",
      downloadFileName: "contract.md",
    },
  };
}

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));
  // The document is fetched on mount; let the promise land before asserting.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});

  return {
    container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function detailProps(overrides: Record<string, unknown> = {}) {
  return {
    owner: "alice",
    repo: "contract",
    uploaderSlug: "alice",
    activeView: "overview" as const,
    activeChangeNumber: null,
    activeChangeView: "discussion" as const,
    activeVersion: null,
    onTabChange: () => {},
    onSelectVersion: () => {},
    onOpenChange: () => {},
    ...overrides,
  };
}

function click(element: Element) {
  flushSync(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

const threeVersions = [
  tag(3, "2026-01-12T00:00:00Z"),
  tag(2, "2025-11-03T00:00:00Z"),
  tag(1, "2025-09-22T00:00:00Z"),
];

test("the version pill opens onto every published version", async () => {
  detail = documentDetail(threeVersions);

  const { container, unmount } = await render(
    createElement(DocumentDetail, detailProps()),
  );

  const pill = container.querySelector(
    ".doc-version-pill--button",
  ) as HTMLButtonElement;
  expect(pill.textContent).toContain("v3 · Current");
  expect(container.querySelector(".doc-version-menu")).toBeNull();

  click(pill);

  expect(
    [...container.querySelectorAll(".doc-version-menu-label")].map(
      (label) => label.textContent,
    ),
  ).toEqual(["v3", "v2", "v1"]);

  unmount();
});

test("picking an earlier version asks for its own page", async () => {
  detail = documentDetail(threeVersions);

  const picked: (number | null)[] = [];
  const { container, unmount } = await render(
    createElement(
      DocumentDetail,
      detailProps({
        onSelectVersion: (version: number | null) => picked.push(version),
      }),
    ),
  );

  click(container.querySelector(".doc-version-pill--button")!);
  const items = container.querySelectorAll(".doc-version-menu-item");
  click(items[1]!);

  expect(picked).toEqual([2]);
  // Picking closes the menu; nobody wants it hanging over what they opened.
  expect(container.querySelector(".doc-version-menu")).toBeNull();

  unmount();
});

test("an earlier version is unmistakable, and says how to get back", async () => {
  detail = documentDetail(threeVersions);

  const picked: (number | null)[] = [];
  const { container, unmount } = await render(
    createElement(
      DocumentDetail,
      detailProps({
        activeVersion: 2,
        onSelectVersion: (version: number | null) => picked.push(version),
      }),
    ),
  );

  const pill = container.querySelector(".doc-version-pill--button")!;
  expect(pill.textContent).toContain("v2 · Earlier version");
  expect(pill.className).toContain("doc-version-pill--past");
  expect(container.textContent).toContain("v3 is current");

  const back = container.querySelector(".doc-header-latest")!;
  click(back);
  expect(picked).toEqual([null]);

  unmount();
});

test("the version on record is not dressed up as an earlier one", async () => {
  detail = documentDetail(threeVersions);

  const { container, unmount } = await render(
    createElement(DocumentDetail, detailProps({ activeVersion: 3 })),
  );

  const pill = container.querySelector(".doc-version-pill--button")!;
  expect(pill.textContent).toContain("v3 · Current");
  expect(container.querySelector(".doc-header-latest")).toBeNull();

  unmount();
});

test("a version that does not exist says so instead of lying", async () => {
  detail = documentDetail(threeVersions);

  const { container, unmount } = await render(
    createElement(DocumentDetail, detailProps({ activeVersion: 9 })),
  );

  expect(container.textContent).toContain("This document has no v9");

  unmount();
});

test("with nothing published the pill is a fact, not a menu", async () => {
  detail = documentDetail([]);

  const { container, unmount } = await render(
    createElement(DocumentDetail, detailProps()),
  );

  expect(container.querySelector(".doc-version-pill--button")).toBeNull();
  expect(container.querySelector(".doc-version-pill")?.textContent).toBe(
    "No version yet",
  );

  unmount();
});
