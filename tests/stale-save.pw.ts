/**
 * A save names the version it was written on, and one written on a version
 * somebody has since saved over is refused rather than replacing their words.
 *
 * In an organization of its own, so the seed's changes are left alone.
 */
import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { LEGAL_VERSION } from "../packages/utils/legal";
import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { signUpAndConfirm } from "./mailpit";

test.describe.configure({ timeout: 180_000 });

/** Git's name for a file's contents, as a tree lists it. */
function blobSha(text: string): string {
  const bytes = Buffer.from(text);
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

test("a save on top of somebody else's is refused, and nothing is written", async () => {
  const suffix = randomUUID().slice(0, 12);
  const signup = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Stale",
      lastName: suffix,
      username: `stale-${suffix}`,
      email: `stale-${suffix}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(signup.status).toBe(200);
  const session = (signup.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
  const headers = {
    Cookie: `bindersnap_session=${session}`,
    Origin: APP_BASE_URL,
  };

  const org = await fetch(`${API_BASE_URL}/api/app/organizations`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      acceptedTerms: LEGAL_VERSION,
      name: `Stale ${suffix}`,
    }),
  });
  expect(org.status).toBe(201);
  const orgName = ((await org.json()) as { organization: { name: string } })
    .organization.name;
  const binder = await fetch(
    `${API_BASE_URL}/api/app/orgs/${orgName}/binders`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Policies" }),
    },
  );
  expect(binder.status).toBe(201);
  const binderName = ((await binder.json()) as { workspace: { name: string } })
    .workspace.name;
  const base = `${API_BASE_URL}/api/app/binders/${orgName}/${binderName}`;

  // A document, in a draft.
  const first = "# Hand Hygiene\n\nThe first words.\n";
  const add = new FormData();
  add.set("name", "Hand Hygiene");
  add.set("draft", "true");
  add.set("file", new File([first], "hand-hygiene.md"));
  const added = await fetch(`${base}/documents`, {
    method: "POST",
    headers,
    body: add,
  });
  expect(added.status, await added.clone().text()).toBe(201);
  const { slugPath, branch } = (await added.json()) as {
    slugPath: string;
    branch: string;
  };

  const save = async (text: string, basedOn: string) => {
    const form = new FormData();
    form.set("documentPath", slugPath);
    form.set("draft", branch);
    form.set("basedOn", basedOn);
    form.set("file", new File([text], "hand-hygiene.md"));
    return fetch(`${base}/document-revisions`, {
      method: "POST",
      headers,
      body: form,
    });
  };

  // One person saves on the first words. Their save says what it left.
  const theirs = "# Hand Hygiene\n\nTheir words.\n";
  const saved = await save(theirs, blobSha(first));
  expect(saved.status, await saved.clone().text()).toBe(201);
  expect(((await saved.json()) as { sha: string }).sha).toBe(blobSha(theirs));

  // Another, still on the first words, is refused.
  const stale = await save("# Hand Hygiene\n\nMine.\n", blobSha(first));
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "stale" });

  // On top of theirs, it goes through.
  const next = await save(
    "# Hand Hygiene\n\nMine, after theirs.\n",
    blobSha(theirs),
  );
  expect(next.status, await next.clone().text()).toBe(201);
});
