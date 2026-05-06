import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import type { JSX } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import { resolveSignupPrefill } from "./authIntent";
import { resolveGiteaTokenScopes } from "./giteaTokenScopes";

const mockClearToken = mock(() => {});
const mockCreateCheckoutSession = mock(async () => ({
  url: "https://example.com/checkout",
}));
const mockCreatePortalSession = mock(async () => ({
  url: "https://example.com/portal",
}));
const mockFetchBillingStatus = mock(async () => ({
  status: "active" as string | null,
  currentPeriodEnd: null as number | null,
  cancelAtPeriodEnd: false,
  cancelAt: null as number | null,
  hasAccess: true,
  accessSource: null as string | null,
  override: null,
  plan: null,
}));
const mockFetchSessionUser = mock(
  async (): Promise<{
    user: { username: string; fullName?: string; isAdmin?: boolean } | null;
    token: string | null;
  } | null> => ({ user: null, token: null }),
);
const mockLogin = mock(async () => ({
  user: null as { username: string; fullName?: string; isAdmin?: boolean } | null,
  token: null as string | null,
}));
const mockLogoutSession = mock(async () => {});
const mockSignup = mock(async () => ({
  user: null,
  token: null,
}));
const mockStoreToken = mock(() => {});

mock.module("./api", () => ({
  clearToken: mockClearToken,
  createCheckoutSession: mockCreateCheckoutSession,
  createPortalSession: mockCreatePortalSession,
  fetchBillingStatus: mockFetchBillingStatus,
  fetchSessionUser: mockFetchSessionUser,
  login: mockLogin,
  logoutSession: mockLogoutSession,
  signup: mockSignup,
  storeToken: mockStoreToken,
}));

mock.module("./components/AppShell", () => ({
  AppShell: ({
    route,
    user,
  }: {
    route: { kind: string };
    user: { isAdmin?: boolean } | null;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "app-shell",
        "data-route-kind": route.kind,
        "data-user-is-admin": user?.isAdmin ? "true" : "false",
      },
      `workspace:${route.kind}`,
    ),
}));

mock.module("./components/BillingPage", () => ({
  BillingPage: ({
    subscriptionStatus,
    hasBillingStatusError,
  }: {
    subscriptionStatus: string;
    hasBillingStatusError: boolean;
  }) =>
    createElement(
      "div",
      {
        "data-testid": "billing-page",
        "data-subscription-status": subscriptionStatus,
        "data-has-billing-status-error": hasBillingStatusError
          ? "true"
          : "false",
      },
      `billing:${subscriptionStatus}`,
    ),
}));

mock.module("./components/BindersnapLogoMark", () => ({
  BindersnapLogoMark: () =>
    createElement("div", { "data-testid": "logo-mark" }),
}));

mock.module("./components/AnonymousDocumentShell", () => ({
  AnonymousDocumentShell: ({
    route,
  }: {
    route: { kind: string; owner: string; repo: string };
  }) =>
    createElement(
      "div",
      {
        "data-testid": "anonymous-document-shell",
        "data-owner": route.owner,
        "data-repo": route.repo,
      },
      `public:${route.owner}/${route.repo}`,
    ),
}));

mock.module("./components/LandingPage", () => ({
  LandingPage: () => createElement("div", { "data-testid": "landing-page" }),
}));

let originalWindow: typeof globalThis.window | undefined;
let originalDocument: typeof globalThis.document | undefined;
let originalNavigator: typeof globalThis.navigator | undefined;
let originalLocation: typeof globalThis.location | undefined;
let originalHistory: typeof globalThis.history | undefined;
let originalHTMLElement: typeof globalThis.HTMLElement | undefined;
let originalElement: typeof globalThis.Element | undefined;
let originalNode: typeof globalThis.Node | undefined;
let originalMutationObserver: typeof globalThis.MutationObserver | undefined;
let originalPopStateEvent: typeof globalThis.PopStateEvent | undefined;
let originalEvent: typeof globalThis.Event | undefined;
let originalRequestAnimationFrame:
  | typeof globalThis.requestAnimationFrame
  | undefined;
let originalCancelAnimationFrame:
  | typeof globalThis.cancelAnimationFrame
  | undefined;

