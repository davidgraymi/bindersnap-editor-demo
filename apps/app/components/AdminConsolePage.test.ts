import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { AdminOverviewPayload, AdminUserListPayload } from "../api";
import type { AppRoute } from "../routes";

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
    url: "https://app.bindersnap.com/-/admin",
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

const overview: AdminOverviewPayload = {
  checkedAt: Date.UTC(2026, 9, 27, 12),
  checks: [
    { id: "api", label: "API", status: "ok", detail: "Release v0.4.95." },
    {
      id: "mail",
      label: "Email",
      status: "down",
      detail: "The oldest email has waited 40 minutes.",
    },
  ],
  counts: { users: 42, organizations: 7, binders: 19, unconfirmedEmails: 3 },
  billing: {
    paying: 4,
    pastDue: 1,
    trial: 2,
    trialEnded: 0,
    comped: 0,
    revoked: 0,
    canceled: 0,
    none: 0,
  },
};

const users: AdminUserListPayload = {
  users: [
    {
      username: "jkim",
      fullName: "Jordan Kim",
      email: "jordan@example.com",
      emailConfirmation: "waiting",
      emailConfirmedAt: null,
      isSiteAdmin: false,
      active: true,
      prohibitLogin: false,
      createdAt: Date.UTC(2026, 2, 14),
      lastLoginAt: null,
      liveSessions: 1,
      organizations: ["riverside-health"],
    },
  ],
  query: "",
  page: 1,
  limit: 25,
  total: 1,
  hasMore: false,
};

const mockGetAdminOverview = mock(async () => overview);
const mockListAdminUsers = mock(async (..._args: unknown[]) => users);

// Spread the real module: see AdminSubscriptionManagementPage.test.ts.
const actualApi = await import("../api");
mock.module("../api", () => ({
  ...actualApi,
  getAdminOverview: mockGetAdminOverview,
  listAdminUsers: mockListAdminUsers,
}));

const { AdminConsolePage } = await import("./AdminConsolePage");

beforeEach(() => {
  originals = installDom();
  mockGetAdminOverview.mockClear();
  mockListAdminUsers.mockClear();
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

function render(props: Parameters<typeof AdminConsolePage>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(AdminConsolePage, props)));
  return {
    container,
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("the overview leads with the worst health check and the deployment's size", async () => {
  const { container, unmount } = render({
    section: "overview",
    currentUsername: "alice",
    onNavigate: () => {},
  });
  try {
    await settle();
    const text = container.textContent ?? "";
    expect(text).toContain("Something is down");
    expect(text).toContain("The oldest email has waited 40 minutes.");
    expect(text).toContain("42");
    expect(text).toContain("3 have not confirmed their email");
    expect(text).toContain("4 paying, 2 in trial");
  } finally {
    unmount();
  }
});

test("each section is a link to its own address", async () => {
  const visited: AppRoute[] = [];
  const { container, unmount } = render({
    section: "overview",
    currentUsername: "alice",
    onNavigate: (route) => visited.push(route),
  });
  try {
    await settle();
    const tabs = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".doc-tab"),
    );
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual([
      "/-/admin",
      "/-/admin/users",
      "/-/admin/organizations",
      "/-/admin/binders",
      "/-/admin/subscriptions",
    ]);
    tabs[1]!.dispatchEvent(
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
    expect(visited).toEqual([{ kind: "admin", section: "users" }]);
  } finally {
    unmount();
  }
});

test("people show their email and whether they confirmed it", async () => {
  const { container, unmount } = render({
    section: "users",
    currentUsername: "alice",
    onNavigate: () => {},
  });
  try {
    await settle();
    expect(mockListAdminUsers).toHaveBeenCalledWith("", 1, 25);
    const text = container.textContent ?? "";
    expect(text).toContain("jkim");
    expect(text).toContain("jordan@example.com");
    expect(text).toContain("Not confirmed");
    expect(text).toContain("riverside-health");
    expect(text).toContain("1–1 of 1");
  } finally {
    unmount();
  }
});
