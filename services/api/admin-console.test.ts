import { expect, mock, test } from "bun:test";

import {
  ACTIVITY_STALE_MS,
  checkActivity,
  billingState,
  checkMail,
  checkReconciler,
  checkStripe,
  giteaTime,
  listAdminBinders,
  listAdminOrganizations,
  listAdminUsers,
  MAIL_STALL_MS,
  reportSignups,
  tallyBilling,
  totalCount,
} from "./admin-console";
import type { GiteaClient } from "./gitea-client/client";
import type { EffectiveSubscriptionAccess } from "./subscriptions";

type Handler = (init?: any) => { data: unknown; total?: number } | unknown;

/** A client answering GETs by path, with `X-Total-Count` when one is given. */
function mockClient(handlers: Record<string, Handler>) {
  const get = mock(async (path: string, init?: unknown) => {
    const handler = handlers[path];
    if (!handler) {
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    }
    const answer = handler(init) as { data: unknown; total?: number };
    const headers = new Headers();
    if (answer.total !== undefined) {
      headers.set("X-Total-Count", String(answer.total));
    }
    return {
      data: answer.data,
      error: undefined,
      response: new Response(null, { status: 200, headers }),
    };
  });
  return { client: { GET: get } as unknown as GiteaClient, get };
}

function access(
  overrides: Partial<EffectiveSubscriptionAccess>,
): EffectiveSubscriptionAccess {
  return {
    giteaOrgId: 1,
    hasAccess: false,
    source: "none",
    subscription: null,
    override: null,
    trialEndsAt: null,
    ...overrides,
  };
}

const subscription = (status: string) => ({
  giteaOrgId: 1,
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_1",
  status,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  updatedAt: 0,
});

test("totalCount reads Gitea's header, and nothing else", () => {
  const withTotal = new Response(null, {
    headers: { "X-Total-Count": "112" },
  });
  expect(totalCount(withTotal)).toBe(112);
  expect(totalCount(new Response(null))).toBeNull();
  expect(
    totalCount(new Response(null, { headers: { "X-Total-Count": "lots" } })),
  ).toBeNull();
});

test("giteaTime reads Gitea's zero time as never", () => {
  expect(giteaTime("0001-01-01T00:00:00Z")).toBeNull();
  expect(giteaTime(undefined)).toBeNull();
  expect(giteaTime("2026-03-14T12:00:00Z")).toBe(
    Date.parse("2026-03-14T12:00:00Z"),
  );
});

test("billingState follows the paywall's own precedence", () => {
  expect(billingState(access({ source: "admin_revoke" }))).toBe("revoked");
  expect(billingState(access({ source: "admin_grant" }))).toBe("comped");
  expect(
    billingState(
      access({ source: "stripe", subscription: subscription("active") }),
    ),
  ).toBe("paying");
  expect(billingState(access({ source: "trial", trialEndsAt: 10 }))).toBe(
    "trial",
  );
  // A subscription that grants nothing has lapsed, whatever Stripe last said.
  expect(billingState(access({ subscription: subscription("active") }))).toBe(
    "past_due",
  );
  expect(billingState(access({ subscription: subscription("past_due") }))).toBe(
    "past_due",
  );
  expect(billingState(access({ subscription: subscription("canceled") }))).toBe(
    "canceled",
  );
  expect(billingState(access({ trialEndsAt: 10 }))).toBe("trial_ended");
  expect(billingState(access({}))).toBe("none");
});

test("tallyBilling counts each organization once", () => {
  expect(
    tallyBilling([
      access({ source: "stripe", subscription: subscription("active") }),
      access({ source: "stripe", subscription: subscription("trialing") }),
      access({ source: "trial", trialEndsAt: 10 }),
      access({ trialEndsAt: 10 }),
      access({ subscription: subscription("unpaid") }),
    ]),
  ).toEqual({
    paying: 2,
    pastDue: 1,
    trial: 1,
    trialEnded: 1,
    comped: 0,
    revoked: 0,
    canceled: 0,
    none: 0,
  });
});

test("checkMail says when nothing can send, and when the outbox is stuck", () => {
  const counts = { pending: 1, sent: 4, failed: 0 };
  expect(
    checkMail({ transport: "off", counts, oldestPendingAt: null, now: 0 })
      .status,
  ).toBe("warn");
  expect(
    checkMail({
      transport: "ses",
      counts,
      oldestPendingAt: 0,
      now: MAIL_STALL_MS + 1,
    }).status,
  ).toBe("down");
  expect(
    checkMail({ transport: "ses", counts, oldestPendingAt: 0, now: 1000 })
      .status,
  ).toBe("ok");
  expect(
    checkMail({
      transport: "ses",
      counts: { ...counts, failed: 2 },
      oldestPendingAt: null,
      now: 0,
    }).status,
  ).toBe("warn");
});

test("checkStripe names what is missing", () => {
  const check = checkStripe({
    secretKey: true,
    webhookSecret: false,
    priceId: true,
  });
  expect(check.status).toBe("warn");
  expect(check.detail).toContain("webhook secret");
  expect(
    checkStripe({ secretKey: true, webhookSecret: true, priceId: true }).status,
  ).toBe("ok");
});

