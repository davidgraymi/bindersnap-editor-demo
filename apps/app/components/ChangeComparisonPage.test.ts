import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import * as api from "../api";
import type {
  WorkspaceChangedDocument,
  WorkspaceRemovedDocument,
} from "../../../packages/api-schema/schemas/workspaces";

/**
 * Everything one change does, on one screen.
 *
 * What has to survive: every document the change touches is on the page at
 * once, a document coming *off* the record says so rather than being quietly
 * left out, and a brand-new policy is read rather than refused for having no
 * earlier version to be compared with.
 */

const files: Record<string, string> = {};

mock.module("../api", () => ({
  ...api,
  downloadDocument: async (_scope: unknown, ref: string) =>
    new Blob([files[ref] ?? ""]),
}));

const { buildChangedDocumentRows } = await import("../changedDocuments");
const { ChangeComparisonPage } = await import("./ChangeComparisonPage");

const DOM_KEYS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "MutationObserver",
  "Event",
  "DOMParser",
] as const;

let originals: Record<string, unknown> = {};

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://bindersnap.com/riverside/clinical?tab=changes&change=4&view=compare",
  });

  // jsdom does not scroll, and the rail's job is to ask it to.
  dom.window.Element.prototype.scrollIntoView = () => {};

  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    DOMParser: dom.window.DOMParser,
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
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const key of Object.keys(files)) delete files[key];

  for (const key of DOM_KEYS) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: originals[key],
    });
  }
});

