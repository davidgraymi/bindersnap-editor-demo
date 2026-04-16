import { randomUUID } from "crypto";

import { sessionStore, type SessionRecord } from "./sessions";
import {
  createGiteaClient,
  GiteaApiError,
  unwrap,
  type GiteaClient,
} from "../../packages/gitea-client/client";
import {
  addRepoCollaborator,
  bootstrapEmptyMainBranch,
  createDocTag,
  createMainBranchProtection,
  createPrivateCurrentUserRepo,
  getCurrentUserRepoPermission,
  getLatestDocTag,
  getRepoBranchProtection,
  getRepoCollaboratorPermission,
  listDocTags,
  listRepoCollaborators,
  listWorkspaceRepos,
  repoExists,
  searchUsers,
  removeRepoCollaborator,
  type RepoCollaboratorPermissionSummary,
  type WorkspaceRepo,
} from "../../packages/gitea-client/repos";
import {
  buildUploadBranchName,
  buildUploadCommitMessage,
  commitBinaryFile,
  createUploadBranch,
  validateUploadFile,
} from "../../packages/gitea-client/uploads";
import {
  createPullRequest,
  listPullRequests,
  mergeOrResolveConflicts,
  submitReview,
  type PullRequestWithApprovalState,
} from "../../packages/gitea-client/pullRequests";

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
const apiPort =
  Number.isFinite(apiPortValue) && apiPortValue > 0 ? apiPortValue : 8787;
const giteaUrl =
  process.env.GITEA_INTERNAL_URL ??
  process.env.BUN_PUBLIC_GITEA_URL ??
  process.env.VITE_GITEA_URL ??
  "http://localhost:3000";
const adminUsername = process.env.GITEA_ADMIN_USER ?? "";
const adminPassword = process.env.GITEA_ADMIN_PASS ?? "";
const emailDomain =
  process.env.BINDERSNAP_USER_EMAIL_DOMAIN ?? "users.bindersnap.local";
const sessionCookieName =
  process.env.BINDERSNAP_SESSION_COOKIE_NAME ?? "bindersnap_session";
const REQUIRED_GITEA_TOKEN_SCOPES = [
  "write:user",
  "write:repository",
  "write:issue",
] as const;

function resolveGiteaTokenScopes(scopesRaw?: string): string[] {
  const configuredScopes = (scopesRaw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope !== "");

  return Array.from(
    new Set<string>([...configuredScopes, ...REQUIRED_GITEA_TOKEN_SCOPES]),
  );
}

const tokenScopes = resolveGiteaTokenScopes(
  process.env.BINDERSNAP_GITEA_TOKEN_SCOPES,
);
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

function json(status: number, body: unknown, headers?: HeadersInit): Response {
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
  if (
    !process.env.BINDERSNAP_ALLOWED_ORIGINS &&
    !process.env.BINDERSNAP_APP_ORIGIN
  ) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  }

  return false;
}

function corsHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = requestOrigin(req);

  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
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

function enforceTransportSecurity(
  req: Request,
  baseHeaders: Headers,
): Response | null {
  if (!enforceHttps || isLocalRequest(req)) {
    return null;
  }

  if (requestProtocol(req) === "https") {
    return null;
  }

  return json(400, { error: "HTTPS is required." }, baseHeaders);
}

function enforceStateChangingOrigin(
  req: Request,
  baseHeaders: Headers,
): Response | null {
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS"
  ) {
    return null;
  }

  const sourceOrigin = requestSourceOrigin(req);
  if (!isAllowedOrigin(sourceOrigin)) {
    return json(403, { error: "Cross-site request blocked." }, baseHeaders);
  }

  return null;
}

