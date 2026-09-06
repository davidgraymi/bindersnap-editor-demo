import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";

type Handler = (init?: any) => unknown;

interface Handlers {
  GET?: Record<string, Handler>;
  POST?: Record<string, Handler>;
  PUT?: Record<string, Handler>;
  PATCH?: Record<string, Handler>;
  DELETE?: Record<string, Handler>;
}

/** A handler returning this answers 404, the way a real Gitea would. */
const NOT_FOUND = Symbol("not-found");

function createMockClient(handlers: Handlers) {
  const notFound = () => ({
    data: undefined,
    error: { message: "not found" },
    response: new Response(null, { status: 404 }),
  });

  const method = (verb: keyof Handlers) =>
    mock(async (path: string, init?: unknown) => {
      const handler = handlers[verb]?.[path];
      if (!handler) return notFound();
      const data = await handler(init);
      if (data === NOT_FOUND) return notFound();
      return {
        data,
        error: undefined,
        response: new Response(null, { status: 200 }),
      };
    });

  const mockGet = method("GET");
  const mockPost = method("POST");
  const mockPut = method("PUT");
  const mockPatch = method("PATCH");
  const mockDelete = method("DELETE");

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      PUT: mockPut,
      PATCH: mockPatch,
      DELETE: mockDelete,
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockPut,
    mockPatch,
    mockDelete,
  };
}

function bodyOf(call: unknown): Record<string, unknown> {
  return (call as [string, { body: Record<string, unknown> }])[1].body;
}

test("protectWorkspaceMain whitelists the role teams so a free reviewer's approval counts", async () => {
  const { client, mockPost } = createMockClient({
    GET: { "/repos/{owner}/{repo}/branch_protections/{name}": () => NOT_FOUND },
    POST: {
      "/repos/{owner}/{repo}/branch_protections": (init: {
        body: Record<string, unknown>;
      }) => init.body,
    },
  });

  const { protectWorkspaceMain } = await import("./workspaces");
  await protectWorkspaceMain({
    client,
    org: "mercy-health",
    workspace: "clinical-policies",
  });

  const body = bodyOf(mockPost.mock.calls[0]);

  // Without these two lines Gitea resolves "official reviewer" as "has write
  // access on repo.code", a free reviewer's approval satisfies nothing, and the
  // whole free-reviewer tier is decorative. See ADR 0004.
  expect(body.enable_approvals_whitelist).toBe(true);
  expect(body.approvals_whitelist_teams).toEqual([
    "clinical-policies-admins",
    "clinical-policies-authors",
    "clinical-policies-reviewers",
  ]);

  // The product's core claim: nothing reaches main except a merged, approved
  // change.
  expect(body.enable_push).toBe(false);
  expect(body.required_approvals).toBe(1);
  // CODEOWNERS is enforcement only when a merge is blocked on the outstanding
  // request it creates.
  expect(body.block_on_official_review_requests).toBe(true);
  expect(body.dismiss_stale_approvals).toBe(true);
});

test("protectWorkspaceMain updates an existing rule instead of failing on it", async () => {
  const { client, mockPost, mockPatch } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/branch_protections/{name}": () => ({
        rule_name: "main",
      }),
    },
    PATCH: {
      "/repos/{owner}/{repo}/branch_protections/{name}": (init: {
        body: Record<string, unknown>;
      }) => init.body,
    },
  });

  const { protectWorkspaceMain } = await import("./workspaces");
  await protectWorkspaceMain({
    client,
    org: "mercy-health",
    workspace: "clinical-policies",
    requiredApprovals: 2,
  });

  // Gitea answers a duplicate rule with 403 "Branch protection already exist",
  // which is indistinguishable from a real permission denial — so ask first.
  expect(mockPost).not.toHaveBeenCalled();
  expect(bodyOf(mockPatch.mock.calls[0]).required_approvals).toBe(2);
});