test("checkReconciler flags a pass that has not run, or found something", () => {
  expect(checkReconciler(null).status).toBe("warn");
  expect(checkReconciler({ binders: 3, findings: [], errors: [] }).status).toBe(
    "ok",
  );
  expect(
    checkReconciler({ binders: 3, findings: [{}], errors: [] }).status,
  ).toBe("warn");
});

test("checkActivity flags a dataset never built, overdue, or partly read", () => {
  const now = 100 * 60 * 60_000;
  const build = {
    finishedAt: now - 30 * 60_000,
    events: 40,
    binders: 3,
    errors: [],
  };
  expect(checkActivity(null, now).status).toBe("warn");
  expect(checkActivity(build, now)).toEqual({
    id: "activity",
    label: "Activity dataset",
    status: "ok",
    detail: "Built 30 minutes ago from 3 binders: 40 events.",
  });
  expect(
    checkActivity({ ...build, finishedAt: now - ACTIVITY_STALE_MS - 1 }, now)
      .status,
  ).toBe("warn");
  expect(checkActivity({ ...build, errors: [{}] }, now).detail).toContain(
    "1 could not be read",
  );
});

test("listAdminUsers joins Gitea's accounts with what Bindersnap knows of them", async () => {
  const { client, get } = mockClient({
    "/admin/users": () => ({
      total: 2,
      data: [
        {
          login: "alice",
          full_name: "Alice Example",
          email: "alice@example.com",
          is_admin: true,
          active: true,
          created: "2026-01-02T00:00:00Z",
          last_login: "2026-03-14T00:00:00Z",
        },
        {
          login: "bob",
          email: "bob@example.com",
          active: false,
          last_login: "0001-01-01T00:00:00Z",
        },
      ],
    }),
    "/users/{username}/orgs": (init) => ({
      data:
        init.params.path.username === "alice"
          ? [{ id: 7, username: "riverside-health" }]
          : [],
    }),
  });

  const result = await listAdminUsers(
    {
      client,
      emailStatus: (username) =>
        username === "alice"
          ? { state: "confirmed", confirmedAt: 5, sentAt: 1 }
          : { state: "waiting", confirmedAt: null, sentAt: 1 },
      liveSessions: async (username) => (username === "alice" ? 2 : 0),
      access: async (giteaOrgId) =>
        access({
          giteaOrgId,
          hasAccess: true,
          source: "admin_grant",
          subscription: null,
          trialEndsAt: null,
        }),
    },
    { page: 1, limit: 2, query: "a" },
  );

  expect(get.mock.calls[0]![1]).toEqual({
    params: {
      query: { page: 1, limit: 2, sort: "created", order: "desc", q: "a" },
    },
  });
  expect(result.total).toBe(2);
  expect(result.hasMore).toBe(false);
  expect(result.users[0]).toMatchObject({
    username: "alice",
    email: "alice@example.com",
    emailConfirmation: "confirmed",
    isSiteAdmin: true,
    liveSessions: 2,
    // Each organization with what it pays, so People can give free access.
    organizations: [{ id: 7, name: "riverside-health", billing: "comped" }],
    lastLoginAt: Date.parse("2026-03-14T00:00:00Z"),
  });
  expect(result.users[1]).toMatchObject({
    username: "bob",
    emailConfirmation: "waiting",
    active: false,
    lastLoginAt: null,
    organizations: [],
  });
});

test("listAdminOrganizations reads billing from SQLite and size from Gitea", async () => {
  const { client } = mockClient({
    "/admin/orgs": () => ({
      total: 51,
      data: [{ id: 7, username: "riverside-health", full_name: "Riverside" }],
    }),
    "/orgs/{org}/repos": () => ({ data: [{}], total: 3 }),
  });

  const result = await listAdminOrganizations(
    {
      client,
      record: async () => ({
        giteaOrgId: 7,
        name: "riverside-health",
        createdBy: "alice",
        createdAt: 100,
        trialEndsAt: 200,
      }),
      access: async () =>
        access({
          giteaOrgId: 7,
          hasAccess: true,
          source: "stripe",
          subscription: subscription("active"),
          trialEndsAt: 200,
        }),
      owners: async () => ["alice"],
      seats: async () => 4,
    },
    { page: 1, limit: 50 },
  );

  expect(result.hasMore).toBe(true);
  expect(result.organizations).toEqual([
    {
      id: 7,
      name: "riverside-health",
      fullName: "Riverside",
      email: "",
      known: true,
      createdBy: "alice",
      createdAt: 100,
      owners: ["alice"],
      seats: 4,
      binders: 3,
      hasAccess: true,
      billing: "paying",
      stripeStatus: "active",
      stripeCustomerId: "cus_1",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: 200,
      freeAccess: null,
    },
  ]);
});

