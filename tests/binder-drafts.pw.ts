/**
 * A draft: work that has not been proposed to anybody yet.
 *
 * Every act on a binder used to open a change request the instant it happened,
 * which put a half-finished thought in front of reviewers and wrote the
 * sentence explaining it on the author's behalf. A draft is the branch git
 * already has: work lands on it, nothing is proposed, and the person who did
 * it writes the title when they are ready.
 *
 * **Why this is an integration test and not a unit test.** Three of the things
 * it asserts are claims about Gitea, not about our code, and a mock would
 * happily agree with a wrong one:
 *
 *   - `GET /commits?sha=<branch>&not=main` returns the draft's own commits.
 *   - A branch name with slashes in it can be deleted through the typed
 *     client, which encodes path parameters.
 *   - A pull request opened from a branch that already has commits carries the
 *     title and body we gave it, and the branch stops being a draft the moment
 *     it has one.
 *
 * Requires the full Docker Compose stack — run via `bun run test:integration`.
 */

import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "serial", timeout: 180_000 });

interface Credentials {
  username: string;
  email: string;
  password: string;
}

function buildCredentials(prefix: string): Credentials {
  const suffix = randomUUID().slice(0, 12);
  return {
    username: `${prefix}-${suffix}`,
    email: `${prefix}-${suffix}@users.bindersnap.local`,
    password: `Bindersnap-${suffix}!`,
  };
}

function sessionFrom(response: Response): string {
  const match = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  );
  expect(match?.[1], "no session cookie in the response").toBeTruthy();
  return match![1]!;
}

function authHeaders(session: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${session}`,
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
  };
}

async function signUp(credentials: Credentials): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify(credentials),
  });
  expect(
    response.status,
    `signup failed: ${await response.clone().text()}`,
  ).toBe(200);
  return sessionFrom(response);
}

async function createOrganization(
  session: string,
  displayName: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name: displayName }),
  });
  const body = await response.text();
  expect(response.status, `create organization failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { organization: { name: string } }).organization
    .name;
}

async function createBinder(
  session: string,
  org: string,
  name: string,
): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/binders`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ name }),
  });
  const body = await response.text();
  expect(response.status, `create binder failed: ${body}`).toBe(201);
  return (JSON.parse(body) as { workspace: { name: string } }).workspace.name;
}

interface DraftPayload {
  draft: {
    branch: string;
    owner: string;
    updatedAt: string | null;
    acts: Array<{ summary: string; paths: string[] }>;
  } | null;
  others: Array<{ branch: string; owner: string; lastAct: string | null }>;
}

async function readDraft(
  session: string,
  org: string,
  binder: string,
): Promise<DraftPayload> {
  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    { headers: authHeaders(session) },
  );
  const body = await response.text();
  expect(response.status, `read draft failed: ${body}`).toBe(200);
  return JSON.parse(body) as DraftPayload;
}

/** Make a folder, putting it wherever `extra` says. */
async function makeFolder(
  session: string,
  org: string,
  binder: string,
  folder: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return fetch(`${API_BASE_URL}/api/app/binders/${org}/${binder}/folders`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ folder, ...extra }),
  });
}

/** A signed-up person with an organization and an empty binder. */
async function provision(prefix: string) {
  const credentials = buildCredentials(prefix);
  const session = await signUp(credentials);
  const org = await createOrganization(
    session,
    `Draftworks ${randomUUID().slice(0, 6)}`,
  );
  const binder = await createBinder(session, org, "Clinical Policies");
  return { credentials, session, org, binder };
}

test("a binder nobody is editing has no draft", async () => {
  const { session, org, binder } = await provision("draft-none");

  const payload = await readDraft(session, org, binder);

  // Null, not a 404. "You are not editing this binder" is the ordinary state.
  expect(payload.draft).toBeNull();
  expect(payload.others).toEqual([]);
});

test("work goes into a draft, and nothing is proposed", async () => {
  const { credentials, session, org, binder } = await provision("draft-work");

  const made = await makeFolder(session, org, binder, "Nursing", {
    draft: true,
  });
  const madeBody = await made.text();
  expect(made.status, `make folder failed: ${madeBody}`).toBe(201);

  // **No change number.** That is the whole point: the act happened, and
  // nobody has been asked to decide anything.
  const result = JSON.parse(madeBody) as {
    branch: string;
    changeNumber: number | null;
  };
  expect(result.changeNumber).toBeNull();
  expect(result.branch).toMatch(
    new RegExp(`^draft/${credentials.username}/\\d{14}$`),
  );

  // And the binder's changes list is still empty, which is the claim that
  // matters to everybody who is not the author.
  const changes = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes?state=open`,
    { headers: authHeaders(session) },
  );
  expect(
    ((await changes.json()) as { changes: unknown[] }).changes,
  ).toHaveLength(0);

  // The draft reads back as the list of things done to it. This is the live
  // check on `not=main`: the binder's own first commit must not be in here.
  const payload = await readDraft(session, org, binder);
  expect(payload.draft?.branch).toBe(result.branch);
  expect(payload.draft?.acts.map((act) => act.summary)).toEqual([
    "Add the folder nursing",
  ]);
  expect(payload.draft?.acts[0]?.paths).toEqual(["nursing/.gitkeep"]);
});

