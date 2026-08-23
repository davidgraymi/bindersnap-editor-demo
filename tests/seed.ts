/**
 * Applies the declarative seed scenario to a running Gitea.
 *
 * There is no seed data in this file. What gets created lives in
 * `tests/seed-data/dev.yaml`; this module is the engine that turns that
 * description into Gitea repos, branches, pull requests, reviews, review
 * threads, merges, and version tags — in that order, idempotently, so
 * re-running it against a warm stack changes nothing.
 *
 * Adding a document or a reviewer is a YAML edit. Only a change to *how*
 * Bindersnap models something in Gitea should ever bring you here.
 */

import { pathToFileURL } from "node:url";

import {
  loadSeedScenario,
  renderSeedDocument,
  type SeedChange,
  type SeedDocumentRepo,
  type SeedScenario,
  type SeedThread,
} from "./seed-scenario";

const DEFAULT_GITEA_URL = `http://localhost:${process.env.GITEA_PORT ?? "3000"}`;
const CANONICAL_DOCUMENT_PATH = "document.json";
const SCENARIO_URL = new URL("seed-data/dev.yaml", import.meta.url);

/** Kept for callers that still ask for the two historically-seeded PRs. */
const PRIMARY_CHANGE = "alice/quarterly-report#feature/q2-amendments";
const SECONDARY_CHANGE = "alice/vendor-contracts#feature/acme-renewal";

type BasicAuth = {
  username: string;
  password: string;
};

type SeedOptions = {
  baseUrl?: string;
  adminUser?: string;
  /**
   * Password for every seeded account, not just the admin. The accounts share
   * one password by design — see `password` in the scenario file.
   */
  adminPass?: string;
  createToken?: boolean;
  tokenNamePrefix?: string;
  /** Override the scenario file. Defaults to `tests/seed-data/dev.yaml`. */
  scenario?: SeedScenario;
  log?: (message: string) => void;
};

type SeedResult = {
  token?: string;
  tokenName?: string;
  /** Pull request numbers keyed by `owner/repo#branch`. */
  pullRequests: Record<string, number>;
  /** The `alice/quarterly-report` review PR. */
  prNumber: number;
  /** The `alice/vendor-contracts` review PR. */
  secondPrNumber: number;
  oauthClientId?: string;
};

type GiteaContentFile = {
  sha: string;
  content?: string;
};

type GiteaPull = {
  number: number;
  title: string;
  state?: string;
  merged?: boolean;
  head?: { ref?: string };
};

type GiteaReview = {
  state?: string;
  body?: string;
  user?: { login?: string };
  stale?: boolean;
  dismissed?: boolean;
};

type GiteaComment = {
  id: number;
  body?: string;
  user?: { login?: string };
};

type GiteaToken = {
  sha1?: string;
};

type GiteaOAuthApp = {
  id: number;
  name: string;
  client_id: string;
};

type GiteaBranchProtection = {
  rule_name?: string;
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

function toBase64Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function fromBase64Utf8(value?: string): string {
  if (!value) {
    return "";
  }
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}

function repoPath(owner: string, repo: string): string {
  return `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
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

/** The port Gitea serves HTTP on, read off the base URL the seeder was given. */
function resolveGiteaHttpPort(baseUrl: string): string {
  try {
    const port = new URL(baseUrl).port;
    if (port) return port;
  } catch {
    // Fall through to the default below.
  }
  return "3000";
}

async function maybeBootstrapInstall(
  baseUrl: string,
  adminUser: string,
  adminPass: string,
  adminEmail: string,
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
  // The install form has to advertise the port Gitea actually listens on,
  // which is whatever GITEA_URL points at — not a hardcoded 3000.
  const giteaHttpPort = resolveGiteaHttpPort(baseUrl);
  const form = new URLSearchParams({
    db_type: "sqlite3",
    db_path: "/data/gitea.db",
    app_name: "Gitea",
    repo_root_path: "/data/git/repositories",
    run_user: "git",
    domain: "localhost",
    ssh_port: "22",
    http_port: giteaHttpPort,
    app_url: `http://localhost:${giteaHttpPort}/`,
    log_root_path: "/data/gitea/log",
    admin_name: adminUser,
    admin_passwd: adminPass,
    admin_confirm_passwd: adminPass,
    admin_email: adminEmail,
  });

  await giteaRequest(baseUrl, "/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    expectedStatuses: [200, 302, 303, 405],
  });
}

