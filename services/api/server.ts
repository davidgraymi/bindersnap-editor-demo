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

const DOCUMENTS_DIRECTORY = "documents";
const DOCUMENTS_ROUTE_PREFIX = "/api/app/documents";
const DOCUMENTS_VERSIONS_ROUTE_SUFFIX = "/versions";
const UPLOAD_BRANCH_PREFIX = "bindersnap/upload";
const GITEA_REPOS_PAGE_LIMIT = 100;
const GITEA_PULLS_PAGE_LIMIT = 100;
const GITEA_COMMENTS_PAGE_LIMIT = 100;
const DEFAULT_UPLOAD_ALLOWED_EXTENSIONS =
  ".json,.txt,.md,.csv,.doc,.docx,.pdf,.xls,.xlsx,.ppt,.pptx";
const uploadAllowedExtensions = new Set(
  (process.env.BINDERSNAP_UPLOAD_ALLOWED_EXTENSIONS ?? DEFAULT_UPLOAD_ALLOWED_EXTENSIONS)
    .split(",")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.startsWith(".")),
);
const uploadMaxBytes = parsePositiveInt(
  process.env.BINDERSNAP_UPLOAD_MAX_BYTES,
  25 * 1024 * 1024,
);

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

interface GiteaUserSummary {
  login?: string;
  full_name?: string;
}

interface GiteaRepoSummary {
  id?: number;
  name?: string;
  full_name?: string;
  default_branch?: string;
  owner?: GiteaUserSummary;
}

interface GiteaContentSummary {
  name?: string;
  path?: string;
  type?: string;
}

interface GiteaPullSummary {
  number?: number;
  title?: string;
  body?: string;
  state?: string;
  head?: { ref?: string };
  updated_at?: string;
  created_at?: string;
  merged?: boolean;
  merged_at?: string;
  html_url?: string;
}

interface GiteaPullReviewSummary {
  state?: string;
  body?: string;
  user?: { login?: string };
  submitted_at?: string;
  created_at?: string;
  updated_at?: string;
}

interface GiteaPullFileSummary {
  filename?: string;
}

interface GiteaBranchSummary {
  name?: string;
  commit?: {
    id?: string;
    sha?: string;
  };
}

interface GiteaContentFileResponse {
  sha?: string;
  content?: string;
  encoding?: string;
}

interface DocumentVersionMetadata extends CommitSummary {}

export interface DocumentCatalogItem {
  id: string;
  title: string;
  displayName: string;
  path: string;
  repository: string;
  publishedVersion: DocumentVersionMetadata | null;
  currentPublishedVersion: DocumentVersionMetadata | null;
  latestPendingVersionStatus: CatalogApprovalState | null;
  latestPendingPullRequest: CatalogPendingPullRequest | null;
  latestCommit: CommitSummary | null;
  lastActivityTimestamp: string;
  lastActivityAt: string;
}

export interface CatalogPayload {
  repository: string;
  documents: DocumentCatalogItem[];
}

export interface CatalogPendingPullRequest {
  number: number;
  title: string;
  state: CatalogApprovalState;
  branch: string;
  updatedAt: string;
  htmlUrl: string | null;
}

export interface DocumentUploadResult {
  documentId: string;
  branchName: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string | null;
  approvalState: CatalogApprovalState;
}

export type CatalogApprovalState =
  | "none"
  | "working"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "published";

interface GiteaApiErrorBody {
  error: {
    code: string;
    message: string;
  };
  message: string;
}

interface WorkspaceRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
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

function buildGiteaHeaders(token: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Authorization", buildTokenAuthHeader(token));
  headers.set("Accept", "application/json");
  return headers;
}

class CatalogError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

function createCatalogError(status: number, code: string, message: string): CatalogError {
  return new CatalogError(status, code, message);
}

function normalizeCatalogError(error: unknown): CatalogError {
  if (error instanceof CatalogError) {
    return error;
  }

  if (error instanceof Error) {
    return createCatalogError(
      502,
      "upstream_error",
      error.message || "Unable to load workspace documents.",
    );
  }

  return createCatalogError(502, "upstream_error", "Unable to load workspace documents.");
}

function catalogErrorResponse(error: unknown, baseHeaders: Headers): Response {
  const normalized = normalizeCatalogError(error);
  return json(
    normalized.status,
    {
      error: {
        code: normalized.code,
        message: normalized.message,
      },
      message: normalized.message,
    },
    baseHeaders,
  );
}