function serializeCookie(
  req: Request,
  value: string,
  expiresAt?: number,
): string {
  const parts = [
    `${sessionCookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

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

  const session = sessionStore.get(sessionId);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessionStore.delete(sessionId);
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
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    );
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

async function readResponsePayload(response: Response): Promise<unknown> {
  const body = await response.text().catch(() => "");
  if (body.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

async function readGiteaErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const headerMessage = response.headers.get("message")?.trim();
  if (headerMessage) {
    return headerMessage;
  }

  const payload = await readResponsePayload(response).catch(() => null);
  if (typeof payload === "string") {
    return payload.trim() || fallback;
  }

  if (typeof payload === "object" && payload !== null) {
    const candidate = payload as {
      error?: unknown;
      message?: unknown;
      err?: unknown;
      description?: unknown;
    };

    if (typeof candidate.error === "string" && candidate.error.trim() !== "") {
      return candidate.error.trim();
    }

    if (
      typeof candidate.message === "string" &&
      candidate.message.trim() !== ""
    ) {
      return candidate.message.trim();
    }

    if (typeof candidate.err === "string" && candidate.err.trim() !== "") {
      return candidate.err.trim();
    }

    if (
      typeof candidate.description === "string" &&
      candidate.description.trim() !== ""
    ) {
      return candidate.description.trim();
    }
  }

  return fallback;
}

function createSessionGiteaClient(session: SessionRecord): GiteaClient {
  return createGiteaClient(giteaUrl, session.giteaToken);
}

function requireSession(
  req: Request,
  baseHeaders: Headers,
): { session: SessionRecord; client: GiteaClient } | Response {
  const session = getSessionFromRequest(req);
  if (!session) {
    return json(401, { error: "Unauthorized." }, baseHeaders);
  }

  return { session, client: createSessionGiteaClient(session) };
}

function parsePositiveIntInput(
  value: string | number | null | undefined,
  fallback: number,
): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeIntInput(
  value: string | number | null | undefined,
  fallback: number,
): number {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseOptionalString(
  value: FormDataEntryValue | null | undefined,
): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalFile(
  value: FormDataEntryValue | null | undefined,
): File | null {
  return value instanceof File ? value : null;
}

function toRepoCollaboratorRole(
  permission: string,
): "read" | "write" | "admin" | "owner" | "unknown" {
  switch (permission) {
    case "read":
    case "write":
    case "admin":
    case "owner":
      return permission;
    default:
      return "unknown";
  }
}

function buildDownloadFileName(repo: string, storedFileName: string): string {
  const lastDotIndex = storedFileName.lastIndexOf(".");
  const extension =
    lastDotIndex > 0 && lastDotIndex < storedFileName.length - 1
      ? storedFileName.slice(lastDotIndex + 1)
      : "";

  return extension ? `${repo}.${extension}` : repo;
}

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dotIndex + 1).toLowerCase();
}

function buildCanonicalDocumentFileName(extension: string): string {
  const normalized = extension.replace(/^\.+/, "").trim().toLowerCase();
  return normalized === "" ? "document" : `document.${normalized}`;
}

function normalizeWorkspaceRepoSummary(repo: {
  id?: number;
  name?: string;
  full_name?: string;
  description?: string;
  updated_at?: string;
  owner?: { login?: string };
}): WorkspaceRepo {
  return {
    id: repo.id ?? 0,
    name: repo.name ?? "",
    full_name: repo.full_name ?? "",
    description: repo.description ?? "",
    updated_at: repo.updated_at ?? "",
    owner: {
      login: repo.owner?.login ?? "",
    },
  };
}

async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readFileAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

type RepoContentsEntry = {
  name?: unknown;
  type?: unknown;
};

type RepoContentsExtResponse = {
  dir_contents?: RepoContentsEntry[];
  file_contents?: RepoContentsEntry;
};

interface CanonicalFileInfo {
  storedFileName: string;
  downloadFileName: string;
}

function inferStoredDocumentFileName(
  entries: RepoContentsEntry[],
  repo: string,
): string | null {
  const files = entries.filter(
    (entry): entry is RepoContentsEntry & { name: string } =>
      entry.type === "file" && typeof entry.name === "string",
  );

  const documentFile = files.find(
    (entry) => entry.name === "document" || entry.name.startsWith("document."),
  );
  if (documentFile) {
    return documentFile.name;
  }

  const legacyFile = files.find(
    (entry) => entry.name === repo || entry.name.startsWith(`${repo}.`),
  );
  if (legacyFile) {
    return legacyFile.name;
  }

  if (files.length === 1) {
    return files[0]?.name ?? null;
  }

  return null;
}

async function resolveCanonicalFileInfo(
  client: GiteaClient,
  owner: string,
  repo: string,
  ref = "main",
): Promise<CanonicalFileInfo | null> {
  const result = await unwrap(
    client.GET("/repos/{owner}/{repo}/contents-ext/{filepath}", {
      params: {
        path: { owner, repo, filepath: "." },
        query: { ref },
      },
    }),
  );

  const response = result as RepoContentsExtResponse;
  const entries = [
    ...(response.dir_contents ?? []),
    ...(response.file_contents ? [response.file_contents] : []),
  ];
  const storedFileName = inferStoredDocumentFileName(entries, repo);

  if (!storedFileName) {
    return null;
  }

  return {
    storedFileName,
    downloadFileName: buildDownloadFileName(repo, storedFileName),
  };
}

async function resolveCurrentUserPermission(
  client: GiteaClient,
  owner: string,
  repo: string,
  currentUsername: string,
): Promise<RepoCollaboratorPermissionSummary | null> {
  if (!currentUsername) {
    return null;
  }

  if (currentUsername === owner) {
    return {
      permission: "owner",
      access: "owner",
      permissionLabel: "Owner",
      roleName: "owner",
      user: {
        id: 0,
        login: currentUsername,
        full_name: "",
        email: "",
        avatar_url: "",
      },
    };
  }

  try {
    return await getCurrentUserRepoPermission({
      client,
      owner,
      repo,
      username: currentUsername,
    });
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      const repository = (await unwrap(
        client.GET("/repos/{owner}/{repo}", {
          params: { path: { owner, repo } },
        }),
      )) as {
        permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
      };

      if (repository.permissions?.admin) {
        return {
          permission: "admin",
          access: "admin",
          permissionLabel: "Admin",
          roleName: "admin",
          user: {
            id: 0,
            login: currentUsername,
            full_name: "",
            email: "",
            avatar_url: "",
          },
        };
      }

      if (repository.permissions?.push) {
        return {
          permission: "write",
          access: "write",
          permissionLabel: "Write",
          roleName: "write",
          user: {
            id: 0,
            login: currentUsername,
            full_name: "",
            email: "",
            avatar_url: "",
          },
        };
      }

      if (repository.permissions?.pull) {
        return {
          permission: "read",
          access: "read",
          permissionLabel: "Read",
          roleName: "read",
          user: {
            id: 0,
            login: currentUsername,
            full_name: "",
            email: "",
            avatar_url: "",
          },
        };
      }

      return null;
    }

    throw err;
  }
}

async function resolveLatestUploadRef(
  client: GiteaClient,
  owner: string,
  repo: string,
): Promise<string | null> {
  const pullRequests = await listPullRequests({
    client,
    owner,
    repo,
    state: "open",
  });

  const uploadPullRequests = pullRequests
    .filter((pullRequest) =>
      (pullRequest.head?.ref ?? "").startsWith("upload/"),
    )
    .sort((left, right) => (right.number ?? 0) - (left.number ?? 0));

  return uploadPullRequests[0]?.head?.ref ?? null;
}

function readInputString(
  payload: Record<string, unknown> | null,
  form: FormData | null,
  key: string,
): string {
  if (payload && typeof payload[key] === "string") {
    return payload[key].trim();
  }

  return parseOptionalString(form?.get(key) ?? null);
}

function readInputNumber(
  payload: Record<string, unknown> | null,
  form: FormData | null,
  key: string,
): string {
  if (payload) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value).trim();
    }
  }

  return parseOptionalString(form?.get(key) ?? null);
}

function decodePathParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function readJsonBody<T extends Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  return await readJson<T>(req);
}

async function readMultipartBody(req: Request): Promise<FormData | null> {
  try {
    return await req.formData();
  } catch {
    return null;
  }
}

function downloadHeaders(baseHeaders: Headers, response: Response): Headers {
  const headers = mergeHeaders(baseHeaders);
  for (const key of [
    "content-type",
    "content-length",
    "content-disposition",
    "cache-control",
    "etag",
    "last-modified",
  ]) {
    const value = response.headers.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  return headers;
}

function responseFromError(
  err: unknown,
  baseHeaders: Headers,
  fallback: string,
): Response {
  if (err instanceof GiteaApiError) {
    return json(err.status, { error: err.message || fallback }, baseHeaders);
  }

  return json(
    500,
    {
      error: err instanceof Error && err.message ? err.message : fallback,
    },
    baseHeaders,
  );
}

async function verifyUserCredentials(
  username: string,
  password: string,
): Promise<string | null> {
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
  return typeof payload.login === "string" && payload.login.trim() !== ""
    ? payload.login.trim()
    : null;
}

type GiteaEmailRecord = {
  email?: unknown;
  username?: unknown;
};

type LoginResolution =
  | { kind: "authenticated"; username: string }
  | { kind: "not_found" }
  | { kind: "unavailable"; status: number; error: string };

function looksLikeEmailAddress(value: string): boolean {
  return value.includes("@");
}

async function findUsernameByEmail(email: string): Promise<LoginResolution> {
  if (!adminUsername || !adminPassword) {
    return {
      kind: "unavailable",
      status: 503,
      error: "Email login is temporarily unavailable.",
    };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === "") {
    return { kind: "not_found" };
  }

  const pageSize = 100;
  const maxPages = 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await giteaFetch(
      `/api/v1/admin/emails/search?q=${encodeURIComponent(email)}&page=${page}&limit=${pageSize}`,
      {
        method: "GET",
        headers: {
          Authorization: buildBasicAuthHeader(adminUsername, adminPassword),
          Accept: "application/json",
        },
      },
    ).catch(() => null);

    if (!response) {
      return {
        kind: "unavailable",
        status: 502,
        error: "Unable to reach Gitea while checking the login email.",
      };
    }

    if (!response.ok) {
      return {
        kind: "unavailable",
        status: response.status,
        error: await readGiteaErrorMessage(
          response,
          "Unable to check the login email right now.",
        ),
      };
    }

    const payload = (await response.json().catch(() => null)) as
      | GiteaEmailRecord[]
      | null;
    if (!Array.isArray(payload)) {
      return {
        kind: "unavailable",
        status: 502,
        error: "Gitea returned an unexpected email search response.",
      };
    }

    const match = payload.find((entry) => {
      if (typeof entry?.email !== "string") {
        return false;
      }

      return entry.email.trim().toLowerCase() === normalizedEmail;
    });

    if (typeof match?.username === "string" && match.username.trim() !== "") {
      return {
        kind: "authenticated",
        username: match.username.trim(),
      };
    }

    if (payload.length < pageSize) {
      return { kind: "not_found" };
    }
  }

  return {
    kind: "unavailable",
    status: 502,
    error: "Email search did not complete after checking all pages.",
  };
}

async function resolveLoginUsername(
  identifier: string,
  emailCandidate: string,
  password: string,
): Promise<LoginResolution> {
  const directLoginName = await verifyUserCredentials(
    identifier,
    password,
  ).catch(() => null);
  if (directLoginName) {
    return { kind: "authenticated", username: directLoginName };
  }

  if (!looksLikeEmailAddress(emailCandidate)) {
    return { kind: "not_found" };
  }

  const emailLookup = await findUsernameByEmail(emailCandidate).catch(
    () =>
      ({
        kind: "unavailable",
        status: 502,
        error: "Unable to resolve the login email right now.",
      }) as LoginResolution,
  );
  if (emailLookup.kind !== "authenticated") {
    return emailLookup;
  }

  const username = await verifyUserCredentials(
    emailLookup.username,
    password,
  ).catch(() => null);
  if (username) {
    return { kind: "authenticated", username };
  }

  return { kind: "not_found" };
}

async function createAuthenticatedSession(
  username: string,
  password: string,
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const tokenName = `bindersnap-session-${randomUUID()}`;
  const token = await createUserToken(username, password, tokenName).catch(
    () => null,
  );
  if (!token) {
    return json(502, { error: "Unable to sign in." }, baseHeaders);
  }

  const session = createSession(username, token, tokenName);
  const headers = mergeHeaders(baseHeaders, {
    "Set-Cookie": serializeCookie(req, session.id, session.expiresAt),
  });

  return json(
    200,
    {
      user: {
        username: session.username,
      },
      token: session.giteaToken,
    },
    headers,
  );
}

async function createLoginSession(
  username: string,
  password: string,
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const loginName = await verifyUserCredentials(username, password).catch(
    () => null,
  );
  if (!loginName) {
    return json(401, { error: "Invalid username or password." }, baseHeaders);
  }

  return createAuthenticatedSession(loginName, password, req, baseHeaders);
}

async function createUserToken(
  username: string,
  password: string,
  tokenName: string,
): Promise<string | null> {
  const response = await giteaFetch(
    `/api/v1/users/${encodeURIComponent(username)}/tokens`,
    {
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
    },
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { sha1?: unknown };
  return typeof payload.sha1 === "string" && payload.sha1.trim() !== ""
    ? payload.sha1.trim()
    : null;
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

async function createGiteaUser(
  username: string,
  email: string,
  password: string,
): Promise<
  { status: 502; error: string } | { status: number; error: string } | "created"
> {
  if (!adminUsername || !adminPassword) {
    return {
      status: 502,
      error: "Gitea admin credentials are not configured.",
    };
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
      email,
      must_change_password: false,
      restricted: false,
      send_notify: false,
      visibility: "limited",
    }),
  }).catch(() => null);

  if (!response) {
    return {
      status: 502,
      error: "Unable to reach Gitea while creating the account.",
    };
  }

  if (response.ok || response.status === 201) {
    return "created";
  }

  return {
    status: response.status,
    error: await readGiteaErrorMessage(
      response,
      response.status === 409 || response.status === 422
        ? "Unable to create account with those details."
        : "Unable to create account.",
    ),
  };
}

function createSession(
  username: string,
  giteaToken: string,
  giteaTokenName: string,
): SessionRecord {
  const now = Date.now();
  const session: SessionRecord = {
    id: randomUUID(),
    username,
    giteaToken,
    giteaTokenName,
    createdAt: now,
    expiresAt: now + sessionTtl,
  };

  sessionStore.put(session);
  return session;
}

async function revokeAndDeleteSession(session: SessionRecord): Promise<void> {
  sessionStore.delete(session.id);
  await revokeUserToken(session).catch(() => undefined);
}

async function handleSignup(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
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

  const payload = await readJson<{
    username?: unknown;
    email?: unknown;
    password?: unknown;
  }>(req);
  const username =
    typeof payload?.username === "string" ? payload.username : "";
  const email = typeof payload?.email === "string" ? payload.email : "";
  const password =
    typeof payload?.password === "string" ? payload.password : "";

  if (!username || !email || !password) {
    return json(
      400,
      { error: "Username, email and password are required." },
      baseHeaders,
    );
  }

  const created = await createGiteaUser(username, email, password);
  if (created !== "created") {
    return json(created.status, { error: created.error }, baseHeaders);
  }

  const response = await createLoginSession(
    username,
    password,
    req,
    baseHeaders,
  );
  if (response.ok) {
    resetAuthRateLimit(req, "signup");
  }
  return response;
}

async function handleLogin(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
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

  const payload = await readJson<{
    username?: unknown;
    email?: unknown;
    identifier?: unknown;
    password?: unknown;
  }>(req);
  const username =
    typeof payload?.username === "string" ? payload.username.trim() : "";
  const email = typeof payload?.email === "string" ? payload.email.trim() : "";
  const identifier =
    typeof payload?.identifier === "string"
      ? payload.identifier.trim()
      : username || email;
  const emailCandidate = email || identifier;
  const password =
    typeof payload?.password === "string" ? payload.password : "";

  if (!identifier || !password) {
    return json(
      400,
      { error: "Username or email and password are required." },
      baseHeaders,
    );
  }

  const resolution = await resolveLoginUsername(
    identifier,
    emailCandidate,
    password,
  );
  if (resolution.kind === "unavailable") {
    return json(resolution.status, { error: resolution.error }, baseHeaders);
  }

  if (resolution.kind !== "authenticated") {
    return json(
      401,
      { error: "Invalid username, email, or password." },
      baseHeaders,
    );
  }

  const response = await createAuthenticatedSession(
    resolution.username,
    password,
    req,
    baseHeaders,
  );
  if (response.ok) {
    resetAuthRateLimit(req, "login");
  }
  return response;
}

async function handleLogout(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (session) {
    sessionStore.delete(session.id);
    await revokeUserToken(session);
  }

  const headers = mergeHeaders(baseHeaders, {
    "Set-Cookie": clearSessionCookie(req),
  });

  return json(200, { ok: true }, headers);
}

async function handleAuthMe(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
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
      token: session.giteaToken,
    },
    baseHeaders,
  );
}

async function handleDocuments(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;

  try {
    const repos = await listWorkspaceRepos(client);
    const documents = await Promise.all(
      repos.map(async (repo) => {
        try {
          const [latestTag, pullRequests] = await Promise.all([
            getLatestDocTag(client, repo.owner.login, repo.name),
            listPullRequests({
              client,
              owner: repo.owner.login,
              repo: repo.name,
              state: "open",
            }),
          ]);

          const pendingPRs = pullRequests
            .filter((pullRequest) =>
              (pullRequest.head?.ref ?? "").startsWith("upload/"),
            )
            .sort((left, right) => (right.number ?? 0) - (left.number ?? 0));

          return {
            repo: normalizeWorkspaceRepoSummary(repo),
            latestTag,
            pendingPRs,
            error: null,
          };
        } catch (err) {
          return {
            repo: normalizeWorkspaceRepoSummary(repo),
            latestTag: null,
            pendingPRs: [] as PullRequestWithApprovalState[],
            error:
              err instanceof Error
                ? err.message
                : "Unable to load document details.",
          };
        }
      }),
    );

    return json(200, { documents }, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load workspace documents.",
    );
  }
}

async function handleCreateDocument(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { session, client } = auth;
  const form = await readMultipartBody(req);
  if (!form) {
    return json(
      400,
      { error: "Multipart form data is required." },
      baseHeaders,
    );
  }

  const file = parseOptionalFile(form.get("file"));
  const repoName = parseOptionalString(form.get("repoName"));
  const description = parseOptionalString(form.get("description")) || undefined;
  const requiredApprovals = parseNonNegativeIntInput(
    parseOptionalString(form.get("requiredApprovals")) || null,
    1,
  );
  const nextVersion = parsePositiveIntInput(
    parseOptionalString(form.get("nextVersion")) || null,
    1,
  );

  if (!file || !repoName) {
    return json(400, { error: "file and repoName are required." }, baseHeaders);
  }

  const validation = validateUploadFile(file);
  if (!validation.valid) {
    return json(
      400,
      { error: validation.reason ?? "Invalid file." },
      baseHeaders,
    );
  }

  try {
    const exists = await repoExists(client, session.username, repoName);
    if (exists) {
      return json(
        409,
        { error: `A document named "${repoName}" already exists.` },
        baseHeaders,
      );
    }

    const createdRepo = await createPrivateCurrentUserRepo({
      client,
      name: repoName,
      description,
    });
    const normalizedRepo = normalizeWorkspaceRepoSummary(createdRepo);
    const owner = normalizedRepo.owner.login || session.username;
    const extension = getFileExtension(file.name);
    const canonicalFile = buildCanonicalDocumentFileName(extension);

    const fullHash = await computeFileHash(file);
    const contentHash8 = fullHash.slice(0, 8);
    const base64Content = await readFileAsBase64(file);
    const branchName = buildUploadBranchName(repoName, owner, contentHash8);

    await bootstrapEmptyMainBranch({
      client,
      owner,
      repo: repoName,
    });

    await createMainBranchProtection({
      client,
      owner,
      repo: repoName,
      requiredApprovals,
    });

    await createUploadBranch({
      client,
      owner,
      repo: repoName,
      branchName,
      from: "main",
    });

    const commitMessage = buildUploadCommitMessage({
      docSlug: repoName,
      canonicalFile,
      sourceFilename: file.name,
      uploadBranch: branchName,
      uploaderSlug: owner,
      fileHashSha256: fullHash,
    });

    const { sha: commitSha } = await commitBinaryFile({
      client,
      owner,
      repo: repoName,
      branch: branchName,
      filePath: canonicalFile,
      base64Content,
      message: commitMessage,
    });

    const prTitle = `Upload v${nextVersion}: ${repoName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")}`;
    const prBody = [
      "Automated upload from Bindersnap file vault.",
      "",
      `Source file: ${file.name}`,
      `Document: ${repoName}`,
      `Uploaded by: ${owner}`,
      `File hash (SHA-256): ${fullHash}`,
    ].join("\n");

    const pr = await createPullRequest({
      client,
      owner,
      repo: repoName,
      title: prTitle,
      head: branchName,
      base: "main",
      body: prBody,
    });

    return json(
      201,
      {
        repository: normalizedRepo,
        owner,
        repo: repoName,
        canonicalFile,
        prNumber: pr.number ?? 0,
        prTitle,
        branchName,
        commitSha,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to create the document.",
    );
  }
}

async function handleDocumentDetail(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client, session } = auth;

  try {
    const repository = normalizeWorkspaceRepoSummary(
      (await unwrap(
        client.GET("/repos/{owner}/{repo}", {
          params: { path: { owner, repo } },
        }),
      )) as {
        id?: number;
        name?: string;
        full_name?: string;
        description?: string;
        updated_at?: string;
        owner?: { login?: string };
      },
    );

    const [tags, openPullRequests, branchProtection] = await Promise.all([
      listDocTags(client, owner, repo),
      listPullRequests({
        client,
        owner,
        repo,
        state: "open",
      }),
      getRepoBranchProtection(client, owner, repo, "main").catch(() => null),
    ]);

    const latestTag = tags[0] ?? null;
    const uploadPullRequests = openPullRequests
      .filter((pullRequest) =>
        (pullRequest.head?.ref ?? "").startsWith("upload/"),
      )
      .sort((left, right) => (right.number ?? 0) - (left.number ?? 0));

    let canonicalFile = await resolveCanonicalFileInfo(
      client,
      owner,
      repo,
    ).catch(() => null);
    if (!canonicalFile) {
      const fallbackRef = await resolveLatestUploadRef(client, owner, repo);
      if (fallbackRef) {
        canonicalFile =
          (await resolveCanonicalFileInfo(
            client,
            owner,
            repo,
            fallbackRef,
          ).catch(() => null)) ?? null;
      }
    }

    const currentUserPermission = await resolveCurrentUserPermission(
      client,
      owner,
      repo,
      session.username,
    ).catch(() => null);

    return json(
      200,
      {
        repository,
        tags,
        latestTag,
        openPullRequests,
        uploadPullRequests,
        branchProtection,
        canonicalFile,
        currentUserPermission,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load document details.",
    );
  }
}

async function handleDocumentVersions(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client, session } = auth;
  const form = await readMultipartBody(req);
  if (!form) {
    return json(
      400,
      { error: "Multipart form data is required." },
      baseHeaders,
    );
  }

  const file = parseOptionalFile(form.get("file"));
  const docSlug = parseOptionalString(form.get("docSlug")) || repo;
  const uploaderSlug =
    parseOptionalString(form.get("uploaderSlug")) || session.username;
  const nextVersionRaw = parseOptionalString(form.get("nextVersion"));
  const canonicalFileName = parseOptionalString(form.get("canonicalFileName"));

  if (!file || !docSlug || !uploaderSlug || nextVersionRaw === "") {
    return json(
      400,
      {
        error: "file, docSlug, uploaderSlug, and nextVersion are required.",
      },
      baseHeaders,
    );
  }

  const nextVersion = parsePositiveIntInput(nextVersionRaw, 0);
  if (nextVersion <= 0) {
    return json(
      400,
      { error: "nextVersion must be a positive integer." },
      baseHeaders,
    );
  }

  const validation = validateUploadFile(file);
  if (!validation.valid) {
    return json(
      400,
      { error: validation.reason ?? "Invalid file." },
      baseHeaders,
    );
  }

  try {
    const fullHash = await computeFileHash(file);
    const contentHash8 = fullHash.slice(0, 8);
    const base64Content = await readFileAsBase64(file);
    const branchName = buildUploadBranchName(
      docSlug,
      uploaderSlug,
      contentHash8,
    );
    const extension = getFileExtension(file.name);
    const canonicalFile =
      canonicalFileName || `${docSlug}${extension ? `.${extension}` : ""}`;

    await createUploadBranch({
      client,
      owner,
      repo,
      branchName,
      from: "main",
    });

    const commitMessage = buildUploadCommitMessage({
      docSlug,
      canonicalFile,
      sourceFilename: file.name,
      uploadBranch: branchName,
      uploaderSlug,
      fileHashSha256: fullHash,
    });

    const { sha: commitSha } = await commitBinaryFile({
      client,
      owner,
      repo,
      branch: branchName,
      filePath: canonicalFile,
      base64Content,
      message: commitMessage,
    });

    const prTitle = `Upload v${nextVersion}: ${docSlug
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")}`;
    const prBody = [
      "Automated upload from Bindersnap file vault.",
      "",
      `Source file: ${file.name}`,
      `Document: ${docSlug}`,
      `Uploaded by: ${uploaderSlug}`,
      `File hash (SHA-256): ${fullHash}`,
    ].join("\n");

    const pr = await createPullRequest({
      client,
      owner,
      repo,
      title: prTitle,
      head: branchName,
      base: "main",
      body: prBody,
    });

    return json(
      201,
      {
        owner,
        repo,
        canonicalFile,
        prNumber: pr.number ?? 0,
        prTitle,
        branchName,
        commitSha,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to upload the new version.",
    );
  }
}

async function handleDocumentReview(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;
  const payload = (await readJsonBody(req)) ?? null;
  const form = payload ? null : await readMultipartBody(req);
  const eventRaw = readInputString(payload, form, "event").toUpperCase();
  const bodyText = readInputString(payload, form, "body");
  const event =
    eventRaw === "APPROVE" ||
    eventRaw === "REQUEST_CHANGES" ||
    eventRaw === "COMMENT"
      ? eventRaw
      : "";

  if (!event) {
    return json(
      400,
      {
        error: "event must be APPROVE, REQUEST_CHANGES, or COMMENT.",
      },
      baseHeaders,
    );
  }

  const reviewBody = event === "APPROVE" ? bodyText || "APPROVED" : bodyText;
  if ((event === "REQUEST_CHANGES" || event === "COMMENT") && !reviewBody) {
    return json(
      400,
      { error: "body is required for REQUEST_CHANGES and COMMENT reviews." },
      baseHeaders,
    );
  }

  try {
    const review = await submitReview({
      client,
      owner,
      repo,
      pullNumber: prNumber,
      event,
      body: reviewBody,
    });

    return json(200, { review }, baseHeaders);
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to submit review.");
  }
}

async function handleDocumentPublish(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;
  const payload = (await readJsonBody(req)) ?? null;
  const form = payload ? null : await readMultipartBody(req);
  const mergeStyleRaw = readInputString(
    payload,
    form,
    "mergeStyle",
  ).toLowerCase();
  const mergeStyle =
    mergeStyleRaw === "squash" || mergeStyleRaw === "rebase"
      ? (mergeStyleRaw as "squash" | "rebase")
      : "merge";
  const nextVersionRaw = readInputNumber(payload, form, "nextVersion");
  const latestTag = await getLatestDocTag(client, owner, repo).catch(
    () => null,
  );
  const nextVersion = parsePositiveIntInput(
    nextVersionRaw || null,
    (latestTag?.version ?? 0) + 1,
  );

  try {
    await mergeOrResolveConflicts({
      client,
      owner,
      repo,
      pullNumber: prNumber,
      mergeStyle,
    });

    const tag = await createDocTag({
      client,
      owner,
      repo,
      version: nextVersion,
      target: "main",
    });

    return json(200, { ok: true, tag }, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to publish the document.",
    );
  }
}

async function handleDocumentDownload(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { session, client } = auth;
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref")?.trim() || "main";

  try {
    let canonicalFile = await resolveCanonicalFileInfo(
      client,
      owner,
      repo,
      ref,
    ).catch(() => null);
    if (!canonicalFile && ref === "main") {
      const fallbackRef = await resolveLatestUploadRef(client, owner, repo);
      if (fallbackRef) {
        canonicalFile =
          (await resolveCanonicalFileInfo(
            client,
            owner,
            repo,
            fallbackRef,
          ).catch(() => null)) ?? null;
      }
    }

    if (!canonicalFile) {
      return json(
        404,
        { error: "Unable to determine the document file for this version." },
        baseHeaders,
      );
    }

    const response = await giteaFetch(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodeURIComponent(canonicalFile.storedFileName)}?ref=${encodeURIComponent(ref)}`,
      {
        method: "GET",
        headers: {
          Authorization: buildTokenAuthHeader(session.giteaToken),
          Accept: "*/*",
        },
      },
    );

    if (!response.ok) {
      return json(
        response.status,
        {
          error: await readGiteaErrorMessage(
            response,
            "Unable to download document.",
          ),
        },
        baseHeaders,
      );
    }

    return new Response(response.body, {
      status: response.status,
      headers: downloadHeaders(baseHeaders, response),
    });
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to download document.");
  }
}

async function handleDocumentCollaborators(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client, session } = auth;
  const url = new URL(req.url);
  const page = parsePositiveIntInput(url.searchParams.get("page"), 1);
  const limit = parsePositiveIntInput(url.searchParams.get("limit"), 12);

  try {
    const result = await listRepoCollaborators({
      client,
      owner,
      repo,
      page,
      limit,
    });

    const currentUserPermission = await resolveCurrentUserPermission(
      client,
      owner,
      repo,
      session.username,
    ).catch(() => null);

    return json(
      200,
      {
        ...result,
        currentUserPermission,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to load collaborators.");
  }
}

async function handleSearchUsersRoute(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;
  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const page = parsePositiveIntInput(url.searchParams.get("page"), 1);
  const limit = parsePositiveIntInput(url.searchParams.get("limit"), 8);

  if (!query) {
    return json(400, { error: "q is required." }, baseHeaders);
  }

  try {
    const result = await searchUsers({
      client,
      query,
      page,
      limit,
    });

    return json(200, result, baseHeaders);
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to search users.");
  }
}

async function handleAddCollaborator(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  login: string,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;
  const payload = (await readJsonBody(req)) ?? null;
  const form = payload ? null : await readMultipartBody(req);
  const permissionRaw = readInputString(
    payload,
    form,
    "permission",
  ).toLowerCase();
  const permission =
    permissionRaw === "read" ||
    permissionRaw === "write" ||
    permissionRaw === "admin"
      ? permissionRaw
      : "write";

  try {
    await addRepoCollaborator({
      client,
      owner,
      repo,
      collaborator: login,
      permission,
    });

    const collaborator = await getRepoCollaboratorPermission({
      client,
      owner,
      repo,
      collaborator: login,
    }).catch(() => ({
      permission,
      access: toRepoCollaboratorRole(permission),
      permissionLabel:
        permission === "read"
          ? "Read"
          : permission === "admin"
            ? "Admin"
            : "Write",
      roleName: permission,
      user: {
        id: 0,
        login,
        full_name: "",
        email: "",
        avatar_url: "",
      },
    }));

    return json(200, { collaborator }, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to update collaborator access.",
    );
  }
}

async function handleDeleteCollaborator(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  login: string,
): Promise<Response> {
  const auth = requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;

  try {
    await removeRepoCollaborator({
      client,
      owner,
      repo,
      collaborator: login,
    });

    return json(200, { ok: true }, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to remove collaborator.",
    );
  }
}

async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  const expired = sessionStore.reap(now);

  if (expired.length > 0) {
    await Promise.allSettled(
      expired.map((session) => revokeUserToken(session)),
    );
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

    if (pathname === "/api/app/documents" && req.method === "POST") {
      return handleCreateDocument(req, baseHeaders);
    }

    if (pathname === "/api/app/users/search" && req.method === "GET") {
      return handleSearchUsersRoute(req, baseHeaders);
    }

    const reviewMatch = pathname.match(
      /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/reviews$/,
    );
    if (reviewMatch && req.method === "POST") {
      return handleDocumentReview(
        req,
        baseHeaders,
        decodePathParam(reviewMatch[1] ?? ""),
        decodePathParam(reviewMatch[2] ?? ""),
        Number.parseInt(reviewMatch[3] ?? "", 10),
      );
    }

    const publishMatch = pathname.match(
      /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/publish$/,
    );
    if (publishMatch && req.method === "POST") {
      return handleDocumentPublish(
        req,
        baseHeaders,
        decodePathParam(publishMatch[1] ?? ""),
        decodePathParam(publishMatch[2] ?? ""),
        Number.parseInt(publishMatch[3] ?? "", 10),
      );
    }

    const downloadMatch = pathname.match(
      /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/download$/,
    );
    if (downloadMatch && req.method === "GET") {
      return handleDocumentDownload(
        req,
        baseHeaders,
        decodePathParam(downloadMatch[1] ?? ""),
        decodePathParam(downloadMatch[2] ?? ""),
      );
    }

    const versionsMatch = pathname.match(
      /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/versions$/,
    );
    if (versionsMatch && req.method === "POST") {
      return handleDocumentVersions(
        req,
        baseHeaders,
        decodePathParam(versionsMatch[1] ?? ""),
        decodePathParam(versionsMatch[2] ?? ""),
      );
    }

    const collaboratorsActionMatch = pathname.match(
      /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)$/,
    );
    if (collaboratorsActionMatch && req.method === "PUT") {
      return handleAddCollaborator(
        req,
        baseHeaders,
        decodePathParam(collaboratorsActionMatch[1] ?? ""),
        decodePathParam(collaboratorsActionMatch[2] ?? ""),
        decodePathParam(collaboratorsActionMatch[3] ?? ""),
      );
    }
    if (collaboratorsActionMatch && req.method === "DELETE") {
      return handleDeleteCollaborator(
        req,
        baseHeaders,
        decodePathParam(collaboratorsActionMatch[1] ?? ""),
        decodePathParam(collaboratorsActionMatch[2] ?? ""),
        decodePathParam(collaboratorsActionMatch[3] ?? ""),
      );
    }

    const collaboratorsMatch = pathname.match(
      /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/collaborators$/,
    );
    if (collaboratorsMatch && req.method === "GET") {
      return handleDocumentCollaborators(
        req,
        baseHeaders,
        decodePathParam(collaboratorsMatch[1] ?? ""),
        decodePathParam(collaboratorsMatch[2] ?? ""),
      );
    }

    const documentMatch = pathname.match(
      /^\/api\/app\/documents\/([^/]+)\/([^/]+)$/,
    );
    if (documentMatch && req.method === "GET") {
      return handleDocumentDetail(
        req,
        baseHeaders,
        decodePathParam(documentMatch[1] ?? ""),
        decodePathParam(documentMatch[2] ?? ""),
      );
    }

    return json(404, { error: "Not found." }, baseHeaders);
  },
});

console.log(`Bindersnap API listening on http://localhost:${server.port}`);
