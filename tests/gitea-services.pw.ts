import { expect, test } from "@playwright/test";

import {
  createAuthenticatedClient,
  getStoredToken,
  storeToken,
  validateToken,
} from "../../packages/gitea-client/auth";
import {
  fetchDocumentAtSha,
  listDocumentCommits,
} from "../packages/gitea-client/documents";
import {
  type ApprovalState,
  getPullRequestForBranch,
  submitReview,
} from "../../packages/gitea-client/pullRequests";
import { createGiteaClient } from "../../packages/gitea-client/client";
import { seedDevStack } from "./seed";

const GITEA_URL = process.env.VITE_GITEA_URL ?? "http://localhost:3000";
const GITEA_ADMIN_USER = process.env.GITEA_ADMIN_USER ?? "alice";
const GITEA_ADMIN_PASS = process.env.GITEA_ADMIN_PASS ?? "bindersnap-dev";
const GITEA_BOB_USER = process.env.GITEA_BOB_USER ?? "bob";
const GITEA_BOB_PASS = process.env.GITEA_BOB_PASS ?? "bindersnap-dev";
const TOKEN = process.env.VITE_GITEA_TOKEN ?? "";

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();

  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  } as Storage;
}

async function waitForExpectedState(): Promise<void> {
  const client = createAuthenticatedClient(GITEA_URL);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const pullRequest = await getPullRequestForBranch({
      client,
      owner: "alice",
      repo: "quarterly-report",
      branch: "feature/q2-amendments",
    });

    if (pullRequest?.approvalState === "changes_requested") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("Timed out waiting for seeded pull request state.");
}

test.describe("Gitea service wrappers against the live dev stack", () => {
  test.beforeAll(async ({ request }) => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      writable: true,
      value: createMemoryStorage(),
    });

    const preferredToken = TOKEN.trim();
    const usePreferredToken =
      preferredToken.length > 0 &&
      (await validateToken(GITEA_URL, preferredToken)
        .then(() => true)
        .catch(() => false));

    const seedResult = await seedDevStack({
      baseUrl: GITEA_URL,
      adminUser: GITEA_ADMIN_USER,
      adminPass: GITEA_ADMIN_PASS,
      createToken: !usePreferredToken,
      tokenNamePrefix: "bindersnap-services",
      log: () => {
        // Intentionally silent: avoid leaking setup noise or secrets into test output.
      },
    });

    const resolvedToken = usePreferredToken ? preferredToken : seedResult.token;
    if (!resolvedToken) {
      throw new Error(
        "Unable to resolve a valid Gitea token for integration tests.",
      );
    }

    storeToken(resolvedToken);
    expect(getStoredToken()).toBe(resolvedToken);

    await waitForExpectedState();
  });

  test("validateToken returns the seeded admin user", async () => {
    const token = getStoredToken();
    expect(token).toBeTruthy();

    const user = await validateToken(GITEA_URL, token!);
    expect(user.login).toBe("alice");
  });

  test("createAuthenticatedClient reads the token from sessionStorage", async () => {
    const client = createAuthenticatedClient(GITEA_URL);
    const { data: user } = await client.user.userGetCurrent();

    expect(user.login).toBe("alice");
  });

  test("listDocumentCommits and fetchDocumentAtSha read the seeded draft document", async () => {
    const client = createAuthenticatedClient(GITEA_URL);
    const commits = await listDocumentCommits({
      client,
      owner: "alice",
      repo: "quarterly-report",
      filePath: "documents/draft.json",
    });

    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]).toHaveProperty("sha");
    expect(commits[0]).toHaveProperty("message");

    const doc = await fetchDocumentAtSha({
      client,
      owner: "alice",
      repo: "quarterly-report",
      filePath: "documents/draft.json",
      sha: commits[0].sha,
    });

    expect(doc.type).toBe("doc");
    expect(Array.isArray(doc.content)).toBe(true);
  });

  test("getPullRequestForBranch returns approval state for the seeded review workflow", async () => {
    const client = createAuthenticatedClient(GITEA_URL);
    const pullRequest = await getPullRequestForBranch({
      client,
      owner: "alice",
      repo: "quarterly-report",
      branch: "feature/q2-amendments",
    });

    expect(pullRequest).not.toBeNull();
    const approvalState: ApprovalState = pullRequest!.approvalState;
    expect(approvalState).toBe("changes_requested");
    expect(pullRequest?.number).toBeGreaterThan(0);
  });

  test("submitReview submits an APPROVE review and returns state APPROVE", async () => {
    // Bob is the collaborator; alice cannot approve her own PR.
    // Mint a short-lived token for bob via basic auth.
    const tokenName = `bindersnap-test-bob-${Date.now()}`;
    const tokenResponse = await fetch(
      `${GITEA_URL}/api/v1/users/${GITEA_BOB_USER}/tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${GITEA_BOB_USER}:${GITEA_BOB_PASS}`)}`,
        },
        body: JSON.stringify({ name: tokenName, scopes: ["all"] }),
      },
    );
    expect(tokenResponse.ok).toBe(true);
    const { sha1: bobToken } = (await tokenResponse.json()) as {
      sha1: string;
    };
    expect(bobToken).toBeTruthy();

    const bobClient = createGiteaClient(GITEA_URL, bobToken);

    const pullRequest = await getPullRequestForBranch({
      client: createAuthenticatedClient(GITEA_URL),
      owner: "alice",
      repo: "vendor-contracts",
      branch: "feature/acme-renewal",
    });

    console.log(
      "[getPullRequestForBranch response]",
      JSON.stringify(pullRequest, null, 2),
    );

    expect(pullRequest).not.toBeNull();
    expect(pullRequest?.number).toBeGreaterThan(0);

    const review = await submitReview({
      client: bobClient,
      owner: "alice",
      repo: "vendor-contracts",
      pullNumber: pullRequest!.number!,
      event: "approve",
    });

    console.log("[submitReview response]", JSON.stringify(review, null, 2));

    expect(review.state?.toUpperCase()).toMatch(/^APPROVE/);
  });
});
