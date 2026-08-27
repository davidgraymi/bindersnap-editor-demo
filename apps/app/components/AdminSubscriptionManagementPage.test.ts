import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { AdminSubscriptionAccessUser } from "../api";

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

function installDom() {
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

  const captured: Record<string, unknown> = {};
  for (const key of DOM_KEYS) {
    captured[key] = (globalThis as Record<string, unknown>)[key];
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: values[key],
    });
  }

  return captured;
}

const mockListAdminSubscriptionAccess = mock(
  async (
    _query?: string,
    _page?: number,
    _limit?: number,
  ): Promise<{
    users: AdminSubscriptionAccessUser[];
    page: number;
    limit: number;
    hasMore: boolean;
    query: string;
  }> => ({ users: [], page: 1, limit: 20, hasMore: false, query: "" }),
);

const mockSetAdminSubscriptionAccess = mock(
  async (
    _username: string,
    _access: "grant" | "revoke",
  ): Promise<AdminSubscriptionAccessUser> => makeUser({}),
);

const mockClearAdminSubscriptionAccess = mock(
  async (_username: string): Promise<void> => {},
);

const mockSearchWorkspaceUsers = mock(async () => ({
  users: [],
  page: 1,
  limit: 6,
  hasMore: false,
  query: "",
}));

// Spread the real module rather than replacing it: `mock.module` fixes a
// module's export names the first time it is applied, so a partial mock here
// makes every *other* suite that imports an untouched export of `../api` fail
// to link — in a different file, with a confusing message.
const actualApi = await import("../api");

mock.module("../api", () => ({
  ...actualApi,
  listAdminSubscriptionAccess: mockListAdminSubscriptionAccess,
  setAdminSubscriptionAccess: mockSetAdminSubscriptionAccess,
  clearAdminSubscriptionAccess: mockClearAdminSubscriptionAccess,
  searchWorkspaceUsers: mockSearchWorkspaceUsers,
}));

const {
  AdminSubscriptionManagementPage,
  formatSourceLabel,
  isOverrideOutranked,
} = await import("./AdminSubscriptionManagementPage");

function makeUser(
  overrides: Partial<AdminSubscriptionAccessUser>,
): AdminSubscriptionAccessUser {
  return {
    username: "bob",
    fullName: "Bob Barker",
    email: "bob@example.com",
    hasAccess: false,
    accessSource: "none",
    stripeStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    override: null,
    ...overrides,
  } as AdminSubscriptionAccessUser;
}

beforeEach(() => {
  // Typing into a controlled input needs react-dom to have seen a DOM at
  // import time; `scripts/test-preload-dom.ts` guarantees that for the run.
  originals = installDom();

  mockListAdminSubscriptionAccess.mockReset();
  mockSetAdminSubscriptionAccess.mockReset();
  mockClearAdminSubscriptionAccess.mockReset();
  mockSearchWorkspaceUsers.mockReset();
  mockSearchWorkspaceUsers.mockResolvedValue({
    users: [],
    page: 1,
    limit: 6,
    hasMore: false,
    query: "",
  });
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

/** Let the component's awaited handlers land and React re-render. */
async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function findButton(
  container: HTMLElement,
  label: string,
): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes(label),
    ) ?? null
  );
}

function click(element: Element | null) {
  element?.dispatchEvent(new window.Event("click", { bubbles: true }));
}

function typeUsername(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>(
    "#admin-pro-username",
  );
  if (!input) {
    throw new Error("username input not rendered");
  }

  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function submitLookup(container: HTMLElement) {
  const form = container.querySelector("form");
  form?.dispatchEvent(new window.Event("submit", { bubbles: true }));
}

/** Render the page and load a user into the access card. */
async function renderWithLoadedUser(user: AdminSubscriptionAccessUser) {
  mockListAdminSubscriptionAccess.mockResolvedValue({
    users: [user],
    page: 1,
    limit: 20,
    hasMore: false,
    query: user.username,
  });

  const rendered = render(
    createElement(AdminSubscriptionManagementPage, {
      currentUsername: "alice",
    }),
  );

  typeUsername(rendered.container, user.username);
  await settle();
  submitLookup(rendered.container);
  await settle();

  return rendered;
}

test("lookup asks the canonical list endpoint and renders the returned state", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({ hasAccess: true, accessSource: "stripe" }),
  );

  expect(mockListAdminSubscriptionAccess).toHaveBeenCalledTimes(1);
  expect(mockListAdminSubscriptionAccess.mock.calls[0]?.[0]).toBe("bob");

  const card = container.querySelector(".admin-pro-state-card");
  expect(card).not.toBeNull();
  expect(card?.textContent).toContain("bob");
  expect(card?.textContent).toContain("Pro Enabled");
  expect(container.querySelector(".app-inline-error")).toBeNull();

  unmount();
});