function upstreamStatusToCatalogError(
  status: number,
  fallbackCode: string,
  fallbackMessage: string,
): CatalogError {
  if (status === 401) {
    return createCatalogError(401, "unauthorized", "Unauthorized.");
  }

  if (status === 403) {
    return createCatalogError(403, "forbidden", "Forbidden.");
  }

  if (status === 404) {
    return createCatalogError(404, fallbackCode, fallbackMessage);
  }

  return createCatalogError(502, "upstream_error", fallbackMessage);
}

async function giteaJson<T>(
  token: string,
  path: string,
  init?: RequestInit,
  fallbackMessage = "Unable to load workspace documents.",
): Promise<T> {
  const response = await giteaFetch(path, {
    ...init,
    headers: buildGiteaHeaders(token, init?.headers),
  });

  if (!response.ok) {
    throw upstreamStatusToCatalogError(response.status, "upstream_error", fallbackMessage);
  }

  return (await response.json()) as T;
}

async function giteaJsonMaybe<T>(
  token: string,
  path: string,
  init?: RequestInit,
  fallbackMessage = "Unable to load workspace documents.",
): Promise<T | null> {
  const response = await giteaFetch(path, {
    ...init,
    headers: buildGiteaHeaders(token, init?.headers),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw upstreamStatusToCatalogError(response.status, "upstream_error", fallbackMessage);
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as T;
}

function isGiteaRepoSummary(value: unknown): value is GiteaRepoSummary {
  return typeof value === "object" && value !== null;
}

function sanitizeBranchName(name: string): string {
  return name.trim();
}

function stableDocumentId(path: string): string {
  return path;
}

function humanizeDocumentTitleFromPath(path: string): string {
  const fileName = path.split("/").pop() ?? path;
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return withoutExtension
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s-])\w/g, (match) => match.toUpperCase()) || fileName;
}

function isDocumentJsonLike(value: unknown): value is { type?: unknown; content?: unknown } {
  return typeof value === "object" && value !== null;
}

function readDocumentDisplayName(rawContent: string, fallbackPath: string): string {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    if (!isDocumentJsonLike(parsed)) {
      return humanizeDocumentTitleFromPath(fallbackPath);
    }

    const content = parsed.content;
    if (!Array.isArray(content)) {
      return humanizeDocumentTitleFromPath(fallbackPath);
    }

    for (const node of content) {
      if (typeof node !== "object" || node === null) {
        continue;
      }

      const candidate = node as {
        type?: unknown;
        content?: unknown;
        attrs?: { level?: unknown };
      };

      if (
        candidate.type === "heading" &&
        candidate.attrs?.level === 1 &&
        Array.isArray(candidate.content)
      ) {
        const headingText = candidate.content
          .map((part) => {
            if (typeof part !== "object" || part === null) {
              return "";
            }
            return typeof (part as { text?: unknown }).text === "string"
              ? (part as { text: string }).text
              : "";
          })
          .join("")
          .trim();

        if (headingText) {
          return headingText;
        }
      }
    }
  } catch {
    return humanizeDocumentTitleFromPath(fallbackPath);
  }

  return humanizeDocumentTitleFromPath(fallbackPath);
}

function readDocumentTitle(rawContent: string, fallbackPath: string): string {
  return readDocumentDisplayName(rawContent, fallbackPath);
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxTimestamp(...values: Array<string | undefined>): string {
  let winner = "";
  let winnerValue = 0;

  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (parsed > winnerValue) {
      winner = value ?? "";
      winnerValue = parsed;
    }
  }

  return winner;
}

function toCatalogApprovalStateFromReview(review: GiteaPullReviewSummary): CatalogApprovalState | null {
  const state = review.state?.toUpperCase();

  if (state === "REQUEST_CHANGES" || state === "CHANGES_REQUESTED") {
    return "changes_requested";
  }

  if (state === "APPROVED") {
    return "approved";
  }

  return null;
}

function isMergedPullRequest(pullRequest: GiteaPullSummary): boolean {
  return pullRequest.merged === true || Boolean(pullRequest.merged_at);
}

function resolvePullRequestState(
  pullRequest: GiteaPullSummary,
  reviews: GiteaPullReviewSummary[],
): CatalogApprovalState {
  if (isMergedPullRequest(pullRequest)) {
    return "published";
  }

  const reviewStates = reviews.map(toCatalogApprovalStateFromReview);
  if (reviewStates.includes("changes_requested")) {
    return "changes_requested";
  }

  if (reviewStates.includes("approved")) {
    return "approved";
  }

  return pullRequest.state === "open" ? "in_review" : "working";
}

