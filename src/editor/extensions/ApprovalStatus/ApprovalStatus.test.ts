import { beforeAll, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { JSDOM } from "jsdom";

import { ApprovalStatusBanner } from "./ApprovalStatusBanner";
import type { ApprovalStatusBannerProps } from "./ApprovalStatusBanner";
import type { ApprovalState } from "../../../services/gitea/pullRequests";

const { window } = new JSDOM("<!doctype html><html><body></body></html>");

beforeAll(() => {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLBodyElement: window.HTMLBodyElement,
    DOMParser: window.DOMParser,
    DocumentFragment: window.DocumentFragment,
    MutationObserver: window.MutationObserver,
    getSelection: window.getSelection.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    innerHeight: 900,
    innerWidth: 1440,
  });
});

const stateClassName: Record<ApprovalState, string> = {
  working: "bs-approval--working",
  in_review: "bs-approval--in-review",
  changes_requested: "bs-approval--changes-requested",
  approved: "bs-approval--approved",
  published: "bs-approval--published",
};

const toneClassName: Record<ApprovalState, string> = {
  working: "bs-approval--pending",
  in_review: "bs-approval--pending",
  changes_requested: "bs-approval--rejected",
  approved: "bs-approval--approved",
  published: "bs-approval--approved",
};

const stateBadge: Record<ApprovalState, string> = {
  working: "Draft",
  in_review: "In Review",
  changes_requested: "Changes Requested",
  approved: "Approved",
  published: "Published",
};

const mountBanner = (props: Partial<ApprovalStatusBannerProps>) => {
  const container = document.createElement("div");
  container.className = "bs-editor";
  document.body.appendChild(container);

  const root = createRoot(container);
  const mergedProps: ApprovalStatusBannerProps = {
    approvalState: "working",
    ...props,
  };

  flushSync(() => {
    root.render(createElement(ApprovalStatusBanner, mergedProps));
  });

  const unmount = () => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  };

  return {
    container,
    unmount,
  };
};

describe("ApprovalStatusBanner", () => {
  (Object.keys(stateBadge) as ApprovalState[]).forEach((approvalState) => {
    test(`renders the ${approvalState} state`, () => {
      const { container, unmount } = mountBanner({ approvalState });

      const banner = container.querySelector<HTMLElement>(".bs-approval");

      expect(banner).not.toBeNull();
      expect(banner?.dataset.state).toBe(approvalState);
      expect(banner?.className).toContain(stateClassName[approvalState]);
      expect(banner?.className).toContain(toneClassName[approvalState]);
      expect(banner?.textContent).toContain(stateBadge[approvalState]);

      unmount();
    });
  });

  test("calls submit-for-review from the working state", () => {
    let submitCount = 0;
    const { container, unmount } = mountBanner({
      approvalState: "working",
      onSubmitForReview: () => {
        submitCount += 1;
      },
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );

    expect(button?.textContent).toBe("Submit for review");

    button?.click();

    expect(submitCount).toBe(1);

    unmount();
  });

  test("calls approve and request-changes from the in_review state", () => {
    let approveCount = 0;
    let requestChangesCount = 0;
    const { container, unmount } = mountBanner({
      approvalState: "in_review",
      onApprove: () => {
        approveCount += 1;
      },
      onRequestChanges: () => {
        requestChangesCount += 1;
      },
    });

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
    );

    expect(buttons.map((button) => button.textContent)).toEqual([
      "Approve",
      "Request changes",
    ]);

    buttons[0]?.click();
    buttons[1]?.click();

    expect(approveCount).toBe(1);
    expect(requestChangesCount).toBe(1);

    unmount();
  });

  test("calls submit-for-review from the changes_requested state", () => {
    let submitCount = 0;
    const { container, unmount } = mountBanner({
      approvalState: "changes_requested",
      onSubmitForReview: () => {
        submitCount += 1;
      },
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[type="button"]',
    );

    expect(button?.textContent).toBe("Submit for review");

    button?.click();

    expect(submitCount).toBe(1);

    unmount();
  });

  test("renders the review link when prUrl is provided", () => {
    const { container, unmount } = mountBanner({
      approvalState: "approved",
      prUrl: "/pulls/42",
    });

    const link = container.querySelector<HTMLAnchorElement>(".bs-approval__link");

    expect(link?.textContent).toBe("Open review trail");
    expect(link?.getAttribute("href")).toBe("/pulls/42");

    unmount();
  });
});
