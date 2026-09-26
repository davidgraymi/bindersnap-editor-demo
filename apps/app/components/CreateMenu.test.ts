import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { CreateMenu } from "./CreateMenu";

/**
 * The top bar's "+", rendered.
 *
 * Quiet — an icon, named for a screen reader, never coral — and it offers the
 * things that have no page to be added from: a binder and an organization. A
 * document is added on its binder's page.
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

function click(element: Element | null | undefined) {
  flushSync(() => {
    element?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

function menu(org: string | null, calls: string[] = []) {
  return createElement(CreateMenu, {
    org,
    onNewBinder: (inOrg: string) => calls.push(`binder:${inOrg}`),
    onNewOrganization: () => calls.push("organization"),
  });
}

test("the button is quiet and named for a screen reader", () => {
  const { container, unmount } = render(menu("riverside"));

  const button = container.querySelector("button");
  expect(button?.getAttribute("aria-label")).toBe("Create new…");
  expect(button?.getAttribute("aria-haspopup")).toBe("menu");
  expect(button?.textContent?.trim()).toBe("");
  expect(button?.className.split(/\s+/)).toContain("app-topnav-icon-btn");

  unmount();
});

test("it offers a binder in the organization on screen, and an organization", () => {
  const calls: string[] = [];
  const { container, unmount } = render(menu("riverside", calls));

  click(container.querySelector("button"));
  const items = [...container.querySelectorAll('[role="menuitem"]')];
  expect(
    items.map((item) => item.querySelector(".create-menu-name")?.textContent),
  ).toEqual(["New binder", "New organization"]);
  // Not "Add a document": that is the binder page's.
  expect(container.textContent).not.toContain("document");

  click(items[0]);
  expect(calls).toEqual(["binder:riverside"]);
  expect(container.querySelector('[role="menu"]')).toBeNull();

  unmount();
});

test("outside an organization there is no binder to add to", () => {
  const { container, unmount } = render(menu(null));

  click(container.querySelector("button"));
  const names = [...container.querySelectorAll(".create-menu-name")].map(
    (name) => name.textContent,
  );
  expect(names).toEqual(["New organization"]);

  unmount();
});
