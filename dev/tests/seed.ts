import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_GITEA_URL = "http://localhost:3000";
const DEFAULT_ADMIN_USER = "alice";
const DEFAULT_ADMIN_PASS = "bindersnap-dev";
const DEFAULT_BOB_USER = "bob";
const DEFAULT_BOB_PASS = "bindersnap-dev";
const DEFAULT_REPO_NAME = "quarterly-report";
const FEATURE_BRANCH = "feature/q2-amendments";
const FEATURE_DOC_PATH = "documents/in-review.json";
const PR_TITLE = "Q2 amendments — GDPR section update";
const REVIEW_BODY =
  "Section 4.2 needs to reference the updated GDPR guidance from the January memo.";

type BasicAuth = {
  username: string;
  password: string;
};

type SeedOptions = {
  baseUrl?: string;
  adminUser?: string;
  adminPass?: string;
  bobUser?: string;
  bobPass?: string;
  repoName?: string;
  createToken?: boolean;
  tokenNamePrefix?: string;
  log?: (message: string) => void;
};

type SeedResult = {
  token?: string;
  tokenName?: string;
  prNumber: number;
  oauthClientId?: string;
};

type GiteaUser = {
  login: string;
};

type GiteaContentFile = {
  sha: string;
  content?: string;
};

type GiteaPull = {
  number: number;
  title: string;
  head?: { ref?: string };
};

type GiteaReview = {
  state?: string;
  body?: string;
  user?: { login?: string };
};

type GiteaToken = {
  sha1?: string;
  token_last_eight?: string;
  name?: string;
};

type GiteaOAuthApp = {
  id: number;
  name: string;
  client_id: string;
};

type RequestOptions = {
  method?: string;
  auth?: BasicAuth;
  headers?: HeadersInit;
  body?: string;
  expectedStatuses?: number[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeAuth(auth: BasicAuth): string {
  return Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
}

function fixtureUrl(name: string): URL {
  return new URL(`../gitea-seed/documents/${name}`, import.meta.url);
}

async function fixtureText(name: string): Promise<string> {
  return readFile(fixtureUrl(name), "utf8");
}

function toBase64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function fromBase64Utf8(value?: string): string {
  if (!value) {
    return "";
  }
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}

async function giteaRequest(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const {
    method = "GET",
    auth,
    headers,
    body,
    expectedStatuses = [200],
  } = options;

  const nextHeaders = new Headers(headers);
  if (auth) {
    nextHeaders.set("Authorization", `Basic ${encodeAuth(auth)}`);
  }
  if (body && !nextHeaders.has("Content-Type")) {
    nextHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: nextHeaders,
    body,
  });

  if (!expectedStatuses.includes(response.status)) {
    const responseBody = await response.text();
    throw new Error(
      `Request failed ${method} ${path}: ${response.status} ${responseBody}`,
    );
  }

  return response;
}

async function giteaJson<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await giteaRequest(baseUrl, path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function waitForUrl(
  baseUrl: string,
  path: string,
  attempts: number,
  delayMs: number,
): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(new URL(path, baseUrl));
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient connection errors while service boots.
    }
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ${new URL(path, baseUrl).toString()}`);
}

async function maybeBootstrapInstall(
  baseUrl: string,
  adminUser: string,
  adminPass: string,
  log: (message: string) => void,
): Promise<void> {
  const adminLookup = await giteaRequest(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(adminUser)}`,
    {
      expectedStatuses: [200, 404],
    },
  );
  if (adminLookup.status === 200) {
    return;
  }

  log("Bootstrapping Gitea install and admin user...");
  const form = new URLSearchParams({
    db_type: "sqlite3",
    db_path: "/data/gitea.db",
    app_name: "Gitea",
    repo_root_path: "/data/git/repositories",
    run_user: "git",
    domain: "localhost",
    ssh_port: "22",
    http_port: "3000",
    app_url: "http://localhost:3000/",
    log_root_path: "/data/gitea/log",
    admin_name: adminUser,
    admin_passwd: adminPass,
    admin_confirm_passwd: adminPass,
    admin_email: "alice@example.com",
  });

  await giteaRequest(baseUrl, "/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    expectedStatuses: [200, 302, 303, 405],
  });
}

