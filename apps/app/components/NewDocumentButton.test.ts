import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { NewDocumentButton } from "./NewDocumentButton";

/**
 * The nav's create action, rendered.
 *
 * The point of this button is restraint: it has to stay reachable and named
 * for a screen reader while giving up the coral that belongs to whatever the
 * page itself is asking for.
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

test("the button is named for a screen reader and on hover", () => {
  const { container, unmount } = render(
    createElement(NewDocumentButton, { onClick: () => {} }),
  );

  const button = container.querySelector("button");
  expect(button).not.toBeNull();
  expect(button?.getAttribute("aria-label")).toBe("New document");
  expect(button?.getAttribute("title")).toBe("New document");
  expect(button?.getAttribute("type")).toBe("button");

  unmount();
});

test("the button stays quiet — no visible label, no coral styling", () => {
  const { container, unmount } = render(
    createElement(NewDocumentButton, { onClick: () => {} }),
  );

  const button = container.querySelector("button");
  // Icon only: nothing in the button reads as a word on screen.
  expect(button?.textContent?.trim()).toBe("");
  expect(container.querySelector("svg")).not.toBeNull();
  // It borrows the nav's plain icon-button styling rather than a coral CTA.
  expect(button?.className.split(/\s+/)).toContain("app-topnav-icon-btn");

  unmount();
});

test("clicking it asks for a new document", () => {
  let clicks = 0;
  const { container, unmount } = render(
    createElement(NewDocumentButton, {
      onClick: () => {
        clicks += 1;
      },
    }),
  );

  const button = container.querySelector("button");
  flushSync(() => {
    button?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });

  expect(clicks).toBe(1);

  unmount();
});
