import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import type { components } from "./spec/gitea";

type Team = Partial<components["schemas"]["Team"]>;
type User = Partial<components["schemas"]["User"]>;

type Handler = (init?: any) => unknown;

interface Handlers {
  GET?: Record<string, Handler>;
  POST?: Record<string, Handler>;
  PUT?: Record<string, Handler>;
  DELETE?: Record<string, Handler>;
}

function createMockClient(handlers: Handlers) {
  const method = (verb: keyof Handlers) =>
    mock(async (path: string, init?: unknown) => {
      const handler = handlers[verb]?.[path];
      if (handler) {
        return {
          data: await handler(init),
          error: undefined,
          response: new Response(null, { status: 200 }),
        };
      }
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: 404 }),
      };
    });

  const mockGet = method("GET");
  const mockPost = method("POST");
  const mockPut = method("PUT");
  const mockDelete = method("DELETE");

  return {
    client: {
      GET: mockGet,
      POST: mockPost,
      PUT: mockPut,
      DELETE: mockDelete,
      use: mock(),
    } as unknown as GiteaClient,
    mockGet,
    mockPost,
    mockPut,
    mockDelete,
  };
}

function user(login: string, id: number): User {
  return { id, login, full_name: login, email: `${login}@example.com` };
}

test("workspaceTeamName joins the workspace and the role", async () => {
  const { workspaceTeamName } = await import("./orgs");

  expect(workspaceTeamName("clinical-policies", "authors")).toBe(
    "clinical-policies-authors",
  );
  expect(workspaceTeamName("clinical-policies", "reviewers")).toBe(
    "clinical-policies-reviewers",
  );
});

test("createOrganization creates a private org owned by the caller", async () => {
  const { client, mockPost } = createMockClient({
    POST: {
      "/orgs": () => ({
        id: 42,
        username: "mercy-health",
        name: "mercy-health",
        full_name: "Mercy Health",
        description: "",
      }),
    },
  });

  const { createOrganization } = await import("./orgs");
  const org = await createOrganization({
    client,
    name: "mercy-health",
    fullName: "Mercy Health",
  });

  expect(org).toEqual({
    id: 42,
    name: "mercy-health",
    fullName: "Mercy Health",
    description: "",
  });

  const body = (
    mockPost.mock.calls[0]?.[1] as { body: Record<string, unknown> }
  ).body;
  // A policy manual is never public by accident.
  expect(body.visibility).toBe("private");
  expect(body.username).toBe("mercy-health");
});

test("findOrganization returns null for an org that does not exist", async () => {
  const { client } = createMockClient({});

  const { findOrganization } = await import("./orgs");
  expect(await findOrganization({ client, org: "nobody" })).toBeNull();
});

test("createWorkspaceTeams gives reviewers read on code and pulls", async () => {
  const created: Record<string, unknown>[] = [];
  const { client } = createMockClient({
    GET: { "/orgs/{org}/teams": () => [] },
    POST: {
      "/orgs/{org}/teams": (init: { body: Record<string, unknown> }) => {
        created.push(init.body);
        return { id: created.length, ...init.body };
      },
    },
  });

  const { createWorkspaceTeams } = await import("./orgs");
  const teams = await createWorkspaceTeams({
    client,
    org: "mercy-health",
    workspace: "clinical-policies",
  });

  expect(Object.keys(teams)).toEqual(["admins", "authors", "reviewers"]);
  expect(teams.reviewers.name).toBe("clinical-policies-reviewers");

  const reviewers = created.find(
    (team) => team.name === "clinical-policies-reviewers",
  );
  // Read on both units is the whole cost of reviewing. Anything more would be
  // a paid seat wearing a free label.
  expect(reviewers?.units_map).toEqual({
    "repo.code": "read",
    "repo.pulls": "read",
    "repo.issues": "read",
  });

  const authors = created.find(
    (team) => team.name === "clinical-policies-authors",
  );
  expect(
    (authors?.units_map as Record<string, string> | undefined)?.["repo.code"],
  ).toBe("write");

  const admins = created.find(
    (team) => team.name === "clinical-policies-admins",
  );
  expect(admins?.permission).toBe("admin");
});

test("createWorkspaceRoleTeam reuses an existing team of the same name", async () => {
  const { client, mockPost } = createMockClient({
    GET: {
      "/orgs/{org}/teams": (): Team[] => [
        { id: 7, name: "clinical-policies-authors", permission: "write" },
      ],
    },
  });

  const { createWorkspaceRoleTeam } = await import("./orgs");
  const team = await createWorkspaceRoleTeam({
    client,
    org: "mercy-health",
    workspace: "clinical-policies",
    role: "authors",
  });

  expect(team.id).toBe(7);
  // Re-running provisioning after a partial failure must not create a second
  // team with a colliding name.
  expect(mockPost).not.toHaveBeenCalled();
});

test("listOrganizationOwners reads the Owners team", async () => {
  const { client } = createMockClient({
    GET: {
      "/orgs/{org}/teams": (): Team[] => [
        { id: 1, name: "Owners", permission: "owner" },
        { id: 2, name: "clinical-policies-authors", permission: "write" },
      ],
      "/teams/{id}/members": () => [user("alice", 1)],
    },
  });

  const { listOrganizationOwners, isOrganizationOwner } =
    await import("./orgs");

  expect(await listOrganizationOwners({ client, org: "mercy-health" })).toEqual(
    [{ id: 1, login: "alice", fullName: "alice", email: "alice@example.com" }],
  );
  expect(
    await isOrganizationOwner({
      client,
      org: "mercy-health",
      username: "Alice",
    }),
  ).toBe(true);
  expect(
    await isOrganizationOwner({ client, org: "mercy-health", username: "bob" }),
  ).toBe(false);
});