async function ensureUser(
  baseUrl: string,
  adminAuth: BasicAuth,
  username: string,
  password: string,
  email: string,
  fullName: string,
  log: (message: string) => void,
): Promise<void> {
  const payload = {
    login_name: username,
    username,
    email,
    password,
    full_name: fullName,
    must_change_password: false,
    send_notify: false,
  };

  const response = await giteaRequest(baseUrl, "/api/v1/admin/users", {
    method: "POST",
    auth: adminAuth,
    body: JSON.stringify(payload),
    expectedStatuses: [201, 422],
  });

  log(
    response.status === 201
      ? `Created user: ${username}`
      : `User already exists: ${username}`,
  );
}

async function ensureRepo(
  baseUrl: string,
  adminAuth: BasicAuth,
  repoName: string,
  log: (message: string) => void,
): Promise<void> {
  const response = await giteaRequest(baseUrl, "/api/v1/user/repos", {
    method: "POST",
    auth: adminAuth,
    body: JSON.stringify({
      name: repoName,
      description: "Quarterly compliance report",
      private: false,
      auto_init: true,
      default_branch: "main",
    }),
    expectedStatuses: [201, 409, 422],
  });

  log(
    response.status === 201
      ? `Created repo: ${repoName}`
      : `Repo already exists: ${repoName}`,
  );
}

async function ensureFile(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  path: string,
  content: string,
  commitMessage: string,
  branch?: string,
  log?: (message: string) => void,
): Promise<void> {
  const refParam = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const getPath = `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${refParam}`;
  const currentFile = await giteaRequest(baseUrl, getPath, {
    auth: adminAuth,
    expectedStatuses: [200, 404],
  });

  const contentBase64 = toBase64Utf8(content);
  if (currentFile.status === 404) {
    const createPayload: Record<string, string> = {
      message: commitMessage,
      content: contentBase64,
    };
    if (branch) {
      createPayload.branch = branch;
    }

    await giteaRequest(
      baseUrl,
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      {
        method: "POST",
        auth: adminAuth,
        body: JSON.stringify(createPayload),
        expectedStatuses: [201],
      },
    );
    log?.(`Committed: ${path}`);
    return;
  }

  const filePayload = (await currentFile.json()) as GiteaContentFile;
  const currentText = fromBase64Utf8(filePayload.content);
  if (currentText === content) {
    log?.(`Already up to date: ${path}`);
    return;
  }

  const updatePayload: Record<string, string> = {
    message: commitMessage,
    content: contentBase64,
    sha: filePayload.sha,
  };
  if (branch) {
    updatePayload.branch = branch;
  }

  await giteaRequest(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    {
      method: "PUT",
      auth: adminAuth,
      body: JSON.stringify(updatePayload),
      expectedStatuses: [200],
    },
  );
  log?.(`Updated: ${path}`);
}

async function ensureCollaborator(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  collaborator: string,
  log: (message: string) => void,
): Promise<void> {
  await giteaRequest(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(collaborator)}`,
    {
      method: "PUT",
      auth: adminAuth,
      body: JSON.stringify({ permission: "write" }),
      expectedStatuses: [204],
    },
  );
  log(`Ensured collaborator: ${collaborator}`);
}

async function ensureBranch(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
  sourceRef: string,
  log: (message: string) => void,
): Promise<void> {
  const getResponse = await giteaRequest(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branchName)}`,
    {
      auth: adminAuth,
      expectedStatuses: [200, 404],
    },
  );

  if (getResponse.status === 200) {
    log(`Branch already exists: ${branchName}`);
    return;
  }

  const createResponse = await giteaRequest(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({
        new_branch_name: branchName,
        old_ref_name: sourceRef,
      }),
      expectedStatuses: [201, 409, 422],
    },
  );

  log(
    createResponse.status === 201
      ? `Created branch: ${branchName}`
      : `Branch already exists: ${branchName}`,
  );
}

async function ensurePullRequest(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
  title: string,
  log: (message: string) => void,
): Promise<number> {
  const pulls = await giteaJson<GiteaPull[]>(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&head=${encodeURIComponent(branchName)}`,
    { auth: adminAuth },
  );

  const existing = pulls.find((pull) => pull.head?.ref === branchName);
  if (existing) {
    if (existing.title !== title) {
      await giteaRequest(
        baseUrl,
        `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${existing.number}`,
        {
          method: "PATCH",
          auth: adminAuth,
          body: JSON.stringify({ title }),
          expectedStatuses: [200],
        },
      );
      log(`Updated pull request title: ${title}`);
    } else {
      log(`Pull request already exists: #${existing.number}`);
    }
    return existing.number;
  }

  const created = await giteaJson<GiteaPull>(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({
        base: "main",
        head: branchName,
        title,
        body: "",
      }),
      expectedStatuses: [201],
    },
  );

  log(`Created pull request: #${created.number}`);
  return created.number;
}