test("provisionWorkspace makes no role teams, and opens the binder to staff", async () => {
  const order: string[] = [];
  let nextTeamId = 10;
  const createdTeams: string[] = [];
  let whitelist: string[] = [];
  let protectedWith: string[] = [];

  const { client, mockPut } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}": () => NOT_FOUND,
      "/orgs/{org}/teams": () => [],
      "/repos/{owner}/{repo}/teams": () => [
        { id: 10, name: "staff", permission: "read" },
      ],
      "/repos/{owner}/{repo}/branch_protections/{name}": () => NOT_FOUND,
      "/repos/{owner}/{repo}/contents/{filepath}": () => NOT_FOUND,
    },
    POST: {
      "/orgs/{org}/repos": (init: { body: { name: string } }) => {
        order.push("repo");
        return {
          id: 1,
          name: init.body.name,
          full_name: `mercy-health/${init.body.name}`,
          owner: { login: "mercy-health" },
        };
      },
      "/orgs/{org}/teams": (init: { body: { name: string } }) => {
        order.push(`team:${init.body.name}`);
        createdTeams.push(init.body.name);
        return { id: nextTeamId++, name: init.body.name };
      },
      "/repos/{owner}/{repo}/branch_protections": (init: {
        body: { approvals_whitelist_teams?: string[] };
      }) => {
        order.push("protect");
        protectedWith = init.body.approvals_whitelist_teams ?? [];
        return {};
      },
    },
    PATCH: {
      "/repos/{owner}/{repo}/branch_protections/{name}": (init: {
        body: { approvals_whitelist_teams?: string[] };
      }) => {
        order.push("whitelist");
        whitelist = init.body.approvals_whitelist_teams ?? [];
        return {};
      },
    },
    PUT: {
      "/teams/{id}/repos/{org}/{repo}": () => {
        order.push("grant");
        return {};
      },
    },
  });

  const { provisionWorkspace } = await import("./workspaces");
  const result = await provisionWorkspace({
    client,
    org: "mercy-health",
    name: "clinical-policies",
  });

  expect(result.workspace.name).toBe("clinical-policies");

  // In Gitea a team is an organization object that a repository adopts, so
  // three teams per binder inverts the model: two of them stay empty forever,
  // and a group that reviews three binders becomes three membership lists a
  // human keeps in step by hand. The only team made here is the org's own.
  expect(createdTeams).toEqual(["staff"]);
  expect(mockPut.mock.calls).toHaveLength(1);

  // A new binder is open to the organization, which is the decided default:
  // the common case is a manual everybody must read in order to attest to it.
  expect(result.staff.name).toBe("staff");

  expect(order[0]).toBe("repo");
  // Protection last: the team has to exist before it can be whitelisted.
  expect(order.at(-1)).toBe("protect");
  expect(order.indexOf("grant")).toBeGreaterThan(order.indexOf("team:staff"));

  // And `Owners` is on the list although it is never granted — Gitea gives it
  // admin over the whole organization implicitly, so a whitelist that omits it
  // silently stops counting an owner's approval.
  expect(whitelist).toEqual([]);
  expect(protectedWith).toEqual(["staff", "Owners"]);
});

test("the approvals whitelist always names Owners, granted or not", async () => {
  // The sharpest failure in this design, and a silent one. `Owners` is never
  // granted onto a repository — Gitea gives it admin over the whole
  // organization implicitly — so a whitelist derived from the granted teams
  // alone omits it, and an owner's approval is recorded, displayed, and counts
  // nothing. It presents as "publishing is mysteriously blocked".
  let whitelist: string[] = [];

  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/teams": () => [
        { id: 10, name: "staff", permission: "read" },
        { id: 11, name: "quality-committee", permission: "read" },
      ],
    },
    PATCH: {
      "/repos/{owner}/{repo}/branch_protections/{name}": (init: {
        body: { approvals_whitelist_teams?: string[] };
      }) => {
        whitelist = init.body.approvals_whitelist_teams ?? [];
        return {};
      },
    },
  });

  const { recomputeApprovalsWhitelist } = await import("./workspaces");
  const names = await recomputeApprovalsWhitelist({
    client,
    org: "mercy-health",
    workspace: "clinical-policies",
  });

  expect(names).toEqual(["staff", "quality-committee", "Owners"]);
  expect(whitelist).toEqual(["staff", "quality-committee", "Owners"]);
});

test("a team already named Owners is not whitelisted twice", async () => {
  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}/teams": () => [
        { id: 1, name: "Owners", permission: "owner" },
        { id: 10, name: "staff", permission: "read" },
      ],
    },
    PATCH: {
      "/repos/{owner}/{repo}/branch_protections/{name}": () => ({}),
    },
  });

  const { recomputeApprovalsWhitelist } = await import("./workspaces");
  expect(
    await recomputeApprovalsWhitelist({
      client,
      org: "mercy-health",
      workspace: "clinical-policies",
    }),
  ).toEqual(["Owners", "staff"]);
});