/**
 * Create the account, or bring an existing one back in line with the scenario.
 *
 * The password reset matters: changing `password:` in the YAML has to work
 * against a stack whose Gitea volume already holds the old accounts, otherwise
 * every password change would mean `bun run down -v` first.
 */
async function ensureUser(
  baseUrl: string,
  adminAuth: BasicAuth,
  username: string,
  password: string,
  email: string,
  fullName: string,
  log: (message: string) => void,
): Promise<void> {
  const created = await giteaRequest(baseUrl, "/api/v1/admin/users", {
    method: "POST",
    auth: adminAuth,
    body: JSON.stringify({
      login_name: username,
      username,
      email,
      password,
      full_name: fullName,
      must_change_password: false,
      send_notify: false,
    }),
    expectedStatuses: [201, 422],
  });

  if (created.status === 201) {
    log(`Created user: ${username}`);
    return;
  }

  await giteaRequest(
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(username)}`,
    {
      method: "PATCH",
      auth: adminAuth,
      body: JSON.stringify({
        login_name: username,
        email,
        password,
        full_name: fullName,
        must_change_password: false,
      }),
      expectedStatuses: [200, 403, 422],
    },
  );
  log(`User already exists, refreshed: ${username}`);
}

async function ensureRepo(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  description: string,
  log: (message: string) => void,
): Promise<void> {
  const response = await giteaRequest(
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(owner)}/repos`,
    {
      method: "POST",
      auth: adminAuth,
      body: JSON.stringify({
        name: repo,
        description,
        private: true,
        auto_init: true,
        default_branch: "main",
      }),
      expectedStatuses: [201, 409, 422],
    },
  );

  log(
    response.status === 201
      ? `Created repo: ${owner}/${repo}`
      : `Repo already exists: ${owner}/${repo}`,
  );
}

/**
 * Strip `main` back to an empty history.
 *
 * A Bindersnap document only reaches `main` by being published, so a freshly
 * created repository must not carry Gitea's auto-init README or a stray
 * document file — otherwise every new document would look already-published.
 */
async function bootstrapEmptyMainBranch(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  log: (message: string) => void,
): Promise<void> {
  const currentFile = await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/contents/README.md?ref=main`,
    {
      auth: adminAuth,
      expectedStatuses: [200, 404],
    },
  );

  if (currentFile.status === 404) {
    log(`Main branch already bootstrapped: ${owner}/${repo}`);
    return;
  }

  const filePayload = (await currentFile.json()) as GiteaContentFile;
  await giteaRequest(baseUrl, `${repoPath(owner, repo)}/contents/README.md`, {
    method: "DELETE",
    auth: adminAuth,
    body: JSON.stringify({
      branch: "main",
      message: "seed: remove README.md from main",
      sha: filePayload.sha,
    }),
    expectedStatuses: [200],
  });
  log(`Bootstrapped empty main branch: ${owner}/${repo}`);
}

async function ensureMainBranchProtection(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  log: (message: string) => void,
): Promise<void> {
  const protections = await giteaJson<GiteaBranchProtection[]>(
    baseUrl,
    `${repoPath(owner, repo)}/branch_protections`,
    { auth: adminAuth },
  );

  if (protections.some((protection) => protection.rule_name === "main")) {
    log(`Main branch protection already exists: ${owner}/${repo}`);
    return;
  }

  await giteaRequest(baseUrl, `${repoPath(owner, repo)}/branch_protections`, {
    method: "POST",
    auth: adminAuth,
    body: JSON.stringify({
      rule_name: "main",
      required_approvals: 1,
      enable_approvals_whitelist: false,
      enable_merge_whitelist: false,
      block_on_rejected_reviews: true,
      block_on_outdated_branch: true,
      dismiss_stale_approvals: true,
      enable_force_push: false,
      enable_push: false,
    }),
    expectedStatuses: [201],
  });

  log(`Ensured main branch protection: ${owner}/${repo}`);
}

async function ensureFile(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  path: string,
  content: string,
  commitMessage: string,
  branch: string,
  log?: (message: string) => void,
): Promise<void> {
  const getPath = `${repoPath(owner, repo)}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const currentFile = await giteaRequest(baseUrl, getPath, {
    auth,
    expectedStatuses: [200, 404],
  });

  const contentBase64 = toBase64Utf8(content);
  if (currentFile.status === 404) {
    await giteaRequest(baseUrl, `${repoPath(owner, repo)}/contents/${path}`, {
      method: "POST",
      auth,
      body: JSON.stringify({
        message: commitMessage,
        content: contentBase64,
        branch,
      }),
      expectedStatuses: [201],
    });
    log?.(`Committed: ${owner}/${repo}@${branch} ${path}`);
    return;
  }

  const filePayload = (await currentFile.json()) as GiteaContentFile;
  if (fromBase64Utf8(filePayload.content) === content) {
    log?.(`Already up to date: ${owner}/${repo}@${branch} ${path}`);
    return;
  }

  await giteaRequest(baseUrl, `${repoPath(owner, repo)}/contents/${path}`, {
    method: "PUT",
    auth,
    body: JSON.stringify({
      message: commitMessage,
      content: contentBase64,
      sha: filePayload.sha,
      branch,
    }),
    expectedStatuses: [200],
  });
  log?.(`Updated: ${owner}/${repo}@${branch} ${path}`);
}

