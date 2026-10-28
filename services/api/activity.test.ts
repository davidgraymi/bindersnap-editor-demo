import { expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  accountEvents,
  ActivityStore,
  binderEvents,
  branchKind,
  collectActivity,
  reviewEvents,
  type ActivityEvent,
  type ActivityPass,
} from "./activity";
import type { GiteaClient } from "./gitea-client/client";
import type { Invitation } from "./invitations";

const UID = "01J8XZ4K7MQ9V3B0RN7YHS2E1D";

function freshStore() {
  return new ActivityStore(
    join(mkdtempSync(join(tmpdir(), "activity-")), "activity.db"),
  );
}

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: "inv-1",
    giteaOrgId: 7,
    orgName: "mercy-health",
    email: "jordan@mercy.example",
    orgRole: "member",
    binder: "clinical",
    binderLevel: "reviewer",
    invitedBy: "Alice",
    createdAt: 5_000,
    expiresAt: 9_000,
    revokedAt: null,
    acceptedAt: null,
    acceptedBy: null,
    joinedAt: null,
    ...overrides,
  };
}

test("accounts, organizations and invitations become events named by id", () => {
  const events = accountEvents({
    accounts: [
      { id: 1, login: "Alice", createdAt: 1_000, isSiteAdmin: false },
      { id: 2, login: "jordan", createdAt: 6_000, isSiteAdmin: false },
      { id: 3, login: "root", createdAt: 10, isSiteAdmin: true },
    ],
    signups: [
      {
        username: "alice",
        entryPath: "/templates/hand-hygiene",
        invited: false,
        createdAt: 1_000,
      },
      { username: "jordan", invited: true, createdAt: 6_000 },
    ],
    confirmations: [
      { username: "alice", verifiedAt: 1_500 },
      // An account Gitea no longer has: nobody to name.
      { username: "gone", verifiedAt: 1_600 },
    ],
    organizations: [
      {
        giteaOrgId: 7,
        name: "mercy-health",
        createdBy: "alice",
        createdAt: 2,
        trialEndsAt: 1_209_602,
      },
    ],
    invitations: [
      invitation({ acceptedAt: 6_500, acceptedBy: "jordan" }),
      invitation({
        id: "inv-2",
        binder: null,
        binderLevel: null,
        orgRole: "owner",
      }),
    ],
  });

  expect(events).toEqual([
    {
      id: "account_created:1",
      kind: "account_created",
      at: 1_000,
      orgId: null,
      binderId: null,
      changeNumber: null,
      actorId: 1,
      detail: "/templates/hand-hygiene",
    },
    {
      id: "account_created:2",
      kind: "account_created",
      at: 6_000,
      orgId: null,
      binderId: null,
      changeNumber: null,
      actorId: 2,
      detail: "invitation",
    },
    {
      id: "email_confirmed:1",
      kind: "email_confirmed",
      at: 1_500,
      orgId: null,
      binderId: null,
      changeNumber: null,
      actorId: 1,
      detail: null,
    },
    {
      id: "org_created:7",
      kind: "org_created",
      at: 2_000,
      orgId: 7,
      binderId: null,
      changeNumber: null,
      actorId: 1,
      detail: "trial",
    },
    {
      id: "invite_sent:inv-1",
      kind: "invite_sent",
      at: 5_000,
      orgId: 7,
      binderId: null,
      changeNumber: null,
      actorId: 1,
      detail: "reviewer",
    },
    {
      id: "invite_accepted:inv-1",
      kind: "invite_accepted",
      at: 6_500,
      orgId: 7,
      binderId: null,
      changeNumber: null,
      actorId: 2,
      detail: "reviewer",
    },
    {
      id: "invite_sent:inv-2",
      kind: "invite_sent",
      at: 5_000,
      orgId: 7,
      binderId: null,
      changeNumber: null,
      actorId: 1,
      detail: "owner",
    },
  ]);
  // Nothing a person typed, and no name or address, reaches a row.
  expect(JSON.stringify(events)).not.toMatch(/alice|jordan|mercy/i);
});

test("a branch says what kind of change it was", () => {
  expect(branchKind("draft/alice/20260919145255")).toBe("draft");
  expect(branchKind("upload/alice/1")).toBe("upload");
  expect(branchKind("sign-off/rules")).toBe("sign-off");
  expect(branchKind("shape/folders")).toBe("shape");
  expect(branchKind("retired/alice/20260919145255")).toBe("retired");
  expect(branchKind("hotfix")).toBe("other");
});

