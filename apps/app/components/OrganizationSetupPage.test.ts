import { expect, test } from "bun:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { OrganizationSetupPage } from "./OrganizationSetupPage";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://bindersnap.com/organizations/new",
  });

  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    Event: dom.window.Event,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  return dom;
}

interface RenderOptions {
  suggestedName?: string | null;
  isFirstOrganization?: boolean;
  reason?: "blocked-write" | null;
  onCreate?: (name: string) => Promise<void>;
  onSkip?: () => void;
}

function render(options: RenderOptions = {}) {
  installDom();

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  flushSync(() => {
    root.render(
      createElement(OrganizationSetupPage, {
        suggestedName: options.suggestedName ?? null,
        isFirstOrganization: options.isFirstOrganization ?? true,
        reason: options.reason ?? null,
        onCreate: options.onCreate ?? (async () => {}),
        onSkip: options.onSkip ?? (() => {}),
      }),
    );
  });

  return {
    container,
    html: () => container.innerHTML,
    cleanup: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

test("shows the address the typed name will actually become", () => {
  // "Mercy Health" cannot be a Gitea org username, so the person is choosing
  // `mercy-health` whether they know it or not. Show them before they commit.
  const page = render({ suggestedName: "Mercy Health" });

  expect(page.html()).toContain("mercy-health");
  page.cleanup();
});

test("promises a trial only when this would be their first organization", () => {
  const first = render({ isFirstOrganization: true });
  expect(first.html()).toContain("14-day trial");
  first.cleanup();

  // The trial goes to a person's first organization only, so promising one on
  // their second would be a lie told in the moment it costs the most trust.
  const second = render({ isFirstOrganization: false });
  expect(second.html()).not.toContain("14-day trial");
  second.cleanup();
});

test("offers no way to join an organization by typing its name", () => {
  // Binders are private. A join-by-name field would let anyone who guesses a
  // customer's name walk into their policy manual, so joining is something an
  // owner does to you, never something you do to them.
  const page = render();
  const inputs = page.container.querySelectorAll("input");

  expect(inputs).toHaveLength(1);
  expect(inputs[0]!.getAttribute("id")).toBe("organization-name");
  expect(page.html()).toContain("Ask an owner to add you");
  page.cleanup();
});

test("can be skipped", () => {
  let skipped = false;
  const page = render({ onSkip: () => (skipped = true) });

  const skip = [...page.container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Skip for now"),
  );
  expect(skip).toBeDefined();

  flushSync(() => {
    skip!.dispatchEvent(new Event("click", { bubbles: true }));
  });
  expect(skipped).toBe(true);
  page.cleanup();
});

test("a blocked write says why they are here", () => {
  const page = render({ reason: "blocked-write" });

  expect(page.html()).toContain("to start writing");
  page.cleanup();
});
