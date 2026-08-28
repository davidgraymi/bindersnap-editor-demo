import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { DocumentHistoryPayload, DocumentVersionRecord } from "../api";

/**
 * The History tab, rendered.
 *
 * One line down the page, one knot per published version. What has to survive
 * a redesign: the title is the change review and it goes there, both people
 * are named, and the two actions are icons — the version is on the knot, so a
 * button that repeats it is the same word twice. Nothing here unfolds into a
 * second copy of the review record, and nothing here shows a commit hash.
 */

let payload: DocumentHistoryPayload = { versions: [], canonicalFile: null };

const mockGetDocumentHistory = mock(async () => payload);

mock.module("../api", () => ({
  getDocumentHistory: mockGetDocumentHistory,
}));

const { DocumentHistory } = await import("./DocumentHistory");

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
    url: "https://bindersnap.com/docs/alice/contract/history",
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

function version(
  overrides: Partial<DocumentVersionRecord> = {},
): DocumentVersionRecord {
  return {
    version: 3,
    tagName: "v3",
    sha: "abcdef0123456789",
    createdAt: "2026-08-21T09:00:00Z",
    submission: {
      number: 12,
      title: "Updated liability clause",
      body: "Updated liability clause",
      submittedBy: "maya",
      submittedAt: "2026-08-20T08:00:00Z",
      mergedAt: "2026-08-21T09:00:00Z",
      mergedBy: "dana",
    },
    reviews: [],
    discussionCount: 0,
    ...overrides,
  };
}

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));
  // The history is fetched on mount; let the promise land before asserting.
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

function historyProps(overrides: Record<string, unknown> = {}) {
  return {
    owner: "alice",
    repo: "contract",
    viewingVersion: null,
    hasCanonicalFile: true,
    downloadingRef: null,
    onDownloadVersion: () => {},
    onViewVersion: () => {},
    onOpenChange: () => {},
    ...overrides,
  };
}

test("each version is a knot on one spline", async () => {
  payload = {
    versions: [version(), version({ version: 2, tagName: "v2" })],
    canonicalFile: null,
  };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  expect(container.querySelectorAll(".doc-spline").length).toBe(1);
  expect(container.querySelectorAll(".doc-spline-entry").length).toBe(2);
  expect(
    [...container.querySelectorAll(".doc-spline-knot")].map(
      (knot) => knot.textContent,
    ),
  ).toEqual(["v3", "v2"]);

  unmount();
});

test("the title is the change review, and it links straight to it", async () => {
  payload = { versions: [version()], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  const link = container.querySelector(".doc-spline-link") as HTMLAnchorElement;
  expect(link.textContent).toBe("Updated liability clause");
  expect(link.getAttribute("href")).toBe("/docs/alice/contract/changes/12");

  unmount();
});

test("clicking the title opens the change review without reloading the page", async () => {
  payload = { versions: [version()], canonicalFile: null };

  const opened: number[] = [];
  const { container, unmount } = await render(
    createElement(
      DocumentHistory,
      historyProps({ onOpenChange: (n: number) => opened.push(n) }),
    ),
  );

  const link = container.querySelector(".doc-spline-link") as HTMLAnchorElement;
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
  });
  flushSync(() => {
    link.dispatchEvent(event);
  });

  expect(opened).toEqual([12]);
  expect(event.defaultPrevented).toBe(true);

  unmount();
});