function pullRequestRank(pullRequest: GiteaPullSummary): number {
  const updatedAt = parseTimestamp(pullRequest.updated_at);
  const createdAt = parseTimestamp(pullRequest.created_at);
  return Math.max(updatedAt, createdAt, pullRequest.number ?? 0);
}

function selectLatestPullRequestForPath(
  pullRequests: Array<{ pullRequest: GiteaPullSummary; reviews: GiteaPullReviewSummary[]; files: string[] }>,
  filePath: string,
): { pullRequest: GiteaPullSummary; reviews: GiteaPullReviewSummary[]; state: CatalogApprovalState } | null {
  const candidates = pullRequests.filter(({ files }) => files.includes(filePath));
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => pullRequestRank(right.pullRequest) - pullRequestRank(left.pullRequest));
  const latest = candidates[0];
  if (!latest) {
    return null;
  }

  return {
    pullRequest: latest.pullRequest,
    reviews: latest.reviews,
    state: resolvePullRequestState(latest.pullRequest, latest.reviews),
  };
}

function extractPullRequestActivityTimestamp(
  pullRequest: GiteaPullSummary,
  reviews: GiteaPullReviewSummary[],
): string {
  const reviewTimes = reviews.map((review) => review.submitted_at ?? review.updated_at ?? review.created_at);
  return maxTimestamp(pullRequest.updated_at, pullRequest.created_at, ...reviewTimes);
}

async function readGiteaContentList(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<GiteaContentSummary[] | null> {
  const response = await giteaFetch(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    {
      method: "GET",
      headers: buildGiteaHeaders(token),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw upstreamStatusToCatalogError(
      response.status,
      "workspace_unavailable",
      "Unable to load workspace documents.",
    );
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload as GiteaContentSummary[];
  }

  if (isGiteaRepoSummary(payload)) {
    return [payload as GiteaContentSummary];
  }

  return [];
}

async function readDocumentFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string> {
  const response = await giteaFetch(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    {
      method: "GET",
      headers: buildGiteaHeaders(token),
    },
  );

  if (!response.ok) {
    throw upstreamStatusToCatalogError(response.status, "document_not_found", "Document not found.");
  }

  const payload = (await response.json()) as { content?: string; encoding?: string } | string;
  if (typeof payload === "string") {
    return payload;
  }

  const encoded = typeof payload.content === "string" ? payload.content : "";
  return Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8");
}

async function listAccessibleRepositories(token: string): Promise<WorkspaceRepository[]> {
  const repositories: WorkspaceRepository[] = [];

  for (let page = 1; page < 100; page += 1) {
    const payload = await giteaJson<GiteaRepoSummary[]>(
      token,
      `/api/v1/user/repos?limit=${GITEA_REPOS_PAGE_LIMIT}&page=${page}`,
      undefined,
      "Unable to load workspace repositories.",
    );

    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }

    for (const candidate of payload) {
      const owner = candidate.owner?.login?.trim();
      const name = candidate.name?.trim();
      const fullName = candidate.full_name?.trim();
      const defaultBranch = sanitizeBranchName(candidate.default_branch ?? "main") || "main";
      if (!owner || !name || !fullName) {
        continue;
      }

      repositories.push({
        id: typeof candidate.id === "number" ? candidate.id : repositories.length + 1,
        owner,
        name,
        fullName,
        defaultBranch,
      });
    }

    if (payload.length < GITEA_REPOS_PAGE_LIMIT) {
      break;
    }
  }

  return repositories;
}

async function listRepoPullRequests(
  token: string,
  owner: string,
  repo: string,
): Promise<GiteaPullSummary[]> {
  const pulls: GiteaPullSummary[] = [];

  for (let page = 1; page < 100; page += 1) {
    const payload = await giteaJson<GiteaPullSummary[]>(
      token,
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&limit=${GITEA_PULLS_PAGE_LIMIT}&page=${page}`,
      undefined,
      "Unable to load workspace pull requests.",
    );

    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }

    pulls.push(...payload);
    if (payload.length < GITEA_PULLS_PAGE_LIMIT) {
      break;
    }
  }

  return pulls;
}

async function listPullRequestFiles(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<string[]> {
  const filenames: string[] = [];

  for (let page = 1; page < 100; page += 1) {
    const payload = await giteaJson<GiteaPullFileSummary[]>(
      token,
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files?limit=${GITEA_PULLS_PAGE_LIMIT}&page=${page}`,
      undefined,
      "Unable to load pull request files.",
    );

    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }

    for (const file of payload) {
      if (typeof file.filename === "string" && file.filename.trim() !== "") {
        filenames.push(file.filename.trim());
      }
    }

    if (payload.length < GITEA_PULLS_PAGE_LIMIT) {
      break;
    }
  }

  return filenames;
}