function installDom(pathname = "/") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `https://bindersnap.com${pathname}`,
  });

  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    history: dom.window.history,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    PopStateEvent: dom.window.PopStateEvent,
    Event: dom.window.Event,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value,
    });
  }

  return dom;
}

function mountApp(App: () => JSX.Element) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const root = createRoot(container);

  flushSync(() => {
    root.render(createElement(App));
  });

  const unmount = () => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  };

  return { container, unmount };
}

async function waitFor(assertion: () => void, timeoutMs = 750) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
}

beforeEach(() => {
  originalWindow = globalThis.window;
  originalDocument = globalThis.document;
  originalNavigator = globalThis.navigator;
  originalLocation = globalThis.location;
  originalHistory = globalThis.history;
  originalHTMLElement = globalThis.HTMLElement;
  originalElement = globalThis.Element;
  originalNode = globalThis.Node;
  originalMutationObserver = globalThis.MutationObserver;
  originalPopStateEvent = globalThis.PopStateEvent;
  originalEvent = globalThis.Event;
  originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  installDom();

  mockClearToken.mockReset();
  mockCreateCheckoutSession.mockReset();
  mockCreatePortalSession.mockReset();
  mockFetchBillingStatus.mockReset();
  mockFetchSessionUser.mockReset();
  mockLogin.mockReset();
  mockLogoutSession.mockReset();
  mockSignup.mockReset();
  mockStoreToken.mockReset();

  mockCreateCheckoutSession.mockImplementation(async () => ({
    url: "https://example.com/checkout",
  }));
  mockCreatePortalSession.mockImplementation(async () => ({
    url: "https://example.com/portal",
  }));
  mockFetchBillingStatus.mockImplementation(async () => ({
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    hasAccess: true,
    accessSource: null,
    override: null,
    plan: null,
  }));
  mockFetchSessionUser.mockImplementation(async () => ({
    user: null,
    token: null,
  }));
  mockLogin.mockImplementation(async () => ({
    user: null,
    token: null,
  }));
  mockLogoutSession.mockImplementation(async () => {});
  mockSignup.mockImplementation(async () => ({
    user: null,
    token: null,
  }));
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: originalLocation,
  });
  Object.defineProperty(globalThis, "history", {
    configurable: true,
    value: originalHistory,
  });
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: originalHTMLElement,
  });
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: originalElement,
  });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: originalNode,
  });
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: originalMutationObserver,
  });
  Object.defineProperty(globalThis, "PopStateEvent", {
    configurable: true,
    value: originalPopStateEvent,
  });
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: originalEvent,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: originalCancelAnimationFrame,
  });
});

test("resolveSubscriptionStatus treats missing or inactive billing records as unpaid", async () => {
  const { resolveSubscriptionStatus } = await import("./App");

  expect(resolveSubscriptionStatus("active")).toBe("active");
  expect(resolveSubscriptionStatus("trialing")).toBe("active");
  expect(resolveSubscriptionStatus(null)).toBe("none");
  expect(resolveSubscriptionStatus("past_due")).toBe("none");
  expect(resolveSubscriptionStatus("canceled")).toBe("none");
});

test("App redirects signed-in users to billing when the billing status fetch rejects", async () => {
  mockFetchSessionUser.mockImplementation(async () => ({
    user: { username: "alice", fullName: "Alice Example" },
    token: "session-token",
  }));
  mockFetchBillingStatus.mockImplementation(async () => {
    throw new Error("billing service unavailable");
  });

  const { App } = await import("./App");
  const { container, unmount } = mountApp(App);

  try {
    await waitFor(() => {
      const billingPage = container.querySelector<HTMLElement>(
        '[data-testid="billing-page"]',
      );

      expect(window.location.pathname).toBe("/billing");
      expect(billingPage?.dataset.subscriptionStatus).toBe("none");
      expect(billingPage?.dataset.hasBillingStatusError).toBe("true");
      expect(container.querySelector('[data-testid="app-shell"]')).toBeNull();
    });
  } finally {
    unmount();
  }
});