test("a binder's changes, publishes and versions become events", () => {
  const events = binderEvents({
    orgId: 7,
    binderId: 12,
    pulls: [
      {
        number: 1,
        user: { id: 1 },
        created_at: "2026-10-01T00:00:00Z",
        merged: true,
        merged_at: "2026-10-02T00:00:00Z",
        merged_by: { id: 1 },
        merge_commit_sha: "m1",
        // Its branch was deleted when it was published.
        head: { ref: "refs/pull/1/head", label: "upload/alice/1" },
      },
      {
        number: 2,
        user: { id: 2 },
        created_at: "2026-10-03T00:00:00Z",
        merged: false,
        head: { ref: "draft/jordan/2" },
      },
    ],
    tags: [
      {
        name: `${UID}/v1`,
        commit: { sha: "m1", created: "2026-10-02T00:00:01Z" },
      },
      // Not one of ours: never a version.
      { name: "v1.0", commit: { sha: "x", created: "2026-10-02T00:00:00Z" } },
    ],
  });

  expect(
    events.map(({ id, kind, changeNumber, actorId, detail }) => ({
      id,
      kind,
      changeNumber,
      actorId,
      detail,
    })),
  ).toEqual([
    {
      id: "change_proposed:12:1",
      kind: "change_proposed",
      changeNumber: 1,
      actorId: 1,
      detail: "upload",
    },
    {
      id: "change_published:12:1",
      kind: "change_published",
      changeNumber: 1,
      actorId: 1,
      detail: "upload",
    },
    {
      id: "change_proposed:12:2",
      kind: "change_proposed",
      changeNumber: 2,
      actorId: 2,
      detail: "draft",
    },
    {
      id: `version_published:12:${UID}/v1`,
      kind: "version_published",
      changeNumber: 1,
      actorId: null,
      detail: "first",
    },
  ]);
  expect(events[0]!.at).toBe(Date.parse("2026-10-01T00:00:00Z"));
});

test("only approvals and requests for changes are reviews", () => {
  const events = reviewEvents({
    orgId: 7,
    binderId: 12,
    changeNumber: 1,
    reviews: [
      {
        id: 40,
        state: "APPROVED",
        submitted_at: "2026-10-02T00:00:00Z",
        user: { id: 2 },
      },
      {
        id: 41,
        state: "REQUEST_CHANGES",
        submitted_at: "2026-10-01T00:00:00Z",
        user: { id: 3 },
      },
      {
        id: 42,
        state: "COMMENT",
        submitted_at: "2026-10-01T00:00:00Z",
        user: { id: 3 },
      },
      { id: 43, state: "PENDING", user: { id: 3 } },
    ],
  });
  expect(events.map((event) => [event.id, event.actorId])).toEqual([
    ["review_approved:12:40", 2],
    ["review_changes_requested:12:41", 3],
  ]);
});

function response(data: unknown, status = 200) {
  return status >= 400
    ? {
        data: undefined,
        error: { message: "Not found" },
        response: new Response(null, { status }),
      }
    : { data, error: undefined, response: new Response(null, { status }) };
}

function giteaWith(params: {
  repos: Record<string, unknown>;
  failing?: string[];
  reviewReads?: number[];
}): GiteaClient {
  return {
    GET: mock(
      async (
        path: string,
        init: { params?: { path?: Record<string, string | number> } },
      ) => {
        const args = init.params?.path ?? {};
        if (path === "/admin/users") {
          return response([
            { id: 1, login: "alice", created: "2026-10-01T00:00:00Z" },
          ]);
        }
        if (path === "/orgs/{org}/repos") {
          const repos = params.repos[String(args.org)];
          return repos === undefined ? response(null, 404) : response(repos);
        }
        if (params.failing?.includes(String(args.repo))) {
          return response(null, 500);
        }
        if (path === "/repos/{owner}/{repo}/pulls") {
          return response([
            {
              number: 1,
              state: "closed",
              closed_at: "2026-10-02T00:00:00Z",
              created_at: "2026-10-01T00:00:00Z",
              head: { ref: "upload/alice/1" },
            },
            {
              number: 2,
              state: "open",
              created_at: "2026-10-03T00:00:00Z",
              head: { ref: "draft/alice/2" },
            },
          ]);
        }
        if (path === "/repos/{owner}/{repo}/pulls/{index}/reviews") {
          params.reviewReads?.push(Number(args.index));
          return response([
            {
              id: Number(args.index) * 10,
              state: "APPROVED",
              submitted_at: "2026-10-02T00:00:00Z",
              user: { id: 1 },
            },
          ]);
        }
        return response([]);
      },
    ),
  } as unknown as GiteaClient;
}