async function listPullRequestReviews(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<GiteaPullReviewSummary[]> {
  const reviews: GiteaPullReviewSummary[] = [];

  for (let page = 1; page < 100; page += 1) {
    const payload = await giteaJson<GiteaPullReviewSummary[]>(
      token,
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reviews?limit=${GITEA_COMMENTS_PAGE_LIMIT}&page=${page}`,
      undefined,
      "Unable to load pull request reviews.",
    );

    if (!Array.isArray(payload) || payload.length === 0) {
      break;
    }

    reviews.push(...payload);
    if (payload.length < GITEA_COMMENTS_PAGE_LIMIT) {
      break;
    }
  }

  return reviews;
}

async function listDocumentFiles(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  currentPath = DOCUMENTS_DIRECTORY,
): Promise<string[]> {
  const entries = await readGiteaContentList(token, owner, repo, currentPath, ref);
  if (entries === null) {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = entry.path?.trim();
    const entryType = entry.type?.trim();
    if (!entryPath) {
      continue;
    }

    if (entryType === "dir") {
      const nested = await listDocumentFiles(token, owner, repo, ref, entryPath);
      files.push(...nested);
      continue;
    }

    if (entryType === "file" || !entryType) {
      files.push(entryPath);
    }
  }

  return files;
}

async function readCommitSummary(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<CommitSummary | null> {
  const payload = await giteaJson<GiteaPullSummary[]>(
    token,
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(ref)}&limit=1`,
    undefined,
    "Unable to load document history.",
  ).catch((error) => {
    if (error instanceof CatalogError && error.status === 404) {
      return [] as GiteaPullSummary[];
    }
    throw error;
  });

  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const commit = payload[0] as unknown as {
    sha?: string;
    commit?: { message?: string; author?: { name?: string; date?: string } };
    author?: { full_name?: string; login?: string };
    created?: string;
  };

  return {
    sha: commit.sha ?? "",
    message: commit.commit?.message ?? "",
    author: commit.commit?.author?.name ?? commit.author?.full_name ?? commit.author?.login ?? "Unknown",
    timestamp: commit.commit?.author?.date ?? commit.created ?? "",
  };
}

async function selectWorkspaceRepository(session: SessionRecord): Promise<WorkspaceRepository> {
  const repositories = await listAccessibleRepositories(session.giteaToken);
  if (repositories.length === 0) {
    throw createCatalogError(404, "workspace_not_found", "No accessible repositories were found for this session.");
  }

  const owned = repositories.filter((repository) => repository.owner === session.username);
  const ordered = [...owned, ...repositories.filter((repository) => repository.owner !== session.username)];

  for (const repository of ordered) {
    const documents = await readGiteaContentList(
      session.giteaToken,
      repository.owner,
      repository.name,
      DOCUMENTS_DIRECTORY,
      repository.defaultBranch,
    );

    if (documents !== null) {
      return repository;
    }
  }

  return ordered[0] ?? repositories[0];
}

async function loadWorkspaceDocumentCatalog(
  session: SessionRecord,
  repository: WorkspaceRepository,
): Promise<CatalogPayload> {
  const documentPaths = await listDocumentFiles(
    session.giteaToken,
    repository.owner,
    repository.name,
    repository.defaultBranch,
  );

  if (documentPaths.length === 0) {
    return {
      repository: repository.fullName,
      documents: [],
    };
  }

  const pullRequests = await listRepoPullRequests(session.giteaToken, repository.owner, repository.name);
  const pullRequestDetails = await Promise.all(
    pullRequests.map(async (pullRequest) => {
      const number = pullRequest.number;
      if (!number) {
        return null;
      }

      const [reviews, files] = await Promise.all([
        listPullRequestReviews(session.giteaToken, repository.owner, repository.name, number),
        listPullRequestFiles(session.giteaToken, repository.owner, repository.name, number),
      ]);

      return {
        pullRequest,
        reviews,
        files,
      };
    }),
  );

  const normalizedPullRequests = pullRequestDetails.filter(
    (item): item is { pullRequest: GiteaPullSummary; reviews: GiteaPullReviewSummary[]; files: string[] } =>
      item !== null,
  );

  const documents = await Promise.all(
    documentPaths.map(async (filePath) => {
      const [commit, rawContent] = await Promise.all([
        readCommitSummary(
          session.giteaToken,
          repository.owner,
          repository.name,
          filePath,
          repository.defaultBranch,
        ),
        readDocumentFile(
          session.giteaToken,
          repository.owner,
          repository.name,
          filePath,
          repository.defaultBranch,
        ),
      ]);

      const matchedPullRequest = selectLatestPullRequestForPath(normalizedPullRequests, filePath);
      const latestPendingPullRequest = matchedPullRequest
        ? {
            number: matchedPullRequest.pullRequest.number ?? 0,
            title: matchedPullRequest.pullRequest.title ?? "",
            state: matchedPullRequest.state,
            branch: matchedPullRequest.pullRequest.head?.ref ?? "",
            updatedAt: extractPullRequestActivityTimestamp(
              matchedPullRequest.pullRequest,
              matchedPullRequest.reviews,
            ),
            htmlUrl: matchedPullRequest.pullRequest.html_url ?? null,
          }
        : null;

      const publishedVersion = commit
        ? {
            ...commit,
          }
        : null;

      const latestPendingVersionStatus = latestPendingPullRequest?.state ?? null;
      const lastActivityTimestamp = maxTimestamp(
        commit?.timestamp,
        latestPendingPullRequest?.updatedAt,
      );
      const displayName = readDocumentTitle(rawContent, filePath);

      return {
        id: stableDocumentId(filePath),
        title: displayName,
        displayName,
        path: filePath,
        repository: repository.fullName,
        publishedVersion,
        currentPublishedVersion: publishedVersion,
        latestPendingVersionStatus,
        latestPendingPullRequest,
        latestCommit: commit,
        lastActivityTimestamp,
        lastActivityAt: lastActivityTimestamp,
      } satisfies DocumentCatalogItem;
    }),
  );

  documents.sort((left, right) => {
    const rightValue = parseTimestamp(right.lastActivityTimestamp || right.lastActivityAt);
    const leftValue = parseTimestamp(left.lastActivityTimestamp || left.lastActivityAt);
    return rightValue - leftValue;
  });

  return {
    repository: repository.fullName,
    documents,
  };
}

async function loadWorkspaceCatalog(session: SessionRecord): Promise<{
  repository: WorkspaceRepository;
  catalog: CatalogPayload;
}> {
  const repository = await selectWorkspaceRepository(session);
  const catalog = await loadWorkspaceDocumentCatalog(session, repository);

  return { repository, catalog };
}

export async function loadDocumentCatalog(session: SessionRecord): Promise<CatalogPayload> {
  const { catalog } = await loadWorkspaceCatalog(session);
  return catalog;
}

export async function loadDocumentCatalogItem(session: SessionRecord, documentId: string): Promise<{ repository: string; document: DocumentCatalogItem }> {
  const { catalog } = await loadWorkspaceCatalog(session);
  const document = catalog.documents.find((item) => item.id === documentId);
  if (!document) {
    throw createCatalogError(404, "document_not_found", "Document not found.");
  }

  return {
    repository: catalog.repository,
    document,
  };
}

function sanitizeBranchSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function extractLowercaseExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(lastDot).toLowerCase();
}

function isAllowedUploadFile(file: File): boolean {
  const extension = extractLowercaseExtension(file.name);
  if (!extension) {
    return false;
  }
  return uploadAllowedExtensions.has(extension);
}

function buildUploadBranchName(baseBranch: string, documentId: string): string {
  const safeBaseBranch = sanitizeBranchSegment(baseBranch) || "main";
  const safeDocumentId = sanitizeBranchSegment(documentId) || "document";
  return `${UPLOAD_BRANCH_PREFIX}/${safeBaseBranch}/${safeDocumentId}`;
}

function buildUploadCommitMessage(params: {
  document: DocumentCatalogItem;
  branchName: string;
  fileName: string;
  summary: string;
  sourceNote: string;
}): string {
  const lines = [
    `Upload new version for ${params.document.displayName}`,
    "",
    `Document: ${params.document.id}`,
    `Branch: ${params.branchName}`,
    `Uploaded file: ${params.fileName}`,
    `Summary: ${params.summary || "None provided"}`,
    `Source note: ${params.sourceNote || "None provided"}`,
  ];

  return lines.join("\n");
}

function buildUploadPullRequestTitle(params: {
  document: DocumentCatalogItem;
  fileName: string;
}): string {
  return `Upload review: ${params.document.displayName} (${params.fileName})`;
}

function buildUploadPullRequestBody(params: {
  document: DocumentCatalogItem;
  repository: WorkspaceRepository;
  branchName: string;
  fileName: string;
  summary: string;
  sourceNote: string;
}): string {
  const lines = [
    `Upload review for ${params.document.displayName}`,
    "",
    `Document ID: ${params.document.id}`,
    `Repository: ${params.repository.fullName}`,
    `Canonical branch: ${params.repository.defaultBranch}`,
    `Upload branch: ${params.branchName}`,
    `Uploaded file: ${params.fileName}`,
    `Summary: ${params.summary || "None provided"}`,
    `Source note: ${params.sourceNote || "None provided"}`,
  ];

  return lines.join("\n");
}

function decodeGiteaContent(encoded: string | undefined): Buffer {
  const normalized = encoded ? encoded.replace(/\s+/g, "") : "";
  return Buffer.from(normalized, "base64");
}

async function readGiteaFileAtRef(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<{ sha: string; content: Buffer } | null> {
  const response = await giteaFetch(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
    {
      method: "GET",
      headers: buildGiteaHeaders(token),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw upstreamStatusToCatalogError(
      response.status,
      "upload_source_unavailable",
      "Unable to load document source.",
    );
  }

  const payload = (await response.json()) as GiteaContentFileResponse | string;
  if (typeof payload === "string") {
    return {
      sha: "",
      content: Buffer.from(payload, "utf8"),
    };
  }

  return {
    sha: typeof payload.sha === "string" ? payload.sha : "",
    content: decodeGiteaContent(payload.content),
  };
}

async function branchExists(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
): Promise<boolean> {
  const response = await giteaFetch(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branchName)}`,
    {
      method: "GET",
      headers: buildGiteaHeaders(token),
    },
  );

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw upstreamStatusToCatalogError(
      response.status,
      "upload_branch_unavailable",
      "Unable to prepare the review branch.",
    );
  }

  return true;
}

async function createUploadBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  baseBranch: string,
): Promise<void> {
  const response = await giteaFetch(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    {
      method: "POST",
      headers: buildGiteaHeaders(token, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        new_branch_name: branchName,
        old_ref_name: baseBranch,
      }),
    },
  );

  if (response.ok || response.status === 201 || response.status === 409 || response.status === 422) {
    return;
  }

  throw upstreamStatusToCatalogError(
    response.status,
    "upload_branch_unavailable",
    "Unable to prepare the review branch.",
  );
}

async function writeUploadFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  branchName: string,
  content: Buffer,
  message: string,
): Promise<{ commitSha: string; fileSha: string | null }> {
  const existingFile = await readGiteaFileAtRef(token, owner, repo, filePath, branchName);
  const body: Record<string, string> = {
    content: content.toString("base64"),
    message,
    branch: branchName,
  };

  if (existingFile?.sha) {
    body.sha = existingFile.sha;
  }

  const response = await giteaFetch(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}`,
    {
      method: existingFile?.sha ? "PUT" : "POST",
      headers: buildGiteaHeaders(token, {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw upstreamStatusToCatalogError(
      response.status,
      "upload_write_failed",
      "Unable to save the uploaded file version.",
    );
  }

  const payload = (await response.json()) as {
    commit?: { sha?: string };
    content?: { sha?: string };
  };

  return {
    commitSha: payload.commit?.sha ?? "",
    fileSha: payload.content?.sha ?? existingFile?.sha ?? null,
  };
}

async function listOpenPullRequestsForBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
): Promise<GiteaPullSummary[]> {
  const response = await giteaFetch(
    `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branchName}`)}&limit=${GITEA_PULLS_PAGE_LIMIT}`,
    {
      method: "GET",
      headers: buildGiteaHeaders(token),
    },
  );

  if (!response.ok) {
    throw upstreamStatusToCatalogError(
      response.status,
      "upload_pull_request_unavailable",
      "Unable to load the upload review request.",
    );
  }

  const payload = (await response.json()) as GiteaPullSummary[];
  return Array.isArray(payload) ? payload : [];
}

function selectLatestUploadPullRequest(
  pullRequests: GiteaPullSummary[],
  branchName: string,
): GiteaPullSummary | null {
  const candidates = pullRequests.filter((pullRequest) => pullRequest.head?.ref === branchName);
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftRank = (left.number ?? 0) + (parseTimestamp(left.updated_at) || parseTimestamp(left.created_at));
    const rightRank = (right.number ?? 0) + (parseTimestamp(right.updated_at) || parseTimestamp(right.created_at));
    return rightRank - leftRank;
  });

  return candidates[0] ?? null;
}

async function createOrUpdateUploadPullRequest(
  token: string,
  repository: WorkspaceRepository,
  document: DocumentCatalogItem,
  branchName: string,
  fileName: string,
  summary: string,
  sourceNote: string,
): Promise<{
  pullRequest: GiteaPullSummary;
  approvalState: CatalogApprovalState;
}> {
  const title = buildUploadPullRequestTitle({ document, fileName });
  const body = buildUploadPullRequestBody({
    document,
    repository,
    branchName,
    fileName,
    summary,
    sourceNote,
  });

  const existingPullRequest = selectLatestUploadPullRequest(
    await listOpenPullRequestsForBranch(token, repository.owner, repository.name, branchName),
    branchName,
  );

  if (existingPullRequest?.number) {
    const response = await giteaFetch(
      `/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${existingPullRequest.number}`,
      {
        method: "PATCH",
        headers: buildGiteaHeaders(token, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          title,
          body,
        }),
      },
    );

    if (!response.ok) {
      throw upstreamStatusToCatalogError(
        response.status,
        "upload_pull_request_unavailable",
        "Unable to update the upload review request.",
      );
    }
  } else {
    const response = await giteaFetch(
      `/api/v1/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls`,
      {
        method: "POST",
        headers: buildGiteaHeaders(token, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          base: repository.defaultBranch,
          head: branchName,
          title,
          body,
        }),
      },
    );

    if (!response.ok && response.status !== 201) {
      throw upstreamStatusToCatalogError(
        response.status,
        "upload_pull_request_unavailable",
        "Unable to create the upload review request.",
      );
    }
  }

  const pullRequest = selectLatestUploadPullRequest(
    await listOpenPullRequestsForBranch(token, repository.owner, repository.name, branchName),
    branchName,
  );

  if (!pullRequest || !pullRequest.number) {
    throw createCatalogError(502, "upload_pull_request_unavailable", "Unable to locate the upload review request.");
  }

  const reviews = await listPullRequestReviews(token, repository.owner, repository.name, pullRequest.number);
  return {
    pullRequest,
    approvalState: resolvePullRequestState(pullRequest, reviews),
  };
}

export async function uploadDocumentVersion(
  session: SessionRecord,
  documentId: string,
  formData: FormData,
): Promise<DocumentUploadResult> {
  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    throw createCatalogError(400, "missing_file", "A file is required.");
  }
  if (fileValue.size <= 0) {
    throw createCatalogError(400, "empty_file", "Uploaded file is empty.");
  }
  if (!isAllowedUploadFile(fileValue)) {
    throw createCatalogError(400, "unsupported_file_type", "Unsupported file type.");
  }
  if (fileValue.size > uploadMaxBytes) {
    throw createCatalogError(413, "file_too_large", "Uploaded file exceeds size limit.");
  }

  const summaryValue = formData.get("summary");
  const sourceNoteValue = formData.get("source_note");
  const summary = typeof summaryValue === "string" ? summaryValue.trim() : "";
  const sourceNote = typeof sourceNoteValue === "string" ? sourceNoteValue.trim() : "";

  const { repository, catalog } = await loadWorkspaceCatalog(session);
  const document = catalog.documents.find((item) => item.id === documentId);
  if (!document) {
    throw createCatalogError(404, "document_not_found", "Document not found.");
  }

  const uploadBranchName = buildUploadBranchName(repository.defaultBranch, document.id);
  const uploadContent = Buffer.from(await fileValue.arrayBuffer());
  const branchAlreadyExists = await branchExists(
    session.giteaToken,
    repository.owner,
    repository.name,
    uploadBranchName,
  );

  if (!branchAlreadyExists) {
    await createUploadBranch(
      session.giteaToken,
      repository.owner,
      repository.name,
      uploadBranchName,
      repository.defaultBranch,
    );
  }

  const existingBranchFile = branchAlreadyExists
    ? await readGiteaFileAtRef(
        session.giteaToken,
        repository.owner,
        repository.name,
        document.path,
        uploadBranchName,
      )
    : null;

  const uploadIsDuplicate =
    branchAlreadyExists &&
    existingBranchFile !== null &&
    existingBranchFile.content.equals(uploadContent);

  let commitSha = "";
  if (!uploadIsDuplicate) {
    const commitResult = await writeUploadFile(
      session.giteaToken,
      repository.owner,
      repository.name,
      document.path,
      uploadBranchName,
      uploadContent,
      buildUploadCommitMessage({
        document,
        branchName: uploadBranchName,
        fileName: fileValue.name || document.id,
        summary,
        sourceNote,
      }),
    );
    commitSha = commitResult.commitSha;
  }

  const pullRequestResult = await createOrUpdateUploadPullRequest(
    session.giteaToken,
    repository,
    document,
    uploadBranchName,
    fileValue.name || document.id,
    summary,
    sourceNote,
  );

  const latestCommit = await readCommitSummary(
    session.giteaToken,
    repository.owner,
    repository.name,
    document.path,
    uploadBranchName,
  );

  return {
    documentId: document.id,
    branchName: uploadBranchName,
    commitSha: latestCommit?.sha || commitSha || existingBranchFile?.sha || "",
    pullRequestNumber: pullRequestResult.pullRequest.number ?? 0,
    pullRequestUrl: pullRequestResult.pullRequest.html_url ?? null,
    approvalState: pullRequestResult.approvalState,
  };
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
    return catalogErrorResponse(createCatalogError(401, "unauthorized", "Unauthorized."), baseHeaders);
  }

  try {
    const payload = await loadDocumentCatalog(session);
    return json(200, payload, baseHeaders);
  } catch (error) {
    return catalogErrorResponse(error, baseHeaders);
  }
}

async function handleDocumentDetail(
  req: Request,
  baseHeaders: Headers,
  documentId: string,
): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) {
    return catalogErrorResponse(createCatalogError(401, "unauthorized", "Unauthorized."), baseHeaders);
  }

  try {
    const payload = await loadDocumentCatalogItem(session, documentId);
    return json(200, payload, baseHeaders);
  } catch (error) {
    return catalogErrorResponse(error, baseHeaders);
  }
}

async function handleDocumentVersionUpload(
  req: Request,
  baseHeaders: Headers,
  documentId: string,
): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) {
    return catalogErrorResponse(createCatalogError(401, "unauthorized", "Unauthorized."), baseHeaders);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return catalogErrorResponse(
      createCatalogError(400, "invalid_upload_payload", "A multipart form upload is required."),
      baseHeaders,
    );
  }

  try {
    const payload = await uploadDocumentVersion(session, documentId, formData);
    return json(200, payload, baseHeaders);
  } catch (error) {
    return catalogErrorResponse(error, baseHeaders);
  }
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

export async function handleApiRequest(req: Request): Promise<Response> {
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

  if (pathname === DOCUMENTS_ROUTE_PREFIX && req.method === "GET") {
    return handleDocuments(req, baseHeaders);
  }

  if (
    pathname.startsWith(`${DOCUMENTS_ROUTE_PREFIX}/`) &&
    pathname.endsWith(DOCUMENTS_VERSIONS_ROUTE_SUFFIX) &&
    req.method === "POST"
  ) {
    try {
      const documentId = decodeURIComponent(
        pathname.slice(
          `${DOCUMENTS_ROUTE_PREFIX}/`.length,
          pathname.length - DOCUMENTS_VERSIONS_ROUTE_SUFFIX.length,
        ),
      );
      if (documentId) {
        return handleDocumentVersionUpload(req, baseHeaders, documentId);
      }
    } catch {
      return catalogErrorResponse(
        createCatalogError(400, "invalid_document_id", "Invalid document identifier."),
        baseHeaders,
      );
    }
  }

  if (pathname.startsWith(`${DOCUMENTS_ROUTE_PREFIX}/`) && req.method === "GET") {
    try {
      const documentId = decodeURIComponent(pathname.slice(`${DOCUMENTS_ROUTE_PREFIX}/`.length));
      if (documentId) {
        return handleDocumentDetail(req, baseHeaders, documentId);
      }
    } catch {
      return catalogErrorResponse(
        createCatalogError(400, "invalid_document_id", "Invalid document identifier."),
        baseHeaders,
      );
    }
  }

  return json(404, { error: "Not found." }, baseHeaders);
}

if (import.meta.main) {
  const server = Bun.serve({
    port: apiPort,
    idleTimeout: 30,
    fetch: handleApiRequest,
  });

  console.log(`Bindersnap API listening on http://localhost:${server.port}`);
}
