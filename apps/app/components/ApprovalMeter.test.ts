import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { ApprovalMeter } from "./ApprovalMeter";

/**
 * The approval counter, rendered.
 *
 * The pips are the part nobody reads — they are the part someone sees. One
 * filled pip per sign-off collected, one empty one per sign-off still owed,
 * so a row says how far along a change is before a word of it is read.
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
    url: "https://bindersnap.com/docs/alice/contract/changes",
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

test("the meter counts sign-offs and fills one pip each", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, { approvalCount: 1, requiredApprovals: 3 }),
  );

  expect(container.textContent).toContain("1 of 3 approvals");
  expect(container.querySelectorAll(".approval-meter-pip")).toHaveLength(3);
  expect(
    container.querySelectorAll(".approval-meter-pip--filled"),
  ).toHaveLength(1);
  expect(container.querySelector(".approval-meter--met")).toBeNull();
  unmount();
});

test("the meter turns over once every approval is in", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, { approvalCount: 2, requiredApprovals: 2 }),
  );

  expect(container.querySelector(".approval-meter--met")).not.toBeNull();
  expect(container.textContent).toContain("2 of 2 approvals");
  unmount();
});

test("a document that requires no approvals gets no meter at all", () => {
  // "0 of 0 approvals" would be a number that answers nothing.
  const { container, unmount } = render(
    createElement(ApprovalMeter, { approvalCount: 0, requiredApprovals: 0 }),
  );

  expect(container.querySelector(".approval-meter")).toBeNull();
  unmount();
});

test("a policy demanding more approvals than fit drops the pips, not the count", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, { approvalCount: 2, requiredApprovals: 9 }),
  );

  expect(container.textContent).toContain("2 of 9 approvals");
  expect(container.querySelectorAll(".approval-meter-pip")).toHaveLength(0);
  unmount();
});