test("lookup matches the username case-insensitively", async () => {
  mockListAdminSubscriptionAccess.mockResolvedValue({
    users: [makeUser({ username: "Bob" })],
    page: 1,
    limit: 20,
    hasMore: false,
    query: "BOB",
  });

  const { container, unmount } = render(
    createElement(AdminSubscriptionManagementPage, {
      currentUsername: "alice",
    }),
  );

  typeUsername(container, "BOB");
  await settle();
  submitLookup(container);
  await settle();

  expect(
    container.querySelector(".admin-pro-state-card")?.textContent,
  ).toContain("Bob");

  unmount();
});

test("a list response with no exact match reports the user as not found", async () => {
  mockListAdminSubscriptionAccess.mockResolvedValue({
    users: [makeUser({ username: "bobby" })],
    page: 1,
    limit: 20,
    hasMore: false,
    query: "bob",
  });

  const { container, unmount } = render(
    createElement(AdminSubscriptionManagementPage, {
      currentUsername: "alice",
    }),
  );

  typeUsername(container, "bob");
  await settle();
  submitLookup(container);
  await settle();

  expect(container.querySelector(".app-inline-error")?.textContent).toContain(
    "No workspace user named bob was found.",
  );
  expect(container.querySelector(".admin-pro-state-card")).toBeNull();

  unmount();
});

test("an empty username never reaches the API", async () => {
  const { container, unmount } = render(
    createElement(AdminSubscriptionManagementPage, {
      currentUsername: "alice",
    }),
  );

  submitLookup(container);
  await settle();

  expect(mockListAdminSubscriptionAccess).not.toHaveBeenCalled();
  expect(container.querySelector(".app-inline-error")?.textContent).toContain(
    "Enter a username",
  );

  unmount();
});

test("a failing lookup surfaces the server's message", async () => {
  mockListAdminSubscriptionAccess.mockRejectedValue(
    new Error("Admin access required."),
  );

  const { container, unmount } = render(
    createElement(AdminSubscriptionManagementPage, {
      currentUsername: "alice",
    }),
  );

  typeUsername(container, "bob");
  await settle();
  submitLookup(container);
  await settle();

  expect(container.querySelector(".app-inline-error")?.textContent).toContain(
    "Admin access required.",
  );

  unmount();
});

test("granting sends access=grant and renders the server's user", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({ hasAccess: false, accessSource: "none" }),
  );

  mockSetAdminSubscriptionAccess.mockResolvedValue(
    makeUser({
      hasAccess: true,
      accessSource: "admin_grant",
      override: {
        username: "bob",
        access: "grant",
        updatedBy: "alice",
        updatedAt: 1_760_000_000_000,
      },
    }),
  );

  click(findButton(container, "Grant Pro access"));
  await settle();

  expect(mockSetAdminSubscriptionAccess).toHaveBeenCalledTimes(1);
  expect(mockSetAdminSubscriptionAccess.mock.calls[0]).toEqual([
    "bob",
    "grant",
  ]);

  const card = container.querySelector(".admin-pro-state-card");
  expect(card?.textContent).toContain("Pro Enabled");
  expect(card?.textContent).toContain("Manual override is granting access");
  expect(card?.textContent).toContain("alice");
  expect(container.querySelector(".admin-pro-notice")?.textContent).toContain(
    "Bindersnap Pro access granted for bob.",
  );

  unmount();
});

