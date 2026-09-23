import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { ChangeRow } from "./ChangeRow";

/**
 * **The rows line up.**
 *
 * The customer, of the change list: *"I noticed that when there is a
 * conversation count that it moves the status to the left. I want it to be
 * easy on peoples eyes and keep the rows aligned, so make these columns
 * static so that the status doesn't shift left or right."*
 *
 * The cause was a column that only existed on some rows: a count rendered
 * when there was one and nothing at all when there was not, so the standing
 * beside it sat in a different place depending on whether anybody had
 * commented. The cure is a slot that is always in the row, holding its own
 * width, empty when there is nothing to put in it.
 *
 * Measuring the pixels needs a browser. What a unit test can pin is the thing
 * that actually regressed — whether the column is there at all — and that is
 * the thing a later edit would casually undo.
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

function row(commentCount?: number) {
  return createElement(ChangeRow, {
    change: {
      number: 4,
      title: "Fourteen-day training, and point-of-care rub placement",
      submittedBy: "Alice",
      submittedAt: "2026-09-20T10:00:00Z",
      approvalCount: 0,
      requiredApprovals: 1,
      ...(commentCount === undefined ? {} : { commentCount }),
    },
    onOpen: () => {},
  });
}

test("a row nobody has commented on still keeps the column", () => {
  const { container, unmount } = render(row(0));

  const slot = container.querySelector(".change-row-comments");
  expect(slot).not.toBeNull();
  // Empty, not a zero: a zero beside every row is a column of zeroes.
  expect(slot?.textContent).toBe("");
  expect(slot?.getAttribute("aria-hidden")).toBe("true");

  unmount();
});

test("a row with a conversation says how much of one", () => {
  const { container, unmount } = render(row(3));

  const slot = container.querySelector(".change-row-comments");
  expect(slot?.textContent).toBe("3");
  expect(slot?.getAttribute("title")).toBe("3 comments");
  // An empty slot is skipped by a screen reader; a full one is not.
  expect(slot?.getAttribute("aria-hidden")).toBeNull();

  unmount();
});

test("one comment is one comment", () => {
  const { container, unmount } = render(row(1));

  expect(
    container.querySelector(".change-row-comments")?.getAttribute("title"),
  ).toBe("1 comment");

  unmount();
});

/**
 * The alignment itself, as near as a DOM can say it: the standing is the same
 * child of the same parent whether or not there is a count beside it. A row
 * that drops the column moves the standing to a different index, which is the
 * shape of the bug the customer saw.
 */
test("the standing sits in the same place with a count and without", () => {
  const quiet = render(row(0));
  const busy = render(row(3));

  const placeOf = (container: Element) => {
    const right = container.querySelector(".bs-row-right");
    const children = Array.from(right?.children ?? []);
    return {
      total: children.length,
      standing: children.findIndex((child) =>
        child.classList.contains("change-standing"),
      ),
      comments: children.findIndex((child) =>
        child.classList.contains("change-row-comments"),
      ),
    };
  };

  expect(placeOf(quiet.container)).toEqual(placeOf(busy.container));
  expect(placeOf(quiet.container)).toEqual({
    total: 2,
    standing: 0,
    comments: 1,
  });

  quiet.unmount();
  busy.unmount();
});

/** A row with no count at all is a row with a count of none. */
test("a change that has never been asked about is the quiet row", () => {
  const { container, unmount } = render(row());

  expect(container.querySelector(".change-row-comments")?.textContent).toBe("");

  unmount();
});
