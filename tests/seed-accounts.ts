/**
 * The accounts a dev stack signs in with, made straight in Gitea.
 *
 * **Before the API, and the only part of the seed that may be.** The API
 * authenticates its own service calls as the install's admin, so that account
 * has to exist before the API starts — and every other seeded person has to
 * exist before anybody can sign in as them. Making a person is not something
 * Bindersnap does (signup makes a person *and* an organization), so this is
 * setup of the platform rather than data in it.
 *
 * Everything a person does once they exist — organizations, binders,
 * documents, changes, reviews — is `seed.ts`'s job, and goes through the API.
 */

import { pathToFileURL } from "node:url";

import {
  loadSeedScenario,
  type SeedScenario,
  type SeedUser,
} from "./seed-scenario";

const DEFAULT_GITEA_URL = `http://localhost:${process.env.GITEA_PORT ?? "3000"}`;
const SCENARIO_URL = new URL("seed-data/dev.yaml", import.meta.url);

export type BasicAuth = {
  username: string;
  password: string;
};

type GiteaToken = {
  sha1?: string;
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeAuth(auth: BasicAuth): string {
  return Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
}

export function repoPath(owner: string, repo: string): string {
  return `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export async function giteaRequest(
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

export async function giteaJson<T>(
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

export async function waitForUrl(
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
  // Gitea 28 asks for the one data directory, `app_data_path`, and refuses an
  // install without it — re-rendering the form with a 200 the request below
  // cannot tell from success. The repository and log roots it used to ask for
  // come from the image's own app.ini.
  const form = new URLSearchParams({
    db_type: "sqlite3",
    db_path: "/data/gitea.db",
    app_name: "Gitea",
    app_data_path: "/data/gitea",
    run_user: "git",
    ssh_port: "22",
    http_port: giteaHttpPort,
    app_url: `http://localhost:${giteaHttpPort}/`,
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
  /**
   * Whether this account runs Bindersnap itself.
   *
   * Sent on both paths, and sent as `false` as well as `true`: turning the flag
   * off in the YAML has to demote the account on the next run, or the seed can
   * only ever add powers to a warm stack.
   */
  siteAdmin: boolean,
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
      admin: siteAdmin,
    }),
    // Gitea 28 answers a taken name with 409; 1.27 used 422.
    expectedStatuses: [201, 409],
  });

  if (created.status === 201) {
    log(`Created user: ${username}${siteAdmin ? " (site admin)" : ""}`);
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
        admin: siteAdmin,
      }),
      expectedStatuses: [200, 403, 422],
    },
  );
  log(`User already exists, refreshed: ${username}`);
}

/** The install admin's name and email, which the install form never asked for. */
async function refreshAdminProfile(
  baseUrl: string,
  adminAuth: BasicAuth,
  user: SeedUser | undefined,
  log: (message: string) => void,
): Promise<void> {
  if (!user) return;

  await giteaRequest(
    baseUrl,
    `/api/v1/admin/users/${encodeURIComponent(user.username)}`,
    {
      method: "PATCH",
      auth: adminAuth,
      body: JSON.stringify({
        login_name: user.username,
        email: user.email,
        full_name: user.fullName,
      }),
      expectedStatuses: [200, 403, 422],
    },
  );
  log(`Refreshed the administrator's profile: ${user.username}`);
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

export type SeedAccountsOptions = {
  baseUrl?: string;
  adminUser?: string;
  /** Password for every seeded account. See `password` in the scenario. */
  adminPass?: string;
  createToken?: boolean;
  tokenNamePrefix?: string;
  scenario?: SeedScenario;
  log?: (message: string) => void;
};

export type SeedAccountsResult = {
  baseUrl: string;
  adminAuth: BasicAuth;
  password: string;
  scenario: SeedScenario;
  oauthClientId?: string;
  token?: string;
  tokenName?: string;
};

/** Install Gitea if it is fresh, and make every account the scenario names. */
export async function seedAccounts(
  options: SeedAccountsOptions = {},
): Promise<SeedAccountsResult> {
  const scenario = options.scenario ?? loadSeedScenario(SCENARIO_URL);
  const baseUrl = options.baseUrl ?? process.env.GITEA_URL ?? DEFAULT_GITEA_URL;
  const password =
    options.adminPass ?? process.env.GITEA_ADMIN_PASS ?? scenario.password;
  const log = options.log ?? ((message: string) => console.log(message));

  const adminUser =
    options.adminUser ??
    process.env.GITEA_ADMIN_USER ??
    scenario.users[0]?.username;
  if (!adminUser) {
    throw new Error("The seed scenario declares no users.");
  }
  const adminAuth: BasicAuth = { username: adminUser, password };

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

  // **The install admin included.** Gitea made that account from the install
  // form, which takes a login and an email and no name — so the one account
  // every developer signs in as was the only one with no full name, and every
  // screen that shows a person showed a bare login beside ten people with
  // proper names. Their site-admin flag is left exactly as it is: the seed
  // authenticates as them, and demoting them would lock it out of its own
  // stack.
  await refreshAdminProfile(
    baseUrl,
    adminAuth,
    scenario.users.find((user) => user.username === adminUser),
    log,
  );

  for (const user of scenario.users) {
    if (user.username === adminUser) continue;
    await ensureUser(
      baseUrl,
      adminAuth,
      user.username,
      password,
      user.email,
      user.fullName,
      user.siteAdmin,
      log,
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

  const result: SeedAccountsResult = {
    baseUrl,
    adminAuth,
    password,
    scenario,
    oauthClientId,
  };
  if (!(options.createToken ?? false)) return result;

  const tokenInfo = await createAccessToken(
    baseUrl,
    adminAuth,
    options.tokenNamePrefix ?? "bindersnap-dev",
    log,
  );
  return { ...result, token: tokenInfo.token, tokenName: tokenInfo.tokenName };
}

const invokedDirectly = (() => {
  const entryPath = process.argv[1];
  if (!entryPath) return false;
  return pathToFileURL(entryPath).href === import.meta.url;
})();

if (invokedDirectly) {
  seedAccounts().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