async function ensureCollaborator(
  baseUrl: string,
  adminAuth: BasicAuth,
  owner: string,
  repo: string,
  collaborator: string,
  permission: string,
  log: (message: string) => void,
): Promise<void> {
  await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/collaborators/${encodeURIComponent(collaborator)}`,
    {
      method: "PUT",
      auth: adminAuth,
      body: JSON.stringify({ permission }),
      expectedStatuses: [204],
    },
  );
  log(`Ensured collaborator: ${collaborator} (${permission}) on ${repo}`);
}

async function ensureBranch(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
  sourceRef: string,
  log: (message: string) => void,
): Promise<void> {
  const getResponse = await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/branches/${encodeURIComponent(branchName)}`,
    {
      auth,
      expectedStatuses: [200, 404],
    },
  );

  if (getResponse.status === 200) {
    log(`Branch already exists: ${branchName}`);
    return;
  }

  const createResponse = await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/branches`,
    {
      method: "POST",
      auth,
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

async function findPullRequest(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
): Promise<GiteaPull | undefined> {
  const pulls = await giteaJson<GiteaPull[]>(
    baseUrl,
    `${repoPath(owner, repo)}/pulls?state=all&limit=100`,
    { auth },
  );
  return pulls.find((pull) => pull.head?.ref === branchName);
}

async function ensurePullRequest(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  branchName: string,
  title: string,
  body: string,
  log: (message: string) => void,
): Promise<GiteaPull> {
  const existing = await findPullRequest(
    baseUrl,
    auth,
    owner,
    repo,
    branchName,
  );
  if (existing) {
    if (existing.title !== title) {
      await giteaRequest(
        baseUrl,
        `${repoPath(owner, repo)}/issues/${existing.number}`,
        {
          method: "PATCH",
          auth,
          body: JSON.stringify({ title }),
          expectedStatuses: [200],
        },
      );
      log(`Updated pull request title: ${title}`);
    } else {
      log(`Pull request already exists: #${existing.number}`);
    }
    return { ...existing, title };
  }

  const created = await giteaJson<GiteaPull>(
    baseUrl,
    `${repoPath(owner, repo)}/pulls`,
    {
      method: "POST",
      auth,
      body: JSON.stringify({ base: "main", head: branchName, title, body }),
      expectedStatuses: [201],
    },
  );

  log(`Created pull request: #${created.number} ${title}`);
  return created;
}

const REVIEW_EVENTS: Record<string, string> = {
  approved: "APPROVED",
  changes_requested: "REQUEST_CHANGES",
  commented: "COMMENT",
};

const REVIEW_STATES: Record<string, string[]> = {
  approved: ["APPROVED"],
  changes_requested: ["REQUEST_CHANGES", "CHANGES_REQUESTED"],
  commented: ["COMMENT", "COMMENTED"],
};

/**
 * Bring the pull request's reviews in line with the scenario.
 *
 * Retries, because Gitea dismisses approvals asynchronously when it catches up
 * with the push that created the branch — a push that lands moments before the
 * pull request exists. Without the retry a seeded approval silently arrives
 * dismissed, and the document shows up in the wrong state.
 */