const organizations = [
  {
    giteaOrgId: 7,
    name: "mercy-health",
    createdBy: "alice",
    createdAt: 1,
    trialEndsAt: null,
  },
  {
    giteaOrgId: 8,
    name: "deleted-clinic",
    createdBy: "alice",
    createdAt: 1,
    trialEndsAt: null,
  },
];

test("a pass reads every binder, and a binder it cannot read keeps its rows", async () => {
  const pass = await collectActivity({
    client: giteaWith({
      repos: {
        "mercy-health": [
          { id: 12, name: "clinical" },
          { id: 13, name: "broken" },
        ],
      },
      failing: ["broken"],
    }),
    organizations,
    signups: [],
    confirmations: [],
    invitations: [],
    reuse: null,
    now: () => 100,
  });

  expect(pass.build.binders).toBe(2);
  expect(pass.build.errors).toEqual([
    { org: "mercy-health", binder: "broken", error: "Not found" },
  ]);
  // The deleted organization is gone, not an error: its rows go.
  expect(pass.keep).toEqual({ binderIds: [13], orgIds: [] });
  expect(pass.events.map((event) => event.id).sort()).toEqual([
    "account_created:1",
    "change_proposed:12:1",
    "change_proposed:12:2",
    "org_created:7",
    "org_created:8",
    "review_approved:12:10",
    "review_approved:12:20",
  ]);
});

test("reviews on a change closed before the last pass are not asked for again", async () => {
  const reads: number[] = [];
  const reused: ActivityEvent = {
    id: "review_approved:12:99",
    kind: "review_approved",
    at: 1,
    orgId: 7,
    binderId: 12,
    changeNumber: 1,
    actorId: 1,
    detail: null,
  };
  const pass = await collectActivity({
    client: giteaWith({
      repos: { "mercy-health": [{ id: 12, name: "clinical" }] },
      reviewReads: reads,
    }),
    organizations: organizations.slice(0, 1),
    signups: [],
    confirmations: [],
    invitations: [],
    reuse: {
      before: Date.parse("2026-10-05T00:00:00Z"),
      reviews: (binderId, changeNumber) =>
        binderId === 12 && changeNumber === 1 ? [reused] : [],
    },
  });

  // The open change is read; the closed one comes from the last pass.
  expect(reads).toEqual([2]);
  expect(pass.events.map((event) => event.id)).toContain(
    "review_approved:12:99",
  );
});

test("a pass replaces the table, except the rows it could not read again", () => {
  const store = freshStore();
  const event = (id: string, binderId: number | null, orgId = 7) =>
    ({
      id,
      kind: "change_proposed",
      at: 1,
      orgId,
      binderId,
      changeNumber: 1,
      actorId: 1,
      detail: "draft",
    }) satisfies ActivityEvent;
  const pass = (
    events: ActivityEvent[],
    keep: ActivityPass["keep"] = { binderIds: [], orgIds: [] },
  ): ActivityPass => ({
    build: {
      startedAt: 1,
      finishedAt: 2,
      events: events.length,
      binders: 3,
      errors: [],
    },
    events,
    keep,
  });

  store.replace(
    pass([
      event("a", 12),
      event("b", 13),
      event("c", 20, 9),
      event("org", null),
    ]),
  );
  expect(store.list().map((row) => row.id)).toEqual(["a", "b", "c", "org"]);

  // Binder 13 and organization 9 could not be read: their rows stay.
  store.replace(
    pass([event("a2", 12), event("org", null)], {
      binderIds: [13],
      orgIds: [9],
    }),
  );
  expect(store.list().map((row) => row.id)).toEqual(["a2", "b", "c", "org"]);
  expect(store.reviewsFor(12, 1)).toEqual([]);
  expect(store.lastBuild()).toEqual({
    startedAt: 1,
    finishedAt: 2,
    events: 2,
    binders: 3,
    errors: [],
  });

  store.replace(pass([]));
  expect(store.list()).toEqual([]);
});

test("a change's reviews are found again by binder and number", () => {
  const store = freshStore();
  const review: ActivityEvent = {
    id: "review_approved:12:40",
    kind: "review_approved",
    at: 5,
    orgId: 7,
    binderId: 12,
    changeNumber: 1,
    actorId: 2,
    detail: null,
  };
  store.replace({
    build: { startedAt: 1, finishedAt: 2, events: 2, binders: 1, errors: [] },
    events: [
      review,
      { ...review, id: "change_proposed:12:1", kind: "change_proposed" },
    ],
    keep: { binderIds: [], orgIds: [] },
  });
  expect(store.reviewsFor(12, 1)).toEqual([review]);
  expect(store.lastBuild()?.events).toBe(2);
});