async function ensureRequestedChangesReview(
  baseUrl: string,
  adminAuth: BasicAuth,
  bobAuth: BasicAuth,
  owner: string,
  repo: string,
  pullNumber: number,
  bobUser: string,
  log: (message: string) => void,
): Promise<void> {
  const reviews = await giteaJson<GiteaReview[]>(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reviews`,
    { auth: adminAuth },
  );

  const alreadyExists = reviews.some(
    (review) =>
      review.user?.login === bobUser &&
      review.body === REVIEW_BODY &&
      (review.state === "REQUEST_CHANGES" ||
        review.state === "CHANGES_REQUESTED"),
  );

  if (alreadyExists) {
    log(`Requested-changes review already exists for #${pullNumber}`);
    return;
  }

  await giteaRequest(
    baseUrl,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reviews`,
    {
      method: "POST",
      auth: bobAuth,
      body: JSON.stringify({
        body: REVIEW_BODY,
        event: "REQUEST_CHANGES",
      }),
      expectedStatuses: [200, 201],
    },
  );
  log(`Submitted requested-changes review for #${pullNumber}`);
}

async function createAccessToken(
  baseUrl: string,
  adminAuth: BasicAuth,
  tokenNamePrefix: string,
  log: (message: string) => void,
): Promise<{ token: string; tokenName: string }> {
  const tokenName = `${tokenNamePrefix}-${Date.now()}`;
  const token = await giteaJson<GiteaToken>(
    baseUrl,
    `/api/v1/users/${encodeURIComponent(adminAuth.username)}/tokens`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({
        name: tokenName,
        scopes: ["all"],
      }),
      expectedStatuses: [201],
    },
  );

  if (!token.sha1) {
    throw new Error(
      "Token creation succeeded but no token value was returned.",
    );
  }

  log(`Created token: ${tokenName}`);
  return { token: token.sha1, tokenName };
}

function buildFeatureDocument(inReview: string): string {
  return inReview
    .replace("Vendor Contract — Acme Corp", "Q2 Compliance Report")
    .replace(
      "This contract has been submitted for review. Awaiting sign-off from the compliance team.",
      "Section 4.2 now reflects the updated GDPR guidance from the January memo.",
    )
    .replace(
      "Acme Corp will provide data processing services in accordance with our data handling addendum dated 2024-01-15.",
      "Personal data may be retained for no longer than 24 months unless a longer period is required by law.",
    );
}

export async function isTokenValid(
  baseUrl: string,
  token: string,
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) {
    return false;
  }

  const response = await fetch(new URL("/api/v1/user", baseUrl), {
    headers: { Authorization: `token ${trimmed}` },
  });
  return response.status === 200;
}

async function ensureOAuthApp(
  baseUrl: string,
  auth: BasicAuth,
  appName: string,
  redirectUri: string,
  log: (msg: string) => void,
): Promise<string> {
  const existing = await giteaJson<GiteaOAuthApp[]>(
    baseUrl,
    "/api/v1/user/applications/oauth2",
    { auth },
  );
  const found = existing.find((app) => app.name === appName);
  if (found) {
    log(
      `OAuth2 app "${appName}" already exists (client_id: ${found.client_id}).`,
    );
    return found.client_id;
  }

  const created = await giteaJson<GiteaOAuthApp>(
    baseUrl,
    "/api/v1/user/applications/oauth2",
    {
      method: "POST",
      auth,
      body: JSON.stringify({
        name: appName,
        redirect_uris: [redirectUri],
        confidential_client: false,
      }),
      expectedStatuses: [201],
    },
  );
  log(`OAuth2 app "${appName}" created (client_id: ${created.client_id}).`);
  return created.client_id;
}