test("revoking sends access=revoke and renders the server's user", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({ hasAccess: true, accessSource: "stripe" }),
  );

  mockSetAdminSubscriptionAccess.mockResolvedValue(
    makeUser({
      hasAccess: false,
      accessSource: "admin_revoke",
      override: {
        username: "bob",
        access: "revoke",
        updatedBy: "alice",
        updatedAt: 1_760_000_000_000,
      },
    }),
  );

  click(findButton(container, "Revoke Pro access"));
  await settle();

  expect(mockSetAdminSubscriptionAccess.mock.calls[0]).toEqual([
    "bob",
    "revoke",
  ]);

  const card = container.querySelector(".admin-pro-state-card");
  expect(card?.textContent).toContain("Pro Disabled");
  expect(card?.textContent).toContain("Manual override is revoking access");
  expect(container.querySelector(".admin-pro-notice")?.textContent).toContain(
    "Bindersnap Pro access revoked for bob.",
  );

  unmount();
});

test("a failed grant reports the error and does not claim access was given", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({ hasAccess: false }),
  );

  mockSetAdminSubscriptionAccess.mockRejectedValue(
    new Error("Admin overrides can only target another user."),
  );

  click(findButton(container, "Grant Pro access"));
  await settle();

  expect(container.querySelector(".app-inline-error")?.textContent).toContain(
    "Admin overrides can only target another user.",
  );
  expect(container.querySelector(".admin-pro-notice")).toBeNull();
  expect(
    container.querySelector(".admin-pro-state-card")?.textContent,
  ).toContain("Pro Disabled");

  unmount();
});

test("a failed revoke reports the error and leaves access shown as enabled", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({ hasAccess: true, accessSource: "stripe" }),
  );

  mockSetAdminSubscriptionAccess.mockRejectedValue(new Error("boom"));

  click(findButton(container, "Revoke Pro access"));
  await settle();

  expect(container.querySelector(".app-inline-error")?.textContent).toContain(
    "boom",
  );
  expect(
    container.querySelector(".admin-pro-state-card")?.textContent,
  ).toContain("Pro Enabled");

  unmount();
});

test("a thrown non-Error falls back to a readable message", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({ hasAccess: false }),
  );

  mockSetAdminSubscriptionAccess.mockRejectedValue("nope");

  click(findButton(container, "Grant Pro access"));
  await settle();

  expect(container.querySelector(".app-inline-error")?.textContent).toContain(
    "Unable to grant Bindersnap Pro access.",
  );

  unmount();
});

test("grant is disabled while access is on, revoke while it is off", async () => {
  const enabled = await renderWithLoadedUser(
    makeUser({ hasAccess: true, accessSource: "stripe" }),
  );
  expect(findButton(enabled.container, "Grant Pro access")?.disabled).toBe(
    true,
  );
  expect(findButton(enabled.container, "Revoke Pro access")?.disabled).toBe(
    false,
  );
  enabled.unmount();

  mockListAdminSubscriptionAccess.mockReset();
  const disabled = await renderWithLoadedUser(makeUser({ hasAccess: false }));
  expect(findButton(disabled.container, "Grant Pro access")?.disabled).toBe(
    false,
  );
  expect(findButton(disabled.container, "Revoke Pro access")?.disabled).toBe(
    true,
  );
  disabled.unmount();
});

test("clearing an override calls DELETE and re-reads the resulting state", async () => {
  const withOverride = makeUser({
    hasAccess: true,
    accessSource: "admin_grant",
    override: {
      username: "bob",
      access: "grant",
      updatedBy: "alice",
      updatedAt: 1_760_000_000_000,
    },
  });

  const { container, unmount } = await renderWithLoadedUser(withOverride);

  mockListAdminSubscriptionAccess.mockResolvedValue({
    users: [makeUser({ hasAccess: false, accessSource: "none" })],
    page: 1,
    limit: 20,
    hasMore: false,
    query: "bob",
  });

  click(findButton(container, "Clear manual override"));
  await settle();

  expect(mockClearAdminSubscriptionAccess).toHaveBeenCalledTimes(1);
  expect(mockClearAdminSubscriptionAccess.mock.calls[0]?.[0]).toBe("bob");
  // The state shown afterwards is a fresh read, not a local guess.
  expect(mockListAdminSubscriptionAccess).toHaveBeenCalledTimes(2);

  const card = container.querySelector(".admin-pro-state-card");
  expect(card?.textContent).toContain("Pro Disabled");
  expect(card?.textContent).toContain("Not active");
  expect(container.querySelector(".admin-pro-notice")?.textContent).toContain(
    "Manual override cleared for bob.",
  );

  unmount();
});

