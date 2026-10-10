import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { withQueryClient } from "../data/testing";
import { FeedbackDialog } from "./FeedbackDialog";

/**
 * Send feedback, rendered: a few words, what the app knew, and Turnstile's
 * token, posted to the feedback Worker. Turnstile and the Worker are stood in
 * for; `services/feedback` tests the other side.
 */

let resets = 0;

beforeEach(() => {
  resets = 0;
  process.env.BUN_PUBLIC_FEEDBACK_URL = "https://feedback.test/";
  process.env.BUN_PUBLIC_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
  (window as { turnstile?: unknown }).turnstile = {
    render: (_: HTMLElement, options: { callback: (t: string) => void }) => {
      queueMicrotask(() => options.callback(`token-${resets}`));
      return "widget-1";
    },
    reset: () => {
      resets += 1;
    },
    remove: () => {},
  };
});

afterEach(() => {
  delete process.env.BUN_PUBLIC_FEEDBACK_URL;
  delete process.env.BUN_PUBLIC_TURNSTILE_SITE_KEY;
  delete (window as { turnstile?: unknown }).turnstile;
});

function render(onClose = () => {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      withQueryClient(
        createElement(FeedbackDialog, {
          context: {
            route: { kind: "binder", org: "acme", binder: "policies" },
            user: { username: "alice", fullName: "Alice Doe" },
            organization: { name: "acme", displayName: "Acme Health" },
          },
          onClose,
        }),
      ),
    ),
  );
  return {
    container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

/** Type the way React hears it: the native setter, then an input event. */
function type(field: Element | null, value: string) {
  const element = field as HTMLInputElement | HTMLTextAreaElement;
  const proto = Object.getPrototypeOf(element);
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  flushSync(() => {
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function click(element: Element | null | undefined) {
  flushSync(() => {
    element?.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function sendButton(container: HTMLElement): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((button) =>
    /Send|Checking|Sending/.test(button.textContent ?? ""),
  ) as HTMLButtonElement;
}

test("nothing goes until there is a summary, a description and a token", async () => {
  const { container, unmount } = render();
  expect(sendButton(container).disabled).toBe(true);

  await settle();
  type(container.querySelector("#feedback-summary"), "Publishing does nothing");
  expect(sendButton(container).disabled).toBe(true);
  type(container.querySelector("#feedback-description"), "I pressed it.");
  expect(sendButton(container).disabled).toBe(false);
  expect(sendButton(container).textContent).toBe("Send");

  unmount();
});

test("it shows what it will send, before it sends it", () => {
  const { container, unmount } = render();
  const details = container.querySelector(".feedback-dialog-trace");
  expect(details?.textContent).toContain("Alice Doe (alice), in Acme Health");
  const json = JSON.parse(
    container.querySelector(".feedback-dialog-json")?.textContent ?? "{}",
  );
  expect(json.route).toEqual({
    kind: "binder",
    org: "acme",
    binder: "policies",
  });
  unmount();
});

test("a report is posted with its kind, words, trace and token", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
    Response.json(
      { received: true },
      { status: 201 },
    )) as unknown as typeof fetch);
  const { container, unmount } = render();
  try {
    await settle();
    click(
      [...container.querySelectorAll(".bs-seg")].find(
        (button) => button.textContent === "An idea",
      ),
    );
    type(container.querySelector("#feedback-summary"), "Sort by owner");
    type(container.querySelector("#feedback-description"), "Please.");
    click(sendButton(container));
    await settle();

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://feedback.test/");
    expect(init?.credentials).toBe("omit");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      kind: "idea",
      title: "Sort by owner",
      description: "Please.",
      turnstileToken: "token-0",
    });
    expect(body.trace.user).toEqual({ username: "alice", name: "Alice Doe" });
    expect(container.textContent).toContain("Thanks — it’s with us.");
  } finally {
    fetchSpy.mockRestore();
    unmount();
  }
});

test("a refusal is shown in the Worker's words, and Turnstile asked again", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () =>
    Response.json(
      { error: "That's a lot of feedback at once. Try again in a minute." },
      { status: 429 },
    )) as unknown as typeof fetch);
  const { container, unmount } = render();
  try {
    await settle();
    type(container.querySelector("#feedback-summary"), "Again");
    type(container.querySelector("#feedback-description"), "And again.");
    click(sendButton(container));
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "That's a lot of feedback at once. Try again in a minute.",
    );
    expect(resets).toBe(1);
    // What they wrote is still there to send again.
    expect(
      (container.querySelector("#feedback-summary") as HTMLInputElement).value,
    ).toBe("Again");
  } finally {
    fetchSpy.mockRestore();
    unmount();
  }
});

test("Escape closes it", () => {
  let closed = false;
  const { unmount } = render(() => {
    closed = true;
  });
  flushSync(() => {
    window.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape" }),
    );
  });
  expect(closed).toBe(true);
  unmount();
});