test("App redirects signed-in users to billing when the payment required handler fires", async () => {
  mockFetchSessionUser.mockImplementation(async () => ({
    user: { username: "alice", fullName: "Alice Example" },
    token: "session-token",
  }));
  mockFetchBillingStatus.mockImplementation(async () => ({
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    hasAccess: true,
    accessSource: null,
    override: null,
    plan: null,
  }));

  const { App } = await import("./App");
  const { notifyPaymentRequired } = await import("./paymentRequired");
  const { container, unmount } = mountApp(App);

  try {
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="app-shell"]'),
      ).not.toBeNull();
    });

    notifyPaymentRequired();

    await waitFor(() => {
      const billingPage = container.querySelector<HTMLElement>(
        '[data-testid="billing-page"]',
      );

      expect(window.location.pathname).toBe("/billing");
      expect(billingPage?.dataset.subscriptionStatus).toBe("none");
      expect(billingPage?.dataset.hasBillingStatusError).toBe("false");
      expect(container.querySelector('[data-testid="app-shell"]')).toBeNull();
    });
  } finally {
    unmount();
  }
});

test("App keeps Gitea admins on the Pro access route even when billing status is unavailable", async () => {
  installDom("/admin/subscriptions");

  mockFetchSessionUser.mockImplementation(async () => ({
    user: {
      username: "alice",
      fullName: "Alice Example",
      isAdmin: true,
    },
    token: "session-token",
  }));
  mockFetchBillingStatus.mockImplementation(async () => {
    throw new Error("billing service unavailable");
  });

  const { App } = await import("./App");
  const { container, unmount } = mountApp(App);

  try {
    await waitFor(() => {
      const appShell = container.querySelector<HTMLElement>(
        '[data-testid="app-shell"]',
      );

      expect(window.location.pathname).toBe("/admin/subscriptions");
      expect(appShell?.dataset.routeKind).toBe("adminSubscriptions");
      expect(appShell?.dataset.userIsAdmin).toBe("true");
      expect(
        container.querySelector('[data-testid="billing-page"]'),
      ).toBeNull();
    });
  } finally {
    unmount();
  }
});

test("App redirects non-admin users away from the Pro access route", async () => {
  installDom("/admin/subscriptions");

  mockFetchSessionUser.mockImplementation(async () => ({
    user: {
      username: "alice",
      fullName: "Alice Example",
      isAdmin: false,
    },
    token: "session-token",
  }));
  mockFetchBillingStatus.mockImplementation(async () => ({
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    hasAccess: true,
    accessSource: null,
    override: null,
    plan: null,
  }));

  const { App } = await import("./App");
  const { container, unmount } = mountApp(App);

  try {
    await waitFor(() => {
      const appShell = container.querySelector<HTMLElement>(
        '[data-testid="app-shell"]',
      );

      expect(window.location.pathname).toBe("/");
      expect(appShell?.dataset.routeKind).toBe("workspace");
      expect(appShell?.dataset.userIsAdmin).toBe("false");
    });
  } finally {
    unmount();
  }
});

test("resolveGiteaTokenScopes includes all required write scopes by default", () => {
  expect(resolveGiteaTokenScopes()).toEqual([
    "write:user",
    "write:repository",
    "write:issue",
  ]);
});

test("resolveGiteaTokenScopes preserves configured scopes and adds missing required scopes", () => {
  const scopes = resolveGiteaTokenScopes("read:user,write:repository");

  expect(scopes).toContain("read:user");
  expect(scopes).toContain("write:user");
  expect(scopes).toContain("write:repository");
  expect(scopes).toContain("write:issue");
});

test("resolveGiteaTokenScopes de-duplicates repeated scopes", () => {
  const scopes = resolveGiteaTokenScopes(
    "write:issue,write:user,write:repository,write:issue",
  );

  expect(scopes.filter((scope) => scope === "write:issue")).toHaveLength(1);
  expect(scopes.filter((scope) => scope === "write:user")).toHaveLength(1);
  expect(scopes.filter((scope) => scope === "write:repository")).toHaveLength(
    1,
  );
});

test("resolveSignupPrefill defaults to an empty email", () => {
  expect(resolveSignupPrefill("")).toEqual({
    email: "",
  });
});

test("resolveSignupPrefill reads the landing email from the query string", () => {
  expect(resolveSignupPrefill("?email=team%40bindersnap.com")).toEqual({
    email: "team@bindersnap.com",
  });
});