async function ensureReviews(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  owner: string,
  repo: string,
  pullNumber: number,
  wanted: SeedChange["reviews"],
  log: (message: string) => void,
): Promise<void> {
  if (wanted.length === 0) {
    return;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reviews = await giteaJson<GiteaReview[]>(
      baseUrl,
      `${repoPath(owner, repo)}/pulls/${pullNumber}/reviews`,
      { auth: adminAuth },
    );

    const missing = wanted.filter(
      (review) =>
        !reviews.some(
          (existing) =>
            existing.user?.login === review.by &&
            existing.body === review.body &&
            (REVIEW_STATES[review.state] ?? []).includes(
              existing.state ?? "",
            ) &&
            existing.dismissed !== true &&
            existing.stale !== true,
        ),
    );

    if (missing.length === 0) {
      if (attempt === 0) {
        log(`Reviews already in place on #${pullNumber}`);
      }
      return;
    }

    for (const review of missing) {
      await giteaRequest(
        baseUrl,
        `${repoPath(owner, repo)}/pulls/${pullNumber}/reviews`,
        {
          method: "POST",
          auth: authFor(review.by),
          body: JSON.stringify({
            body: review.body,
            event: REVIEW_EVENTS[review.state],
          }),
          expectedStatuses: [200, 201],
        },
      );
      log(`Submitted ${review.state} review by ${review.by} on #${pullNumber}`);
    }

    // Give Gitea's async review-dismissal pass a chance to undo what we just
    // wrote, so the next loop can see it and put it back.
    await sleep(1500);
  }

  throw new Error(
    `Reviews on #${pullNumber} in ${owner}/${repo} kept being dismissed after 5 attempts.`,
  );
}

// ---------------------------------------------------------------------------
// Review threads
//
// Gitea has no thread primitive, so Bindersnap models a thread as pull-request
// issue comments carrying a trailing marker. Resolution is append-only: a
// resolve is a new comment, never an edit. The seed writes exactly the same
// shape the app does — see services/api/gitea-client/discussions.ts.
// ---------------------------------------------------------------------------

function threadMarker(
  kind: "thread" | "reply" | "resolve",
  threadId: string,
  extra?: Record<string, string>,
): string {
  const attrs = [`kind=${kind}`, `thread=${threadId}`];
  for (const [key, value] of Object.entries(extra ?? {})) {
    attrs.push(`${key}=${value}`);
  }
  return `<!-- bindersnap:v1 ${attrs.join(" ")} -->`;
}

function threadComment(
  body: string,
  kind: "thread" | "reply" | "resolve",
  threadId: string,
  extra?: Record<string, string>,
): string {
  const marker = threadMarker(kind, threadId, extra);
  return body ? `${body}\n\n${marker}` : marker;
}

