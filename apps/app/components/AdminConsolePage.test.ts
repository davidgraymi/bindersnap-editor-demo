import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

import type {
  AdminOverviewPayload,
  AdminSignupsPayload,
  AdminSystemPayload,
  AdminUserListPayload,
} from "../api";
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
      organizations: [{ id: 7, name: "riverside-health", billing: "trial" }],
    },
  ],
  query: "",
  page: 1,
  limit: 25,
  total: 1,
  hasMore: false,
};

const system: AdminSystemPayload = {
  bindersnap: {
    version: "0.4.94",
    commit: "2ec0a5b93e300610fd6051d349e54a25e4ec0829",
    environment: "production",
  },
  gitea: { version: "28.0.0", url: "http://gitea:3000" },
  images: [
    {
      service: "gitea",
      name: "gitea/gitea",
      tag: "28.0.0",
      digest:
        "sha256:a9dc25679ebdd33356242d2e0667cc220043745e8339922879f187c20329a42e",
    },
  ],
  runtime: {
    bunVersion: "1.4.3",
    bunRevision: "abc123",
    platform: "linux",
    arch: "arm64",
    hostname: "api",
    pid: 1,
    startedAt: Date.now() - 3 * 60 * 60_000,
    cpuCount: 2,
    loadAverage: [0.1, 0.2, 0.3],
    cpuUserSeconds: 12,
    cpuSystemSeconds: 3,
    memory: {
      rss: 120 * 1024 * 1024,
      heapUsed: 40 * 1024 * 1024,
      heapTotal: 60 * 1024 * 1024,
      external: 1024,
      arrayBuffers: 0,
      hostTotal: 4 * 1024 ** 3,
      hostFree: 1024 ** 3,
    },
  },
  storage: {
    databasePath: "/var/lib/bindersnap/sessions.db",
    databaseBytes: 2 * 1024 * 1024,
    walBytes: 0,
    diskTotalBytes: 20 * 1024 ** 3,
    diskFreeBytes: 15 * 1024 ** 3,
  },
};

const mockGetAdminOverview = mock(async () => overview);
const mockGetAdminSystem = mock(async () => system);
const mockCreateAdminUser = mock(async (body: { email: string }) => ({
  username: "jkim",
  email: body.email,
  fullName: "Jordan Kim",
  emailed: "welcome" as const,
}));
const mockListAdminUsers = mock(async (..._args: unknown[]) => users);
const organizationRow = (
  name: string,
  fullName: string,
  extra: Record<string, unknown>,
) => ({
  id: name.length,
  name,
  fullName,
  email: "",
  known: true,
  createdBy: "alice",
  createdAt: Date.UTC(2026, 2, 14) / 1000,
  owners: ["alice"],
  seats: 3,
  binders: 1,
  hasAccess: true,
  billing: "trial" as const,
  stripeStatus: null,
  stripeCustomerId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEndsAt: null,
  freeAccess: null,
  ...extra,
});
const mockListAdminOrganizations = mock(async (..._args: unknown[]) => ({
  organizations: [
    organizationRow("summit-surgery-center", "Summit Surgery Center", {
      billing: "comped",
      freeAccess: {
        expiresAt: Date.UTC(2027, 3, 25) / 1000,
        maxWriters: 5,
        reason: null,
        grantedBy: "alice",
        grantedAt: 1,
        lapse: null,
      },
    }),
    organizationRow("lakeside-hospice", "Lakeside Hospice", {}),
  ],
  page: 1,
  limit: 25,
  total: 2,
  hasMore: false,
}));
const mockSetAdminOrganizationAccess = mock(
  async (org: string, ..._rest: unknown[]) => ({
    organization: org,
    billing: "comped" as const,
  }),
);
const mockClearAdminOrganizationAccess = mock(async (org: string) => ({
  organization: org,
  billing: "trial" as const,
}));

const signups: AdminSignupsPayload = {
  recorded: 3,
  since: Date.UTC(2026, 9, 1),
  byEntryPage: [
    { key: "/glossary/qapi", signups: 2, organizations: 2, paying: 1 },
    { key: null, signups: 1, organizations: 0, paying: 0 },
  ],
  bySite: [
    { key: "www.google.com", signups: 2, organizations: 2, paying: 1 },
    { key: "invitation", signups: 1, organizations: 0, paying: 0 },
  ],
  byCampaign: [],
  recent: [
    {
      username: "casey",
      createdAt: Date.UTC(2026, 9, 20),
      invited: false,
      entryPath: "/glossary/qapi",
      fromPath: "/pricing",
      referrerHost: "www.google.com",
      campaign: null,
      organizations: [{ name: "lakeside", billing: "paying" }],
    },
  ],
};
const mockGetAdminSignups = mock(async () => signups);

