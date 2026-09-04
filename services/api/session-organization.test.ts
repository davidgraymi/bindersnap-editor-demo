import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./gitea-client/client";
import type { SessionRecord } from "./sessions";
import {
  listSessionOrganizations,
  resolveOrganizationForUser,
  resolveSessionOrganization,
} from "./session-organization";

function createClient(
  responses: Record<string, { status: number; body?: unknown }>,
) {
  const get = mock(async (path: string) => {
    const response = responses[path];
    if (!response || response.status >= 400) {
      return {
        data: undefined,
        error: { message: "not found" },
        response: new Response(null, { status: response?.status ?? 404 }),
      };
    }
    return {
      data: response.body,
      error: undefined,
      response: new Response(null, { status: 200 }),
    };
  });

  return {
    client: { GET: get, use: mock() } as unknown as GiteaClient,
    get,
  };
}

const session: SessionRecord = {
  id: "sess_1",
  username: "alice",
  giteaToken: "token",
  giteaTokenName: "name",
  createdAt: 0,
  expiresAt: 0,
};

test("resolveSessionOrganization returns the session's one organization", async () => {
  const { client } = createClient({
    "/user/orgs": {
      status: 200,
      body: [{ id: 42, username: "mercy-health" }],
    },
  });

  expect(await resolveSessionOrganization(client, session)).toEqual({
    id: 42,
    name: "mercy-health",
    displayName: "mercy-health",
  });
});

test("no organization is a real answer, not an error", async () => {
  const { client } = createClient({ "/user/orgs": { status: 200, body: [] } });

  // An account that predates ADR 0004, or one whose signup provisioning
  // failed. The paywall reads this as "nothing to bill", which is not access.
  expect(await resolveSessionOrganization(client, session)).toBeNull();
});

test("a Gitea failure resolves to no organization rather than throwing", async () => {
  const { client } = createClient({ "/user/orgs": { status: 500 } });

  expect(await listSessionOrganizations(client)).toEqual([]);
  expect(await resolveSessionOrganization(client, session)).toBeNull();
});

test("several organizations resolve to the oldest, deterministically", async () => {
  const { client } = createClient({
    "/user/orgs": {
      status: 200,
      body: [
        { id: 77, username: "later-org" },
        { id: 42, username: "mercy-health" },
        { id: 91, username: "another-org" },
      ],
    },
  });

  // Gitea allows it and a person may be in an org we did not create, so this
  // has to pick without flapping between requests.
  expect(await resolveSessionOrganization(client, session)).toEqual({
    id: 42,
    name: "mercy-health",
    displayName: "mercy-health",
  });
});

test("rows without an id are ignored", async () => {
  const { client } = createClient({
    "/user/orgs": {
      status: 200,
      body: [{ username: "nameless" }, { id: 42, username: "mercy-health" }],
    },
  });

  expect(await listSessionOrganizations(client)).toEqual([
    { id: 42, name: "mercy-health", displayName: "mercy-health" },
  ]);
});

test("resolveOrganizationForUser reads another person's organization", async () => {
  const { client, get } = createClient({
    "/users/{username}/orgs": {
      status: 200,
      body: [{ id: 42, username: "mercy-health" }],
    },
  });

  // The admin console's question: an override belongs to an organization, and
  // an admin types a person's name.
  expect(await resolveOrganizationForUser(client, "bob")).toEqual({
    id: 42,
    name: "mercy-health",
    displayName: "mercy-health",
  });
  expect(get.mock.calls[0]?.[0]).toBe("/users/{username}/orgs");
});

test("resolveOrganizationForUser returns null when Gitea will not say", async () => {
  const { client } = createClient({
    "/users/{username}/orgs": { status: 403 },
  });

  expect(await resolveOrganizationForUser(client, "bob")).toBeNull();
});

test("the name the owner typed survives slugification", () => {
  // "Mercy Health" becomes the org username `mercy-health`, which is a URL
  // segment and a poor title. Gitea keeps the typed name in `full_name`, and
  // this is what carries it back to the app.
  const { client } = createClient({
    "/user/orgs": {
      status: 200,
      body: [{ id: 42, username: "mercy-health-2", full_name: "Mercy Health" }],
    },
  });

  return listSessionOrganizations(client).then((orgs) => {
    expect(orgs).toEqual([
      { id: 42, name: "mercy-health-2", displayName: "Mercy Health" },
    ]);
  });
});