async function ensureThread(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  owner: string,
  repo: string,
  pullNumber: number,
  thread: SeedThread,
  log: (message: string) => void,
): Promise<void> {
  const comments = await giteaJson<GiteaComment[]>(
    baseUrl,
    `${repoPath(owner, repo)}/issues/${pullNumber}/comments`,
    { auth: adminAuth },
  );

  const has = (marker: string): boolean =>
    comments.some((comment) => (comment.body ?? "").includes(marker));

  const post = async (author: string, body: string): Promise<void> => {
    await giteaRequest(
      baseUrl,
      `${repoPath(owner, repo)}/issues/${pullNumber}/comments`,
      {
        method: "POST",
        auth: authFor(author),
        body: JSON.stringify({ body }),
        expectedStatuses: [201],
      },
    );
  };

  if (!has(threadMarker("thread", thread.id))) {
    await post(thread.by, threadComment(thread.body, "thread", thread.id));
    log(`Opened review thread "${thread.id}" on #${pullNumber}`);
  }

  // Replies share one marker, so count them rather than matching on text.
  const replyMarker = threadMarker("reply", thread.id);
  const existingReplies = comments.filter((comment) =>
    (comment.body ?? "").includes(replyMarker),
  ).length;

  for (const reply of thread.replies.slice(existingReplies)) {
    await post(reply.by, threadComment(reply.body, "reply", thread.id));
    log(`Replied in thread "${thread.id}" on #${pullNumber}`);
  }

  if (
    thread.resolved &&
    !has(threadMarker("resolve", thread.id, { state: "resolved" }))
  ) {
    await post(
      thread.resolvedBy ?? thread.by,
      threadComment("", "resolve", thread.id, { state: "resolved" }),
    );
    log(`Resolved thread "${thread.id}" on #${pullNumber}`);
  }
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Merge the change and tag the result — the same two steps the publish button
 * performs, so a seeded published version is indistinguishable from a real one.
 *
 * `version` comes from the change's position in the scenario rather than from
 * counting existing tags, so a second seed run re-derives the same tag name and
 * does nothing instead of inventing a version nobody published.
 */
async function publishChange(
  baseUrl: string,
  auth: BasicAuth,
  owner: string,
  repo: string,
  pull: GiteaPull,
  title: string,
  version: number,
  refreshReviews: () => Promise<void>,
  log: (message: string) => void,
): Promise<void> {
  if (!pull.merged && pull.state !== "closed") {
    // Gitea computes mergeability asynchronously and answers 405 until it has.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await giteaRequest(
        baseUrl,
        `${repoPath(owner, repo)}/pulls/${pull.number}/merge`,
        {
          method: "POST",
          auth,
          body: JSON.stringify({
            Do: "merge",
            MergeTitleField: title,
            MergeMessageField: "",
          }),
          expectedStatuses: [200, 405],
        },
      );

      if (response.status === 200) {
        log(`Merged pull request #${pull.number}`);
        break;
      }

      const reason = await response.text();
      if (attempt === 9) {
        throw new Error(
          `Could not merge #${pull.number} in ${owner}/${repo} after 10 attempts: ${reason}`,
        );
      }
      if (reason.includes("approvals")) {
        await refreshReviews();
      }
      await sleep(1000);
    }
  } else {
    log(`Pull request already merged: #${pull.number}`);
  }

  const tagName = `doc/v${version.toString().padStart(4, "0")}`;
  const response = await giteaRequest(
    baseUrl,
    `${repoPath(owner, repo)}/tags`,
    {
      method: "POST",
      auth,
      body: JSON.stringify({
        tag_name: tagName,
        target: "main",
        message: `Published version ${tagName}`,
      }),
      expectedStatuses: [201, 409, 422],
    },
  );

  log(
    response.status === 201
      ? `Tagged published version: ${owner}/${repo} ${tagName}`
      : `Published version already tagged: ${owner}/${repo}`,
  );
}

// ---------------------------------------------------------------------------
// Tokens and OAuth
// ---------------------------------------------------------------------------

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
      body: JSON.stringify({ name: tokenName, scopes: ["all"] }),
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

// ---------------------------------------------------------------------------
// The scenario walk
// ---------------------------------------------------------------------------

async function applyChange(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  document: SeedDocumentRepo,
  change: SeedChange,
  version: number,
  log: (message: string) => void,
): Promise<number> {
  const { owner, repo } = document;
  const authorAuth = authFor(change.author ?? owner);

  await ensureBranch(
    baseUrl,
    authorAuth,
    owner,
    repo,
    change.branch,
    "main",
    log,
  );
  await ensureFile(
    baseUrl,
    authorAuth,
    owner,
    repo,
    CANONICAL_DOCUMENT_PATH,
    renderSeedDocument(change.document),
    `seed: ${change.title}`,
    change.branch,
    log,
  );

  const pull = await ensurePullRequest(
    baseUrl,
    authorAuth,
    owner,
    repo,
    change.branch,
    change.title,
    change.summary,
    log,
  );

  const refreshReviews = (): Promise<void> =>
    ensureReviews(
      baseUrl,
      adminAuth,
      authFor,
      owner,
      repo,
      pull.number,
      change.reviews,
      log,
    );

  await refreshReviews();

  for (const thread of change.threads) {
    await ensureThread(
      baseUrl,
      adminAuth,
      authFor,
      owner,
      repo,
      pull.number,
      thread,
      log,
    );
  }

  if (change.publish) {
    await publishChange(
      baseUrl,
      adminAuth,
      owner,
      repo,
      pull,
      change.title,
      version,
      refreshReviews,
      log,
    );
  }

  return pull.number;
}