async function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));

  // Every comparison on the page fetches two files and reads both. Poll until
  // none of them is still drawing a skeleton rather than guessing at a delay.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    flushSync(() => {});
    if (!container.querySelector(".bs-skeleton")) break;
  }

  return {
    container,
    click(selector: string) {
      const node = container.querySelector<HTMLElement>(selector);
      if (!node) throw new Error(`No ${selector} on the page.`);
      act(() => node.click());
    },
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

function version(name: string, number: number) {
  return {
    tag: `${name}-v${number}`,
    version: number,
    commitSha: `sha-${name}-${number}`,
    publishedAt: "2026-04-01T00:00:00Z",
  };
}

function changed(
  name: string,
  overrides: Partial<WorkspaceChangedDocument> = {},
): WorkspaceChangedDocument {
  return {
    path: `clinical/${name}.01J8XZ4K7MQ1RSTVWXYZ0ABCDE.md`,
    slugPath: `clinical/${name}`,
    name,
    uid: `uid-${name}`,
    folder: "clinical",
    size: 120,
    sha: "blob",
    nextVersion: 3,
    currentVersion: version(name, 2),
    versions: [version(name, 2), version(name, 1)],
    previousSlugPath: null,
    ...overrides,
  };
}

function removed(name: string): WorkspaceRemovedDocument {
  return {
    path: `clinical/${name}.01J9XZ4K7MQ1RSTVWXYZ0ABCDE.md`,
    slugPath: `clinical/${name}`,
    name,
    uid: `uid-${name}`,
    folder: "clinical",
    size: 90,
    sha: "blob",
    lastVersion: version(name, 4),
  };
}

function page(
  documents: WorkspaceChangedDocument[],
  removedDocuments: WorkspaceRemovedDocument[] = [],
) {
  return createElement(ChangeComparisonPage, {
    org: "riverside",
    binder: "clinical",
    changeNumber: 4,
    title: "Spring policy refresh",
    open: true,
    rows: buildChangedDocumentRows({
      documents,
      removedDocuments,
      open: true,
    }),
    headRef: "change-4",
    onBackToChange: () => {},
    onReadFile: () => {},
    onOpenDocument: () => {},
    onDownload: () => {},
  });
}

test("every document the change touches is on the one screen", async () => {
  files["hand-hygiene-v2"] = "# Hand hygiene\n\nWash for thirty seconds.";
  files["visitor-policy-v2"] = "# Visitors\n\nTwo per room.";
  files["change-4"] = "# Hand hygiene\n\nWash for sixty seconds.";

  const { container, unmount } = await render(
    page([changed("hand-hygiene"), changed("visitor-policy")]),
  );

  expect(container.querySelectorAll(".cmp-file").length).toBe(2);
  // The rail is the map: one row per document, so nothing is reachable only
  // by scrolling past everything above it.
  expect(container.querySelectorAll(".bs-rail .bs-row").length).toBe(2);
  expect(
    [...container.querySelectorAll(".bs-rail .bs-row-name")].map(
      (node) => node.textContent,
    ),
  ).toEqual(["Hand Hygiene", "Visitor Policy"]);

  // And each one is a real comparison, not a link to one.
  expect(container.querySelector("del")?.textContent).toBe("thirty");
  expect(container.querySelector("ins")?.textContent).toBe("sixty");

  unmount();
});

test("the scale line adds up what the whole change does", async () => {
  files["hand-hygiene-v2"] = "Wash for thirty seconds.";
  files["change-4"] = "Wash for sixty seconds.";

  const { container, unmount } = await render(page([changed("hand-hygiene")]));

  const scale = container.querySelector(".cmp-scale")?.textContent ?? "";
  expect(scale).toContain("1 document");
  expect(scale).toContain("1 word added");
  expect(scale).toContain("1 word removed");

  unmount();
});

test("a document coming off the record says so instead of drawing a diff", async () => {
  files["change-4"] = "# Hand hygiene\n\nWash for sixty seconds.";
  files["hand-hygiene-v2"] = "# Hand hygiene\n\nWash for thirty seconds.";

  const { container, unmount } = await render(
    page([changed("hand-hygiene")], [removed("visitor-policy")]),
  );

  const notice =
    container.querySelector(".cmp-removed-line")?.textContent ?? "";
  expect(notice).toContain("Visitor Policy");
  expect(notice).toContain("off the record");
  // The history is what the product sells, so the page says it survives.
  expect(notice).toContain("v4");
  expect(container.querySelector(".cmp-kind--removed")?.textContent).toContain(
    "Taken off the record",
  );

  unmount();
});

test("a brand-new policy is read whole rather than refused", async () => {
  files["change-4"] = "# Visitors\n\nTwo per room, by appointment.";

  const { container, unmount } = await render(
    page([
      changed("visitor-policy", {
        currentVersion: null,
        versions: [],
        nextVersion: 1,
      }),
    ]),
  );

  expect(container.querySelector(".cmp-kind--added")?.textContent).toContain(
    "New document",
  );
  expect(container.querySelector(".cmp-file-note")?.textContent).toContain(
    "no earlier version",
  );
  // The whole policy, not an empty frame apologising for having no before.
  expect(container.textContent).toContain("Two per room, by appointment.");

  unmount();
});

test("a document can be folded away, and marking it read folds it", async () => {
  files["hand-hygiene-v2"] = "Wash for thirty seconds.";
  files["visitor-policy-v2"] = "Two per room.";
  files["change-4"] = "Wash for sixty seconds.";

  const { container, click, unmount } = await render(
    page([changed("hand-hygiene"), changed("visitor-policy")]),
  );

  const body = () =>
    container.querySelector<HTMLElement>(".cmp-file .cmp-file-body");
  expect(body()?.hidden).toBe(false);

  click(".cmp-file .cmp-file-fold");
  expect(body()?.hidden).toBe(true);

  // Unfolding, then finishing with it: reading something is being done with
  // it, so the tick puts it away again.
  click(".cmp-file .cmp-file-fold");
  expect(body()?.hidden).toBe(false);

  click(".cmp-file .cmp-file-read");
  expect(body()?.hidden).toBe(true);
  expect(container.querySelector(".cmp-rail-row--read")).not.toBeNull();
  expect(container.querySelector(".bs-rail-note")?.textContent).toContain(
    "1 of 2 read",
  );
  // And it is a bookmark, never a review — a page about approvals cannot let
  // a checkbox look like one.
  expect(container.querySelector(".bs-rail-note")?.textContent).toContain(
    "It records nothing",
  );

  unmount();
});

test("a change that versions no document says what it does instead", async () => {
  const element = createElement(ChangeComparisonPage, {
    org: "riverside",
    binder: "clinical",
    changeNumber: 7,
    title: "Who signs off on nursing",
    open: true,
    // A sign-off rules change: it goes through the same review as a policy and
    // publishes no version at all.
    rows: [],
    headRef: "sign-off/nursing",
    onBackToChange: () => {},
    onReadFile: () => {},
    onOpenDocument: () => {},
    onDownload: () => {},
  });

  const { container, unmount } = await render(element);

  expect(container.querySelector(".bs-note")?.textContent).toContain(
    "versions no document",
  );
  expect(container.querySelector(".bs-rail")).toBeNull();

  unmount();
});

test("a change with no branch on record says why it cannot compare", async () => {
  const element = createElement(ChangeComparisonPage, {
    org: "riverside",
    binder: "clinical",
    changeNumber: 4,
    title: "Spring policy refresh",
    open: true,
    rows: buildChangedDocumentRows({
      documents: [changed("hand-hygiene")],
      removedDocuments: [],
      open: true,
    }),
    headRef: null,
    onBackToChange: () => {},
    onReadFile: () => {},
    onOpenDocument: () => {},
    onDownload: () => {},
  });

  const { container, unmount } = await render(element);

  expect(container.querySelector(".bs-note")?.textContent).toContain(
    "no branch on record",
  );
  expect(container.querySelector(".cmp-file")).toBeNull();

  unmount();
});