test("provisionWorkspace reuses a repository that already exists", async () => {
  const { client, mockPost } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}": () => ({
        id: 1,
        name: "clinical-policies",
        full_name: "mercy-health/clinical-policies",
        owner: { login: "mercy-health" },
      }),
      "/orgs/{org}/teams": () => [
        { id: 10, name: "staff", permission: "read" },
      ],
      "/repos/{owner}/{repo}/teams": () => [
        { id: 10, name: "staff", permission: "read" },
      ],
      "/repos/{owner}/{repo}/branch_protections/{name}": () => ({
        rule_name: "main",
      }),
    },
    PATCH: {
      "/repos/{owner}/{repo}/branch_protections/{name}": () => ({}),
    },
    PUT: { "/teams/{id}/repos/{org}/{repo}": () => ({}) },
  });

  const { provisionWorkspace } = await import("./workspaces");
  await provisionWorkspace({
    client,
    org: "mercy-health",
    name: "clinical-policies",
  });

  // Re-running provisioning to repair a partial failure must create nothing
  // twice.
  expect(mockPost).not.toHaveBeenCalled();
});

test("createWorkspaceRepo makes a private, initialized binder", async () => {
  const { client, mockPost } = createMockClient({
    GET: { "/repos/{owner}/{repo}": () => NOT_FOUND },
    POST: {
      "/orgs/{org}/repos": (init: { body: Record<string, unknown> }) => ({
        id: 1,
        name: init.body.name,
        full_name: `mercy-health/${init.body.name}`,
        owner: { login: "mercy-health" },
      }),
    },
  });

  const { createWorkspaceRepo } = await import("./workspaces");
  await createWorkspaceRepo({
    client,
    org: "mercy-health",
    name: "clinical-policies",
  });

  const body = bodyOf(mockPost.mock.calls[0]);
  expect(body.private).toBe(true);
  // main has to exist before it can be protected.
  expect(body.auto_init).toBe(true);
  expect(body.default_branch).toBe("main");
});

test("listOrganizationWorkspaces returns the org's binders in the app's shape", async () => {
  const { client } = createMockClient({
    GET: {
      "/orgs/{org}/repos": () => [
        {
          id: 7,
          name: "clinical-policies",
          full_name: "mercy-health/clinical-policies",
          owner: { login: "mercy-health" },
          description: "Nursing and clinical practice",
        },
        {
          id: 9,
          name: "hr",
          full_name: "mercy-health/hr",
          owner: { login: "mercy-health" },
        },
      ],
    },
  });

  const { listOrganizationWorkspaces } = await import("./workspaces");
  const workspaces = await listOrganizationWorkspaces({
    client,
    org: "mercy-health",
  });

  expect(workspaces).toEqual([
    {
      id: 7,
      name: "clinical-policies",
      fullName: "mercy-health/clinical-policies",
      owner: "mercy-health",
      description: "Nursing and clinical practice",
    },
    // A binder with no description is an ordinary binder, not a broken one.
    {
      id: 9,
      name: "hr",
      fullName: "mercy-health/hr",
      owner: "mercy-health",
      description: "",
    },
  ]);
});

test("listOrganizationWorkspaces treats an org with no binders as empty", async () => {
  const { client } = createMockClient({
    GET: { "/orgs/{org}/repos": () => [] },
  });

  const { listOrganizationWorkspaces } = await import("./workspaces");
  expect(
    await listOrganizationWorkspaces({ client, org: "mercy-health" }),
  ).toEqual([]);
});

test("a new binder starts empty, without the README Gitea generates", async () => {
  const deleted: string[] = [];

  const { client } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}": () => NOT_FOUND,
      "/orgs/{org}/teams": () => [],
      "/repos/{owner}/{repo}/branch_protections/{name}": () => NOT_FOUND,
      // `auto_init` is the only way to get a `main` to protect, and it writes
      // this.
      "/repos/{owner}/{repo}/contents/{filepath}": () => ({
        sha: "readme-sha",
        path: "README.md",
      }),
    },
    POST: {
      "/orgs/{org}/repos": (init: { body: { name: string } }) => ({
        id: 1,
        name: init.body.name,
        full_name: `mercy-health/${init.body.name}`,
        owner: { login: "mercy-health" },
      }),
      "/orgs/{org}/teams": (init: { body: { name: string } }) => ({
        id: 1,
        name: init.body.name,
      }),
      "/repos/{owner}/{repo}/branch_protections": () => ({}),
    },
    PUT: { "/teams/{id}/repos/{org}/{repo}": () => ({}) },
    DELETE: {
      "/repos/{owner}/{repo}/contents/{filepath}": () => {
        deleted.push("README.md");
        return {};
      },
    },
  });

  const { provisionWorkspace } = await import("./workspaces");
  await provisionWorkspace({
    client,
    org: "mercy-health",
    name: "clinical",
  });

  // A binder holds policies. A generated README is not one, and left in place
  // it lists as a document called "README" in front of a surveyor.
  expect(deleted).toEqual(["README.md"]);
});
