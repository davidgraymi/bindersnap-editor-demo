/**
 * A draft is `draft/<username>/<17-digit stamp>`. For a 16-character
 * username that is exactly 40 characters — the length of a commit hash — and
 * Gitea's tree endpoint read it as one. Edit opened an editor that said the
 * draft it had just made did not exist.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";
import { signUpAndConfirm } from "./mailpit";
import { LEGAL_VERSION } from "../packages/utils/legal";

test.describe.configure({ timeout: 120_000 });

async function call(
  session: string,
  method: string,
  path: string,
  body: unknown,
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: `bindersnap_session=${session}`,
      "Content-Type": "application/json",
      Origin: APP_BASE_URL,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, text).toBeLessThan(300);
  return JSON.parse(text);
}

test("somebody with a 16-character username can open a document to edit", async ({
  page,
}) => {
  const username = `ed-${randomUUID().replace(/-/g, "").slice(0, 13)}`;
  expect(username).toHaveLength(16);
  const signup = await signUpAndConfirm(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Test",
      lastName: "User",
      username,
      email: `${username}@users.bindersnap.local`,
      password: `Bindersnap-${randomUUID()}!`,
    }),
  });
  expect(signup.status).toBe(200);
  const session = (signup.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;

  const { organization } = await call(
    session,
    "POST",
    "/api/app/organizations",
    {
      acceptedTerms: LEGAL_VERSION,
      name: `Drafts ${randomUUID().slice(0, 6)}`,
    },
  );
  const org = organization.name as string;
  const { workspace } = await call(
    session,
    "POST",
    `/api/app/orgs/${org}/binders`,
    {
      name: "Policies",
    },
  );
  const binder = workspace.name as string;
  await call(session, "PATCH", `/api/app/binders/${org}/${binder}/rules`, {
    requiredApprovals: 0,
  });

  const form = new FormData();
  form.set(
    "file",
    new Blob(
      [
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Wash hands." }],
            },
          ],
        }),
      ],
      { type: "application/json" },
    ),
    "document.json",
  );
  form.set("name", "Hand Hygiene");
  const added = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/documents`,
    {
      method: "POST",
      headers: {
        Cookie: `bindersnap_session=${session}`,
        Origin: APP_BASE_URL,
      },
      body: form,
    },
  );
  expect(added.status).toBe(201);
  const { pullRequestNumber, slugPath } = (await added.json()) as {
    pullRequestNumber: number;
    slugPath: string;
  };
  await call(
    session,
    "POST",
    `/api/app/binders/${org}/${binder}/changes/${pullRequestNumber}/publish`,
    { mergeStyle: "merge" },
  );

  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}/${slugPath}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("draft"))
    .toBeTruthy();
  expect(new URL(page.url()).searchParams.get("draft")!).toHaveLength(40);
  await expect(
    page.getByRole("textbox", { name: "Hand Hygiene" }),
  ).toContainText("Wash hands.");
  await expect(page.getByText(/has no branch called/)).toHaveCount(0);
});
