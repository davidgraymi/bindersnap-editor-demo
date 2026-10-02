/**
 * Getting a policy out of Bindersnap as a PDF or a Word document.
 *
 * A policy written in the editor is stored as the editor's JSON, which nobody
 * outside the product can open. The export lays it out afresh; an uploaded
 * file that already is a PDF comes back as itself, and one that is not is
 * refused with a sentence rather than approximated.
 */
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

test.describe.configure({ mode: "parallel", timeout: 120_000 });

function authHeaders(session: string): Record<string, string> {
  return {
    Cookie: `bindersnap_session=${session}`,
    "Content-Type": "application/json",
    Origin: APP_BASE_URL,
  };
}

async function signUp(): Promise<string> {
  const suffix = randomUUID().slice(0, 12);
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({
      firstName: "Test",
      lastName: "User",
      username: `export-${suffix}`,
      email: `export-${suffix}@users.bindersnap.local`,
      password: `Bindersnap-${suffix}!`,
    }),
  });
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )![1]!;
}

async function post(session: string, path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: path.endsWith("/rules") ? "PATCH" : "POST",
    headers: authHeaders(session),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, text).toBeLessThan(300);
  return JSON.parse(text || "{}");
}

async function publishFile(
  session: string,
  org: string,
  binder: string,
  name: string,
  file: Blob,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.set("file", file, filename);
  form.set("name", name);
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
  const body = (await added.json()) as {
    pullRequestNumber: number;
    slugPath: string;
  };
  expect(added.status).toBe(201);
  await post(
    session,
    `/api/app/binders/${org}/${binder}/changes/${body.pullRequestNumber}/publish`,
    { mergeStyle: "merge" },
  );
  return body.slugPath;
}

const POLICY = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Fire Safety" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Know where the exits are." }],
    },
  ],
};

test("a policy is exported as a PDF and as a Word document", async () => {
  const session = await signUp();
  const { organization } = await post(session, "/api/app/organizations", {
    name: `Export ${randomUUID().slice(0, 6)}`,
  });
  const org = organization.name as string;
  const { workspace } = await post(session, `/api/app/orgs/${org}/binders`, {
    name: "Policies",
  });
  const binder = workspace.name as string;
  // On its own, so the owner can publish without a second person.
  await post(session, `/api/app/binders/${org}/${binder}/rules`, {
    requiredApprovals: 0,
  });

  const written = await publishFile(
    session,
    org,
    binder,
    "Fire Safety",
    new Blob([JSON.stringify(POLICY)], { type: "application/json" }),
    "document.json",
  );

  const exported = (format: string, path = written) =>
    fetch(
      `${API_BASE_URL}/api/app/binders/${org}/${binder}/export/${path}?format=${format}`,
      { headers: authHeaders(session) },
    );

  const pdf = await exported("pdf");
  expect(pdf.status).toBe(200);
  expect(pdf.headers.get("content-type")).toBe("application/pdf");
  expect(pdf.headers.get("content-disposition")).toContain(
    "fire-safety-v1.pdf",
  );
  const pdfBytes = await pdf.arrayBuffer();
  expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");
  // Set in the editor's own fonts, which the API image carries: Lora for
  // the heading, Geist for the text.
  const pdfText = new TextDecoder("latin1").decode(pdfBytes);
  expect(pdfText).toContain("/BaseFont /Lora-SemiBold");
  expect(pdfText).toContain("/BaseFont /Geist-Regular");

  const docx = await exported("docx");
  expect(docx.status).toBe(200);
  const zip = new Uint8Array(await docx.arrayBuffer());
  expect([zip[0], zip[1]]).toEqual([0x50, 0x4b]);

  // An uploaded PDF is handed back as itself; asked for as Word, it says why not.
  const uploaded = await publishFile(
    session,
    org,
    binder,
    "Evacuation Map",
    new Blob(["%PDF-1.4\n%%EOF\n"], { type: "application/pdf" }),
    "evacuation-map.pdf",
  );
  const original = await exported("pdf", uploaded);
  expect(original.status).toBe(200);
  expect(await original.text()).toBe("%PDF-1.4\n%%EOF\n");
  const refused = await exported("docx", uploaded);
  expect(refused.status).toBe(415);
  expect(((await refused.json()) as { error: string }).error).toContain(
    "a PDF",
  );
});

test("the document page offers PDF and Word for a policy written here", async ({
  page,
}) => {
  const session = await signUp();
  const { organization } = await post(session, "/api/app/organizations", {
    name: `Export ${randomUUID().slice(0, 6)}`,
  });
  const org = organization.name as string;
  const { workspace } = await post(session, `/api/app/orgs/${org}/binders`, {
    name: "Policies",
  });
  const binder = workspace.name as string;
  await post(session, `/api/app/binders/${org}/${binder}/rules`, {
    requiredApprovals: 0,
  });
  const written = await publishFile(
    session,
    org,
    binder,
    "Fire Safety",
    new Blob([JSON.stringify(POLICY)], { type: "application/json" }),
    "document.json",
  );

  await page
    .context()
    .addCookies([
      { name: "bindersnap_session", value: session, url: APP_BASE_URL },
    ]);
  await page.goto(`${APP_BASE_URL}/${org}/${binder}/-/blob/main/${written}`);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "PDF", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("fire-safety-v1.pdf");
  await expect(
    page.getByRole("button", { name: "Word", exact: true }),
  ).toBeVisible();
});

test("a document's audit packet is one zip, holding the record of every version", async () => {
  const session = await signUp();
  const { organization } = await post(session, "/api/app/organizations", {
    name: `Audit ${randomUUID().slice(0, 6)}`,
  });
  const org = organization.name as string;
  const { workspace } = await post(session, `/api/app/orgs/${org}/binders`, {
    name: "Policies",
  });
  const binder = workspace.name as string;
  await post(session, `/api/app/binders/${org}/${binder}/rules`, {
    requiredApprovals: 0,
  });
  const written = await publishFile(
    session,
    org,
    binder,
    "Fire Safety",
    new Blob([JSON.stringify(POLICY)], { type: "application/json" }),
    "document.json",
  );

  const response = await fetch(
    `${API_BASE_URL}/api/app/binders/${org}/${binder}/audit/${written}`,
    { headers: authHeaders(session) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-disposition")).toContain(
    "fire-safety-audit-packet-",
  );
  const zip = Buffer.from(await response.arrayBuffer());
  expect([zip[0], zip[1]]).toEqual([0x50, 0x4b]);
  // Stored, not compressed, so the names and the record are in the bytes.
  const text = zip.toString("latin1");
  for (const name of [
    "audit-packet.pdf",
    "approvals.csv",
    "record.json",
    "README.txt",
  ]) {
    expect(text).toContain(name);
  }
  expect(text).toContain('"version": 1');
});
