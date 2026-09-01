import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";

type Handler = (init?: any) => unknown;

interface Handlers {
  GET?: Record<string, Handler>;
  POST?: Record<string, Handler>;
  PUT?: Record<string, Handler>;
  PATCH?: Record<string, Handler>;
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

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      PUT: mockPut,
      PATCH: mockPatch,
      DELETE: mock(),
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockPut,
    mockPatch,
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

test("provisionWorkspace creates the repo, grants all three teams, then protects main", async () => {
  const order: string[] = [];
  let nextTeamId = 10;

  const { client, mockPut } = createMockClient({
    GET: {
      "/repos/{owner}/{repo}": () => NOT_FOUND,
      "/orgs/{org}/teams": () => [],
      "/repos/{owner}/{repo}/branch_protections/{name}": () => NOT_FOUND,
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
        return { id: nextTeamId++, name: init.body.name };
      },
      "/repos/{owner}/{repo}/branch_protections": () => {
        order.push("protect");
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
  expect(Object.keys(result.teams)).toEqual(["admins", "authors", "reviewers"]);
  expect(mockPut.mock.calls).toHaveLength(3);

  // Protection has to come last: the teams must exist before they can be
  // whitelisted on the rule.
  expect(order[0]).toBe("repo");
  expect(order.at(-1)).toBe("protect");
  expect(order.indexOf("grant")).toBeGreaterThan(
    order.indexOf("team:clinical-policies-admins"),
  );
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
        { id: 10, name: "clinical-policies-admins", permission: "admin" },
        { id: 11, name: "clinical-policies-authors", permission: "write" },
        { id: 12, name: "clinical-policies-reviewers", permission: "read" },
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
