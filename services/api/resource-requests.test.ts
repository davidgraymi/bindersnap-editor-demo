import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SITE_RESOURCES } from "../../packages/utils/siteResources";
import { renderEmail } from "./mail/layout";
import {
  DAILY_LIMIT_PER_ADDRESS,
  handleResourceRequest,
  handleResourceUnsubscribe,
  isRequestableResource,
  reportResourceRequests,
  resourceName,
  resourceRequestEmail,
  ResourceRequestStore,
  type ResourceRequestDeps,
} from "./resource-requests";

const SITE = "https://bindersnap.com";
const HAND_HYGIENE = "/templates/hand-hygiene-policy";

function freshStore() {
  return new ResourceRequestStore(
    join(mkdtempSync(join(tmpdir(), "resource-requests-")), "requests.db"),
  );
}

function setup(overrides: Partial<ResourceRequestDeps> = {}) {
  const sent: Parameters<ResourceRequestDeps["send"]>[0][] = [];
  const deps: ResourceRequestDeps = {
    store: freshStore(),
    limited: () => false,
    send: (params) => sent.push(params),
    siteOrigin: SITE,
    now: () => Date.UTC(2026, 10, 10, 15),
    ...overrides,
  };
  const post = (fields: Record<string, string>) =>
    handleResourceRequest(
      new Request("https://api.bindersnap.com/site/resource-requests", {
        method: "POST",
        body: new URLSearchParams(fields),
      }),
      "203.0.113.7",
      deps,
    );
  return { deps, sent, post };
}

test("only the site's templates, manual indexes and tools can be asked for", () => {
  expect(isRequestableResource(HAND_HYGIENE)).toBe(true);
  expect(
    isRequestableResource("/manuals/hospice-policy-and-procedure-manual"),
  ).toBe(true);
  expect(isRequestableResource("/tools/required-policies-checklist")).toBe(
    true,
  );
  for (const refused of [
    "/pricing",
    "/templates",
    "/templates/../legal/terms",
    "//evil.example/templates/x",
    "/templates/x?next=https://evil.example",
    "/templates/Hand-Hygiene",
    // The right shape, and not a page: nothing is built from a request.
    "/templates/you-have-won-claim-your-prize-at-evil-example",
    "/tools/constructor",
    "/tools/__proto__",
    "https://evil.example/templates/x",
    "",
    undefined,
    42,
  ]) {
    expect(isRequestableResource(refused)).toBe(false);
  }
});

test("a request is kept, one email goes out, and the reader lands back on the page", async () => {
  const { deps, sent, post } = setup();
  const response = await post({
    email: " DON@Riverside.example ",
    resource: HAND_HYGIENE,
    website: "",
  });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${SITE}${HAND_HYGIENE}#sent`);

  expect(deps.store.list()).toEqual([
    {
      email: "don@riverside.example",
      resource: HAND_HYGIENE,
      createdAt: Date.UTC(2026, 10, 10, 15),
      requestedAt: Date.UTC(2026, 10, 10, 15),
      unsubscribed: false,
    },
  ]);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.to).toBe("don@riverside.example");
  expect(sent[0]!.idempotencyKey).toBe(
    `resource-request:don@riverside.example:${HAND_HYGIENE}:2026-11-10`,
  );
  expect(sent[0]!.content.action).toEqual({
    label: "Download the Word file",
    url: `${SITE}${HAND_HYGIENE}.docx`,
  });
  expect(sent[0]!.oneClickUnsubscribeUrl).toContain(
    "/site/resource-requests/unsubscribe?token=",
  );
});

test("asking twice in a day uses the same email key, so the outbox sends once", async () => {
  const { sent, post, deps } = setup();
  await post({ email: "don@riverside.example", resource: HAND_HYGIENE });
  await post({ email: "don@riverside.example", resource: HAND_HYGIENE });
  expect(new Set(sent.map((entry) => entry.idempotencyKey)).size).toBe(1);
  expect(deps.store.list()).toHaveLength(1);
});

test("a bad address, a page that is not ours, or a flood sends nothing", async () => {
  const bad = setup();
  expect(
    (
      await bad.post({ email: "not an address", resource: HAND_HYGIENE })
    ).headers.get("location"),
  ).toBe(`${SITE}${HAND_HYGIENE}#send-again`);
  expect(
    (
      await bad.post({
        email: "don@riverside.example",
        resource: "https://evil.example/",
      })
    ).headers.get("location"),
  ).toBe(`${SITE}/`);
  expect(bad.sent).toHaveLength(0);
  expect(bad.deps.store.list()).toHaveLength(0);

  const flooded = setup({ limited: () => true });
  expect(
    (
      await flooded.post({
        email: "don@riverside.example",
        resource: HAND_HYGIENE,
      })
    ).headers.get("location"),
  ).toBe(`${SITE}${HAND_HYGIENE}#send-again`);
  expect(flooded.sent).toHaveLength(0);
});

