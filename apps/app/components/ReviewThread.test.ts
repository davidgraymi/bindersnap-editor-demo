import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { DiscussionThread, ThreadReaction } from "../api";
import { ReviewThread } from "./ReviewThread";

/**
 * Reactions on a review thread, rendered.
 *
 * What has to hold: a chip says how many and whose, clicking your own takes it
 * back rather than adding a second, a read-only visitor sees the count but is
 * not invited to click, and a collapsed thread still shows what people made of
 * it without offering the picker.
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
  "MouseEvent",
] as const;

let originals: Record<string, unknown> = {};

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://bindersnap.com/docs/alice/contract/changes/3",
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
    MouseEvent: dom.window.MouseEvent,
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

function reaction(overrides: Partial<ThreadReaction> = {}): ThreadReaction {
  return {
    content: "+1",
    count: 2,
    users: ["maya", "kit"],
    reactedByViewer: false,
    ...overrides,
  };
}

function thread(overrides: Partial<DiscussionThread> = {}): DiscussionThread {
  return {
    id: "t1",
    origin: "bindersnap",
    comments: [
      {
        id: 1,
        threadId: "t1",
        author: { login: "tom", fullName: "Tom Ward", avatarUrl: "" },
        body: "Does the cap include indemnification claims?",
        createdAt: "2026-08-20T10:00:00Z",
        updatedAt: "2026-08-20T10:00:00Z",
        htmlUrl: "",
      },
    ],
    events: [],
    reactions: [],
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: "2026-08-20T10:00:00Z",
    updatedAt: "2026-08-20T10:00:00Z",
    ...overrides,
  };
}

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

interface ReactCall {
  threadId: string;
  content: string;
  reacted: boolean;
}

function threadProps(overrides: Record<string, unknown> = {}) {
  return {
    thread: thread(),
    canParticipate: true,
    busy: false,
    onReply: async () => true,
    onToggleResolved: async () => {},
    onReact: async () => {},
    ...overrides,
  };
}

function click(element: Element) {
  flushSync(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

test("a chip carries the count and names who reacted", () => {
  const { container, unmount } = render(
    createElement(
      ReviewThread,
      threadProps({ thread: thread({ reactions: [reaction()] }) }) as never,
    ),
  );

  const chip = container.querySelector(".rev-reaction") as HTMLButtonElement;
  expect(chip.textContent).toContain("2");
  expect(chip.title).toBe("maya and kit — Agree");
  expect(chip.getAttribute("aria-pressed")).toBe("false");

  unmount();
});

test("your own reaction is marked, and clicking it takes it back", () => {
  const calls: ReactCall[] = [];
  const { container, unmount } = render(
    createElement(
      ReviewThread,
      threadProps({
        thread: thread({
          reactions: [reaction({ reactedByViewer: true, users: ["maya"] })],
        }),
        onReact: async (
          threadId: string,
          content: string,
          reacted: boolean,
        ) => {
          calls.push({ threadId, content, reacted });
        },
      }) as never,
    ),
  );

  const chip = container.querySelector(".rev-reaction") as HTMLButtonElement;
  expect(chip.className).toContain("rev-reaction--mine");
  expect(chip.getAttribute("aria-pressed")).toBe("true");

  click(chip);

  expect(calls).toEqual([{ threadId: "t1", content: "+1", reacted: false }]);

  unmount();
});

test("the picker offers six reactions and leaves the one you choose", () => {
  const calls: ReactCall[] = [];
  const { container, unmount } = render(
    createElement(
      ReviewThread,
      threadProps({
        onReact: async (
          threadId: string,
          content: string,
          reacted: boolean,
        ) => {
          calls.push({ threadId, content, reacted });
        },
      }) as never,
    ),
  );

  click(container.querySelector(".rev-reaction--add")!);

  const choices = container.querySelectorAll(".rev-reaction-choice");
  expect(choices).toHaveLength(6);

  click(choices[2]!);

  expect(calls).toEqual([{ threadId: "t1", content: "eyes", reacted: true }]);
  // Picking closes the menu — it is one choice, not a checklist.
  expect(container.querySelector(".rev-reaction-menu")).toBeNull();

  unmount();
});

test("a read-only visitor sees the count but is not invited to click", () => {
  const { container, unmount } = render(
    createElement(
      ReviewThread,
      threadProps({
        canParticipate: false,
        thread: thread({ reactions: [reaction()] }),
      }) as never,
    ),
  );

  const chip = container.querySelector(".rev-reaction") as HTMLButtonElement;
  expect(chip.disabled).toBe(true);
  expect(container.querySelector(".rev-reaction--add")).toBeNull();

  unmount();
});

test("a thread nobody reacted to does not grow a reaction row for a reader", () => {
  const { container, unmount } = render(
    createElement(
      ReviewThread,
      threadProps({ canParticipate: false }) as never,
    ),
  );

  expect(container.querySelector(".rev-reactions")).toBeNull();

  unmount();
});

test("a collapsed thread still shows what people made of it", () => {
  // Resolved threads open collapsed. The chips belong to the root comment,
  // which is on screen either way — but a collapsed thread is meant to be
  // small, so it does not also get a picker.
  const { container, unmount } = render(
    createElement(
      ReviewThread,
      threadProps({
        thread: thread({
          resolved: true,
          reactions: [reaction()],
          comments: [
            thread().comments[0]!,
            {
              id: 2,
              threadId: "t1",
              author: { login: "maya", fullName: "Maya Ruiz", avatarUrl: "" },
              body: "Yes — clause 7 covers it.",
              createdAt: "2026-08-20T11:00:00Z",
              updatedAt: "2026-08-20T11:00:00Z",
              htmlUrl: "",
            },
          ],
        }),
      }) as never,
    ),
  );

  expect(container.querySelector(".rev-thread--collapsed")).not.toBeNull();
  expect(container.querySelector(".rev-reaction")).not.toBeNull();
  expect(container.querySelector(".rev-reaction--add")).toBeNull();

  unmount();
});

test("a comment written in Gitea can still be reacted to", () => {
  // It cannot be resolved — there is no marker to hang the event on — but a
  // reaction never gates publishing, so the picker is still offered.
  const { container, unmount } = render(
    createElement(
      ReviewThread,
      threadProps({ thread: thread({ origin: "external" }) }) as never,
    ),
  );

  expect(container.querySelector(".rev-reaction--add")).not.toBeNull();

  unmount();
});
