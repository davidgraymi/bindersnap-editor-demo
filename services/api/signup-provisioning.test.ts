import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./gitea-client/client";
import type { OrganizationBackend, OrganizationRecord } from "./organizations";
import {
  deriveOrganizationName,
  nameAttempt,
  provisionSignup,
  provisionSignupBestEffort,
  slugifyOrganizationName,
} from "./signup-provisioning";

type Handler = (init?: any) => unknown;

interface Handlers {
  GET?: Record<string, Handler>;
  POST?: Record<string, Handler>;
  PUT?: Record<string, Handler>;
  PATCH?: Record<string, Handler>;
}

/** A handler returning this answers 404, the way a real Gitea would. */
const NOT_FOUND = Symbol("not-found");

/** A handler returning this answers 422, the way Gitea refuses a taken name. */
const ALREADY_EXISTS = Symbol("already-exists");

function notFound() {
  return {
    data: undefined,
    error: { message: "not found" },
    response: new Response(null, { status: 404 }),
  };
}

function alreadyExists() {
  return {
    data: undefined,
    error: { message: "user already exists [name: mercy-health]" },
    response: new Response(null, { status: 422 }),
  };
}

function createMockClient(handlers: Handlers) {
  const method = (verb: keyof Handlers) =>
    mock(async (path: string, init?: unknown) => {
      const handler = handlers[verb]?.[path];
      if (!handler) {
        return notFound();
      }
      const data = await handler(init);
      if (data === NOT_FOUND) {
        return notFound();
      }
      if (data === ALREADY_EXISTS) {
        return alreadyExists();
      }
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
  };
}

function createMemoryStore(): OrganizationBackend & {
  rows: Map<number, OrganizationRecord>;
} {
  const rows = new Map<number, OrganizationRecord>();
  return {
    rows,
    async get(id) {
      return rows.get(id) ?? null;
    },
    async getByName(name) {
      return [...rows.values()].find((row) => row.name === name) ?? null;
    },
    async upsert(record) {
      rows.set(record.giteaOrgId, record);
    },
    async list() {
      return [...rows.values()];
    },
  };
}

/**
 * A Gitea that answers every provisioning call. `existingOrgs` decides which
 * org names are already taken, which is how the collision path is exercised.
 */
function createProvisioningClient(
  existingOrgs: string[] = [],
  /**
   * Names held by a **private** organization this caller cannot see. Gitea
   * answers `GET /orgs/{org}` for those with a 404 — indistinguishable from a
   * free name — and only refuses at creation, with a 422.
   */
  invisiblyTaken: string[] = [],
) {
  const taken = new Set(existingOrgs);
  const hidden = new Set(invisiblyTaken);
  const created: { orgs: string[]; teams: string[]; repos: string[] } = {
    orgs: [],
    teams: [],
    repos: [],
  };
  let nextTeamId = 1;

  return {
    created,
    ...createMockClient({
      GET: {
        "/orgs/{org}": (init: { params: { path: { org: string } } }) => {
          const org = init.params.path.org;
          return taken.has(org)
            ? { id: 1, username: org, name: org }
            : NOT_FOUND;
        },
        "/orgs/{org}/teams": () => [],
        // A fresh org holds no repository and no branch protection yet.
        "/repos/{owner}/{repo}": () => NOT_FOUND,
        "/repos/{owner}/{repo}/branch_protections/{name}": () => NOT_FOUND,
      },
      POST: {
        "/orgs": (init: { body: { username: string } }) => {
          if (hidden.has(init.body.username)) {
            return ALREADY_EXISTS;
          }
          created.orgs.push(init.body.username);
          return {
            id: 77,
            username: init.body.username,
            name: init.body.username,
          };
        },
        "/orgs/{org}/repos": (init: { body: { name: string } }) => {
          created.repos.push(init.body.name);
          return {
            id: 5,
            name: init.body.name,
            full_name: `org/${init.body.name}`,
            owner: { login: "org" },
          };
        },
        "/orgs/{org}/teams": (init: { body: { name: string } }) => {
          created.teams.push(init.body.name);
          return { id: nextTeamId++, name: init.body.name };
        },
        "/repos/{owner}/{repo}/branch_protections": (init: {
          body: Record<string, unknown>;
        }) => init.body,
      },
      PUT: {
        "/teams/{id}/repos/{org}/{repo}": () => ({}),
      },
    }),
  };
}

test("slugifyOrganizationName reduces a display name to a Gitea username", () => {
  expect(slugifyOrganizationName("Mercy Health Group")).toBe(
    "mercy-health-group",
  );
  expect(slugifyOrganizationName("  St. Jude's / Nursing  ")).toBe(
    "st.-jude-s-nursing",
  );
  expect(slugifyOrganizationName("---")).toBe("");
});

test("deriveOrganizationName never collides with the user's own name", () => {
  // Gitea keeps users and organizations in one namespace, so `alice` the org
  // and `alice` the person cannot both exist.
  expect(deriveOrganizationName("alice")).toBe("alice-org");
  expect(deriveOrganizationName("alice", "Alice")).toBe("alice-org");
  expect(deriveOrganizationName("alice", "Mercy Health")).toBe("mercy-health");
});

test("nameAttempt suffixes only after the first try", () => {
  expect(nameAttempt("mercy-health", 1)).toBe("mercy-health");
  expect(nameAttempt("mercy-health", 3)).toBe("mercy-health-3");
});

test("provisionSignup creates the org, the first binder and its three teams", async () => {
  const { client, created } = createProvisioningClient();
  const store = createMemoryStore();

  const result = await provisionSignup({
    client,
    username: "alice",
    organizationName: "Mercy Health",
    store,
    now: 1_700_000_000_000,
  });

  expect(created.orgs).toEqual(["mercy-health"]);
  expect(created.repos).toEqual(["policies"]);
  expect(created.teams).toEqual([
    "policies-admins",
    "policies-authors",
    "policies-reviewers",
  ]);

  expect(result.organization.giteaOrgId).toBe(77);
  expect(result.organization.createdBy).toBe("alice");
  // Fourteen days, no card (#369).
  expect(result.organization.trialEndsAt).toBe(
    Math.floor(1_700_000_000_000 / 1000) + 14 * 24 * 60 * 60,
  );
  expect(store.rows.get(77)).toEqual(result.organization);
});

test("provisionSignup steps past an organization name that is taken", async () => {
  const { client, created } = createProvisioningClient(["mercy-health"]);
  const store = createMemoryStore();

  await provisionSignup({
    client,
    username: "alice",
    organizationName: "Mercy Health",
    store,
  });

  expect(created.orgs).toEqual(["mercy-health-2"]);
});

test("provisionSignup does not restart the trial on a second run", async () => {
  const { client } = createProvisioningClient();
  const store = createMemoryStore();

  const first = await provisionSignup({
    client,
    username: "alice",
    store,
    now: 1_700_000_000_000,
  });
  const second = await provisionSignup({
    client,
    username: "alice",
    store,
    // Ten days later, re-running provisioning to repair a partial failure.
    now: 1_700_000_000_000 + 10 * 24 * 60 * 60 * 1000,
  });

  expect(second.organization.trialEndsAt).toBe(first.organization.trialEndsAt);
  expect(second.organization.createdAt).toBe(first.organization.createdAt);
});

test("provisionSignupBestEffort never fails the signup it is part of", async () => {
  // A Gitea that answers nothing: the account and the session are already real
  // by the time this runs, and a hiccup here must not strand the new user at a
  // login form for an account that exists.
  const { client } = createMockClient({});
  const store = createMemoryStore();

  expect(
    await provisionSignupBestEffort({ client, username: "alice", store }),
  ).toBeNull();
});

test("a name held by an organization the signer-up cannot see steps to the next", async () => {
  // The ordinary case for two customers of the same name. Gitea answers
  // `GET /orgs/mercy-health` with 404 when the organization is private and
  // this user is not in it, so the name looks free and only the create refuses.
  const gitea = createProvisioningClient([], ["mercy-health"]);

  const result = await provisionSignup({
    client: gitea.client,
    username: "bob",
    organizationName: "Mercy Health",
    store: createMemoryStore(),
  });

  expect(gitea.created.orgs).toEqual(["mercy-health-2"]);
  expect(result.provisioned.organization.name).toBe("mercy-health-2");
  // And the binder is built inside the organization that was actually created.
  expect(gitea.created.repos).toEqual(["policies"]);
});

test("an invisible collision does not swallow a real creation failure", async () => {
  // 422 means "that name is taken". Anything else is a genuine failure and must
  // surface on the first attempt rather than being walked past twenty times.
  const gitea = createMockClient({
    GET: { "/orgs/{org}": () => NOT_FOUND },
    POST: { "/orgs": () => NOT_FOUND },
  });

  await expect(
    provisionSignup({
      client: gitea.client,
      username: "bob",
      organizationName: "Mercy Health",
      store: createMemoryStore(),
    }),
  ).rejects.toThrow();

  // One create attempt, not twenty.
  expect(
    gitea.mockPost.mock.calls.filter((call) => call[0] === "/orgs"),
  ).toHaveLength(1);
});