// Spread the real module: see AdminSubscriptionManagementPage.test.ts.
const actualApi = await import("../api");
mock.module("../api", () => ({
  ...actualApi,
  getAdminOverview: mockGetAdminOverview,
  getAdminSystem: mockGetAdminSystem,
  getAdminSignups: mockGetAdminSignups,
  createAdminUser: mockCreateAdminUser,
  listAdminUsers: mockListAdminUsers,
  listAdminOrganizations: mockListAdminOrganizations,
  setAdminOrganizationAccess: mockSetAdminOrganizationAccess,
  clearAdminOrganizationAccess: mockClearAdminOrganizationAccess,
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
      "/-/admin/signups",
      "/-/admin/system",
      "/-/admin/config",
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
    expect(text).toContain("In trial");
    expect(text).toContain("1–1 of 1");
  } finally {
    unmount();
  }
});

test("signups show which pages and sites brought people in, and who pays", async () => {
  const { container, unmount } = render({
    section: "signups",
    currentUsername: "alice",
    onNavigate: () => {},
  });
  try {
    await settle();
    expect(mockGetAdminSignups).toHaveBeenCalled();
    const panels = Array.from(container.querySelectorAll("section.bs-panel"));
    expect(panels.map((panel) => panel.getAttribute("aria-label"))).toEqual([
      "First page of the visit",
      "Sent by",
      "Newest signups",
    ]);
    const firstPage = panels[0]!.textContent ?? "";
    expect(firstPage).toContain("/glossary/qapi");
    expect(firstPage).toContain("Not recorded");
    expect(panels[1]!.textContent).toContain("An invitation");
    const newest = panels[2]!.textContent ?? "";
    expect(newest).toContain("casey");
    expect(newest).toContain("/pricing");
    expect(newest).toContain("Paying");
    expect(container.textContent).toContain("3 signups since Oct 1, 2026");
  } finally {
    unmount();
  }
});

test("the system page names the build, its images and the process", async () => {
  const { container, unmount } = render({
    section: "system",
    currentUsername: "alice",
    onNavigate: () => {},
  });
  try {
    await settle();
    const text = container.textContent ?? "";
    expect(text).toContain("0.4.94");
    expect(text).toContain("2ec0a5b93e30");
    expect(text).toContain("gitea/gitea:28.0.0");
    expect(text).toContain("3 hours, 0 minutes");
    const commit = container.querySelector<HTMLAnchorElement>(
      'a[href$="/commit/2ec0a5b93e300610fd6051d349e54a25e4ec0829"]',
    );
    expect(commit).not.toBeNull();
  } finally {
    unmount();
  }
});

test("a new account is created from the People page", async () => {
  const { container, unmount } = render({
    section: "users",
    currentUsername: "alice",
    onNavigate: () => {},
  });
  try {
    await settle();
    const open = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("New account"),
    );
    open!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle();

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(".admin-console-form input"),
    );
    for (const [index, value] of [
      "Jordan",
      "Kim",
      "jordan@example.com",
    ].entries()) {
      setter.call(inputs[index], value);
      inputs[index]!.dispatchEvent(
        new window.Event("input", { bubbles: true }),
      );
    }
    container
      .querySelector("form.admin-console-form")!
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await settle();

    expect(mockCreateAdminUser).toHaveBeenCalledWith({
      firstName: "Jordan",
      lastName: "Kim",
      email: "jordan@example.com",
    });
    expect(container.textContent).toContain(
      "A link to choose a password went to jordan@example.com.",
    );
  } finally {
    unmount();
  }
});

test("free access is given from Organizations, for days and writers, and ended", async () => {
  const { container, unmount } = render({
    section: "organizations",
    currentUsername: "alice",
    onNavigate: () => {},
  });
  const button = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const click = (element: Element) =>
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  try {
    await settle();
    expect(container.textContent).toContain("Free until");
    expect(container.textContent).toContain("for up to 5 writers (3 now)");
    // An organization's record keeps seconds; read as milliseconds it was 1970.
    expect(container.textContent).toContain("Mar 14, 2026");
    expect(container.textContent).not.toContain("1970");

    // An organization with none: the form takes days and writers.
    click(button("Give free access to Lakeside Hospice")!);
    await settle();
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(".admin-console-form input"),
    );
    for (const [index, value] of ["30", "4"].entries()) {
      setter.call(inputs[index], value);
      inputs[index]!.dispatchEvent(
        new window.Event("input", { bubbles: true }),
      );
    }
    container
      .querySelector("form.admin-console-form")!
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    await settle();
    expect(mockSetAdminOrganizationAccess).toHaveBeenCalledWith(
      "lakeside-hospice",
      "grant",
      { days: 30, maxWriters: 4 },
    );

    // Ending it is always there while there is any.
    click(button("End free access for Summit Surgery Center")!);
    await settle();
    expect(mockClearAdminOrganizationAccess).toHaveBeenCalledWith(
      "summit-surgery-center",
    );
    expect(mockListAdminOrganizations.mock.calls.length).toBeGreaterThan(1);
  } finally {
    unmount();
  }
});