test("an organization's free access shows its limits, checked against the writers it shows", async () => {
  const { client } = mockClient({
    "/admin/orgs": () => ({
      total: 1,
      data: [{ id: 7, username: "summit", full_name: "Summit" }],
    }),
    "/orgs/{org}/repos": () => ({ data: [{}], total: 1 }),
  });
  let writersSeen: number | null = null;

  const result = await listAdminOrganizations(
    {
      client,
      record: async () => null,
      access: async (giteaOrgId, writers) => {
        writersSeen = writers ? await writers() : null;
        return access({
          giteaOrgId,
          hasAccess: false,
          source: "trial",
          override: {
            giteaOrgId,
            access: "grant",
            reason: "Pilot",
            updatedBy: "alice",
            updatedAt: 5,
            expiresAt: 900,
            maxWriters: 5,
          },
          grantLapse: "over_writers",
        });
      },
      owners: async () => [],
      seats: async () => 6,
    },
    { page: 1, limit: 50 },
  );

  // The limit is checked against the same count the row shows.
  expect(writersSeen).toBe(6);
  expect(result.organizations[0]!.freeAccess).toEqual({
    expiresAt: 900,
    maxWriters: 5,
    reason: "Pilot",
    grantedBy: "alice",
    grantedAt: 5,
    lapse: "over_writers",
  });
});

test("listAdminBinders lists every repository, newest change first", async () => {
  const { client, get } = mockClient({
    "/repos/search": () => ({
      total: 1,
      data: {
        ok: true,
        data: [
          {
            id: 9,
            name: "policies",
            owner: { login: "riverside-health" },
            private: true,
            size: 2048,
            open_pr_counter: 2,
            updated_at: "2026-03-14T00:00:00Z",
          },
        ],
      },
    }),
  });

  const result = await listAdminBinders(client, {
    page: 1,
    limit: 25,
    query: "",
  });

  expect(get.mock.calls[0]![1]).toEqual({
    params: { query: { page: 1, limit: 25, sort: "updated", order: "desc" } },
  });
  expect(result.binders[0]).toMatchObject({
    org: "riverside-health",
    name: "policies",
    private: true,
    sizeKb: 2048,
    openChanges: 2,
  });
  expect(result.total).toBe(1);
});

test("reportSignups counts each source by signups, organizations and payers", async () => {
  const signup = (
    username: string,
    createdAt: number,
    source: Record<string, string> = {},
    invited = false,
  ) => ({ username, createdAt, invited, ...source });
  const org = (giteaOrgId: number, name: string, createdBy: string) => ({
    giteaOrgId,
    name,
    createdBy,
    createdAt: 0,
    trialEndsAt: null,
  });
  const report = await reportSignups({
    // Newest first, as the store lists them.
    signups: [
      signup("dana", 4_000, { entryPath: "/pricing" }, true),
      signup("casey", 3_000, {
        entryPath: "/glossary/qapi",
        referrerHost: "www.google.com",
        utmSource: "newsletter",
        utmCampaign: "oct",
      }),
      signup("blake", 2_000, {
        entryPath: "/glossary/qapi",
        referrerHost: "www.google.com",
      }),
      signup("avery", 1_000),
    ],
    organizations: [
      // Created under a login in another case: still theirs.
      org(1, "riverside", "Blake"),
      org(2, "lakeside", "casey"),
      org(3, "hillside", "someone-else"),
    ],
    access: async (id) =>
      id === 1
        ? access({ source: "stripe", subscription: subscription("active") })
        : access({ source: "trial", trialEndsAt: 10 }),
  });

  expect(report.recorded).toBe(4);
  expect(report.since).toBe(1_000);
  expect(report.byEntryPage).toEqual([
    { key: "/glossary/qapi", signups: 2, organizations: 2, paying: 1 },
    { key: "/pricing", signups: 1, organizations: 0, paying: 0 },
    { key: null, signups: 1, organizations: 0, paying: 0 },
  ]);
  expect(report.bySite).toEqual([
    { key: "www.google.com", signups: 2, organizations: 2, paying: 1 },
    { key: "invitation", signups: 1, organizations: 0, paying: 0 },
    { key: null, signups: 1, organizations: 0, paying: 0 },
  ]);
  expect(report.byCampaign).toEqual([
    { key: "newsletter / – / oct", signups: 1, organizations: 1, paying: 0 },
  ]);
  expect(report.recent.map((row) => row.username)).toEqual([
    "dana",
    "casey",
    "blake",
    "avery",
  ]);
  expect(report.recent[2]).toEqual({
    username: "blake",
    createdAt: 2_000,
    invited: false,
    entryPath: "/glossary/qapi",
    fromPath: null,
    referrerHost: "www.google.com",
    campaign: null,
    organizations: [{ name: "riverside", billing: "paying" }],
  });
});

test("reportSignups with nothing recorded says so", async () => {
  expect(
    await reportSignups({
      signups: [],
      organizations: [],
      access: async () => access({}),
    }),
  ).toEqual({
    recorded: 0,
    since: null,
    byEntryPage: [],
    bySite: [],
    byCampaign: [],
    recent: [],
  });
});