test("the author and the publisher are both on the spline", async () => {
  payload = { versions: [version()], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  const names = [...container.querySelectorAll(".doc-spline-person-name")].map(
    (name) => name.textContent,
  );
  const roles = [...container.querySelectorAll(".doc-spline-person-role")].map(
    (role) => role.textContent,
  );
  expect(names).toEqual(["Maya", "Dana"]);
  expect(roles).toEqual(["wrote", "published"]);

  unmount();
});

test("View and Download are icons, named for a screen reader only", async () => {
  payload = { versions: [version()], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  const actions = [
    ...container.querySelectorAll(".doc-spline-actions button"),
  ] as HTMLButtonElement[];

  expect(actions.length).toBe(2);
  expect(actions.map((button) => button.textContent)).toEqual(["", ""]);
  expect(actions.map((button) => button.getAttribute("aria-label"))).toEqual([
    "View v3",
    "Download v3",
  ]);

  unmount();
});

test("with no file to download, only View is offered", async () => {
  payload = { versions: [version()], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps({ hasCanonicalFile: false })),
  );

  const actions = [...container.querySelectorAll(".doc-spline-actions button")];
  expect(actions.length).toBe(1);
  expect(actions[0]?.getAttribute("aria-label")).toBe("View v3");

  unmount();
});

test("the version being read is marked on the spline", async () => {
  payload = {
    versions: [version(), version({ version: 2, tagName: "v2" })],
    canonicalFile: null,
  };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps({ viewingVersion: 2 })),
  );

  const marked = [...container.querySelectorAll(".doc-spline-entry")].map(
    (entry) => entry.className.includes("doc-spline-entry--viewing"),
  );
  expect(marked).toEqual([false, true]);

  unmount();
});

test("a version with no surviving change review is plain text, not a dead link", async () => {
  payload = { versions: [version({ submission: null })], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  expect(container.querySelector(".doc-spline-link")).toBeNull();
  expect(container.querySelector(".doc-spline-title")?.textContent).toContain(
    "Version 3",
  );

  unmount();
});

test("a knot does not unfold into a second copy of the review record", async () => {
  // The change review is the review record — it renders the approvals and the
  // discussion threads on its own page. Repeating them here is the same log in
  // two places. The title is the way in.
  payload = { versions: [version()], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  expect(container.querySelector(".doc-spline-toggle")).toBeNull();
  expect(container.querySelector(".doc-spline-detail")).toBeNull();
  expect(container.querySelector(".rev-timeline")).toBeNull();
  expect(container.textContent).not.toContain("review record");

  unmount();
});

test("a knot does not say who approved it", async () => {
  // Everything on this page is published, which is to say approved. Repeating
  // that on every knot distinguishes nothing.
  payload = {
    versions: [
      version({
        reviews: [
          {
            id: 1,
            author: { login: "kit", fullName: "", avatarUrl: "" },
            state: "approved",
            body: "",
            submittedAt: "2026-08-20T10:00:00Z",
            stale: false,
            dismissed: false,
          },
        ],
      }),
    ],
    canonicalFile: null,
  };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  expect(container.textContent).not.toContain("Approved");
  expect(container.textContent).not.toContain("Kit");

  unmount();
});

test("a knot never shows a commit hash", async () => {
  // The reader is a compliance manager. A SHA answers no question they have.
  payload = { versions: [version()], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  expect(container.querySelector("code")).toBeNull();
  expect(container.textContent).not.toContain("abcdef");

  unmount();
});

test("nothing published yet says so instead of drawing an empty line", async () => {
  payload = { versions: [], canonicalFile: null };

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  expect(container.querySelector(".doc-spline")).toBeNull();
  expect(container.textContent).toContain("No published versions yet");

  unmount();
});

test("the whole trail can leave as one file", async () => {
  payload = { versions: [version()], canonicalFile: null };

  const downloads: { name: string; href: string }[] = [];
  const anchorProto = (
    window as unknown as { HTMLAnchorElement: { prototype: HTMLAnchorElement } }
  ).HTMLAnchorElement.prototype;
  const realClick = anchorProto.click;
  anchorProto.click = function capture(this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.href });
  };
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = () => "blob:record";

  const { container, unmount } = await render(
    createElement(DocumentHistory, historyProps()),
  );

  const button = container.querySelector(
    ".doc-record-export-btn",
  ) as HTMLButtonElement;
  expect(button.textContent).toContain("Export record");

  flushSync(() => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });

  expect(downloads.length).toBe(1);
  expect(downloads[0]!.name).toMatch(
    /^contract-audit-record-\d{4}-\d{2}-\d{2}\.html$/,
  );

  anchorProto.click = realClick;
  URL.createObjectURL = realCreate;
  unmount();
});