export async function seedDevStack(
  options: SeedOptions = {},
): Promise<SeedResult> {
  const baseUrl = options.baseUrl ?? process.env.GITEA_URL ?? DEFAULT_GITEA_URL;
  const adminUser =
    options.adminUser ?? process.env.GITEA_ADMIN_USER ?? DEFAULT_ADMIN_USER;
  const adminPass =
    options.adminPass ?? process.env.GITEA_ADMIN_PASS ?? DEFAULT_ADMIN_PASS;
  const bobUser =
    options.bobUser ?? process.env.GITEA_BOB_USER ?? DEFAULT_BOB_USER;
  const bobPass =
    options.bobPass ?? process.env.GITEA_BOB_PASS ?? DEFAULT_BOB_PASS;
  const repoName = options.repoName ?? DEFAULT_REPO_NAME;
  const createToken = options.createToken ?? true;
  const tokenNamePrefix = options.tokenNamePrefix ?? "bindersnap-dev";
  const log = options.log ?? ((message: string) => console.log(message));

  const adminAuth: BasicAuth = { username: adminUser, password: adminPass };
  const bobAuth: BasicAuth = { username: bobUser, password: bobPass };

  log("Waiting for Gitea...");
  await waitForUrl(baseUrl, "/", 30, 2000);
  await maybeBootstrapInstall(baseUrl, adminUser, adminPass, log);
  await waitForUrl(baseUrl, "/api/v1/settings/api", 30, 2000);
  log("Gitea is ready.");

  await ensureUser(
    baseUrl,
    adminAuth,
    bobUser,
    bobPass,
    "bob@example.com",
    "Bob Reviewer",
    log,
  );
  await ensureRepo(baseUrl, adminAuth, repoName, log);

  const draft = await fixtureText("draft.json");
  const inReview = await fixtureText("in-review.json");
  const changesRequested = await fixtureText("changes-requested.json");
  const featureDocument = buildFeatureDocument(inReview);

  await ensureFile(
    baseUrl,
    adminAuth,
    adminUser,
    repoName,
    "documents/draft.json",
    draft,
    "seed: add draft document",
    undefined,
    log,
  );
  await ensureFile(
    baseUrl,
    adminAuth,
    adminUser,
    repoName,
    "documents/in-review.json",
    inReview,
    "seed: add in-review document",
    undefined,
    log,
  );
  await ensureFile(
    baseUrl,
    adminAuth,
    adminUser,
    repoName,
    "documents/changes-requested.json",
    changesRequested,
    "seed: add changes-requested document",
    undefined,
    log,
  );

  await ensureCollaborator(
    baseUrl,
    adminAuth,
    adminUser,
    repoName,
    bobUser,
    log,
  );
  await ensureBranch(
    baseUrl,
    adminAuth,
    adminUser,
    repoName,
    FEATURE_BRANCH,
    "main",
    log,
  );
  await ensureFile(
    baseUrl,
    adminAuth,
    adminUser,
    repoName,
    FEATURE_DOC_PATH,
    featureDocument,
    `seed: update ${FEATURE_DOC_PATH} for q2 amendments`,
    FEATURE_BRANCH,
    log,
  );

  const prNumber = await ensurePullRequest(
    baseUrl,
    adminAuth,
    adminUser,
    repoName,
    FEATURE_BRANCH,
    PR_TITLE,
    log,
  );
  await ensureRequestedChangesReview(
    baseUrl,
    adminAuth,
    bobAuth,
    adminUser,
    repoName,
    prNumber,
    bobUser,
    log,
  );

  const redirectUri = `http://localhost:${process.env.APP_PORT ?? "5173"}/auth/callback`;
  const oauthClientId = await ensureOAuthApp(
    baseUrl,
    adminAuth,
    "bindersnap-dev",
    redirectUri,
    log,
  );

  if (!createToken) {
    return { prNumber, oauthClientId };
  }

  const tokenInfo = await createAccessToken(
    baseUrl,
    adminAuth,
    tokenNamePrefix,
    log,
  );
  return {
    prNumber,
    oauthClientId,
    token: tokenInfo.token,
    tokenName: tokenInfo.tokenName,
  };
}

async function runCli(): Promise<void> {
  const result = await seedDevStack();
  console.log("");
  console.log("==================================================");
  if (result.oauthClientId) {
    console.log(`OAUTH_CLIENT_ID=${result.oauthClientId}`);
    console.log("Add to dev/.env:");
    console.log(`  BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID=${result.oauthClientId}`);
  }
  if (result.token) {
    const tokenSuffix = result.token.slice(-8);
    console.log(`TOKEN_NAME=${result.tokenName}`);
    console.log(`ALICE_TOKEN_SUFFIX=...${tokenSuffix}`);
    console.log(
      "Token created. Set VITE_GITEA_TOKEN manually in your shell if needed.",
    );
  }
  console.log("==================================================");
  console.log("Seed complete.");
}

const invokedDirectly = (() => {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return pathToFileURL(entryPath).href === import.meta.url;
})();

if (invokedDirectly) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
