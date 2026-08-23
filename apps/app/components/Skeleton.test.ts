import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import {
  SkeletonGroup,
  SkeletonLine,
  SkeletonLines,
  SkeletonShape,
} from "./Skeleton";

/**
 * The shapes a page wears while it waits.
 *
 * A skeleton says nothing out loud, so the group around it has to: a reader
 * who cannot see the grey bars still needs the sentence the old "Loading…"
 * box used to carry.
 */

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
    url: "https://bindersnap.com/",
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

function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(element));

  return {
    container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

test("the group announces what is coming while it waits", () => {
  const { container, unmount } = render(
    createElement(
      SkeletonGroup,
      { label: "Loading documents" },
      createElement(SkeletonLine, {}),
    ),
  );

  const group = container.querySelector(".bs-skeleton");
  expect(group?.getAttribute("role")).toBe("status");
  expect(group?.getAttribute("aria-busy")).toBe("true");
  expect(group?.textContent).toBe("Loading documents");

  unmount();
});

test("the group keeps the page's own class, so it holds the page's layout", () => {
  const { container, unmount } = render(
    createElement(
      SkeletonGroup,
      { label: "Loading document", className: "docw-page" },
      createElement(SkeletonShape, { variant: "icon" }),
    ),
  );

  const group = container.querySelector(".bs-skeleton");
  expect(group?.className.split(/\s+/)).toContain("docw-page");
  expect(container.querySelector(".bs-skeleton-shape--icon")).not.toBeNull();

  unmount();
});

test("a line carries its width, and a heading line is its own shape", () => {
  const { container, unmount } = render(
    createElement(
      SkeletonGroup,
      { label: "Loading" },
      createElement(SkeletonLine, { width: "short" }),
      createElement(SkeletonLine, { heading: true }),
    ),
  );

  const lines = container.querySelectorAll(".bs-skeleton-line");
  expect(lines.length).toBe(2);
  expect(lines[0]?.className.split(/\s+/)).toContain("bs-skeleton-line--short");
  expect(lines[1]?.className.split(/\s+/)).toContain(
    "bs-skeleton-line--heading",
  );

  unmount();
});

test("stacked lines vary in width, so a block never reads as ruled paper", () => {
  const { container, unmount } = render(
    createElement(
      SkeletonGroup,
      { label: "Loading" },
      createElement(SkeletonLines, { count: 3 }),
    ),
  );

  const widths = [...container.querySelectorAll(".bs-skeleton-line")].map(
    (line) =>
      [...line.classList].find((name) =>
        name.startsWith("bs-skeleton-line--"),
      ) ?? "",
  );

  expect(widths.length).toBe(3);
  expect(new Set(widths).size).toBe(3);

  unmount();
});
