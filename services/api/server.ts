import { randomUUID } from "crypto";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const apiPortValue = Number.parseInt(
  process.env.API_PORT ?? process.env.PORT ?? "8787",
  10,
);
const apiPort = Number.isFinite(apiPortValue) && apiPortValue > 0 ? apiPortValue : 8787;
const giteaUrl =
  process.env.GITEA_INTERNAL_URL ??
  process.env.BUN_PUBLIC_GITEA_URL ??
  process.env.VITE_GITEA_URL ??
  "http://localhost:3000";
const adminUsername = process.env.GITEA_ADMIN_USER ?? "";
const adminPassword = process.env.GITEA_ADMIN_PASS ?? "";
const emailDomain = process.env.BINDERSNAP_USER_EMAIL_DOMAIN ?? "users.bindersnap.local";
const sessionCookieName =
  process.env.BINDERSNAP_SESSION_COOKIE_NAME ?? "bindersnap_session";
const tokenScopes = (process.env.BINDERSNAP_GITEA_TOKEN_SCOPES ?? "read:repository")
  .split(",")
  .map((scope) => scope.trim())
  .filter((scope) => scope !== "");
const sessionTtlMs = Number.parseInt(
  process.env.BINDERSNAP_SESSION_TTL_MS ?? `${7 * 24 * 60 * 60 * 1000}`,
  10,
);
const enforceHttps = parseBoolean(
  process.env.BINDERSNAP_REQUIRE_HTTPS,
  process.env.NODE_ENV === "production",
);
const authRateLimitEnabled = parseBoolean(
  process.env.BINDERSNAP_AUTH_RATE_LIMIT_ENABLED,
  true,
);
const authRateLimitWindowMs = parsePositiveInt(
  process.env.BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS,
  10 * 60 * 1000,
);
const authRateLimitMax = parsePositiveInt(
  process.env.BINDERSNAP_AUTH_RATE_LIMIT_MAX,
  20,
);
const defaultAppOrigin = `http://localhost:${process.env.APP_PORT ?? "5173"}`;
const configuredAllowedOrigins = (
  process.env.BINDERSNAP_ALLOWED_ORIGINS ??
  process.env.BINDERSNAP_APP_ORIGIN ??
  defaultAppOrigin
)
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");

const SEEDED_DOCUMENTS = [
  { title: "Draft", path: "documents/draft.json" },
  { title: "In Review", path: "documents/in-review.json" },
  { title: "Changes Requested", path: "documents/changes-requested.json" },
] as const;

interface SessionRecord {
  id: string;
  username: string;
  giteaToken: string;
  giteaTokenName: string;
  createdAt: number;
  expiresAt: number;
}

interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
}

const sessions = new Map<string, SessionRecord>();
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const sessionTtl =
  Number.isFinite(sessionTtlMs) && sessionTtlMs > 0
    ? sessionTtlMs
    : 7 * 24 * 60 * 60 * 1000;
const allowedOrigins = new Set(
  configuredAllowedOrigins
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin)),
);

function normalizeOrigin(origin: string | null | undefined): string | null {
  if (!origin) {
    return null;
  }

  const trimmed = origin.trim();
  if (trimmed === "") {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function json(status: number, body: Record<string, unknown>, headers?: HeadersInit): Response {
  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });

  if (headers) {
    new Headers(headers).forEach((value, key) => {
      responseHeaders.set(key, value);
    });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function buildTokenAuthHeader(token: string): string {
  return `token ${token}`;
}

function requestOrigin(req: Request): string | null {
  return normalizeOrigin(req.headers.get("origin"));
}

function requestSourceOrigin(req: Request): string | null {
  const origin = requestOrigin(req);
  if (origin) {
    return origin;
  }

  const referer = req.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function requestProtocol(req: Request): string {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim().toLowerCase() ?? "";
  }

  return new URL(req.url).protocol.replace(":", "").toLowerCase();
}

function requestClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const cfConnectingIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return new URL(req.url).hostname;
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  if (allowedOrigins.has(origin)) {
    return true;
  }

  // Local dev fallback: allow loopback browser origins unless explicitly locked down.
  if (!process.env.BINDERSNAP_ALLOWED_ORIGINS && !process.env.BINDERSNAP_APP_ORIGIN) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  }

  return false;
}

function corsHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = requestOrigin(req);

  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set("Vary", "Origin");
  }

  return headers;
}

function mergeHeaders(base: Headers, extra?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (extra) {
    new Headers(extra).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function isLocalRequest(req: Request): boolean {
  const { hostname } = new URL(req.url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function enforceTransportSecurity(req: Request, baseHeaders: Headers): Response | null {
  if (!enforceHttps || isLocalRequest(req)) {
    return null;
  }

  if (requestProtocol(req) === "https") {
    return null;
  }

  return json(400, { error: "HTTPS is required." }, baseHeaders);
}

function enforceStateChangingOrigin(req: Request, baseHeaders: Headers): Response | null {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return null;
  }

  const sourceOrigin = requestSourceOrigin(req);
  if (!isAllowedOrigin(sourceOrigin)) {
    return json(403, { error: "Cross-site request blocked." }, baseHeaders);
  }

  return null;
}

function serializeCookie(req: Request, value: string, expiresAt?: number): string {
  const parts = [`${sessionCookieName}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];

  if (!isLocalRequest(req)) {
    parts.push("Secure");
  }

  if (expiresAt !== undefined) {
    const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    parts.push(`Max-Age=${maxAge}`);
    parts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
  }

  return parts.join("; ");
}

function clearSessionCookie(req: Request): string {
  return serializeCookie(req, "", 0);
}

function parseCookies(req: Request): Map<string, string> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const parsed = new Map<string, string>();

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    parsed.set(rawName, rawValue.join("="));
  }

  return parsed;
}

function getSessionFromRequest(req: Request): SessionRecord | null {
  const sessionId = parseCookies(req).get(sessionCookieName);
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    void revokeUserToken(session);
    return null;
  }

  return session;
}

function consumeAuthRateLimit(
  req: Request,
  action: "login" | "signup",
): { limited: boolean; retryAfterSeconds: number } {
  if (!authRateLimitEnabled) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  const key = `${action}:${requestClientIp(req)}`;
  const now = Date.now();
  const existing = authAttempts.get(key);

  if (!existing || existing.resetAt <= now) {
    authAttempts.set(key, {
      count: 1,
      resetAt: now + authRateLimitWindowMs,
    });
    return { limited: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  authAttempts.set(key, existing);

  if (existing.count > authRateLimitMax) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

function resetAuthRateLimit(req: Request, action: "login" | "signup"): void {
  if (!authRateLimitEnabled) {
    return;
  }

  const key = `${action}:${requestClientIp(req)}`;
  authAttempts.delete(key);
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function giteaFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, giteaUrl), init);
}

async function verifyUserCredentials(username: string, password: string): Promise<string | null> {
  const response = await giteaFetch("/api/v1/user", {
    method: "GET",
    headers: {
      Authorization: buildBasicAuthHeader(username, password),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { login?: unknown };
  return typeof payload.login === "string" && payload.login.trim() !== "" ? payload.login.trim() : null;
}

async function createUserToken(username: string, password: string, tokenName: string): Promise<string | null> {
  const response = await giteaFetch(`/api/v1/users/${encodeURIComponent(username)}/tokens`, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(username, password),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      name: tokenName,
      scopes: tokenScopes.length > 0 ? tokenScopes : ["read:repository"],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { sha1?: unknown };
  return typeof payload.sha1 === "string" && payload.sha1.trim() !== "" ? payload.sha1.trim() : null;
}

async function revokeUserToken(session: SessionRecord): Promise<void> {
  const path = `/api/v1/users/${encodeURIComponent(session.username)}/tokens/${encodeURIComponent(session.giteaTokenName)}`;

  // Try revoking with the user's own token first.
  const tokenResponse = await giteaFetch(path, {
    method: "DELETE",
    headers: {
      Authorization: buildTokenAuthHeader(session.giteaToken),
      Accept: "application/json",
    },
  }).catch(() => null);

  if (tokenResponse?.ok) {
    return;
  }

  // Fallback to admin credentials when available.
  if (!adminUsername || !adminPassword) {
    return;
  }

  await giteaFetch(path, {
    method: "DELETE",
    headers: {
      Authorization: buildBasicAuthHeader(adminUsername, adminPassword),
      Accept: "application/json",
    },
  }).catch(() => undefined);
}

async function createGiteaUser(username: string, password: string): Promise<"created" | "exists" | "error"> {
  if (!adminUsername || !adminPassword) {
    return "error";
  }

  const response = await giteaFetch("/api/v1/admin/users", {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(adminUsername, adminPassword),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      username,
      password,
      email: `${username}@${emailDomain}`,
      must_change_password: false,
      restricted: false,
      send_notify: false,
      visibility: "private",
    }),
  }).catch(() => null);

  if (!response) {
    return "error";
  }

  if (response.ok || response.status === 201) {
    return "created";
  }

  if (response.status === 409 || response.status === 422) {
    return "exists";
  }

  return "error";
}

function createSession(username: string, giteaToken: string, giteaTokenName: string): SessionRecord {
  const now = Date.now();
  const session: SessionRecord = {
    id: randomUUID(),
    username,
    giteaToken,
    giteaTokenName,
    createdAt: now,
    expiresAt: now + sessionTtl,
  };

  sessions.set(session.id, session);
  return session;
}

async function revokeAndDeleteSession(session: SessionRecord): Promise<void> {
  sessions.delete(session.id);
  await revokeUserToken(session).catch(() => undefined);
}

async function revokeOtherUserSessions(username: string): Promise<void> {
  const staleSessions = [...sessions.values()].filter((session) => session.username === username);
  if (staleSessions.length === 0) {
    return;
  }

  await Promise.allSettled(staleSessions.map((session) => revokeAndDeleteSession(session)));
}

async function createLoginSession(username: string, password: string, req: Request, baseHeaders: Headers): Promise<Response> {
  const loginName = await verifyUserCredentials(username, password).catch(() => null);
  if (!loginName) {
    return json(401, { error: "Invalid username or password." }, baseHeaders);
  }

  const tokenName = `bindersnap-session-${randomUUID()}`;
  const token = await createUserToken(loginName, password, tokenName).catch(() => null);
  if (!token) {
    return json(502, { error: "Unable to sign in." }, baseHeaders);
  }

  await revokeOtherUserSessions(loginName);

  const session = createSession(loginName, token, tokenName);
  const headers = mergeHeaders(baseHeaders, {
    "Set-Cookie": serializeCookie(req, session.id, session.expiresAt),
  });

  return json(
    200,
    {
      user: {
        username: session.username,
      },
    },
    headers,
  );
}

async function listLatestCommit(token: string, filePath: string): Promise<CommitSummary | null> {
  const response = await giteaFetch(
    `/api/v1/repos/alice/quarterly-report/commits?path=${encodeURIComponent(filePath)}&limit=1`,
    {
      method: "GET",
      headers: {
        Authorization: buildTokenAuthHeader(token),
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const commits = (await response.json()) as Array<{
    sha?: string;
    commit?: { message?: string; author?: { name?: string; date?: string } };
    author?: { full_name?: string; login?: string };
    created?: string;
  }>;

  const commit = commits[0];
  if (!commit) return null;

  return {
    sha: commit.sha ?? "",
    message: commit.commit?.message ?? "",
    author: commit.commit?.author?.name ?? commit.author?.full_name ?? commit.author?.login ?? "Unknown",
    timestamp: commit.commit?.author?.date ?? commit.created ?? "",
  };
}

async function handleSignup(req: Request, baseHeaders: Headers): Promise<Response> {
  const rateLimit = consumeAuthRateLimit(req, "signup");
  if (rateLimit.limited) {
    return json(
      429,
      { error: "Too many signup attempts. Please try again shortly." },
      mergeHeaders(baseHeaders, {
        "Retry-After": String(rateLimit.retryAfterSeconds),
      }),
    );
  }

  const payload = await readJson<{ username?: unknown; password?: unknown }>(req);
  const username = typeof payload?.username === "string" ? payload.username.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (!username || !password) {
    return json(400, { error: "Username and password are required." }, baseHeaders);
  }

  const created = await createGiteaUser(username, password);
  if (created === "exists") {
    return json(409, { error: "Username is unavailable." }, baseHeaders);
  }

  if (created !== "created") {
    return json(502, { error: "Unable to create account." }, baseHeaders);
  }

  const response = await createLoginSession(username, password, req, baseHeaders);
  if (response.ok) {
    resetAuthRateLimit(req, "signup");
  }
  return response;
}

async function handleLogin(req: Request, baseHeaders: Headers): Promise<Response> {
  const rateLimit = consumeAuthRateLimit(req, "login");
  if (rateLimit.limited) {
    return json(
      429,
      { error: "Too many login attempts. Please try again shortly." },
      mergeHeaders(baseHeaders, {
        "Retry-After": String(rateLimit.retryAfterSeconds),
      }),
    );
  }

  const payload = await readJson<{ username?: unknown; password?: unknown }>(req);
  const username = typeof payload?.username === "string" ? payload.username.trim() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (!username || !password) {
    return json(400, { error: "Username and password are required." }, baseHeaders);
  }

  const response = await createLoginSession(username, password, req, baseHeaders);
  if (response.ok) {
    resetAuthRateLimit(req, "login");
  }
  return response;
}

async function handleLogout(req: Request, baseHeaders: Headers): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (session) {
    sessions.delete(session.id);
    await revokeUserToken(session);
  }

  const headers = mergeHeaders(baseHeaders, {
    "Set-Cookie": clearSessionCookie(req),
  });

  return json(200, { ok: true }, headers);
}

async function handleAuthMe(req: Request, baseHeaders: Headers): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) {
    return json(401, { error: "Unauthorized." }, baseHeaders);
  }

  return json(
    200,
    {
      user: {
        username: session.username,
      },
    },
    baseHeaders,
  );
}

async function handleDocuments(req: Request, baseHeaders: Headers): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) {
    return json(401, { error: "Unauthorized." }, baseHeaders);
  }

  const documents = await Promise.all(
    SEEDED_DOCUMENTS.map(async (document) => ({
      ...document,
      latestCommit: await listLatestCommit(session.giteaToken, document.path),
    })),
  );

  return json(
    200,
    {
      repository: "alice/quarterly-report",
      documents,
    },
    baseHeaders,
  );
}

async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  const expiredSessions: SessionRecord[] = [];

  for (const [id, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
      expiredSessions.push(session);
    }
  }

  if (expiredSessions.length > 0) {
    await Promise.allSettled(expiredSessions.map((session) => revokeUserToken(session)));
  }

  for (const [key, entry] of authAttempts.entries()) {
    if (entry.resetAt <= now) {
      authAttempts.delete(key);
    }
  }
}

setInterval(() => {
  void cleanupExpiredSessions();
}, 60_000);

const server = Bun.serve({
  port: apiPort,
  idleTimeout: 30,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const baseHeaders = corsHeaders(req);
    const transportError = enforceTransportSecurity(req, baseHeaders);
    if (transportError) {
      return transportError;
    }

    const originError = enforceStateChangingOrigin(req, baseHeaders);
    if (originError) {
      return originError;
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: baseHeaders,
      });
    }

    if (pathname === "/auth/signup" && req.method === "POST") {
      return handleSignup(req, baseHeaders);
    }

    if (pathname === "/auth/login" && req.method === "POST") {
      return handleLogin(req, baseHeaders);
    }

    if (pathname === "/auth/logout" && req.method === "POST") {
      return handleLogout(req, baseHeaders);
    }

    if (pathname === "/auth/me" && req.method === "GET") {
      return handleAuthMe(req, baseHeaders);
    }

    if (pathname === "/api/app/documents" && req.method === "GET") {
      return handleDocuments(req, baseHeaders);
    }

    return json(404, { error: "Not found." }, baseHeaders);
  },
});

console.log(`Bindersnap API listening on http://localhost:${server.port}`);