test("a filled honeypot looks like success and does nothing", async () => {
  const { deps, sent, post } = setup();
  const response = await post({
    email: "don@riverside.example",
    resource: HAND_HYGIENE,
    website: "https://spam.example",
  });
  expect(response.headers.get("location")).toBe(`${SITE}${HAND_HYGIENE}#sent`);
  expect(sent).toHaveLength(0);
  expect(deps.store.list()).toHaveLength(0);
});

test("one address is sent only so many pages a day, whoever asks", async () => {
  const { sent, post } = setup();
  const resources = Object.keys(SITE_RESOURCES);
  expect(resources.length).toBeGreaterThan(DAILY_LIMIT_PER_ADDRESS);
  for (const resource of resources) {
    const response = await post({ email: "target@example.org", resource });
    // The sender is told the same thing either way.
    expect(response.headers.get("location")).toEndWith("#sent");
  }
  expect(sent).toHaveLength(DAILY_LIMIT_PER_ADDRESS);
});

test("unsubscribing stops every email to the address, and no form post undoes it", async () => {
  const { deps, sent, post } = setup();
  await post({ email: "don@riverside.example", resource: HAND_HYGIENE });
  await post({
    email: "don@riverside.example",
    resource: "/tools/required-policies-checklist",
  });
  const token = new URL(sent[0]!.oneClickUnsubscribeUrl).searchParams.get(
    "token",
  )!;
  const url = `https://api.bindersnap.com/site/resource-requests/unsubscribe?token=${token}`;

  // Opening the link only asks: a mail scanner must not unsubscribe anyone.
  const ask = handleResourceUnsubscribe(new Request(url), deps);
  expect(await ask.response.text()).toContain("Stop emails from Bindersnap?");
  expect(deps.store.list().every((row) => !row.unsubscribed)).toBe(true);

  const done = handleResourceUnsubscribe(
    new Request(url, { method: "POST" }),
    deps,
  );
  expect(done.email).toBe("don@riverside.example");
  expect(await done.response.text()).toContain("You're unsubscribed.");
  expect(done.response.headers.get("content-security-policy")).toContain(
    "form-action 'self'",
  );
  expect(deps.store.list().every((row) => row.unsubscribed)).toBe(true);

  // A token that matches nobody gets the same page.
  const nobody = handleResourceUnsubscribe(
    new Request(url.replace(token, "nope"), { method: "POST" }),
    deps,
  );
  expect(nobody.email).toBeNull();
  expect(await nobody.response.text()).toContain("You're unsubscribed.");

  // Anyone can post the form with this address. It stays unsubscribed, gets
  // nothing, and the sender sees what they would have seen anyway.
  const before = sent.length;
  const again = await post({
    email: "Don@Riverside.example",
    resource: "/templates/exposure-control-plan",
  });
  expect(again.headers.get("location")).toEndWith("#sent");
  expect(sent).toHaveLength(before);
  expect(deps.store.list()).toHaveLength(2);
  expect(deps.store.list().every((row) => row.unsubscribed)).toBe(true);
});

test("the email names the page, links its Word file, and can be stopped without an account", () => {
  expect(resourceName("/manuals/hospice-policy-and-procedure-manual")).toBe(
    "Hospice policy and procedure manual index",
  );
  expect(() => resourceName("/templates/not-a-page")).toThrow();
  const template = renderEmail(
    resourceRequestEmail(HAND_HYGIENE, "tok", SITE),
    "https://app.bindersnap.com",
  );
  expect(template.subject).toBe(
    "Hand hygiene policy template for healthcare settings, from Bindersnap",
  );
  expect(template.text).toContain(`${SITE}${HAND_HYGIENE}.docx`);
  expect(template.text).toContain("Unsubscribe: ");
  expect(template.text).not.toContain("Email settings");
  expect(template.html).not.toContain("Email settings");

  const tool = resourceRequestEmail(
    "/tools/required-policies-checklist",
    "tok",
    SITE,
  );
  expect(tool.action).toEqual({
    label: "Open the page",
    url: `${SITE}/tools/required-policies-checklist`,
  });
});

test("the admin's list counts people once and pages by how often they were asked for", () => {
  const store = freshStore();
  store.record("a@example.org", HAND_HYGIENE, 1_000);
  store.record("b@example.org", HAND_HYGIENE, 2_000);
  store.record("a@example.org", "/tools/required-policies-checklist", 3_000);
  const report = reportResourceRequests(store.list());
  expect(report.people).toBe(2);
  expect(report.byResource).toEqual([
    { resource: HAND_HYGIENE, requests: 2 },
    { resource: "/tools/required-policies-checklist", requests: 1 },
  ]);
  expect(report.recent.map((row) => row.requestedAt)).toEqual([
    3_000, 2_000, 1_000,
  ]);

  store.forget("A@example.org");
  expect(store.list().map((row) => row.email)).toEqual(["b@example.org"]);
});
