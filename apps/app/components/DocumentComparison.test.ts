import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import * as api from "../api";

/**
 * The comparison screen, rendered.
 *
 * What has to survive: the reviewer sees one readable document with the
 * change marked inside it, and a file a browser cannot read inside says so
 * instead of showing an empty frame.
 */

const files: Record<string, string> = {};

mock.module("../api", () => ({
  ...api,
  downloadDocument: async (_owner: string, _repo: string, ref: string) =>
    new Blob([files[ref] ?? ""]),
}));

const { DocumentComparison } = await import("./DocumentComparison");

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
  await new Promise((resolve) => setTimeout(resolve, 20));

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
  // Both versions are fetched and read on mount.
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync(() => {});
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

function comparison(overrides: Record<string, unknown> = {}) {
  return createElement(DocumentComparison, {
    owner: "alice",
    repo: "contract",
    base: { ref: "v3", label: "v3" },
    headRef: "change-4",
    headLabel: "This change",
    fileName: "contract.md",
    onDownload: () => {},
    ...overrides,
  } as never);
}

test("a Markdown change reads as one document with the change marked in it", async () => {
  files["v3"] = "# Vendor terms\n\nPayment is due within thirty days.";
  files["change-4"] = "# Vendor terms\n\nPayment is due within sixty days.";

  const { container, unmount } = await render(comparison());

  // Still a document: the heading is a heading, not a line of diff output.
  expect(container.querySelector("h1")?.textContent).toBe("Vendor terms");
  expect(container.querySelector("del")?.textContent).toBe("thirty");
  expect(container.querySelector("ins")?.textContent).toBe("sixty");
  expect(container.textContent).toContain("1 word added · 1 word removed");

  unmount();
});

test("two identical versions say so instead of showing an empty page", async () => {
  files["v3"] = "Nothing moved.";
  files["change-4"] = "Nothing moved.";

  const { container, unmount } = await render(comparison());

  expect(container.textContent).toContain(
    "Nothing changed — these two versions read the same.",
  );
  expect(container.querySelector("ins")).toBeNull();
  expect(container.querySelector("del")).toBeNull();

  unmount();
});

test("plain text is compared word by word, not line by line", async () => {
  files["v3"] = "The vendor shall notify us.";
  files["change-4"] = "The supplier shall notify us.";

  const { container, unmount } = await render(
    comparison({ fileName: "notes.txt" }),
  );

  expect(container.querySelector("del")?.textContent).toBe("vendor");
  expect(container.querySelector("ins")?.textContent).toBe("supplier");
  // The untouched words are still there, so the sentence still reads.
  expect(container.textContent).toContain("shall notify us.");

  unmount();
});

test("a file the browser cannot read inside offers both versions instead", async () => {
  const saved: string[] = [];
  const { container, unmount } = await render(
    comparison({
      fileName: "contract.docx",
      onDownload: (ref: string) => saved.push(ref),
    }),
  );

  expect(container.textContent).toContain("Word document");
  expect(container.querySelector("ins")).toBeNull();

  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.map((button) => button.textContent?.trim())).toEqual([
    "v3",
    "This change",
  ]);

  // Each button saves its own side, so the reviewer gets the pair they need
  // to compare in Word.
  flushSync(() => {
    buttons[0]!.dispatchEvent(new window.Event("click", { bubbles: true }));
    buttons[1]!.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  expect(saved).toEqual(["v3", "change-4"]);

  unmount();
});