test("several acts accumulate on one draft", async () => {
  const { session, org, binder } = await provision("draft-many");

  for (const folder of ["Nursing", "Pharmacy", "Estates"]) {
    const response = await makeFolder(session, org, binder, folder, {
      draft: true,
    });
    expect(
      response.status,
      `make ${folder} failed: ${await response.clone().text()}`,
    ).toBe(201);
  }

  const payload = await readDraft(session, org, binder);

  // One draft, three acts — not three drafts and not three change requests.
  // Newest first, the way Gitea returns commits.
  expect(payload.draft?.acts.map((act) => act.summary)).toEqual([
    "Add the folder estates",
    "Add the folder pharmacy",
    "Add the folder nursing",
  ]);
});

test("pressing Edit twice resumes the same draft", async () => {
  const { session, org, binder } = await provision("draft-resume");

  const open = async () =>
    fetch(`${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`, {
      method: "POST",
      headers: authHeaders(session),
    });

  const first = (await (await open()).json()) as DraftPayload;
  const second = (await (await open()).json()) as DraftPayload;

  expect(first.draft?.branch).toBeTruthy();
  expect(second.draft?.branch).toBe(first.draft!.branch);
});

test("the author writes the title, and proposing it opens the change request", async () => {
  const { session, org, binder } = await provision("draft-propose");

  await makeFolder(session, org, binder, "Nursing", { draft: true });
  await makeFolder(session, org, binder, "Pharmacy", { draft: true });

  const proposed = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        title: "Sort the binder into departments",
        description:
          "Nursing and Pharmacy own different policies and reviewing them\ntogether has never worked.",
      }),
    },
  );
  const proposedBody = await proposed.text();
  expect(proposed.status, `propose failed: ${proposedBody}`).toBe(201);
  const { changeNumber } = JSON.parse(proposedBody) as { changeNumber: number };

  // The change carries the author's own words, not a generated summary.
  const detail = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes/${changeNumber}`,
    { headers: authHeaders(session) },
  );
  const change = (await detail.json()) as {
    change: { title: string; body: string };
  };
  expect(change.change.title).toBe("Sort the binder into departments");
  expect(change.change.body).toContain("reviewing them");

  // And the draft is gone, because a proposed draft is a change request.
  expect((await readDraft(session, org, binder)).draft).toBeNull();
});

test("an empty draft has nothing to propose", async () => {
  const { session, org, binder } = await provision("draft-empty");

  await fetch(`${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`, {
    method: "POST",
    headers: authHeaders(session),
  });

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ title: "Nothing at all" }),
    },
  );

  expect(response.status).toBe(409);
  expect((await response.json()) as { error: string }).toMatchObject({
    error: expect.stringContaining("nothing in your draft"),
  });
});

test("a change request needs a title somebody wrote", async () => {
  const { session, org, binder } = await provision("draft-untitled");
  await makeFolder(session, org, binder, "Nursing", { draft: true });

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/changes`,
    {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ title: "   " }),
    },
  );

  expect(response.status).toBe(400);
});

test("discarding a draft throws the branch away", async () => {
  // The live check on deleting a branch whose name has slashes in it — the
  // typed client encodes path parameters, and this is the one call that would
  // find out the hard way.
  const { session, org, binder } = await provision("draft-discard");
  await makeFolder(session, org, binder, "Nursing", { draft: true });

  const before = await readDraft(session, org, binder);
  expect(before.draft).not.toBeNull();

  const discarded = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/draft`,
    { method: "DELETE", headers: authHeaders(session) },
  );
  const discardedBody = await discarded.text();
  expect(discarded.status, `discard failed: ${discardedBody}`).toBe(200);
  expect(JSON.parse(discardedBody)).toEqual({
    discarded: before.draft!.branch,
  });

  expect((await readDraft(session, org, binder)).draft).toBeNull();

  // And the folder never reached the binder, which is what discarding means.
  const documents = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    { headers: authHeaders(session) },
  );
  const listed = (await documents.json()) as { folders?: string[] };
  expect(listed.folders ?? []).not.toContain("nursing");
});

test("a draft is not somebody else's to commit into", async () => {
  const { session, org, binder } = await provision("draft-owner");
  const made = await makeFolder(session, org, binder, "Nursing", {
    draft: true,
  });
  const mine = (JSON.parse(await made.text()) as { branch: string }).branch;

  // A second person in the same organization, so the refusal is about
  // ownership of the draft rather than about access to the binder.
  const other = buildCredentials("draft-intruder");
  const otherSession = await signUp(other);
  const added = await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: other.username, owner: false }),
  });
  expect(
    added.status,
    `add person failed: ${await added.clone().text()}`,
  ).toBeLessThan(300);

  const attempt = await makeFolder(otherSession, org, binder, "Estates", {
    draft: mine,
  });

  expect(attempt.status).toBe(409);
  expect((await attempt.json()) as { error: string }).toMatchObject({
    error: expect.stringContaining("not yours"),
  });
});

test("a draft in flight is visible to the people it is not", async () => {
  // Not its contents — only that somebody is editing, which is what stops two
  // people making the same folder twice.
  const { credentials, session, org, binder } = await provision("draft-seen");
  await makeFolder(session, org, binder, "Nursing", { draft: true });

  const other = buildCredentials("draft-watcher");
  const otherSession = await signUp(other);
  await fetch(`${API_BASE_URL}/api/app/orgs/${org}/people`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify({ username: other.username, owner: false }),
  });

  const seen = await readDraft(otherSession, org, binder);

  expect(seen.draft).toBeNull();
  expect(seen.others).toHaveLength(1);
  expect(seen.others[0]).toMatchObject({
    owner: credentials.username,
    lastAct: "Add the folder nursing",
  });
});