test("the clear button only appears while an override exists", async () => {
  const none = await renderWithLoadedUser(makeUser({ hasAccess: false }));
  expect(findButton(none.container, "Clear manual override")).toBeNull();
  none.unmount();

  mockListAdminSubscriptionAccess.mockReset();
  const overridden = await renderWithLoadedUser(
    makeUser({
      hasAccess: true,
      accessSource: "admin_grant",
      override: {
        username: "bob",
        access: "grant",
        updatedBy: "alice",
        updatedAt: 1_760_000_000_000,
      },
    }),
  );
  expect(
    findButton(overridden.container, "Clear manual override"),
  ).not.toBeNull();
  overridden.unmount();
});

test("a failed clear reports the error and does not re-read state", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({
      hasAccess: true,
      accessSource: "admin_grant",
      override: {
        username: "bob",
        access: "grant",
        updatedBy: "alice",
        updatedAt: 1_760_000_000_000,
      },
    }),
  );

  mockClearAdminSubscriptionAccess.mockRejectedValue(new Error("still locked"));

  click(findButton(container, "Clear manual override"));
  await settle();

  expect(container.querySelector(".app-inline-error")?.textContent).toContain(
    "still locked",
  );
  expect(mockListAdminSubscriptionAccess).toHaveBeenCalledTimes(1);

  unmount();
});

test("a revoke the config bypass outranks is called out, not shown as taking effect", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({ hasAccess: true, accessSource: "config_bypass" }),
  );

  mockSetAdminSubscriptionAccess.mockResolvedValue(
    makeUser({
      // The server keeps config_bypass ahead of the override, so access stays on.
      hasAccess: true,
      accessSource: "config_bypass",
      override: {
        username: "bob",
        access: "revoke",
        updatedBy: "alice",
        updatedAt: 1_760_000_000_000,
      },
    }),
  );

  click(findButton(container, "Revoke Pro access"));
  await settle();

  const card = container.querySelector(".admin-pro-state-card");
  expect(card?.textContent).toContain("Pro Enabled");
  expect(card?.textContent).toContain("Active but not in effect");
  expect(card?.textContent).toContain("paywall bypass list");
  // The confirmation must not claim a revoke that did not happen.
  const notice =
    container.querySelector(".admin-pro-notice")?.textContent ?? "";
  expect(notice).toContain("not in effect");
  expect(notice).not.toContain("Pro access revoked");

  unmount();
});

test("an override that nothing outranks is not flagged as inert", async () => {
  const { container, unmount } = await renderWithLoadedUser(
    makeUser({
      hasAccess: false,
      accessSource: "admin_revoke",
      override: {
        username: "bob",
        access: "revoke",
        updatedBy: "alice",
        updatedAt: 1_760_000_000_000,
      },
    }),
  );

  const card = container.querySelector(".admin-pro-state-card");
  expect(card?.textContent).toContain("Active");
  expect(card?.textContent).not.toContain("not in effect");
  expect(card?.textContent).not.toContain("paywall bypass list");

  unmount();
});

test("isOverrideOutranked is true only for an override under a config bypass", () => {
  const override = {
    username: "bob",
    access: "revoke" as const,
    updatedBy: "alice",
    updatedAt: 1_760_000_000_000,
  };

  expect(
    isOverrideOutranked(
      makeUser({ accessSource: "config_bypass", override, hasAccess: true }),
    ),
  ).toBe(true);
  expect(
    isOverrideOutranked(
      makeUser({ accessSource: "config_bypass", override: null }),
    ),
  ).toBe(false);
  expect(
    isOverrideOutranked(makeUser({ accessSource: "admin_revoke", override })),
  ).toBe(false);
});

test("formatSourceLabel titles the raw source when there is no override", () => {
  expect(formatSourceLabel(makeUser({ accessSource: "stripe" }))).toBe(
    "Stripe",
  );
  expect(formatSourceLabel(makeUser({ accessSource: "config_bypass" }))).toBe(
    "Config Bypass",
  );
  expect(
    formatSourceLabel(makeUser({ accessSource: "none", hasAccess: false })),
  ).toBe("Pro access is currently disabled");
  expect(
    formatSourceLabel(makeUser({ accessSource: "none", hasAccess: true })),
  ).toBe("Pro access is currently enabled");
});
