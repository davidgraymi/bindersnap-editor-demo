import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { ApprovalMeter } from "./ApprovalMeter";
import type { ChangeReviewer } from "../api";
import type { ChangeRecord } from "../documentDisplay";

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

function reviewer(
  login: string,
  status: ChangeReviewer["status"],
): ChangeReviewer {
  return {
    login,
    fullName: "",
    avatarUrl: "",
    status,
    reviewedAt: "",
    stale: false,
    requested: true,
  };
}

function change(overrides: Partial<ChangeRecord> = {}): ChangeRecord {
  return {
    number: 1,
    summary: "Submitted by Alice",
    description: "",
    branchName: "bs/1",
    submittedBy: "alice",
    submittedAt: "2026-08-21T07:38:00Z",
    open: true,
    reviews: [],
    approvalState: "awaiting",
    outcome: null,
    closedAt: null,
    decidedBy: null,
    publishedVersion: null,
    assignee: null,
    reviewers: [],
    approvalCount: 0,
    requiredApprovals: 0,
    ...overrides,
  };
}

test("the meter counts sign-offs and fills one pip each", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, {
      change: change({
        approvalCount: 1,
        requiredApprovals: 3,
        reviewers: [reviewer("bob", "approved")],
      }),
    }),
  );

  expect(container.textContent).toContain("1 of 3 approvals");
  expect(container.querySelectorAll(".approval-meter-pip")).toHaveLength(3);
  expect(
    container.querySelectorAll(".approval-meter-pip--filled"),
  ).toHaveLength(1);
  expect(container.querySelector(".approval-meter--ready")).toBeNull();
  unmount();
});

test("the meter turns over once every approval is in", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, {
      change: change({
        approvalCount: 2,
        requiredApprovals: 2,
        reviewers: [reviewer("bob", "approved"), reviewer("carol", "approved")],
      }),
    }),
  );

  expect(container.querySelector(".approval-meter--ready")).not.toBeNull();
  expect(container.textContent).toContain("2 of 2 approvals");
  expect(container.textContent).toContain("Ready to publish");
  unmount();
});

test("a document that requires no approvals gets no meter at all", () => {
  // "0 of 0 approvals" would be a number that answers nothing.
  const { container, unmount } = render(
    createElement(ApprovalMeter, { change: change({ requiredApprovals: 0 }) }),
  );

  expect(container.querySelector(".approval-meter")).toBeNull();
  unmount();
});

test("a policy demanding more approvals than fit drops the pips, not the count", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, {
      change: change({ approvalCount: 2, requiredApprovals: 9 }),
    }),
  );

  expect(container.textContent).toContain("2 of 9 approvals");
  expect(container.querySelectorAll(".approval-meter-pip")).toHaveLength(0);
  unmount();
});

test("a reviewer asking for changes outranks a full approval count", () => {
  // The bug this replaced: Gitea keeps an approval after the same reviewer
  // asks for changes, so the page showed a red CHANGES REQUESTED badge beside
  // a green "1 of 1 approvals". One pill, worst news first.
  const { container, unmount } = render(
    createElement(ApprovalMeter, {
      change: change({
        approvalCount: 1,
        requiredApprovals: 1,
        approvalState: "changes_requested",
        reviewers: [reviewer("bob", "changes_requested")],
      }),
    }),
  );

  expect(container.querySelector(".approval-meter--blocked")).not.toBeNull();
  expect(container.textContent).toContain("Bob asked for changes");
  expect(container.textContent).not.toContain("Ready to publish");
  unmount();
});

test("an open thread blocks just as loudly as a request for changes", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, {
      change: change({
        approvalCount: 1,
        requiredApprovals: 1,
        reviewers: [reviewer("bob", "approved")],
      }),
      openThreadAuthors: new Set(["bob"]),
    }),
  );

  expect(container.querySelector(".approval-meter--blocked")).not.toBeNull();
  expect(container.textContent).toContain("Bob left a thread open");
  unmount();
});

test("a change short of approvals names who it waits on", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, {
      change: change({
        approvalCount: 1,
        requiredApprovals: 2,
        reviewers: [reviewer("bob", "approved"), reviewer("carol", "awaiting")],
      }),
    }),
  );

  expect(container.textContent).toContain("1 of 2 approvals");
  expect(container.textContent).toContain("Waiting on Carol");
  unmount();
});

test("a closed change is its outcome, not a count", () => {
  const { container, unmount } = render(
    createElement(ApprovalMeter, {
      change: change({
        open: false,
        outcome: "published",
        approvalCount: 2,
        requiredApprovals: 2,
      }),
    }),
  );

  expect(container.querySelector(".approval-meter")).toBeNull();
  unmount();
});