test("listBillableSeats counts one human once across every binder", async () => {
  const membersByTeam: Record<number, User[]> = {
    1: [user("alice", 1)], // Owners
    2: [user("alice", 1), user("bob", 2)], // clinical-policies-admins
    3: [user("bob", 2), user("dan", 4)], // clinical-policies-authors
    4: [user("carol", 3)], // clinical-policies-reviewers — free
    5: [user("dan", 4)], // hr-policies-authors
  };

  const { client } = createMockClient({
    GET: {
      "/orgs/{org}/teams": (): Team[] => [
        { id: 1, name: "Owners", permission: "owner" },
        {
          id: 2,
          name: "clinical-policies-admins",
          permission: "admin",
        },
        {
          id: 3,
          name: "clinical-policies-authors",
          permission: "write",
          units_map: { "repo.code": "write" },
        },
        {
          id: 4,
          name: "clinical-policies-reviewers",
          permission: "read",
          units_map: { "repo.code": "read", "repo.pulls": "read" },
        },
        {
          id: 5,
          name: "hr-policies-authors",
          permission: "write",
          units_map: { "repo.code": "write" },
        },
      ],
      "/teams/{id}/members": (init: { params: { path: { id: number } } }) =>
        membersByTeam[init.params.path.id] ?? [],
      "/teams/{id}/repos": () => [{ id: 1, name: "clinical-policies" }],
    },
  });

  const { listBillableSeats, countBillableSeats } = await import("./orgs");

  const seats = await listBillableSeats({ client, org: "mercy-health" });
  expect(seats.map((seat) => seat.login)).toEqual(["alice", "bob", "dan"]);
  // dan authors in two binders and is still one seat; carol reviews and is free.
  expect(await countBillableSeats({ client, org: "mercy-health" })).toBe(3);
});

test("listBillableSeats counts org owners, who can write to every binder", async () => {
  const { client } = createMockClient({
    GET: {
      "/orgs/{org}/teams": (): Team[] => [
        { id: 1, name: "Owners", permission: "owner" },
        {
          id: 2,
          name: "clinical-policies-reviewers",
          permission: "read",
          units_map: { "repo.code": "read" },
        },
      ],
      "/teams/{id}/members": (init: { params: { path: { id: number } } }) =>
        init.params.path.id === 1 ? [user("alice", 1)] : [user("carol", 3)],
      "/teams/{id}/repos": () => [{ id: 1, name: "clinical-policies" }],
    },
  });

  const { listBillableSeats } = await import("./orgs");

  // Matching on a `-authors` suffix would let an org move everyone into Owners
  // and pay for nobody. The permission is the criterion, not the name.
  expect(
    (await listBillableSeats({ client, org: "mercy-health" })).map(
      (seat) => seat.login,
    ),
  ).toEqual(["alice"]);
});

test("listBillableSeats ignores a write team that holds no repository", async () => {
  const { client } = createMockClient({
    GET: {
      "/orgs/{org}/teams": (): Team[] => [
        {
          id: 2,
          name: "leftovers-authors",
          permission: "write",
          units_map: { "repo.code": "write" },
          includes_all_repositories: false,
        },
      ],
      "/teams/{id}/members": () => [user("bob", 2)],
      "/teams/{id}/repos": () => [],
    },
  });

  const { listBillableSeats } = await import("./orgs");

  // A team granted onto nothing grants access to nothing, so it costs nothing.
  expect(await listBillableSeats({ client, org: "mercy-health" })).toEqual([]);
});

test("listBillableSeats counts an includes-all-repositories team without asking for its repos", async () => {
  const { client, mockGet } = createMockClient({
    GET: {
      "/orgs/{org}/teams": (): Team[] => [
        {
          id: 2,
          name: "everything-authors",
          permission: "write",
          units_map: { "repo.code": "write" },
          includes_all_repositories: true,
        },
      ],
      "/teams/{id}/members": () => [user("bob", 2)],
    },
  });

  const { listBillableSeats } = await import("./orgs");

  expect(
    (await listBillableSeats({ client, org: "mercy-health" })).map(
      (seat) => seat.login,
    ),
  ).toEqual(["bob"]);
  expect(
    mockGet.mock.calls.some((call) => call[0] === "/teams/{id}/repos"),
  ).toBe(false);
});

test("grantTeamOnRepo and addTeamMember surface Gitea failures", async () => {
  const { client } = createMockClient({});

  const { grantTeamOnRepo, addTeamMember, removeTeamMember } =
    await import("./orgs");

  expect(
    grantTeamOnRepo({ client, teamId: 1, org: "mercy", repo: "policies" }),
  ).rejects.toThrow();
  expect(
    addTeamMember({ client, teamId: 1, username: "bob" }),
  ).rejects.toThrow();
  expect(
    removeTeamMember({ client, teamId: 1, username: "bob" }),
  ).rejects.toThrow();
});

test("grantTeamOnRepo and addTeamMember address the right Gitea routes", async () => {
  const { client, mockPut } = createMockClient({
    PUT: {
      "/teams/{id}/repos/{org}/{repo}": () => ({}),
      "/teams/{id}/members/{username}": () => ({}),
    },
  });

  const { grantTeamOnRepo, addTeamMember } = await import("./orgs");

  await grantTeamOnRepo({
    client,
    teamId: 3,
    org: "mercy-health",
    repo: "clinical-policies",
  });
  await addTeamMember({ client, teamId: 3, username: "bob" });

  expect(mockPut.mock.calls[0]?.[0]).toBe("/teams/{id}/repos/{org}/{repo}");
  expect(mockPut.mock.calls[1]?.[0]).toBe("/teams/{id}/members/{username}");
});
