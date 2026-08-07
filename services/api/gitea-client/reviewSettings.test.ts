import { expect, mock, test } from "bun:test";

import type { GiteaClient } from "./client";
import {
  DEFAULT_REVIEW_SETTINGS,
  getReviewSettings,
  parseReviewSettings,
  REVIEW_SETTINGS_BRANCH,
  REVIEW_SETTINGS_PATH,
  serializeReviewSettings,
  updateReviewSettings,
} from "./reviewSettings";

const CONTENTS = "/repos/{owner}/{repo}/contents/{filepath}";
const BRANCH = "/repos/{owner}/{repo}/branches/{branch}";
const BRANCHES = "/repos/{owner}/{repo}/branches";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

interface MockOptions {
  /** Raw file content, or null for "file does not exist". */
  file?: string | null;
  branchExists?: boolean;
}

function createMockClient(options: MockOptions = {}) {
  const { file = null, branchExists = true } = options;
  const calls: Array<{ method: string; path: string; init: any }> = [];

  const ok = (data: unknown, status = 200) => ({
    data,
    error: undefined,
    response: new Response(null, { status }),
  });
  const notFound = () => ({
    data: undefined,
    error: { message: "not found" },
    response: new Response(null, { status: 404 }),
  });

  const GET = mock(async (path: string, init?: any) => {
    calls.push({ method: "GET", path, init });
    if (path === CONTENTS) {
      return file === null
        ? notFound()
        : ok({ content: encode(file), sha: "file-sha" });
    }
    if (path === BRANCH) {
      return branchExists ? ok({ name: REVIEW_SETTINGS_BRANCH }) : notFound();
    }
    return notFound();
  });

  const POST = mock(async (path: string, init?: any) => {
    calls.push({ method: "POST", path, init });
    if (path === BRANCHES) return ok({ name: REVIEW_SETTINGS_BRANCH }, 201);
    if (path === CONTENTS) return ok({ content: {}, commit: {} }, 201);
    return notFound();
  });

  const PUT = mock(async (path: string, init?: any) => {
    calls.push({ method: "PUT", path, init });
    if (path === CONTENTS) return ok({ content: {}, commit: {} });
    return notFound();
  });

  return {
    client: {
      GET,
      POST,
      PUT,
      DELETE: mock(),
      use: mock(),
    } as unknown as GiteaClient,
    calls,
    GET,
    POST,
    PUT,
  };
}

const base = { owner: "alice", repo: "contract" };

// --- parsing --------------------------------------------------------------

test("parseReviewSettings reads a stored config", () => {
  const raw = JSON.stringify({
    version: 1,
    review: { blockOnUnresolvedThreads: true },
  });
  expect(parseReviewSettings(raw)).toEqual({ blockOnUnresolvedThreads: true });
});

test("parseReviewSettings falls back to defaults on malformed JSON", () => {
  expect(parseReviewSettings("{not json")).toEqual(DEFAULT_REVIEW_SETTINGS);
});

test("parseReviewSettings ignores a non-boolean value", () => {
  const raw = JSON.stringify({
    version: 1,
    review: { blockOnUnresolvedThreads: "yes" },
  });
  expect(parseReviewSettings(raw)).toEqual(DEFAULT_REVIEW_SETTINGS);
});

test("the default is permissive so an unconfigured document still publishes", () => {
  expect(DEFAULT_REVIEW_SETTINGS.blockOnUnresolvedThreads).toBe(false);
});

test("serializeReviewSettings round-trips", () => {
  const settings = { blockOnUnresolvedThreads: true };
  expect(parseReviewSettings(serializeReviewSettings(settings))).toEqual(
    settings,
  );
});

// --- reads ----------------------------------------------------------------

test("getReviewSettings returns defaults when no config file exists", async () => {
  const { client } = createMockClient({ file: null });
  expect(await getReviewSettings({ client, ...base })).toEqual(
    DEFAULT_REVIEW_SETTINGS,
  );
});

test("getReviewSettings reads from the config branch, not main", async () => {
  const { client, calls } = createMockClient({
    file: JSON.stringify({
      version: 1,
      review: { blockOnUnresolvedThreads: true },
    }),
  });

  await getReviewSettings({ client, ...base });

  const read = calls.find((c) => c.path === CONTENTS);
  expect(read?.init?.params?.query?.ref).toBe(REVIEW_SETTINGS_BRANCH);
  expect(read?.init?.params?.path?.filepath).toBe(REVIEW_SETTINGS_PATH);
});

// --- writes ---------------------------------------------------------------

test("updateReviewSettings creates the file on the config branch", async () => {
  const { client, calls, POST } = createMockClient({ file: null });

  const result = await updateReviewSettings({
    client,
    ...base,
    settings: { blockOnUnresolvedThreads: true },
    actor: "alice",
  });

  expect(result.blockOnUnresolvedThreads).toBe(true);
  const write = calls.find((c) => c.method === "POST" && c.path === CONTENTS);
  expect(write?.init?.body?.branch).toBe(REVIEW_SETTINGS_BRANCH);
  expect(write?.init?.body?.message).toContain("alice");
  expect(POST).toHaveBeenCalled();
});

test("updateReviewSettings updates in place when the file already exists", async () => {
  const { client, calls } = createMockClient({
    file: JSON.stringify({
      version: 1,
      review: { blockOnUnresolvedThreads: false },
    }),
  });

  await updateReviewSettings({
    client,
    ...base,
    settings: { blockOnUnresolvedThreads: true },
    actor: "bob",
  });

  const write = calls.find((c) => c.method === "PUT" && c.path === CONTENTS);
  expect(write?.init?.body?.sha).toBe("file-sha");
  expect(write?.init?.body?.branch).toBe(REVIEW_SETTINGS_BRANCH);
});

test("updateReviewSettings creates the config branch when it is missing", async () => {
  const { client, calls } = createMockClient({
    file: null,
    branchExists: false,
  });

  await updateReviewSettings({
    client,
    ...base,
    settings: { blockOnUnresolvedThreads: true },
    actor: "alice",
  });

  const created = calls.find((c) => c.path === BRANCHES);
  expect(created?.init?.body?.new_branch_name).toBe(REVIEW_SETTINGS_BRANCH);
  expect(created?.init?.body?.old_ref_name).toBe("main");
});

test("updateReviewSettings writes nothing when the value is unchanged", async () => {
  const { client, POST, PUT } = createMockClient({
    file: JSON.stringify({
      version: 1,
      review: { blockOnUnresolvedThreads: true },
    }),
  });

  await updateReviewSettings({
    client,
    ...base,
    settings: { blockOnUnresolvedThreads: true },
    actor: "alice",
  });

  expect(POST).not.toHaveBeenCalled();
  expect(PUT).not.toHaveBeenCalled();
});
