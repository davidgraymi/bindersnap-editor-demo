import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { ChangeStateBadge, ChangeTabs } from "./ChangeTabs";

/**
 * The top of a change request: whether it is open, and its two screens as
 * tabs. Rendered for real, because what matters is that the tabs are links
 * with addresses and that the badge never guesses.
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

const OVERVIEW = "/riverside-health/clinical?tab=changes&change=4";
const CHANGES = `${OVERVIEW}&view=compare`;

function tabs(view: "discussion" | "compare", documentCount = 2) {
  return createElement(ChangeTabs, {
    view,
    overviewHref: OVERVIEW,
    changesHref: CHANGES,
    documentCount,
    onSelect: () => {},
  });
}

test("the two screens are links, so either opens in a new tab", () => {
  const { container, unmount } = render(tabs("discussion"));

  const links = [...container.querySelectorAll("a")];
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    OVERVIEW,
    CHANGES,
  ]);
  expect(container.querySelector("button")).toBeNull();

  unmount();
});

test("the tab on screen is marked as the page, and only that one", () => {
  const overview = render(tabs("discussion"));
  expect(
    overview.container.querySelector('[aria-current="page"]')?.textContent,
  ).toBe("Overview");
  overview.unmount();

  const changes = render(tabs("compare"));
  expect(
    changes.container.querySelector('[aria-current="page"]')?.textContent,
  ).toBe("Changes2");
  changes.unmount();
});

test("Changes counts the documents, and a change to the rules has none", () => {
  const some = render(tabs("discussion", 3));
  expect(some.container.querySelector(".doc-tab-count")?.textContent).toBe("3");
  some.unmount();

  const none = render(tabs("discussion", 0));
  expect(none.container.querySelector(".doc-tab-count")).toBeNull();
  none.unmount();
});

test("the badge says open, published, or closed, and never guesses why", () => {
  const cases = [
    ["open", "Open"],
    ["published", "Published"],
    ["declined", "Declined"],
    ["withdrawn", "Withdrawn"],
    // Ended without publishing, and the page cannot tell who ended it.
    ["closed", "Closed"],
  ] as const;

  for (const [state, label] of cases) {
    const { container, unmount } = render(
      createElement(ChangeStateBadge, { state }),
    );
    expect(container.textContent).toBe(label);
    unmount();
  }
});