async function applyDocument(
  baseUrl: string,
  adminAuth: BasicAuth,
  authFor: (username: string) => BasicAuth,
  document: SeedDocumentRepo,
  log: (message: string) => void,
): Promise<Record<string, number>> {
  const { owner, repo } = document;

  await ensureRepo(baseUrl, adminAuth, owner, repo, document.description, log);
  await bootstrapEmptyMainBranch(baseUrl, adminAuth, owner, repo, log);
  await ensureMainBranchProtection(baseUrl, adminAuth, owner, repo, log);

  for (const collaborator of document.collaborators) {
    await ensureCollaborator(
      baseUrl,
      adminAuth,
      owner,
      repo,
      collaborator.user,
      collaborator.permission,
      log,
    );
  }

  const pullRequests: Record<string, number> = {};
  let publishedVersions = 0;
  for (const change of document.changes) {
    if (change.publish) {
      publishedVersions += 1;
    }
    const number = await applyChange(
      baseUrl,
      adminAuth,
      authFor,
      document,
      change,
      publishedVersions,
      log,
    );
    pullRequests[`${owner}/${repo}#${change.branch}`] = number;
  }
  return pullRequests;
}

export async function seedDevStack(
  options: SeedOptions = {},
): Promise<SeedResult> {
  const scenario = options.scenario ?? loadSeedScenario(SCENARIO_URL);
  const baseUrl = options.baseUrl ?? process.env.GITEA_URL ?? DEFAULT_GITEA_URL;
  const password =
    options.adminPass ?? process.env.GITEA_ADMIN_PASS ?? scenario.password;
  const createToken = options.createToken ?? true;
  const tokenNamePrefix = options.tokenNamePrefix ?? "bindersnap-dev";
  const log = options.log ?? ((message: string) => console.log(message));

  const adminUser =
    options.adminUser ??
    process.env.GITEA_ADMIN_USER ??
    scenario.users[0]?.username;
  if (!adminUser) {
    throw new Error("The seed scenario declares no users.");
  }

  const adminAuth: BasicAuth = { username: adminUser, password };
  const authFor = (username: string): BasicAuth => ({ username, password });

  log("Waiting for Gitea...");
  await waitForUrl(baseUrl, "/", 30, 2000);
  await maybeBootstrapInstall(
    baseUrl,
    adminUser,
    password,
    scenario.users.find((user) => user.username === adminUser)?.email ??
      `${adminUser}@example.com`,
    log,
  );
  await waitForUrl(baseUrl, "/api/v1/settings/api", 30, 2000);
  log("Gitea is ready.");

  for (const user of scenario.users) {
    if (user.username === adminUser) {
      continue;
    }
    await ensureUser(
      baseUrl,
      adminAuth,
      user.username,
      password,
      user.email,
      user.fullName,
      log,
    );
  }

  const pullRequests: Record<string, number> = {};
  for (const document of scenario.documents) {
    Object.assign(
      pullRequests,
      await applyDocument(baseUrl, adminAuth, authFor, document, log),
    );
  }

  const redirectUri = `http://localhost:${process.env.APP_PORT ?? "5173"}/auth/callback`;
  const oauthClientId = await ensureOAuthApp(
    baseUrl,
    adminAuth,
    "bindersnap-dev",
    redirectUri,
    log,
  );

  const result: SeedResult = {
    pullRequests,
    prNumber: pullRequests[PRIMARY_CHANGE] ?? 0,
    secondPrNumber: pullRequests[SECONDARY_CHANGE] ?? 0,
    oauthClientId,
  };

  if (!createToken) {
    return result;
  }

  const tokenInfo = await createAccessToken(
    baseUrl,
    adminAuth,
    tokenNamePrefix,
    log,
  );
  return { ...result, token: tokenInfo.token, tokenName: tokenInfo.tokenName };
}

async function runCli(): Promise<void> {
  const scenario = loadSeedScenario(SCENARIO_URL);
  const result = await seedDevStack({ scenario });
  const password = process.env.GITEA_ADMIN_PASS ?? scenario.password;

  console.log("");
  console.log("==================================================");
  console.log(
    `Sign in at http://localhost:${process.env.APP_PORT ?? "5173"} as any of:`,
  );
  for (const user of scenario.users) {
    const role = user.role ? ` — ${user.role}` : "";
    console.log(`  ${user.username} / ${password}${role}`);
  }
  console.log("");
  console.log(`Seeded ${scenario.documents.length} documents.`);
  if (result.oauthClientId) {
    console.log(`OAUTH_CLIENT_ID=${result.oauthClientId}`);
    console.log("Add to .env:");
    console.log(`  BUN_PUBLIC_GITEA_OAUTH_CLIENT_ID=${result.oauthClientId}`);
  }
  if (result.token) {
    console.log(`TOKEN_NAME=${result.tokenName}`);
    console.log(`ALICE_TOKEN_SUFFIX=...${result.token.slice(-8)}`);
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
