import { randomUUID } from "crypto";

import { config, type SessionCookieSameSite } from "./config";
import { logger } from "./logger";
import { runSessionReaper } from "./session-reaper";
import { sessionStore, type SessionRecord } from "./sessions";
import {
  subscriptionStore,
  organizationHasAccess,
  webhookEventStore,
  type EffectiveSubscriptionAccess,
  type SubscriptionAccessOverrideRecord,
} from "./subscriptions";
import { organizationStore } from "./organizations";
import {
  listSessionOrganizations,
  resolveOrganizationForUser,
  resolveSessionOrganization,
  type SessionOrganization,
} from "./session-organization";
import { claimLegacyBillingForOrganization } from "./legacy-billing-claim";
import { provisionSignup } from "./signup-provisioning";
import { slugifyOrganizationName } from "../../packages/utils/organizationName";
import {
  buildDocumentFilePath,
  buildDocumentSlugPath,
} from "../../packages/utils/documentPath";
import {
  findWorkspaceRepo,
  listOrganizationWorkspaces,
  provisionWorkspace,
  workspacePathExists,
} from "./gitea-client/workspaces";
import {
  createDocumentVersionTag,
  findWorkspaceDocument,
  listChangedDocuments,
  listDocumentVersions,
  listWorkspaceDocuments,
  nextVersionFrom,
} from "./gitea-client/workspaceDocuments";
import { listOrganizationOwners } from "./gitea-client/orgs";
import { createPrivilegedGiteaClient } from "./privileged-client";
import type Stripe from "stripe";
import { extractCurrentPeriodEnd } from "./stripe/api-version";
import { getStripeClient } from "./stripe/client";
import {
  buildStripeSubscriptionRecord,
  reconcileStripeCustomerByCustomerId,
} from "./stripe/reconcile";
import {
  createGiteaBasicAuthClient,
  createGiteaClient,
  GiteaApiError,
  unwrap,
  type GiteaClient,
} from "./gitea-client/client";
import {
  createDiscussionThread,
  listDiscussions,
  replyToDiscussion,
  setCommentReactionInThread,
  setDiscussionResolution,
} from "./gitea-client/discussions";
import { isSupportedReaction } from "./gitea-client/reactions";
import {
  getReviewSettings,
  updateReviewSettings,
} from "./gitea-client/reviewSettings";
import {
  buildClosedChanges,
  buildVersionRecords,
  toVersionReviews,
} from "./document-history";
import type { ClosedChange } from "../../packages/api-schema/schemas/documents";
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
  getRepoInfo,
  listDocTags,
  listRepoCollaborators,
  searchWorkspaceReposPage,
  repoExists,
  searchUsers,
  removeRepoCollaborator,
  updateRepoBranchProtection,
  updateRepoVisibility,
  type RepoCollaboratorPermissionSummary,
  type RepoBranchProtection,
  type RepoUserSummary,
  type WorkspaceRepo,
} from "./gitea-client/repos";
import {
  buildUploadBranchName,
  buildUploadCommitMessage,
  commitBinaryFile,
  createUploadBranch,
  validateUploadFile,
} from "./gitea-client/uploads";
import {
  createPullRequest,
  getPullRequestWithReviews,
  listBranchUpdates,
  listPullRequests,
  listPullRequestsWithReviews,
  searchInvolvedChanges,
  type InvolvedChangeRef,
  mergeOrResolveConflicts,
  mergeWorkspaceChange,
  removePullReviewers,
  requestPullReviewers,
  setPullRequestAssignees,
  submitReview,
  type PullRequestWithApprovalState,
  type PullRequestWithReviews,
} from "./gitea-client/pullRequests";
import {
  buildChangeReviewers,
  countApprovals,
  planReviewerChanges,
  readAssignee,
  readRequestedReviewers,
} from "./change-assignments";
import { buildChangeUpdates } from "./change-updates";

/**
 * How far back a change's update history is read.
 *
 * A change that has been corrected fifty times is a change that should have
 * been closed and resubmitted; the cap keeps one pathological branch from
 * costing every reader a long walk through Gitea's commit pages.
 */
const CHANGE_UPDATE_LIMIT = 50;

/**
 * How many documents one page of the library holds.
 *
 * Each row costs Gitea calls of its own — its tags, its open changes, and the
 * reviews on them — so this is the real cost knob for the list, not just a
 * render budget. Twenty-five fills a tall screen with room to spare, which is
 * what the reader needs before they scroll for more.
 */
const DOCUMENTS_PAGE_SIZE = 25;

/** The most a caller may ask for in one page, however large a limit they send. */
const MAX_DOCUMENTS_PAGE_SIZE = 50;

/**
 * How many recently decided changes home considers.
 *
 * It renders at most five, but the search cannot know which of a reader's
 * decided changes are theirs to look back on — that depends on the document's
 * ownership, which is settled here. A small margin covers the trimming.
 */
const HOME_DECIDED_CANDIDATES = 12;

const authAttempts = new Map<string, { count: number; resetAt: number }>();
const checkoutAttempts = new Map<string, { count: number; resetAt: number }>();

export interface SessionLifetime {
  sessionExpiresAt: number;
  cookieExpiresAt?: number;
}

export function buildSessionLifetime(
  rememberMe: boolean,
  now = Date.now(),
  options?: {
    sessionTtlMs?: number;
    rememberedSessionTtlMs?: number;
  },
): SessionLifetime {
  const standardTtlMs = options?.sessionTtlMs ?? config.sessionTtlMs;
  const persistentTtlMs =
    options?.rememberedSessionTtlMs ?? config.rememberedSessionTtlMs;
  const ttlMs = rememberMe ? persistentTtlMs : standardTtlMs;
  const expiresAt = now + ttlMs;

  return rememberMe
    ? { sessionExpiresAt: expiresAt, cookieExpiresAt: expiresAt }
    : { sessionExpiresAt: expiresAt };
}

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

function buildGiteaServiceHeaders(
  extraHeaders?: HeadersInit,
): HeadersInit | null {
  if (!config.giteaServiceToken) {
    return null;
  }

  return {
    Authorization: buildTokenAuthHeader(config.giteaServiceToken),
    ...extraHeaders,
  };
}

function buildGiteaPrivilegedHeaders(
  extraHeaders?: HeadersInit,
): HeadersInit | null {
  const serviceHeaders = buildGiteaServiceHeaders(extraHeaders);
  if (serviceHeaders) {
    return serviceHeaders;
  }

  if (
    !config.isProduction &&
    config.giteaAdminUsername &&
    config.giteaAdminPassword
  ) {
    return {
      Authorization: buildBasicAuthHeader(
        config.giteaAdminUsername,
        config.giteaAdminPassword,
      ),
      ...extraHeaders,
    };
  }

  return null;
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

  if (config.configuredAllowedOrigins.has(origin)) {
    return true;
  }

  // Local dev fallback: allow loopback browser origins unless explicitly locked down.
  if (!config.hasExplicitBrowserOrigins) {
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
  if (!config.enforceHttps || isLocalRequest(req)) {
    return null;
  }

  if (requestProtocol(req) === "https") {
    return null;
  }

  logger.warn("Transport security rejected: HTTPS required", {
    method: req.method,
    path: new URL(req.url).pathname,
    protocol: requestProtocol(req),
    clientIp: requestClientIp(req),
  });

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
    logger.warn(
      "CORS rejected: origin not allowed for state-changing request",
      {
        method: req.method,
        path: new URL(req.url).pathname,
        origin: sourceOrigin,
        clientIp: requestClientIp(req),
      },
    );
    return json(403, { error: "Cross-site request blocked." }, baseHeaders);
  }

  return null;
}

export function serializeSessionCookie(
  req: Request,
  value: string,
  options?: {
    expiresAt?: number;
  },
): string {
  const parts = [
    `${config.sessionCookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.sessionCookieSameSite}`,
  ];

  if (config.sessionCookieDomain) {
    parts.push(`Domain=${config.sessionCookieDomain}`);
  }

  if (!isLocalRequest(req)) {
    parts.push("Secure");
  }

  if (options?.expiresAt !== undefined) {
    const maxAge = Math.max(
      0,
      Math.floor((options.expiresAt - Date.now()) / 1000),
    );
    parts.push(`Max-Age=${maxAge}`);
    parts.push(`Expires=${new Date(options.expiresAt).toUTCString()}`);
  }

  return parts.join("; ");
}

function clearSessionCookie(req: Request): string {
  return serializeSessionCookie(req, "", { expiresAt: 0 });
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

async function getSessionFromRequest(
  req: Request,
): Promise<SessionRecord | null> {
  const sessionId = parseCookies(req).get(config.sessionCookieName);
  if (!sessionId) return null;

  const session = await sessionStore.get(sessionId);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    await sessionStore.delete(sessionId);
    void revokeUserToken(session);
    return null;
  }

  return session;
}

function consumeAuthRateLimit(
  req: Request,
  action: "login" | "signup",
): { limited: boolean; retryAfterSeconds: number } {
  if (!config.authRateLimitEnabled) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  const key = `${action}:${requestClientIp(req)}`;
  const now = Date.now();
  const existing = authAttempts.get(key);

  if (!existing || existing.resetAt <= now) {
    authAttempts.set(key, {
      count: 1,
      resetAt: now + config.authRateLimitWindowMs,
    });
    return { limited: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  authAttempts.set(key, existing);

  if (existing.count > config.authRateLimitMax) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    );
    return { limited: true, retryAfterSeconds };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

function resetAuthRateLimit(req: Request, action: "login" | "signup"): void {
  if (!config.authRateLimitEnabled) {
    return;
  }

  const key = `${action}:${requestClientIp(req)}`;
  authAttempts.delete(key);
}

function consumeCheckoutRateLimit(username: string): {
  limited: boolean;
  retryAfterSeconds: number;
} {
  const key = `checkout:${username}`;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 5;
  const existing = checkoutAttempts.get(key);

  if (!existing || existing.resetAt <= now) {
    checkoutAttempts.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  checkoutAttempts.set(key, existing);

  if (existing.count > max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    );
    return { limited: true, retryAfterSeconds };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function giteaFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, config.giteaUrl), init);
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
  return createGiteaClient(config.giteaUrl, session.giteaToken);
}

function createServiceGiteaClient(): GiteaClient {
  return createGiteaClient(config.giteaUrl, config.giteaServiceToken);
}

/**
 * How many approvals a document demands before anything can publish.
 *
 * Gitea serves branch protection only to an owner or a collaborator with admin
 * write, so reading it as the caller hands every write collaborator a 403 — and
 * the reviewers who need the count most are precisely the ones who never see
 * it. The service account reads it instead, and only the number comes back:
 * the whitelists on the same object name individual people and stay as
 * admin-only as they are today.
 *
 * Returns 0 for a repo with no protection rule, and null when the read fails,
 * so "this document needs no approvals" stays distinguishable from "we could
 * not find out how many it needs".
 */
async function readRequiredApprovals(
  owner: string,
  repo: string,
  branch = "main",
): Promise<number | null> {
  const client = createPrivilegedGiteaClient();
  if (!client) return null;

  try {
    const protection = await getRepoBranchProtection(
      client,
      owner,
      repo,
      branch,
    );
    return protection?.requiredApprovals ?? 0;
  } catch (err) {
    logger.error("Failed to read required approvals", {
      owner,
      repo,
      branch,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface DocumentAccessContext {
  client: GiteaClient;
  username: string | null;
  token: string;
}

async function resolveDocumentAccess(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<DocumentAccessContext | Response> {
  // Reading the record is never gated (ADR 0004). Every caller of this is a
  // GET, so a signed-in reader gets through whatever their organization owes
  // us; the service-client fallback below is for the anonymous reader of a
  // public repo, not for the delinquent one.
  const auth = await requireSession(req, baseHeaders);
  if (!(auth instanceof Response)) {
    return {
      client: auth.client,
      username: auth.session.username,
      token: auth.session.giteaToken,
    };
  }

  const serviceClient = createServiceGiteaClient();
  try {
    const { isPrivate } = await getRepoInfo({
      client: serviceClient,
      owner,
      repo,
    });
    if (isPrivate) {
      return auth;
    }
    return {
      client: serviceClient,
      username: null,
      token: config.giteaServiceToken,
    };
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return auth;
    }
    logger.error("Service client failed to check repo visibility", {
      owner,
      repo,
      error: err instanceof Error ? err.message : String(err),
    });
    return json(
      503,
      { error: "Unable to verify document access." },
      baseHeaders,
    );
  }
}

async function requireSession(
  req: Request,
  baseHeaders: Headers,
): Promise<{ session: SessionRecord; client: GiteaClient } | Response> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return json(401, { error: "Unauthorized." }, baseHeaders);
  }

  return { session, client: createSessionGiteaClient(session) };
}

/**
 * The paywall. It gates **authoring and mutation, and nothing else.**
 *
 * ADR 0004 makes this structural rather than a nicety: reads and exports stay
 * open forever, whatever an organization owes us. Holding a customer's
 * approval history hostage is the one act that would poison a compliance
 * reference permanently, and a surveyor's question does not pause for an
 * invoice. The rule is gated by intent, not by route list — so a new GET that
 * reaches for this function is the bug, and `paywall-scope.test.ts` says so
 * before review has to.
 *
 * When it does bite it bites the organization, not the person: a delinquent
 * org's reviewers are blocked from mutating too, because the org is
 * delinquent, not them.
 */
async function requireSubscription(
  req: Request,
  baseHeaders: Headers,
): Promise<{ session: SessionRecord; client: GiteaClient } | Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;
  if (config.bypassSubscriptionForUsers.includes(auth.session.username)) {
    logger.info("Subscription requirement bypassed for user", {
      username: auth.session.username,
      path: new URL(req.url).pathname,
    });
    return auth;
  }

  // The organization is what owes us money, so it is what gets checked. A
  // delinquent org blocks everyone in it — its reviewers included, because the
  // org is delinquent, not them.
  const organization = await resolveSessionOrganization(
    auth.client,
    auth.session,
  );
  if (!organization || !(await organizationHasAccess(organization.id))) {
    return json(402, { error: "Subscription required." }, baseHeaders);
  }

  return auth;
}

async function requireAdminSession(
  req: Request,
  baseHeaders: Headers,
): Promise<
  | {
      session: SessionRecord;
      client: GiteaClient;
      currentUser: ResolvedGiteaCurrentUser;
    }
  | Response
> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const currentUser = await fetchSessionGiteaUser(auth.session);
  if (!currentUser) {
    return json(
      502,
      { error: "Unable to verify admin access right now." },
      baseHeaders,
    );
  }

  if (!currentUser.isAdmin) {
    return json(403, { error: "Admin access required." }, baseHeaders);
  }

  return {
    ...auth,
    currentUser,
  };
}

async function requireSubscriptionOrAdmin(
  req: Request,
  baseHeaders: Headers,
): Promise<{ session: SessionRecord; client: GiteaClient } | Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  if (config.bypassSubscriptionForUsers.includes(auth.session.username)) {
    return auth;
  }

  const organization = await resolveSessionOrganization(
    auth.client,
    auth.session,
  );
  if (organization && (await organizationHasAccess(organization.id))) {
    return auth;
  }

  const currentUser = await fetchSessionGiteaUser(auth.session);
  if (currentUser?.isAdmin) {
    return auth;
  }

  return json(402, { error: "Subscription required." }, baseHeaders);
}

type SubscriptionAccessSource =
  | "config_bypass"
  | "stripe"
  | "trial"
  | "admin_grant"
  | "admin_revoke"
  | "no_organization"
  | "none";

interface SubscriptionAccessState {
  hasAccess: boolean;
  source: SubscriptionAccessSource;
  status: string | null;
  stripeStatus: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  trialEndsAt: number | null;
  override: SubscriptionAccessOverrideRecord | null;
  organization: { id: number; name: string } | null;
}

/**
 * The billing state of an organization, in the shape the UI and the admin
 * console both read. `username` only decides the dev bypass; everything else
 * hangs off the organization, because that is who we bill.
 */
async function resolveSubscriptionAccessState(
  username: string,
  organization: SessionOrganization | null,
): Promise<SubscriptionAccessState> {
  const summary = organization
    ? { id: organization.id, name: organization.name }
    : null;

  if (config.bypassSubscriptionForUsers.includes(username)) {
    const subscription = organization
      ? await subscriptionStore.getByOrganization(organization.id)
      : null;
    return {
      hasAccess: true,
      source: "config_bypass",
      status: "active",
      stripeStatus: subscription?.status ?? null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      trialEndsAt: null,
      override: organization
        ? await subscriptionStore.getAccessOverride(organization.id)
        : null,
      organization: summary,
    };
  }

  if (!organization) {
    // An account that predates ADR 0004, or one whose signup provisioning
    // failed. There is nothing to bill and nothing to grant.
    return {
      hasAccess: false,
      source: "no_organization",
      status: null,
      stripeStatus: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      trialEndsAt: null,
      override: null,
      organization: null,
    };
  }

  const access = await subscriptionStore.resolveAccess(organization.id);
  return {
    hasAccess: access.hasAccess,
    source: access.source,
    status:
      access.source === "admin_grant"
        ? "active"
        : access.source === "admin_revoke"
          ? "revoked"
          : access.source === "trial"
            ? "trialing"
            : (access.subscription?.status ?? null),
    stripeStatus: access.subscription?.status ?? null,
    currentPeriodEnd: access.subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: access.subscription?.cancelAtPeriodEnd ?? false,
    cancelAt: access.subscription?.cancelAt ?? null,
    trialEndsAt: access.trialEndsAt,
    override: access.override,
    organization: summary,
  };
}

export function createStripeRequestIdempotencyKey(
  flow: "checkout" | "portal",
  clientKey?: string | null,
): string {
  // Client-supplied key for true idempotency; falls back to server-generated UUID.
  // Validates client key: 8-128 chars, alphanumeric + hyphen only.
  if (clientKey && /^[a-zA-Z0-9-]{8,128}$/.test(clientKey)) {
    return `${flow}-${clientKey}`;
  }
  return `${flow}-${randomUUID()}`;
}

type StripePriceInfo = {
  amount: number;
  currency: string;
  interval: string;
  formatted: string;
};

let cachedPriceInfo: StripePriceInfo | null = null;
let priceInfoCachedAt = 0;
const PRICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchStripePriceInfo(): Promise<StripePriceInfo | null> {
  const now = Date.now();
  if (cachedPriceInfo && now - priceInfoCachedAt < PRICE_CACHE_TTL_MS) {
    return cachedPriceInfo;
  }

  if (!config.stripeSecretKey || !config.stripePriceId) {
    return null;
  }

  try {
    const stripe = getStripeClient();
    const price = await stripe.prices.retrieve(config.stripePriceId, {
      expand: ["product"],
    });

    const amount =
      typeof price.unit_amount === "number" ? price.unit_amount / 100 : 0;
    const currency = price.currency.toUpperCase();
    const interval =
      price.recurring?.interval ?? (price.type === "one_time" ? "once" : "");

    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: price.currency,
    }).format(amount);

    const intervalDisplay =
      interval === "month"
        ? " / month"
        : interval === "year"
          ? " / year"
          : interval === "once"
            ? ""
            : ` / ${interval}`;

    cachedPriceInfo = {
      amount,
      currency,
      interval,
      formatted: `${formatted}${intervalDisplay}`,
    };
    priceInfoCachedAt = now;

    return cachedPriceInfo;
  } catch (err) {
    logger.warn("Failed to fetch Stripe price info", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
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
  return computeFileHashFromBuffer(buffer);
}

async function computeFileHashFromBuffer(buffer: ArrayBuffer): Promise<string> {
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

  const newestFirst = [...pullRequests].sort(
    (left, right) => (right.number ?? 0) - (left.number ?? 0),
  );

  const uploadPullRequests = newestFirst.filter((pullRequest) =>
    (pullRequest.head?.ref ?? "").startsWith("upload/"),
  );

  // A document whose first version is still under review has no file on
  // `main` at all. Bindersnap's own uploads win, but any open branch beats
  // telling the reviewer there is no file to read.
  return uploadPullRequests[0]?.head?.ref ?? newestFirst[0]?.head?.ref ?? null;
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
    // Status 0 marks an error detected on our side (input validation, missing
    // data) rather than an HTTP status from Gitea. Response() rejects 0, and
    // these are request-shaped problems, so surface them as 400.
    const status = err.status === 0 ? 400 : err.status;
    if (status >= 500) {
      logger.error("Gitea API error (5xx)", {
        status,
        message: err.message || fallback,
        errorType: "GiteaApiError",
      });
      logger.debug("Gitea API error details", { err });
    } else {
      logger.warn("Gitea API error (4xx)", {
        status,
        message: err.message || fallback,
        errorType: "GiteaApiError",
      });
      logger.debug("Gitea API error details", { err });
    }
    return json(status, { error: err.message || fallback }, baseHeaders);
  }

  const message = err instanceof Error && err.message ? err.message : fallback;
  logger.error("Unhandled route exception", {
    message,
    errorType: err instanceof Error ? err.constructor.name : typeof err,
    stack: err instanceof Error ? err.stack : undefined,
  });
  logger.debug("Gitea API error details", { err });

  return json(500, { error: message }, baseHeaders);
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

type GiteaCurrentUserRecord = {
  login?: unknown;
  full_name?: unknown;
  email?: unknown;
  is_admin?: unknown;
};

type ResolvedGiteaCurrentUser = {
  username: string;
  fullName: string | null;
  email: string | null;
  isAdmin: boolean;
};

async function fetchSessionGiteaUser(
  session: SessionRecord,
): Promise<ResolvedGiteaCurrentUser | null> {
  const response = await giteaFetch("/api/v1/user", {
    method: "GET",
    headers: {
      Authorization: buildTokenAuthHeader(session.giteaToken),
      Accept: "application/json",
    },
  }).catch(() => null);

  if (!response) {
    logger.warn("Unable to reach Gitea for session user lookup", {
      username: session.username,
    });
    return null;
  }

  if (!response.ok) {
    logger.warn("Gitea session user lookup failed", {
      username: session.username,
      status: response.status,
    });
    return null;
  }

  const payload = (await response
    .json()
    .catch(() => null)) as GiteaCurrentUserRecord | null;
  const username =
    typeof payload?.login === "string" && payload.login.trim() !== ""
      ? payload.login.trim()
      : session.username;
  const fullName =
    typeof payload?.full_name === "string" && payload.full_name.trim() !== ""
      ? payload.full_name.trim()
      : null;
  const email =
    typeof payload?.email === "string"
      ? payload.email.trim().toLowerCase()
      : "";

  return {
    username,
    fullName,
    email: looksLikeEmailAddress(email) ? email : null,
    isAdmin: payload?.is_admin === true,
  };
}

async function fetchSessionUserEmail(
  session: SessionRecord,
): Promise<string | null> {
  const user = await fetchSessionGiteaUser(session);
  return user?.email ?? null;
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
  const serviceHeaders = buildGiteaPrivilegedHeaders({
    Accept: "application/json",
  });
  if (!serviceHeaders) {
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
        headers: serviceHeaders,
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
      GiteaEmailRecord[] | null;
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

type EstablishedSession =
  | { ok: true; session: SessionRecord; headers: Headers }
  | { ok: false; response: Response };

/**
 * Mint the Gitea token, store the session, and build the cookie — without
 * writing the response yet, so signup can act as the new user (creating their
 * organization) before answering.
 */
async function establishSession(
  username: string,
  password: string,
  req: Request,
  baseHeaders: Headers,
  rememberMe = true,
): Promise<EstablishedSession> {
  const tokenName = `bindersnap-session-${randomUUID()}`;
  const token = await createUserToken(username, password, tokenName).catch(
    () => null,
  );
  if (!token) {
    return {
      ok: false,
      response: json(502, { error: "Unable to sign in." }, baseHeaders),
    };
  }

  const lifetime = buildSessionLifetime(rememberMe);
  const session = await createSession(
    username,
    token,
    tokenName,
    lifetime.sessionExpiresAt,
  );
  const headers = mergeHeaders(baseHeaders, {
    "Set-Cookie": serializeSessionCookie(req, session.id, {
      expiresAt: lifetime.cookieExpiresAt,
    }),
  });

  return { ok: true, session, headers };
}

function sessionResponse(
  session: SessionRecord,
  headers: Headers,
  extra: { suggestedOrganizationName?: string | null } = {},
): Response {
  return json(
    200,
    {
      user: {
        username: session.username,
      },
      token: session.giteaToken,
      ...(extra.suggestedOrganizationName
        ? { suggestedOrganizationName: extra.suggestedOrganizationName }
        : {}),
    },
    headers,
  );
}

async function createAuthenticatedSession(
  username: string,
  password: string,
  req: Request,
  baseHeaders: Headers,
  rememberMe = true,
): Promise<Response> {
  const established = await establishSession(
    username,
    password,
    req,
    baseHeaders,
    rememberMe,
  );
  if (!established.ok) {
    return established.response;
  }

  return sessionResponse(established.session, established.headers);
}

async function createLoginSession(
  username: string,
  password: string,
  req: Request,
  baseHeaders: Headers,
  rememberMe = true,
): Promise<Response> {
  const loginName = await verifyUserCredentials(username, password).catch(
    () => null,
  );
  if (!loginName) {
    return json(401, { error: "Invalid username or password." }, baseHeaders);
  }

  return createAuthenticatedSession(
    loginName,
    password,
    req,
    baseHeaders,
    rememberMe,
  );
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
        scopes:
          config.tokenScopes.length > 0
            ? config.tokenScopes
            : ["read:repository"],
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

  const serviceHeaders = buildGiteaPrivilegedHeaders({
    Accept: "application/json",
  });
  if (!serviceHeaders) {
    return;
  }

  await giteaFetch(path, {
    method: "DELETE",
    headers: serviceHeaders,
  }).catch(() => undefined);
}

async function createGiteaUser(
  username: string,
  email: string,
  password: string,
): Promise<
  { status: 502; error: string } | { status: number; error: string } | "created"
> {
  const serviceHeaders = buildGiteaPrivilegedHeaders({
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  if (!serviceHeaders) {
    return {
      status: 502,
      error: "Gitea service credentials are not configured.",
    };
  }

  const response = await giteaFetch("/api/v1/admin/users", {
    method: "POST",
    headers: serviceHeaders,
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

async function createSession(
  username: string,
  giteaToken: string,
  giteaTokenName: string,
  expiresAt: number,
): Promise<SessionRecord> {
  const now = Date.now();
  const session: SessionRecord = {
    id: randomUUID(),
    username,
    giteaToken,
    giteaTokenName,
    createdAt: now,
    expiresAt,
  };

  await sessionStore.put(session);
  return session;
}

async function revokeAndDeleteSession(session: SessionRecord): Promise<void> {
  await sessionStore.delete(session.id);
  await revokeUserToken(session).catch(() => undefined);
}

async function handleSignup(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const clientIp = requestClientIp(req);
  const rateLimit = consumeAuthRateLimit(req, "signup");

  logger.debug("Auth rate limit check (signup)", {
    clientIp,
    limited: rateLimit.limited,
    retryAfterSeconds: rateLimit.retryAfterSeconds,
  });

  if (rateLimit.limited) {
    logger.warn("Rate limit hit on signup", {
      clientIp,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
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
    organization?: unknown;
  }>(req);
  const username =
    typeof payload?.username === "string" ? payload.username : "";
  const email = typeof payload?.email === "string" ? payload.email : "";
  const password =
    typeof payload?.password === "string" ? payload.password : "";
  const organization =
    typeof payload?.organization === "string" ? payload.organization : "";

  if (!username || !email || !password) {
    return json(
      400,
      { error: "Username, email and password are required." },
      baseHeaders,
    );
  }

  logger.debug("Attempting Gitea user creation", { username, clientIp });

  const created = await createGiteaUser(username, email, password);
  if (created !== "created") {
    logger.warn("Gitea user creation failed during signup", {
      username,
      status: created.status,
      error: created.error,
    });
    return json(created.status, { error: created.error }, baseHeaders);
  }

  logger.debug("Gitea user created; establishing session", {
    username,
    clientIp,
  });

  const loginName = await verifyUserCredentials(username, password).catch(
    () => null,
  );
  if (!loginName) {
    return json(401, { error: "Invalid username or password." }, baseHeaders);
  }

  const established = await establishSession(
    loginName,
    password,
    req,
    baseHeaders,
  );
  if (!established.ok) {
    return established.response;
  }

  resetAuthRateLimit(req, "signup");
  logger.debug("Session created after signup", { username, clientIp });

  // Signup no longer creates an organization behind the person's back.
  //
  // It used to, deriving a name they never saw and could not change, which
  // made naming — the one thing an organization needs from its owner —
  // impossible. An account with no organization is now an ordinary state the
  // app knows how to handle, and `POST /api/app/organizations` is the single
  // way one gets created, for a new signup and for an account that predates
  // ADR 0004 alike. One path, and the person names the thing.
  //
  // `organization` from the signup form is carried back to the client so the
  // create-organization screen can arrive pre-filled rather than blank.
  return sessionResponse(established.session, established.headers, {
    suggestedOrganizationName: organization || null,
  });
}

async function handleLogin(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const clientIp = requestClientIp(req);
  const rateLimit = consumeAuthRateLimit(req, "login");

  logger.debug("Auth rate limit check (login)", {
    clientIp,
    limited: rateLimit.limited,
    retryAfterSeconds: rateLimit.retryAfterSeconds,
  });

  if (rateLimit.limited) {
    logger.warn("Rate limit hit on login", {
      clientIp,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
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
    rememberMe?: unknown;
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
  const rememberMe =
    typeof payload?.rememberMe === "boolean" ? payload.rememberMe : true;

  if (!identifier || !password) {
    return json(
      400,
      { error: "Username or email and password are required." },
      baseHeaders,
    );
  }

  logger.debug("Credential verification attempt", {
    // Log the identifier type (email or username) but never the value itself
    identifierType: looksLikeEmailAddress(identifier) ? "email" : "username",
    rememberMe,
    clientIp,
  });

  const resolution = await resolveLoginUsername(
    identifier,
    emailCandidate,
    password,
  );

  if (resolution.kind === "unavailable") {
    logger.warn("Login resolution unavailable", {
      status: resolution.status,
      error: resolution.error,
      clientIp,
    });
    return json(resolution.status, { error: resolution.error }, baseHeaders);
  }

  if (resolution.kind !== "authenticated") {
    logger.debug("Login credential verification failed", { clientIp });
    return json(
      401,
      { error: "Invalid username, email, or password." },
      baseHeaders,
    );
  }

  logger.debug("Credentials verified; establishing session", {
    username: resolution.username,
    rememberMe,
    clientIp,
  });

  const response = await createAuthenticatedSession(
    resolution.username,
    password,
    req,
    baseHeaders,
    rememberMe,
  );
  if (response.ok) {
    resetAuthRateLimit(req, "login");
    logger.debug("Session created after login", {
      username: resolution.username,
      clientIp,
    });
  }
  return response;
}

async function handleLogout(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (session) {
    logger.debug("Revoking session on logout", {
      username: session.username,
      clientIp: requestClientIp(req),
    });
    await sessionStore.delete(session.id);
    await revokeUserToken(session);
  } else {
    logger.debug("Logout called with no active session", {
      clientIp: requestClientIp(req),
    });
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
  const session = await getSessionFromRequest(req);
  if (!session) {
    logger.debug("Auth/me: no valid session found", {
      clientIp: requestClientIp(req),
    });
    return json(401, { error: "Unauthorized." }, baseHeaders);
  }

  logger.debug("Auth/me: session resolved", {
    username: session.username,
    clientIp: requestClientIp(req),
  });

  const giteaUser = await fetchSessionGiteaUser(session);

  return json(
    200,
    {
      user: {
        username: giteaUser?.username ?? session.username,
        fullName: giteaUser?.fullName ?? undefined,
        isAdmin: giteaUser?.isAdmin === true,
      },
      token: session.giteaToken,
    },
    baseHeaders,
  );
}

/**
 * Quick find: one page of documents whose name or description matches.
 *
 * Deliberately not the library listing. That call fans out per repo for tags,
 * open changes and approval policy, which is the right answer for a page and
 * far too much for a panel that reopens on every keystroke. This returns the
 * repo rows only, in pages, so the panel can render the first results while
 * the reader is still typing and ask for more as they scroll.
 */
async function handleDocumentSearch(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  // A read. Never gated — see resolveDocumentAccess.
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;
  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const page = parsePositiveIntInput(url.searchParams.get("page"), 1);
  const limit = Math.min(
    parsePositiveIntInput(url.searchParams.get("limit"), 8),
    50,
  );

  if (!query) {
    return json(400, { error: "q is required." }, baseHeaders);
  }

  try {
    const result = await searchWorkspaceReposPage({
      client,
      q: query,
      page,
      limit,
    });

    return json(
      200,
      {
        documents: result.repos.map(normalizeWorkspaceRepoSummary),
        page: result.page,
        limit: result.limit,
        hasMore: result.hasMore,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to search documents.");
  }
}

/** One open change as a list row carries it — the wire shape, not Gitea's. */
type PendingChangeRow = ReturnType<typeof buildPendingChangeRow>;

function buildPendingChangeRow(
  entry: PullRequestWithReviews,
  requiredApprovals: number | null,
) {
  return {
    ...entry.pullRequest,
    reviewers: buildChangeReviewers({
      requested: readRequestedReviewers(entry.pullRequest),
      reviews: entry.reviews,
      submittedBy: entry.pullRequest.user?.login ?? "",
    }),
    assignee: readAssignee(entry.pullRequest),
    approvalCount: countApprovals(entry.reviews),
    requiredApprovals,
  };
}

/**
 * A document's open changes, ready for a list row.
 *
 * Shared by the library list and the home page: both need the same three
 * things about a document — the version it is on, the changes in flight, and
 * how many approvals those still need — and both would rather show a row with
 * a gap in it than fail the whole page for one unreachable repository.
 */
async function loadOpenChangeSummary(
  client: GiteaClient,
  owner: string,
  repo: string,
) {
  try {
    const [latestTag, openWithReviews] = await Promise.all([
      getLatestDocTag(client, owner, repo),
      listPullRequestsWithReviews({ client, owner, repo, state: "open" }),
    ]);
    const pending = openWithReviews.filter((entry) =>
      (entry.pullRequest.head?.ref ?? "").startsWith("upload/"),
    );
    // The approval policy only ever answers "how many approvals does this
    // change still need", so a document with nothing in flight has no question
    // to ask — and most of them don't. Asking anyway spent a Gitea round trip
    // per row, which across a workspace was the largest part of this cost.
    //
    // A row is worth showing without its approval policy; it is not worth
    // failing the whole list for.
    const requiredApprovals =
      pending.length > 0 ? await readRequiredApprovals(owner, repo) : null;

    return {
      latestTag,
      pendingPRs: pending
        .map((entry) => buildPendingChangeRow(entry, requiredApprovals))
        .sort((left, right) => (right.number ?? 0) - (left.number ?? 0)),
      error: null,
    };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unable to load document details.";
    logger.error("Failed to load details for repo", {
      repo,
      owner,
      message: errorMessage,
    });
    return {
      latestTag: null,
      pendingPRs: [] as PendingChangeRow[],
      error: errorMessage,
    };
  }
}

async function handleDocuments(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  // A read. Never gated — see resolveDocumentAccess.
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { session: _session, client } = auth;
  const reqUrl = new URL(req.url);
  const ownerUsername = reqUrl.searchParams.get("owner") || undefined;
  const memberUsername = reqUrl.searchParams.get("member") || undefined;
  const freeText = reqUrl.searchParams.get("q") || undefined;
  const page = parsePositiveIntInput(reqUrl.searchParams.get("page"), 1);
  const limit = Math.min(
    parsePositiveIntInput(
      reqUrl.searchParams.get("limit"),
      DOCUMENTS_PAGE_SIZE,
    ),
    MAX_DOCUMENTS_PAGE_SIZE,
  );

  try {
    // One page, always. The unpaged read asked Gitea for a hardcoded 100 and
    // silently dropped anything past it, so a workspace's 101st document
    // simply did not exist as far as this list was concerned.
    const { repos, hasMore } = await searchWorkspaceReposPage({
      client,
      q: freeText,
      ownerUsername,
      memberUsername,
      page,
      limit,
    });
    const documents = await Promise.all(
      repos.map(async (repo) => ({
        repo: normalizeWorkspaceRepoSummary(repo),
        ...(await loadOpenChangeSummary(client, repo.owner.login, repo.name)),
      })),
    );

    return json(200, { documents, page, limit, hasMore }, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load workspace documents.",
    );
  }
}

/**
 * Everything the home page shows, in one request.
 *
 * Home asks "which changes am I part of", which is a filter across the whole
 * workspace rather than a prefix of any list — so it cannot be paged, and it
 * used to be answered by scanning every document and then asking each one for
 * its closed changes too. That cost grew with the workspace while the answer
 * did not: a reader with a dozen changes in flight has a dozen rows whether
 * the workspace holds thirty documents or three thousand.
 *
 * Gitea can answer it directly, so the search picks the candidates and the
 * expensive per-change reads are spent only where they can produce a row.
 */
async function handleHomeChanges(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  // A read. Never gated — see resolveDocumentAccess.
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client, session } = auth;

  try {
    const [openRefs, closedRefs] = await Promise.all([
      searchInvolvedChanges({
        client,
        state: "open",
        ownedBy: session.username,
      }),
      searchInvolvedChanges({
        client,
        state: "closed",
        ownedBy: session.username,
        limit: HOME_DECIDED_CANDIDATES,
      }),
    ]);

    // Open changes are read per repository, because the reader's own rows are
    // classified against every change in flight on that document — an approval
    // policy is met or not against all of them, not just the ones they touched.
    const openRepos = distinctRepoRefs(openRefs);

    // Decided changes are read per change instead. A document's history has no
    // upper bound, and home shows a handful of the most recent, so scanning
    // whole repositories here would pay for years of records to print five.
    const decidedByRepo = groupRefsByRepo(
      closedRefs.slice(0, HOME_DECIDED_CANDIDATES),
    );

    const [open, decided] = await Promise.all([
      Promise.all(
        openRepos.map(async ({ owner, repo }) => ({
          repo: { name: repo, owner: { login: owner } },
          ...(await loadOpenChangeSummary(client, owner, repo)),
        })),
      ),
      Promise.all(
        decidedByRepo.map(({ owner, repo, numbers }) =>
          loadDecidedChanges(client, owner, repo, numbers),
        ),
      ),
    ]);

    return json(200, { open, decided }, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load your change requests.",
    );
  }
}

/** The distinct repositories a set of change references touches. */
function distinctRepoRefs(
  refs: InvolvedChangeRef[],
): Array<{ owner: string; repo: string }> {
  const seen = new Map<string, { owner: string; repo: string }>();
  for (const ref of refs) {
    const key = `${ref.owner}/${ref.repo}`;
    if (!seen.has(key)) seen.set(key, { owner: ref.owner, repo: ref.repo });
  }
  return [...seen.values()];
}

/** The same references, gathered so one repository is read once. */
function groupRefsByRepo(
  refs: InvolvedChangeRef[],
): Array<{ owner: string; repo: string; numbers: number[] }> {
  const groups = new Map<
    string,
    { owner: string; repo: string; numbers: number[] }
  >();
  for (const ref of refs) {
    const key = `${ref.owner}/${ref.repo}`;
    const group = groups.get(key);
    if (group) {
      group.numbers.push(ref.number);
    } else {
      groups.set(key, {
        owner: ref.owner,
        repo: ref.repo,
        numbers: [ref.number],
      });
    }
  }
  return [...groups.values()];
}

/**
 * Named decided changes from one document.
 *
 * The tags are what turn a merged change into "published as v3", so they are
 * read per document rather than per change.
 */
async function loadDecidedChanges(
  client: GiteaClient,
  owner: string,
  repo: string,
  numbers: number[],
) {
  try {
    const [tags, requiredApprovals, entries] = await Promise.all([
      listDocTags(client, owner, repo),
      readRequiredApprovals(owner, repo),
      Promise.all(
        numbers.map((pullNumber) =>
          getPullRequestWithReviews({ client, owner, repo, pullNumber }),
        ),
      ),
    ]);

    return {
      owner,
      repo,
      changes: buildClosedChanges(entries, tags, requiredApprovals),
    };
  } catch (err) {
    // A document that will not answer contributes nothing to the section
    // rather than emptying it.
    logger.error("Failed to load decided changes for repo", {
      owner,
      repo,
      message: err instanceof Error ? err.message : String(err),
    });
    return { owner, repo, changes: [] as ClosedChange[] };
  }
}

async function handleCreateDocument(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
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

    // Read buffer once to compute hash and base64
    const buffer = await file.arrayBuffer();
    const [fullHash, base64Content] = await Promise.all([
      computeFileHashFromBuffer(buffer),
      Buffer.from(buffer).toString("base64"),
    ]);
    const contentHash8 = fullHash.slice(0, 8);
    const branchName = buildUploadBranchName(repoName, owner, contentHash8);

    // Sequential initialization to avoid sqlite locking issues in gitea.
    // We keep bootstrapEmptyMainBranch to ensure a clean starting point.
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
      isNewFile: true,
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
  const access = await resolveDocumentAccess(req, baseHeaders, owner, repo);
  if (access instanceof Response) {
    return access;
  }

  const { client, username } = access;

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

    const [
      tags,
      openWithReviews,
      branchProtection,
      requiredApprovals,
      reviewSettings,
    ] = await Promise.all([
      listDocTags(client, owner, repo),
      listPullRequestsWithReviews({
        client,
        owner,
        repo,
        state: "open",
      }),
      // The whole rule, whitelists and all, is admin-only and stays that way:
      // a non-admin gets null here and the count below regardless.
      getRepoBranchProtection(client, owner, repo, "main").catch(() => null),
      readRequiredApprovals(owner, repo),
      getReviewSettings({ client, owner, repo }).catch(() => null),
    ]);

    // The reviews come back with the pull requests anyway, and a change's page
    // reads as a log of what happened — an approval is part of that log, so it
    // travels with the change rather than costing a second round trip. The
    // reviewer list is the same reviews read a different way: not what happened,
    // but who the change is still waiting on.
    const openPullRequests = openWithReviews.map((entry) => ({
      ...entry.pullRequest,
      reviews: toVersionReviews(entry.reviews),
      reviewers: buildChangeReviewers({
        requested: readRequestedReviewers(entry.pullRequest),
        reviews: entry.reviews,
        submittedBy: entry.pullRequest.user?.login ?? "",
      }),
      assignee: readAssignee(entry.pullRequest),
      approvalCount: countApprovals(entry.reviews),
      requiredApprovals,
    }));

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

    const currentUserPermission = username
      ? await resolveCurrentUserPermission(client, owner, repo, username).catch(
          () => null,
        )
      : null;

    return json(
      200,
      {
        repository,
        tags,
        latestTag,
        openPullRequests,
        uploadPullRequests,
        branchProtection,
        reviewSettings,
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

/**
 * The approval trail: every published version with the review that let it
 * through. Kept off the detail payload because it costs a review lookup per
 * closed pull request, and the document view itself does not need it.
 */
async function handleDocumentHistory(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const access = await resolveDocumentAccess(req, baseHeaders, owner, repo);
  if (access instanceof Response) {
    return access;
  }

  const { client } = access;

  try {
    const [tags, closedPullRequests] = await Promise.all([
      listDocTags(client, owner, repo),
      listPullRequestsWithReviews({
        client,
        owner,
        repo,
        state: "closed",
      }),
    ]);

    const merged: PullRequestWithReviews[] = closedPullRequests.filter(
      (entry) => entry.pullRequest.approvalState === "published",
    );

    // Comment counts are decoration, not the record — a failure here must not
    // cost the user their history.
    //
    // The publisher is not decoration: the spline names the person who put
    // each version on the record. Gitea only fills `merged_by` in on a single
    // pull request's own endpoint, never in the list, so it is read per change
    // here. A read that fails leaves that one version unattributed rather than
    // failing the whole history.
    const discussionCounts = new Map<number, number>();
    const publishers = new Map<number, string>();
    await Promise.all(
      merged.map(async (entry) => {
        const pullNumber = entry.pullRequest.number;
        if (!pullNumber) return;

        const [summary, detail] = await Promise.all([
          listDiscussions({ client, owner, repo, pullNumber }).catch(
            () => null,
          ),
          getPullRequestWithReviews({ client, owner, repo, pullNumber }).catch(
            () => null,
          ),
        ]);

        if (summary) {
          discussionCounts.set(pullNumber, summary.totalCount);
        }

        const publisher = detail?.pullRequest.merged_by?.login;
        if (publisher) {
          publishers.set(pullNumber, publisher);
        }
      }),
    );

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

    return json(
      200,
      {
        versions: buildVersionRecords(
          tags,
          merged,
          discussionCounts,
          publishers,
        ),
        canonicalFile,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load the version history.",
    );
  }
}

/**
 * Changes that are no longer open, and how each one ended.
 *
 * Loaded on its own rather than with the document detail: it costs a review
 * lookup per closed change, and that bill grows with every version a document
 * ever had. Nobody should pay it just to open the document.
 */
async function handleClosedChanges(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const access = await resolveDocumentAccess(req, baseHeaders, owner, repo);
  if (access instanceof Response) {
    return access;
  }

  const { client } = access;

  try {
    const [tags, closedPullRequests, requiredApprovals] = await Promise.all([
      listDocTags(client, owner, repo),
      listPullRequestsWithReviews({
        client,
        owner,
        repo,
        state: "closed",
      }),
      readRequiredApprovals(owner, repo),
    ]);

    return json(
      200,
      {
        changes: buildClosedChanges(
          closedPullRequests,
          tags,
          requiredApprovals,
        ),
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load the closed changes.",
    );
  }
}

async function handleDocumentVersions(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
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
  const auth = await requireSubscription(req, baseHeaders);
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

/** Distinct, trimmed usernames, in the order they were given. */
function readUsernameList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const logins: string[] = [];
  for (const entry of value) {
    const login = typeof entry === "string" ? entry.trim() : "";
    if (login && !logins.includes(login)) {
      logins.push(login);
    }
  }

  return logins;
}

/**
 * Put a change on someone's desk.
 *
 * Both halves are Gitea primitives — the assignee is the pull request's
 * assignee, the reviewers are its review requests — so nothing new is stored
 * and Gitea keeps enforcing who is allowed to set them. Reviewers arrive as
 * the whole list rather than a delta: the caller says who should be on the
 * change, and the difference against what Gitea already holds is worked out
 * here, so two people editing at once cannot double-add anybody.
 */
async function handleUpdateChangeAssignments(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const { client } = auth;
  const payload = (await readJsonBody(req)) ?? null;

  const assigneeGiven = payload !== null && "assignee" in payload;
  const rawAssignee = payload?.assignee;
  if (
    assigneeGiven &&
    rawAssignee !== null &&
    typeof rawAssignee !== "string"
  ) {
    return json(
      400,
      { error: "assignee must be a username or null." },
      baseHeaders,
    );
  }
  const assignee = typeof rawAssignee === "string" ? rawAssignee.trim() : null;

  const reviewersGiven = payload !== null && "reviewers" in payload;
  const reviewers = reviewersGiven
    ? readUsernameList(payload?.reviewers)
    : null;
  if (reviewersGiven && reviewers === null) {
    return json(
      400,
      { error: "reviewers must be an array of usernames." },
      baseHeaders,
    );
  }

  if (!assigneeGiven && !reviewersGiven) {
    return json(
      400,
      { error: "Provide an assignee, a reviewer list, or both." },
      baseHeaders,
    );
  }

  try {
    const before = await getPullRequestWithReviews({
      client,
      owner,
      repo,
      pullNumber: prNumber,
    });
    const submittedBy = before.pullRequest.user?.login ?? "";

    if (assigneeGiven) {
      await setPullRequestAssignees({
        client,
        owner,
        repo,
        pullNumber: prNumber,
        assignees: assignee ? [assignee] : [],
      });
    }

    if (reviewers) {
      const { add, remove } = planReviewerChanges({
        current: readRequestedReviewers(before.pullRequest)
          .map((user) => user.login?.trim() ?? "")
          .filter(Boolean),
        wanted: reviewers,
        submittedBy,
      });

      await requestPullReviewers({
        client,
        owner,
        repo,
        pullNumber: prNumber,
        reviewers: add,
      });

      await removePullReviewers({
        client,
        owner,
        repo,
        pullNumber: prNumber,
        reviewers: remove,
      });
    }

    const [after, requiredApprovals] = await Promise.all([
      getPullRequestWithReviews({
        client,
        owner,
        repo,
        pullNumber: prNumber,
      }),
      readRequiredApprovals(owner, repo),
    ]);

    return json(
      200,
      {
        assignee: readAssignee(after.pullRequest),
        reviewers: buildChangeReviewers({
          requested: readRequestedReviewers(after.pullRequest),
          reviews: after.reviews,
          submittedBy: after.pullRequest.user?.login ?? submittedBy,
        }),
        approvalCount: countApprovals(after.reviews),
        requiredApprovals,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to update who this change is assigned to.",
    );
  }
}

async function handleListDiscussions(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Response> {
  const access = await resolveDocumentAccess(req, baseHeaders, owner, repo);
  if (access instanceof Response) {
    return access;
  }

  try {
    const discussions = await listDiscussions({
      client: access.client,
      owner,
      repo,
      pullNumber: prNumber,
      viewerLogin: access.username,
      withReactions: true,
    });
    return json(200, discussions, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load review discussion.",
    );
  }
}

/**
 * Every version this change has proposed, oldest first.
 *
 * The commits on the change's branch are the updates — an answer to a reviewer
 * is a new upload, and Gitea has already recorded it. Loaded on its own rather
 * than with the change: the Changes tab lists changes, and a list has no use
 * for the history inside each one.
 */
async function handleChangeUpdates(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Response> {
  const access = await resolveDocumentAccess(req, baseHeaders, owner, repo);
  if (access instanceof Response) {
    return access;
  }

  const { client } = access;

  try {
    const { pullRequest } = await getPullRequestWithReviews({
      client,
      owner,
      repo,
      pullNumber: prNumber,
    });

    const branch = pullRequest.branchName;
    if (!branch) {
      // A published or withdrawn change has had its branch deleted. The record
      // of what it proposed is the published version now, not a branch.
      return json(200, { updates: [], resetsApprovals: false }, baseHeaders);
    }

    const base = pullRequest.base?.ref || "main";

    const [commits, branchProtection] = await Promise.all([
      listBranchUpdates({
        client,
        owner,
        repo,
        branch,
        base,
        limit: CHANGE_UPDATE_LIMIT,
      }),
      getRepoBranchProtection(client, owner, repo, base).catch(() => null),
    ]);

    return json(
      200,
      {
        updates: buildChangeUpdates(commits),
        resetsApprovals: branchProtection?.dismissStaleApprovals ?? false,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load this change's updates.",
    );
  }
}

async function handleCreateDiscussionThread(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const payload = (await readJsonBody(req)) ?? null;
  const form = payload ? null : await readMultipartBody(req);
  const body = readInputString(payload, form, "body");

  if (!body.trim()) {
    return json(400, { error: "A comment body is required." }, baseHeaders);
  }

  try {
    const discussions = await createDiscussionThread({
      client: auth.client,
      owner,
      repo,
      pullNumber: prNumber,
      body,
      viewerLogin: auth.session.username,
      withReactions: true,
    });
    return json(201, discussions, baseHeaders);
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to start a thread.");
  }
}

async function handleReplyToDiscussion(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
  threadId: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const payload = (await readJsonBody(req)) ?? null;
  const form = payload ? null : await readMultipartBody(req);
  const body = readInputString(payload, form, "body");

  if (!body.trim()) {
    return json(400, { error: "A comment body is required." }, baseHeaders);
  }

  try {
    const discussions = await replyToDiscussion({
      client: auth.client,
      owner,
      repo,
      pullNumber: prNumber,
      threadId,
      body,
      viewerLogin: auth.session.username,
      withReactions: true,
    });
    return json(201, discussions, baseHeaders);
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to post the reply.");
  }
}

async function handleResolveDiscussion(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
  threadId: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const payload = (await readJsonBody(req)) ?? null;
  const form = payload ? null : await readMultipartBody(req);
  const resolvedRaw = payload
    ? payload.resolved
    : readInputString(null, form, "resolved");

  // Require an explicit value. Defaulting a malformed request to `false` would
  // silently reopen a resolved thread and write a bogus event into the record.
  const resolved =
    typeof resolvedRaw === "boolean"
      ? resolvedRaw
      : resolvedRaw === "true"
        ? true
        : resolvedRaw === "false"
          ? false
          : null;

  if (resolved === null) {
    return json(400, { error: "resolved must be true or false." }, baseHeaders);
  }

  try {
    const discussions = await setDiscussionResolution({
      client: auth.client,
      owner,
      repo,
      pullNumber: prNumber,
      threadId,
      resolved,
      viewerLogin: auth.session.username,
      withReactions: true,
    });
    return json(200, discussions, baseHeaders);
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to update the thread status.",
    );
  }
}

/**
 * Leave or take back a reaction on one comment in a review thread.
 *
 * A reaction is not a review and not a resolution: it changes nothing about
 * whether this version can be published. It is here so that agreeing with a
 * concern does not cost the record another comment.
 */
async function handleSetCommentReaction(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
  threadId: string,
  commentId: number,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  if (!Number.isSafeInteger(commentId) || commentId <= 0) {
    return json(400, { error: "Invalid comment id." }, baseHeaders);
  }

  const payload = (await readJsonBody(req)) ?? null;
  const form = payload ? null : await readMultipartBody(req);
  const content = readInputString(payload, form, "content");
  const onRaw = payload ? payload.on : readInputString(null, form, "on");

  if (!isSupportedReaction(content)) {
    return json(
      400,
      { error: "That is not a reaction you can leave here." },
      baseHeaders,
    );
  }

  // Require an explicit value, the same way resolution does: defaulting a
  // malformed request to `false` would quietly delete somebody's reaction.
  const on =
    typeof onRaw === "boolean"
      ? onRaw
      : onRaw === "true"
        ? true
        : onRaw === "false"
          ? false
          : null;

  if (on === null) {
    return json(400, { error: "on must be true or false." }, baseHeaders);
  }

  try {
    const discussions = await setCommentReactionInThread({
      client: auth.client,
      owner,
      repo,
      pullNumber: prNumber,
      threadId,
      commentId,
      content,
      on,
      viewerLogin: auth.session.username,
    });
    return json(200, discussions, baseHeaders);
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to save the reaction.");
  }
}

async function handleDocumentPublish(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
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
    // Enforce "resolve every thread before publishing". Gitea has no
    // equivalent of GitHub's required conversation resolution, so the gate
    // lives here — the BFF is the only path to a merge, so this cannot be
    // bypassed from the browser. Checked before the merge, never after.
    const reviewSettings = await getReviewSettings({ client, owner, repo });
    if (reviewSettings.blockOnUnresolvedThreads) {
      const discussions = await listDiscussions({
        client,
        owner,
        repo,
        pullNumber: prNumber,
      });

      if (discussions.unresolvedCount > 0) {
        return json(
          409,
          {
            error:
              discussions.unresolvedCount === 1
                ? "This version has 1 unresolved discussion thread. Resolve it before publishing."
                : `This version has ${discussions.unresolvedCount} unresolved discussion threads. Resolve them before publishing.`,
            unresolvedCount: discussions.unresolvedCount,
          },
          baseHeaders,
        );
      }
    }

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
  const access = await resolveDocumentAccess(req, baseHeaders, owner, repo);
  if (access instanceof Response) {
    return access;
  }

  const { client, token } = access;
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

    const downloadAuthHeaders: HeadersInit = token
      ? { Authorization: buildTokenAuthHeader(token), Accept: "*/*" }
      : { Accept: "*/*" };

    const response = await giteaFetch(
      `/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodeURIComponent(canonicalFile.storedFileName)}?ref=${encodeURIComponent(ref)}`,
      {
        method: "GET",
        headers: downloadAuthHeaders,
      },
    );

    if (!response.ok) {
      const errorMessage = await readGiteaErrorMessage(
        response,
        "Unable to download document.",
      );
      logger.error("Gitea fetch failure on document download", {
        status: response.status,
        owner,
        repo,
        ref,
        message: errorMessage,
      });
      return json(response.status, { error: errorMessage }, baseHeaders);
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
  const access = await resolveDocumentAccess(req, baseHeaders, owner, repo);
  if (access instanceof Response) {
    return access;
  }

  const { client, username } = access;
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

    const currentUserPermission = username
      ? await resolveCurrentUserPermission(client, owner, repo, username).catch(
          () => null,
        )
      : null;

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
  const auth = await requireSubscriptionOrAdmin(req, baseHeaders);
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

function serializeSubscriptionOverride(
  override: SubscriptionAccessOverrideRecord | null,
) {
  if (!override) {
    return null;
  }

  return {
    access: override.access,
    mode: override.access,
    reason: override.reason,
    updatedBy: override.updatedBy,
    updatedAt: override.updatedAt,
  };
}

function accessStateUpdatedAt(access: EffectiveSubscriptionAccess): number {
  return Math.max(
    access.subscription?.updatedAt ?? 0,
    access.override?.updatedAt ?? 0,
  );
}

/**
 * One row of the admin access console.
 *
 * The console is addressed by person because that is who an admin can name,
 * but everything it reports and everything it changes belongs to that person's
 * **organization** — so `organization` is on every row, and an account with
 * none says so rather than silently reading as "no access".
 */
async function buildAdminSubscriptionAccessEntry(
  client: GiteaClient,
  user: Pick<RepoUserSummary, "login" | "full_name" | "email">,
) {
  const organization = await resolveOrganizationForUser(client, user.login);
  const accessState = await resolveSubscriptionAccessState(
    user.login,
    organization,
  );

  return {
    username: user.login,
    fullName: user.full_name || undefined,
    email: user.email || undefined,
    organization: accessState.organization,
    hasAccess: accessState.hasAccess,
    accessSource: accessState.source,
    status: accessState.status,
    stripeStatus: accessState.stripeStatus,
    currentPeriodEnd: accessState.currentPeriodEnd,
    cancelAtPeriodEnd: accessState.cancelAtPeriodEnd,
    cancelAt: accessState.cancelAt,
    trialEndsAt: accessState.trialEndsAt,
    override: serializeSubscriptionOverride(accessState.override),
  };
}

/**
 * One row of the browse listing, built from an organization outward.
 *
 * The admin console acts on people, so a row is labelled with one of the
 * organization's owners — the same humans ADR 0004 says can change billing.
 */
async function buildAdminOrganizationAccessEntry(
  client: GiteaClient,
  access: EffectiveSubscriptionAccess,
) {
  const organization = await organizationStore.get(access.giteaOrgId);
  const owners = organization
    ? await listOrganizationOwners({ client, org: organization.name }).catch(
        () => [],
      )
    : [];
  const owner = owners[0] ?? null;

  return {
    username: owner?.login ?? "",
    fullName: owner?.fullName || undefined,
    email: owner?.email || undefined,
    organization: organization
      ? { id: organization.giteaOrgId, name: organization.name }
      : { id: access.giteaOrgId, name: "" },
    hasAccess: access.hasAccess,
    accessSource: access.source,
    status:
      access.source === "admin_grant"
        ? "active"
        : access.source === "admin_revoke"
          ? "revoked"
          : access.source === "trial"
            ? "trialing"
            : (access.subscription?.status ?? null),
    stripeStatus: access.subscription?.status ?? null,
    currentPeriodEnd: access.subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: access.subscription?.cancelAtPeriodEnd ?? false,
    cancelAt: access.subscription?.cancelAt ?? null,
    trialEndsAt: access.trialEndsAt,
    override: serializeSubscriptionOverride(access.override),
  };
}

async function findExactGiteaUser(
  client: GiteaClient,
  username: string,
): Promise<RepoUserSummary | null> {
  const result = await searchUsers({
    client,
    query: username,
    page: 1,
    limit: 20,
  });

  const normalizedUsername = username.trim().toLowerCase();
  return (
    result.users.find(
      (candidate) =>
        candidate.login.trim().toLowerCase() === normalizedUsername,
    ) ?? null
  );
}

async function handleAdminSubscriptionAccessList(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireAdminSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const page = parsePositiveIntInput(url.searchParams.get("page"), 1);
  const limit = parsePositiveIntInput(url.searchParams.get("limit"), 12);

  if (query === "") {
    // Browsing rather than searching. What we know billing about is
    // organizations, so this walks those — and names each row by one of the
    // org's owners, since a username is what the admin can act on.
    const offset = (page - 1) * limit;
    const accessRows = (await subscriptionStore.listKnownAccessStates()).sort(
      (left, right) => {
        const updatedAtDiff =
          accessStateUpdatedAt(right) - accessStateUpdatedAt(left);
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }

        return left.giteaOrgId - right.giteaOrgId;
      },
    );
    const hasMore = accessRows.length > offset + limit;
    const users = await Promise.all(
      accessRows
        .slice(offset, offset + limit)
        .map((access) =>
          buildAdminOrganizationAccessEntry(auth.client, access),
        ),
    );

    return json(
      200,
      {
        users,
        page,
        limit,
        hasMore,
        query,
      },
      baseHeaders,
    );
  }

  try {
    const result = await searchUsers({
      client: auth.client,
      query,
      page,
      limit,
    });

    return json(
      200,
      {
        users: await Promise.all(
          result.users.map((user) =>
            buildAdminSubscriptionAccessEntry(auth.client, user),
          ),
        ),
        page: result.page,
        limit: result.limit,
        hasMore: result.hasMore,
        query,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load admin subscription access.",
    );
  }
}

async function handleAdminSubscriptionAccessUpdate(
  req: Request,
  baseHeaders: Headers,
  rawUsername: string,
): Promise<Response> {
  const auth = await requireAdminSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const username = decodePathParam(rawUsername).trim();
  if (username === "") {
    return json(400, { error: "Username is required." }, baseHeaders);
  }

  const payload = await readJsonBody(req);
  const accessInput =
    readInputString(payload, null, "access") ||
    readInputString(payload, null, "mode");
  const access = accessInput.toLowerCase();
  if (access !== "grant" && access !== "revoke") {
    return json(400, { error: "access must be grant or revoke." }, baseHeaders);
  }

  if (username === auth.currentUser.username) {
    return json(
      400,
      { error: "Admin overrides can only target another user." },
      baseHeaders,
    );
  }

  const reasonInput = readInputString(payload, null, "reason");
  const reason = reasonInput === "" ? null : reasonInput;

  // An override belongs to an organization, not a person: ADR 0004 bills the
  // org, so comping or cutting off one member of it would be meaningless.
  const organization = await resolveOrganizationForUser(auth.client, username);
  if (!organization) {
    return json(
      404,
      {
        error: `${username} is not in an organization, so there is nothing to override.`,
      },
      baseHeaders,
    );
  }

  await subscriptionStore.putAccessOverride({
    giteaOrgId: organization.id,
    access,
    reason,
    updatedBy: auth.currentUser.username,
    updatedAt: Date.now(),
  });

  return json(
    200,
    {
      user: await buildAdminSubscriptionAccessEntry(auth.client, {
        login: username,
        full_name: "",
        email: "",
      }),
    },
    baseHeaders,
  );
}

async function handleAdminSubscriptionAccessDelete(
  req: Request,
  baseHeaders: Headers,
  rawUsername: string,
): Promise<Response> {
  const auth = await requireAdminSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const username = decodePathParam(rawUsername).trim();
  if (username === "") {
    return json(400, { error: "Username is required." }, baseHeaders);
  }

  if (username === auth.currentUser.username) {
    return json(
      400,
      { error: "Admin overrides can only target another user." },
      baseHeaders,
    );
  }

  const organization = await resolveOrganizationForUser(auth.client, username);
  if (!organization) {
    return json(
      404,
      {
        error: `${username} is not in an organization, so there is no override to clear.`,
      },
      baseHeaders,
    );
  }

  await subscriptionStore.deleteAccessOverride(organization.id);

  return json(
    200,
    {
      ok: true,
      username,
      user: await buildAdminSubscriptionAccessEntry(auth.client, {
        login: username,
        full_name: "",
        email: "",
      }),
    },
    baseHeaders,
  );
}

async function handleAddCollaborator(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
  login: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
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
  const auth = await requireSubscription(req, baseHeaders);
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

async function handleGetDocumentPermissions(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  // A read: who may act on this binder, and what the rules are. Changing any
  // of it is the PUT, and that is still gated.
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;
  const { client, session } = auth;

  try {
    const [branchProtection, repoInfo, currentUserPermission, reviewSettings] =
      await Promise.all([
        getRepoBranchProtection(client, owner, repo, "main").catch(() => null),
        getRepoInfo({ client, owner, repo }),
        resolveCurrentUserPermission(
          client,
          owner,
          repo,
          session.username,
        ).catch(() => null),
        getReviewSettings({ client, owner, repo }).catch(() => null),
      ]);

    return json(
      200,
      {
        branchProtection,
        isPrivate: repoInfo.isPrivate,
        isInternal: repoInfo.isInternal,
        currentUserPermission,
        reviewSettings,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to load document permissions.",
    );
  }
}

async function handleUpdateDocumentPermissions(
  req: Request,
  baseHeaders: Headers,
  owner: string,
  repo: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;
  const { client, session } = auth;

  // Changing review policy or branch protection is a governance action:
  // the owner and admin collaborators may do it, write access is not enough.
  if (session.username !== owner) {
    const permission = await resolveCurrentUserPermission(
      client,
      owner,
      repo,
      session.username,
    ).catch(() => null);

    if (permission?.access !== "admin" && permission?.access !== "owner") {
      return json(
        403,
        {
          error:
            "Only the document owner or an admin collaborator can change permissions.",
        },
        baseHeaders,
      );
    }
  }

  const payload = await readJsonBody(req);

  const requiredApprovals =
    typeof payload?.requiredApprovals === "number"
      ? Math.max(0, Math.floor(payload.requiredApprovals))
      : undefined;
  const enableApprovalsWhitelist =
    typeof payload?.enableApprovalsWhitelist === "boolean"
      ? payload.enableApprovalsWhitelist
      : undefined;
  const approvalsWhitelistUsernames = Array.isArray(
    payload?.approvalsWhitelistUsernames,
  )
    ? (payload.approvalsWhitelistUsernames as unknown[]).filter(
        (u): u is string => typeof u === "string",
      )
    : undefined;
  const enableMergeWhitelist =
    typeof payload?.enableMergeWhitelist === "boolean"
      ? payload.enableMergeWhitelist
      : undefined;
  const mergeWhitelistUsernames = Array.isArray(
    payload?.mergeWhitelistUsernames,
  )
    ? (payload.mergeWhitelistUsernames as unknown[]).filter(
        (u): u is string => typeof u === "string",
      )
    : undefined;
  const isPrivate =
    typeof payload?.isPrivate === "boolean" ? payload.isPrivate : undefined;
  const dismissStaleApprovals =
    typeof payload?.dismissStaleApprovals === "boolean"
      ? payload.dismissStaleApprovals
      : undefined;
  const blockOnUnresolvedThreads =
    typeof payload?.blockOnUnresolvedThreads === "boolean"
      ? payload.blockOnUnresolvedThreads
      : undefined;

  try {
    const updates: Array<Promise<unknown>> = [];

    const hasBranchUpdate =
      requiredApprovals !== undefined ||
      enableApprovalsWhitelist !== undefined ||
      approvalsWhitelistUsernames !== undefined ||
      enableMergeWhitelist !== undefined ||
      mergeWhitelistUsernames !== undefined ||
      dismissStaleApprovals !== undefined;

    if (hasBranchUpdate) {
      updates.push(
        updateRepoBranchProtection({
          client,
          owner,
          repo,
          ruleName: "main",
          requiredApprovals,
          enableApprovalsWhitelist,
          approvalsWhitelistUsernames,
          enableMergeWhitelist,
          mergeWhitelistUsernames,
          dismissStaleApprovals,
        }),
      );
    }

    if (isPrivate !== undefined) {
      updates.push(updateRepoVisibility({ client, owner, repo, isPrivate }));
    }

    if (blockOnUnresolvedThreads !== undefined) {
      updates.push(
        updateReviewSettings({
          client,
          owner,
          repo,
          settings: { blockOnUnresolvedThreads },
          actor: session.username,
        }),
      );
    }

    await Promise.all(updates);

    const [branchProtection, repoInfo, reviewSettings] = await Promise.all([
      getRepoBranchProtection(client, owner, repo, "main").catch(() => null),
      getRepoInfo({ client, owner, repo }),
      getReviewSettings({ client, owner, repo }).catch(() => null),
    ]);

    return json(
      200,
      {
        branchProtection,
        isPrivate: repoInfo.isPrivate,
        isInternal: repoInfo.isInternal,
        reviewSettings,
      },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(
      err,
      baseHeaders,
      "Unable to update document permissions.",
    );
  }
}

async function handleStripeWebhook(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const rawBody = await req.text();
  const sigHeader = req.headers.get("stripe-signature") ?? "";

  if (!config.stripeWebhookSecret) {
    logger.warn(
      "Stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured — rejecting",
    );
    return json(400, { error: "Webhook secret not configured." }, baseHeaders);
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sigHeader,
      config.stripeWebhookSecret,
    );
  } catch (err) {
    logger.warn("Stripe webhook signature verification failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return json(400, { error: "Invalid signature." }, baseHeaders);
  }

  const type = event.type;
  const eventId = event.id;
  const eventCreated = event.created;
  const data = event.data.object as unknown as Record<string, unknown>;
  const customerId = data?.customer as string | undefined;

  logger.info("Stripe webhook received", { type, eventId });

  if (eventId && (await webhookEventStore.isProcessed(eventId))) {
    logger.info("Duplicate webhook event — skipping", { eventId, type });
    return json(200, { received: true }, baseHeaders);
  }

  if (
    customerId &&
    eventCreated !== undefined &&
    (await webhookEventStore.isOutOfOrder(customerId, eventCreated))
  ) {
    logger.info("Out-of-order webhook event — skipping", {
      eventId,
      type,
      customerId,
      eventCreated,
    });
    if (eventId) {
      await webhookEventStore.markProcessed(
        eventId,
        type ?? "unknown",
        customerId,
        eventCreated,
      );
    }
    return json(200, { received: true }, baseHeaders);
  }

  if (type === "checkout.session.completed" && data) {
    // client_reference_id carries the Gitea org id — checkout is bought by an
    // organization. Session metadata is the fallback for a session created
    // before the re-key.
    const sessionMetadata = (data.metadata ?? {}) as Record<string, unknown>;
    const orgIdRaw =
      (data.client_reference_id as string | undefined) ??
      (typeof sessionMetadata.bindersnap_gitea_org_id === "string"
        ? sessionMetadata.bindersnap_gitea_org_id
        : undefined);
    const giteaOrgId = orgIdRaw ? Number.parseInt(orgIdRaw, 10) : NaN;
    const username =
      typeof sessionMetadata.bindersnap_username === "string"
        ? sessionMetadata.bindersnap_username
        : null;
    const customerId = data.customer as string | undefined;
    const subscriptionId = data.subscription as string | undefined;

    if (
      Number.isSafeInteger(giteaOrgId) &&
      giteaOrgId > 0 &&
      customerId &&
      subscriptionId
    ) {
      try {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await subscriptionStore.upsert(
          buildStripeSubscriptionRecord(
            giteaOrgId,
            customerId,
            sub as unknown as Record<string, unknown>,
          ),
        );
        logger.info("Subscription activated", {
          giteaOrgId,
          status: sub.status,
        });

        // Stamp the org id onto the Stripe Customer so later subscription
        // webhooks, which carry only a customer, can reconcile from it.
        try {
          await stripe.customers.update(customerId, {
            metadata: {
              bindersnap_gitea_org_id: String(giteaOrgId),
              ...(username ? { bindersnap_username: username } : {}),
            },
          });
          logger.info("Backfilled customer metadata", {
            customerId,
            giteaOrgId,
          });
        } catch (metadataErr) {
          // Non-fatal: subscription is already activated; log and continue.
          logger.warn("Failed to backfill customer metadata", {
            customerId,
            giteaOrgId,
            error:
              metadataErr instanceof Error
                ? metadataErr.message
                : String(metadataErr),
          });
        }
      } catch (err) {
        logger.error(
          "Could not fetch subscription details from Stripe — returning 500 so Stripe retries",
          {
            stripe_webhook_5xx: true,
            event_id: eventId,
            event_type: type,
            customer_id: customerId ?? null,
            giteaOrgId,
            subscriptionId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        // Return 500 so Stripe retries delivery (a 200 would suppress retries).
        return json(
          500,
          { error: "Failed to verify subscription; will retry." },
          baseHeaders,
        );
      }
    } else {
      logger.warn(
        "Checkout completed without a resolvable Bindersnap organization",
        {
          event_id: eventId,
          customer_id: customerId ?? null,
          client_reference_id: data.client_reference_id ?? null,
        },
      );
    }
  } else if (
    (type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted") &&
    data
  ) {
    const customerId = data.customer as string | undefined;
    const subscriptionId = data.id as string | undefined;
    if (customerId) {
      const record = await subscriptionStore.getByCustomerId(customerId);
      if (record) {
        await subscriptionStore.upsert({
          ...record,
          stripeSubscriptionId: subscriptionId ?? record.stripeSubscriptionId,
          status:
            (data.status as string) ??
            (type === "customer.subscription.deleted"
              ? "canceled"
              : record.status),
          currentPeriodEnd:
            extractCurrentPeriodEnd(data) ?? record.currentPeriodEnd,
          cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
          cancelAt: typeof data.cancel_at === "number" ? data.cancel_at : null,
          updatedAt: Date.now(),
        });
        logger.info("Subscription updated", {
          customer: customerId,
          status: data.status,
        });
      } else {
        const reconciled = await reconcileStripeCustomerByCustomerId(
          stripe,
          customerId,
          {
            subscription: data,
            now: Date.now(),
          },
        );
        if (reconciled) {
          await subscriptionStore.upsert(reconciled.record);
          logger.info(
            "Reconciled missing subscription row from Stripe customer metadata",
            {
              customer: customerId,
              giteaOrgId: reconciled.record.giteaOrgId,
              subscriptionId: reconciled.record.stripeSubscriptionId,
              eventType: type,
            },
          );
        } else {
          logger.warn(
            "Stripe subscription webhook could not reconcile missing local record",
            {
              customer: customerId,
              subscriptionId,
              eventType: type,
            },
          );
        }
      }
    }
  } else if (type === "invoice.payment_failed" && data) {
    const customerId = data.customer as string | undefined;
    if (customerId) {
      const record = await subscriptionStore.getByCustomerId(customerId);
      if (record && record.status !== "canceled") {
        await subscriptionStore.upsert({
          ...record,
          status: "past_due",
          updatedAt: Date.now(),
        });
        logger.info("Subscription marked past_due on invoice.payment_failed", {
          customer: customerId,
        });
      }
    }
  } else if (type === "invoice.payment_succeeded" && data) {
    const customerId = data.customer as string | undefined;
    if (customerId) {
      const record = await subscriptionStore.getByCustomerId(customerId);
      if (record && record.status === "past_due") {
        await subscriptionStore.upsert({
          ...record,
          status: "active",
          updatedAt: Date.now(),
        });
        logger.info(
          "Subscription restored to active on invoice.payment_succeeded",
          { customer: customerId },
        );
      }
    }
  }

  if (eventId) {
    await webhookEventStore.markProcessed(
      eventId,
      type ?? "unknown",
      customerId ?? null,
      eventCreated ?? 0,
    );
  }

  return json(200, { received: true }, baseHeaders);
}

/**
 * The organizations this session belongs to.
 *
 * Not gated on a subscription: this is the question a person with no
 * organization has to be able to ask, and gating it behind having one is a
 * loop with no way out.
 */
/**
 * The binders this session's organization owns.
 *
 * A read, so it is never gated (ADR 0004). A session with no organization has
 * no binders rather than an error — that is an ordinary state now that an
 * organization is something a person creates.
 */
/**
 * Add a document to a binder, as a file at a path.
 *
 * ADR 0004's step 2. The document is no longer a repository of its own: it is
 * a file inside the workspace that governs it, which is what makes one set of
 * rules and one set of people cover every policy in the binder.
 *
 * ADR 0001's contract is unchanged — upload lands on a branch and opens a pull
 * request, and nothing reaches `main` except a merged, approved change. Only
 * the target repository and the path are new.
 */
/**
 * The binder's documents.
 *
 * One recursive tree read instead of a repository search — the binder model's
 * whole cost argument, per ADR 0004: "the documents list drops from roughly
 * three Gitea calls per document to a handful per workspace".
 *
 * A read, so it is never gated.
 */
/**
 * Publish a change, and version every document it touched.
 *
 * ADR 0004 §4: the unit of approval is the change, not the document. One
 * approved change that revised three cross-referencing policies publishes three
 * versions — `infection-control/v4`, `handover/v2`, `medication/v7` — all
 * pointing at the same merge commit. Several tags on one commit is ordinary
 * git, and it is what keeps "who approved v4" answerable as tag → commit →
 * pull request → reviews.
 *
 * The unresolved-thread gate is unchanged from the per-repository publish and
 * still lives here: Gitea has no equivalent of GitHub's required conversation
 * resolution, and the BFF is the only path to a merge, so it cannot be
 * bypassed from the browser. Checked before the merge, never after.
 */
async function handlePublishWorkspaceChange(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  pullNumber: number,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;
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

  // Authorization comes from the token, not from a membership lookup: a binder
  // this session cannot see answers 404 from Gitea, which is the same answer a
  // binder that does not exist gives — and the right one either way.
  const owner = orgName;

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: owner,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    // Which documents this change covers has to be known before the merge:
    // afterwards the branch is gone, and with it the question's cheapest
    // answer.
    const documents = await listChangedDocuments({
      client,
      org: owner,
      workspace: workspaceName,
      pullNumber,
    });

    if (documents.length === 0) {
      return json(
        409,
        { error: "This change does not touch any document." },
        baseHeaders,
      );
    }

    const reviewSettings = await getReviewSettings({
      client,
      owner,
      repo: workspaceName,
    });
    if (reviewSettings.blockOnUnresolvedThreads) {
      const discussions = await listDiscussions({
        client,
        owner,
        repo: workspaceName,
        pullNumber,
      });

      if (discussions.unresolvedCount > 0) {
        return json(
          409,
          {
            error:
              discussions.unresolvedCount === 1
                ? "This change has 1 unresolved discussion thread. Resolve it before publishing."
                : `This change has ${discussions.unresolvedCount} unresolved discussion threads. Resolve them before publishing.`,
            unresolvedCount: discussions.unresolvedCount,
          },
          baseHeaders,
        );
      }
    }

    // Each document's next version is its own: they are versioned separately
    // and a binder's documents do not advance in lockstep. Read before the
    // merge so a failure here changes nothing.
    const nextVersions = await Promise.all(
      documents.map(async (document) => ({
        document,
        version: nextVersionFrom(
          await listDocumentVersions({
            client,
            org: owner,
            workspace: workspaceName,
            slugPath: document.slugPath,
          }),
        ),
      })),
    );

    await mergeWorkspaceChange({
      client,
      owner,
      repo: workspaceName,
      pullNumber,
      mergeStyle,
    });

    // Sequential: Gitea serializes repository writes, and a partial failure
    // here is easier to read in order than interleaved.
    const tags = [];
    for (const { document, version } of nextVersions) {
      tags.push(
        await createDocumentVersionTag({
          client,
          org: owner,
          workspace: workspaceName,
          slugPath: document.slugPath,
          version,
          target: "main",
        }),
      );
    }

    logger.info("Workspace change published", {
      username: session.username,
      organization: owner,
      workspace: workspaceName,
      pullNumber,
      tags: tags.map((tag) => tag.tag),
    });

    return json(200, { ok: true, tags }, baseHeaders);
  } catch (err) {
    logger.error("Failed to publish a workspace change", {
      username: session.username,
      organization: owner,
      workspace: workspaceName,
      pullNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to publish the change.");
  }
}

async function handleListWorkspaceDocuments(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  try {
    const workspace = await findWorkspaceRepo({
      client: auth.client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const documents = await listWorkspaceDocuments({
      client: auth.client,
      org: orgName,
      workspace: workspaceName,
    });

    // One call for the whole binder, then matched to documents by the upload
    // branch convention — rather than one pull request query per document,
    // which is the cost the binder exists to remove.
    const openChanges = await listPullRequests({
      client: auth.client,
      owner: orgName,
      repo: workspaceName,
      state: "open",
    });

    return json(
      200,
      {
        organization: orgName,
        workspace: workspaceName,
        documents: documents.map((document) => ({
          ...document,
          openChangeCount: openChanges.filter((pull) =>
            changeTouchesDocument(pull, document.slugPath),
          ).length,
        })),
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to list workspace documents", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to list the documents.");
  }
}

/**
 * Whether an open change is about this document.
 *
 * Matched on the upload branch convention — `upload/<slugPath>/…` — because
 * asking Gitea which files a pull request touches is a call per change, and
 * this list exists to stop paying per document. The answer only decides a
 * badge; nothing gates on it, so a convention is the right price.
 */
function changeTouchesDocument(
  pull: { head?: { ref?: string } | null },
  slugPath: string,
): boolean {
  const ref = pull.head?.ref ?? "";
  return ref.startsWith(`upload/${slugPath}/`);
}

/**
 * One document in a binder, with its published versions.
 *
 * Addressable by file path or by identity: a URL may carry
 * `clinical/infection-control` or `clinical/infection-control.pdf`, and the
 * extension is how we render a document rather than how a person refers to it.
 */
async function handleWorkspaceDocumentDetail(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  documentPath: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  try {
    const workspace = await findWorkspaceRepo({
      client: auth.client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const document = await findWorkspaceDocument({
      client: auth.client,
      org: orgName,
      workspace: workspaceName,
      documentPath,
    });
    if (!document) {
      return json(404, { error: "No such document." }, baseHeaders);
    }

    const [versions, openChanges] = await Promise.all([
      listDocumentVersions({
        client: auth.client,
        org: orgName,
        workspace: workspaceName,
        slugPath: document.slugPath,
      }),
      listPullRequests({
        client: auth.client,
        owner: orgName,
        repo: workspaceName,
        state: "open",
      }),
    ]);

    return json(
      200,
      {
        organization: orgName,
        workspace: workspaceName,
        document,
        versions,
        latestVersion: versions[0] ?? null,
        openChanges: openChanges.filter((pull) =>
          changeTouchesDocument(pull, document.slugPath),
        ),
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to read a workspace document", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      documentPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to read the document.");
  }
}

async function handleCreateWorkspaceDocument(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

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
  const name = parseOptionalString(form.get("name"));
  const folder = parseOptionalString(form.get("folder")) || null;

  if (!file || !name) {
    return json(400, { error: "file and name are required." }, baseHeaders);
  }

  const validation = validateUploadFile(file);
  if (!validation.valid) {
    return json(
      400,
      { error: validation.reason ?? "Invalid file." },
      baseHeaders,
    );
  }

  const slugPath = buildDocumentSlugPath(name, folder);
  if (slugPath === "") {
    return json(
      400,
      { error: "That name has no letters or numbers to make a path from." },
      baseHeaders,
    );
  }

  const extension = getFileExtension(file.name);
  const filePath = buildDocumentFilePath(name, extension, folder);

  const organization = await resolveSessionOrganization(client, session);
  if (!organization) {
    return json(
      409,
      { error: "Create an organization before adding a document." },
      baseHeaders,
    );
  }

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    if (
      await workspacePathExists({
        client,
        org: orgName,
        workspace: workspaceName,
        path: filePath,
      })
    ) {
      return json(
        409,
        { error: `A document already lives at "${filePath}".` },
        baseHeaders,
      );
    }

    const buffer = await file.arrayBuffer();
    const [fullHash, base64Content] = await Promise.all([
      computeFileHashFromBuffer(buffer),
      Buffer.from(buffer).toString("base64"),
    ]);
    const contentHash8 = fullHash.slice(0, 8);
    const branchName = buildUploadBranchName(
      slugPath,
      session.username,
      contentHash8,
    );

    // No repository to create and no rules to install: the binder already has
    // a protected `main` and its role teams. That is the point of the level.
    await createUploadBranch({
      client,
      owner: orgName,
      repo: workspaceName,
      branchName,
      from: "main",
    });

    const commitMessage = buildUploadCommitMessage({
      docSlug: slugPath,
      canonicalFile: filePath,
      sourceFilename: file.name,
      uploadBranch: branchName,
      uploaderSlug: session.username,
      fileHashSha256: fullHash,
    });

    await commitBinaryFile({
      client,
      owner: orgName,
      repo: workspaceName,
      branch: branchName,
      filePath,
      base64Content,
      message: commitMessage,
      isNewFile: true,
    });

    const pr = await createPullRequest({
      client,
      owner: orgName,
      repo: workspaceName,
      title: `Add ${slugPath}`,
      head: branchName,
      base: "main",
      body: [
        "Automated upload from Bindersnap.",
        "",
        `Source file: ${file.name}`,
        `Document: ${slugPath}`,
        `Binder: ${organization.name}/${workspaceName}`,
        `Uploaded by: ${session.username}`,
        `File hash (SHA-256): ${fullHash}`,
      ].join("\n"),
    });

    logger.info("Workspace document created", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      documentPath: filePath,
    });

    return json(
      201,
      {
        organization: orgName,
        workspace: workspaceName,
        documentPath: filePath,
        slugPath,
        branch: branchName,
        pullRequestNumber: pr.number ?? null,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to add a document to a workspace", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      documentPath: filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to add the document.");
  }
}

async function handleListWorkspaces(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  try {
    // Every organization this session belongs to, not the oldest one. Picking
    // for them was always a guess, and a person in two organizations was shown
    // whichever came first — including, in a dev stack, whichever test made one
    // first. Each binder names its owner, so the caller can address it.
    const organizations = await listSessionOrganizations(auth.client);

    const workspaces = (
      await Promise.all(
        organizations.map((organization) =>
          listOrganizationWorkspaces({
            client: auth.client,
            org: organization.name,
          }).catch(() => []),
        ),
      )
    ).flat();

    return json(200, { workspaces }, baseHeaders);
  } catch (err) {
    logger.error("Failed to list workspaces", {
      username: auth.session.username,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to list the binders.");
  }
}

/**
 * Create a binder, owned by the organization.
 *
 * A write, so it needs a subscription — and the 402 is what sends a session
 * with no organization to name one first, since there is nothing to own a
 * binder until then.
 *
 * The name is slugified the same way an organization's is, and for the same
 * reason: "Clinical Policies" is not a name Gitea will take, and the person
 * choosing it should be told the address they are choosing.
 */
async function handleCreateWorkspace(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const payload = await readJson<{ name?: unknown; description?: unknown }>(
    req,
  );
  const requested =
    typeof payload?.name === "string" ? payload.name.trim() : "";
  if (!requested) {
    return json(400, { error: "A binder name is required." }, baseHeaders);
  }

  const name = slugifyOrganizationName(requested);
  if (!name) {
    return json(
      400,
      { error: "That name has no letters or numbers Gitea can use." },
      baseHeaders,
    );
  }

  const description =
    typeof payload?.description === "string"
      ? payload.description.trim()
      : undefined;

  try {
    const existing = await findWorkspaceRepo({
      client: auth.client,
      org: orgName,
      name,
    });
    if (existing) {
      return json(
        409,
        { error: `A binder named "${name}" already exists.` },
        baseHeaders,
      );
    }

    const provisioned = await provisionWorkspace({
      client: auth.client,
      org: orgName,
      name,
      description,
    });

    logger.info("Workspace created", {
      username: auth.session.username,
      organization: orgName,
      workspace: provisioned.workspace.name,
    });

    return json(201, { workspace: provisioned.workspace }, baseHeaders);
  } catch (err) {
    logger.error("Failed to create a workspace", {
      username: auth.session.username,
      organization: orgName,
      workspace: name,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to create the binder.");
  }
}

async function handleListOrganizations(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const organizations = await listSessionOrganizations(auth.client);
  return json(200, { organizations }, baseHeaders);
}

/**
 * Create an organization, with the person creating it as its owner.
 *
 * Provisioning runs on the caller's own token, which is what makes them the
 * owner — the service account would own it instead, and ownership surviving
 * personnel changes is the whole reason ADR 0004's first level exists.
 *
 * Unlike signup, this reports failure. There is a person watching a form, and
 * a silent failure here leaves them pressing a button that appears to do
 * nothing.
 */
async function handleCreateOrganization(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const payload = await readJson<{ name?: unknown }>(req);
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  if (!name) {
    return json(
      400,
      { error: "An organization name is required." },
      baseHeaders,
    );
  }

  try {
    const result = await provisionSignup({
      client: auth.client,
      username: auth.session.username,
      organizationName: name,
    });

    // The billing half of the migration, for the account in front of us: a
    // subscription parked under this username moves onto the organization it
    // now has. Best effort — a person who just named their organization should
    // not be shown an error because a legacy row could not be read.
    const claim = await claimLegacyBillingForOrganization({
      username: auth.session.username,
      giteaOrgId: result.provisioned.organization.id,
    }).catch((err) => {
      logger.error("Failed to claim parked billing for a new organization", {
        username: auth.session.username,
        giteaOrgId: result.provisioned.organization.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

    logger.info("Organization created from the app", {
      username: auth.session.username,
      organization: result.organization.name,
      giteaOrgId: result.organization.giteaOrgId,
      claimedLegacyBilling: claim?.claimedSubscription ?? false,
    });

    return json(
      201,
      {
        organization: {
          id: result.organization.giteaOrgId,
          name: result.organization.name,
          // What they typed, not the slug we derived from it.
          displayName:
            result.provisioned.organization.fullName ||
            result.organization.name,
          trialEndsAt: result.organization.trialEndsAt,
        },
      },
      baseHeaders,
    );
  } catch (err) {
    const status = err instanceof GiteaApiError ? err.status : 502;
    logger.error("Failed to create an organization", {
      username: auth.session.username,
      status,
      error: err instanceof Error ? err.message : String(err),
    });

    if (status === 403) {
      return json(
        403,
        { error: "This account is not allowed to create organizations." },
        baseHeaders,
      );
    }

    return json(
      502,
      { error: "Unable to create the organization. Please try again." },
      baseHeaders,
    );
  }
}

async function handleBillingStatus(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { username } = auth.session;
  const organization = await resolveSessionOrganization(
    auth.client,
    auth.session,
  );

  const priceInfo = await fetchStripePriceInfo();
  const accessState = await resolveSubscriptionAccessState(
    username,
    organization,
  );
  return json(
    200,
    {
      organization: accessState.organization,
      trialEndsAt: accessState.trialEndsAt,
      status: accessState.status,
      stripeStatus: accessState.stripeStatus,
      currentPeriodEnd: accessState.currentPeriodEnd,
      cancelAtPeriodEnd: accessState.cancelAtPeriodEnd,
      cancelAt: accessState.cancelAt,
      hasAccess: accessState.hasAccess,
      accessSource: accessState.source,
      override: serializeSubscriptionOverride(accessState.override),
      plan: priceInfo,
    },
    baseHeaders,
  );
}

async function handleBillingCheckout(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const checkoutRateLimit = consumeCheckoutRateLimit(auth.session.username);
  if (checkoutRateLimit.limited) {
    return json(
      429,
      { error: "Too many checkout attempts. Please try again shortly." },
      mergeHeaders(baseHeaders, {
        "Retry-After": String(checkoutRateLimit.retryAfterSeconds),
      }),
    );
  }

  if (!config.stripeSecretKey || !config.stripePriceId) {
    return json(503, { error: "Billing not configured." }, baseHeaders);
  }

  // Checkout buys a subscription for the organization, not for the person
  // clicking the button — so there has to be one.
  const organization = await resolveSessionOrganization(
    auth.client,
    auth.session,
  );
  if (!organization) {
    return json(
      409,
      { error: "You are not in an organization yet." },
      baseHeaders,
    );
  }

  const existingSubscription = await subscriptionStore.getByOrganization(
    organization.id,
  );
  const userEmail = await fetchSessionUserEmail(auth.session);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clientIdempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: config.stripePriceId, quantity: 1 }],
    client_reference_id: String(organization.id),
    // The org id is the key; the username records who set it up, which support
    // wants and billing must never depend on.
    metadata: {
      bindersnap_gitea_org_id: String(organization.id),
      bindersnap_organization: organization.name,
      bindersnap_username: auth.session.username,
    },
    subscription_data: {
      metadata: {
        bindersnap_gitea_org_id: String(organization.id),
        bindersnap_username: auth.session.username,
      },
    },
    success_url: `${config.appOrigin}/billing?checkout=success`,
    cancel_url: `${config.appOrigin}/billing`,
  };
  if (existingSubscription?.stripeCustomerId) {
    params.customer = existingSubscription.stripeCustomerId;
  } else {
    // In `subscription` mode Stripe always creates a Customer automatically;
    // `customer_creation` is only valid for `payment`/`setup` mode and was
    // rejected by the Stripe API when upgraded to 2025-06-30.basil.
    if (userEmail) {
      params.customer_email = userEmail;
    }
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create(params, {
      idempotencyKey: createStripeRequestIdempotencyKey(
        "checkout",
        clientIdempotencyKey,
      ),
    });
    return json(200, { url: session.url }, baseHeaders);
  } catch (err) {
    logger.error("Stripe checkout session creation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return json(
      502,
      { error: "Unable to create checkout session." },
      baseHeaders,
    );
  }
}

async function handleDevGrantSubscription(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  if (config.isProduction || !config.devFeaturesEnabled) {
    return json(404, { error: "Not found." }, baseHeaders);
  }

  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { username } = auth.session;
  const organization = await resolveSessionOrganization(
    auth.client,
    auth.session,
  );
  if (!organization) {
    return json(
      409,
      { error: "You are not in an organization yet." },
      baseHeaders,
    );
  }

  await subscriptionStore.upsert({
    giteaOrgId: organization.id,
    stripeCustomerId: `cus_dev_org_${organization.id}`,
    stripeSubscriptionId: `sub_dev_org_${organization.id}`,
    status: "active",
    currentPeriodEnd: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    updatedAt: Date.now(),
  });

  return json(
    200,
    { ok: true, username, organization: organization.name },
    baseHeaders,
  );
}

/**
 * Dev only: end this organization's trial, so the paywall can be observed.
 *
 * Every new organization gets 14 days (ADR 0004, #369), which is exactly the
 * behaviour an integration test asserting "a delinquent organization cannot
 * author" has to get past. Ending the trial is the honest way to do that —
 * the alternative is a test that never sees the paywall it claims to check.
 */
async function handleDevEndTrial(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  if (config.isProduction || !config.devFeaturesEnabled) {
    return json(404, { error: "Not found." }, baseHeaders);
  }

  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const organization = await resolveSessionOrganization(
    auth.client,
    auth.session,
  );
  if (!organization) {
    return json(
      409,
      { error: "You are not in an organization yet." },
      baseHeaders,
    );
  }

  const existing = await organizationStore.get(organization.id);
  await organizationStore.upsert({
    giteaOrgId: organization.id,
    name: organization.name,
    createdBy: existing?.createdBy ?? auth.session.username,
    createdAt: existing?.createdAt ?? Math.floor(Date.now() / 1000),
    trialEndsAt: Math.floor(Date.now() / 1000) - 1,
  });

  return json(200, { ok: true, organization: organization.name }, baseHeaders);
}

async function buildLegacyAdminSubscriptionAccessState(
  client: GiteaClient,
  username: string,
) {
  const organization = await resolveOrganizationForUser(client, username);
  const accessState = await resolveSubscriptionAccessState(
    username,
    organization,
  );

  return {
    username,
    organization: accessState.organization,
    hasProAccess: accessState.hasAccess,
    source: accessState.source,
    overrideActive: accessState.override !== null,
    updatedAt:
      accessState.override !== null
        ? new Date(accessState.override.updatedAt).toISOString()
        : null,
    updatedBy: accessState.override?.updatedBy ?? null,
  };
}

async function handleAdminSubscriptionStatus(
  req: Request,
  baseHeaders: Headers,
  rawUsername: string,
): Promise<Response> {
  const auth = await requireAdminSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const username = decodePathParam(rawUsername).trim();
  if (username === "") {
    return json(400, { error: "Username is required." }, baseHeaders);
  }

  const matchedUser = await findExactGiteaUser(auth.client, username).catch(
    () => null,
  );
  if (!matchedUser) {
    return json(404, { error: "User not found." }, baseHeaders);
  }

  return json(
    200,
    await buildLegacyAdminSubscriptionAccessState(
      auth.client,
      matchedUser.login,
    ),
    baseHeaders,
  );
}

async function upsertLegacyAdminSubscriptionOverride(
  req: Request,
  baseHeaders: Headers,
  rawUsername: string,
  access: "grant" | "revoke",
): Promise<Response> {
  const auth = await requireAdminSession(req, baseHeaders);
  if (auth instanceof Response) {
    return auth;
  }

  const username = decodePathParam(rawUsername).trim();
  if (username === "") {
    return json(400, { error: "Username is required." }, baseHeaders);
  }

  const matchedUser = await findExactGiteaUser(auth.client, username).catch(
    () => null,
  );
  if (!matchedUser) {
    return json(404, { error: "User not found." }, baseHeaders);
  }

  const organization = await resolveOrganizationForUser(
    auth.client,
    matchedUser.login,
  );
  if (!organization) {
    return json(
      404,
      {
        error: `${matchedUser.login} is not in an organization, so there is nothing to override.`,
      },
      baseHeaders,
    );
  }

  await subscriptionStore.putAccessOverride({
    giteaOrgId: organization.id,
    access,
    reason: null,
    updatedBy: auth.currentUser.username,
    updatedAt: Date.now(),
  });

  return json(
    200,
    await buildLegacyAdminSubscriptionAccessState(
      auth.client,
      matchedUser.login,
    ),
    baseHeaders,
  );
}

async function handleAdminSubscriptionBooleanUpdate(
  req: Request,
  baseHeaders: Headers,
  rawUsername: string,
): Promise<Response> {
  const payload = await readJsonBody(req);
  const hasProAccessValue = payload?.hasProAccess;

  if (hasProAccessValue === true) {
    return upsertLegacyAdminSubscriptionOverride(
      req,
      baseHeaders,
      rawUsername,
      "grant",
    );
  }

  if (hasProAccessValue === false) {
    return upsertLegacyAdminSubscriptionOverride(
      req,
      baseHeaders,
      rawUsername,
      "revoke",
    );
  }

  const accessValue = readInputString(payload, null, "access").toLowerCase();
  if (accessValue === "grant" || accessValue === "revoke") {
    return upsertLegacyAdminSubscriptionOverride(
      req,
      baseHeaders,
      rawUsername,
      accessValue,
    );
  }

  return json(
    400,
    { error: "hasProAccess must be provided as a boolean." },
    baseHeaders,
  );
}

async function handleBillingPortal(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const organization = await resolveSessionOrganization(
    auth.client,
    auth.session,
  );
  const record = organization
    ? await subscriptionStore.getByOrganization(organization.id)
    : null;
  if (!record) {
    return json(404, { error: "No subscription found." }, baseHeaders);
  }

  if (!config.stripeSecretKey) {
    return json(503, { error: "Billing not configured." }, baseHeaders);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clientIdempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey : null;

  try {
    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create(
      {
        customer: record.stripeCustomerId,
        return_url: `${config.appOrigin}/billing`,
      },
      {
        idempotencyKey: createStripeRequestIdempotencyKey(
          "portal",
          clientIdempotencyKey,
        ),
      },
    );
    return json(200, { url: session.url }, baseHeaders);
  } catch (err) {
    logger.error("Stripe portal session creation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return json(502, { error: "Unable to open billing portal." }, baseHeaders);
  }
}

async function cleanupExpiredSessions(): Promise<void> {
  const now = Date.now();
  await runSessionReaper({
    sessionStore,
    revoke: revokeUserToken,
    now,
    logger,
  });

  for (const [key, entry] of authAttempts.entries()) {
    if (entry.resetAt <= now) {
      authAttempts.delete(key);
    }
  }

  for (const [key, entry] of checkoutAttempts.entries()) {
    if (entry.resetAt <= now) {
      checkoutAttempts.delete(key);
    }
  }
}

function startCleanupTimer(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void cleanupExpiredSessions();
  }, 60_000);
}

export function createApiServer() {
  return Bun.serve({
    port: config.apiPort,
    idleTimeout: 30,
    async fetch(req) {
      const startMs = Date.now();
      const { pathname } = new URL(req.url);
      const method = req.method;
      const origin = requestOrigin(req);
      const clientIp = requestClientIp(req);

      logger.info("Incoming request", {
        method,
        path: pathname,
        origin,
        clientIp,
      });

      // Liveness probe: must respond before any auth/origin/HTTPS gate.
      // Returns 200 once the process accepts connections; deeper readiness
      // (e.g. Gitea reachability) would live on /readyz if it lands.
      if (pathname === "/healthz" && (method === "GET" || method === "HEAD")) {
        const durationMs = Date.now() - startMs;
        logger.info("Response sent", {
          method,
          path: pathname,
          status: 200,
          durationMs,
        });
        return new Response(method === "HEAD" ? null : "ok\n", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      const baseHeaders = corsHeaders(req);
      const transportError = enforceTransportSecurity(req, baseHeaders);
      if (transportError) {
        const durationMs = Date.now() - startMs;
        logger.info("Response sent", {
          method,
          path: pathname,
          status: transportError.status,
          durationMs,
        });
        return transportError;
      }

      if (pathname === "/stripe/webhook" && method === "POST") {
        const response = await handleStripeWebhook(req, baseHeaders);
        const durationMs = Date.now() - startMs;
        if (response.status >= 500) {
          logger.error("Response sent with 5xx status", {
            method,
            path: pathname,
            status: response.status,
            durationMs,
          });
        } else {
          logger.info("Response sent", {
            method,
            path: pathname,
            status: response.status,
            durationMs,
          });
        }
        return response;
      }

      const originError = enforceStateChangingOrigin(req, baseHeaders);
      if (originError) {
        const durationMs = Date.now() - startMs;
        logger.info("Response sent", {
          method,
          path: pathname,
          status: originError.status,
          durationMs,
        });
        return originError;
      }

      if (method === "OPTIONS") {
        const durationMs = Date.now() - startMs;
        logger.info("Response sent", {
          method,
          path: pathname,
          status: 204,
          durationMs,
        });
        return new Response(null, {
          status: 204,
          headers: baseHeaders,
        });
      }

      let response: Response;

      if (pathname === "/auth/signup" && method === "POST") {
        response = await handleSignup(req, baseHeaders);
      } else if (pathname === "/auth/login" && method === "POST") {
        response = await handleLogin(req, baseHeaders);
      } else if (pathname === "/auth/logout" && method === "POST") {
        response = await handleLogout(req, baseHeaders);
      } else if (pathname === "/auth/me" && method === "GET") {
        response = await handleAuthMe(req, baseHeaders);
      } else if (pathname === "/api/app/home/changes" && method === "GET") {
        response = await handleHomeChanges(req, baseHeaders);
      } else if (pathname === "/api/app/documents" && method === "GET") {
        response = await handleDocuments(req, baseHeaders);
      } else if (pathname === "/api/app/documents/search" && method === "GET") {
        response = await handleDocumentSearch(req, baseHeaders);
      } else if (pathname === "/api/app/documents" && method === "POST") {
        response = await handleCreateDocument(req, baseHeaders);
      } else if (pathname === "/api/app/users/search" && method === "GET") {
        response = await handleSearchUsersRoute(req, baseHeaders);
      } else if (
        pathname === "/api/app/admin/subscriptions/access" &&
        method === "GET"
      ) {
        response = await handleAdminSubscriptionAccessList(req, baseHeaders);
      } else if (pathname === "/api/app/binders" && method === "GET") {
        response = await handleListWorkspaces(req, baseHeaders);
      } else if (pathname === "/api/app/organizations" && method === "GET") {
        response = await handleListOrganizations(req, baseHeaders);
      } else if (pathname === "/api/app/organizations" && method === "POST") {
        response = await handleCreateOrganization(req, baseHeaders);
      } else if (pathname === "/api/app/billing/status" && method === "GET") {
        response = await handleBillingStatus(req, baseHeaders);
      } else if (
        pathname === "/api/app/billing/checkout" &&
        method === "POST"
      ) {
        response = await handleBillingCheckout(req, baseHeaders);
      } else if (pathname === "/api/app/billing/portal" && method === "POST") {
        response = await handleBillingPortal(req, baseHeaders);
      } else if (
        pathname === "/api/dev/grant-subscription" &&
        method === "POST"
      ) {
        response = await handleDevGrantSubscription(req, baseHeaders);
      } else if (pathname === "/api/dev/end-trial" && method === "POST") {
        response = await handleDevEndTrial(req, baseHeaders);
      } else {
        const reviewMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/reviews$/,
        );
        const assignmentsMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/assignments$/,
        );
        const publishMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/publish$/,
        );
        const discussionsMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/discussions$/,
        );
        const changeUpdatesMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/updates$/,
        );
        const discussionRepliesMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/discussions\/([^/]+)\/comments$/,
        );
        const discussionResolveMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/discussions\/([^/]+)\/resolve$/,
        );
        const discussionReactionMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/pull-requests\/(\d+)\/discussions\/([^/]+)\/comments\/(\d+)\/reactions$/,
        );
        const downloadMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/download$/,
        );
        const versionsMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/versions$/,
        );
        const historyMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/history$/,
        );
        const closedChangesMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/changes\/closed$/,
        );
        const permissionsMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/permissions$/,
        );
        const collaboratorsActionMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)$/,
        );
        const adminSubscriptionAccessActionMatch = pathname.match(
          /^\/api\/app\/admin\/subscriptions\/access\/([^/]+)$/,
        );
        const adminSubscriptionGrantMatch = pathname.match(
          /^\/api\/app\/admin\/subscriptions\/([^/]+)\/grant$/,
        );
        const adminSubscriptionRevokeMatch = pathname.match(
          /^\/api\/app\/admin\/subscriptions\/([^/]+)\/revoke$/,
        );
        const adminSubscriptionStatusMatch = pathname.match(
          /^\/api\/app\/admin\/subscriptions\/([^/]+)$/,
        );
        const collaboratorsMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)\/collaborators$/,
        );
        const documentMatch = pathname.match(
          /^\/api\/app\/documents\/([^/]+)\/([^/]+)$/,
        );
        const workspaceDocumentsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/documents$/,
        );
        // The document's path carries slashes — it is a path inside the binder,
        // not one segment — so this captures the rest of the URL.
        const workspaceDocumentMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/documents\/(.+)$/,
        );
        const workspacePublishMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/publish$/,
        );
        const createBinderMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/binders$/,
        );

        if (createBinderMatch && method === "POST") {
          response = await handleCreateWorkspace(
            req,
            baseHeaders,
            createBinderMatch[1]!,
          );
        } else if (workspacePublishMatch && method === "POST") {
          response = await handlePublishWorkspaceChange(
            req,
            baseHeaders,
            workspacePublishMatch[1]!,
            workspacePublishMatch[2]!,
            Number.parseInt(workspacePublishMatch[3] ?? "", 10),
          );
        } else if (workspaceDocumentsMatch && method === "GET") {
          response = await handleListWorkspaceDocuments(
            req,
            baseHeaders,
            workspaceDocumentsMatch[1]!,
            workspaceDocumentsMatch[2]!,
          );
        } else if (workspaceDocumentMatch && method === "GET") {
          response = await handleWorkspaceDocumentDetail(
            req,
            baseHeaders,
            workspaceDocumentMatch[1]!,
            workspaceDocumentMatch[2]!,
            decodeURIComponent(workspaceDocumentMatch[3]!),
          );
        } else if (workspaceDocumentsMatch && method === "POST") {
          response = await handleCreateWorkspaceDocument(
            req,
            baseHeaders,
            workspaceDocumentsMatch[1]!,
            workspaceDocumentsMatch[2]!,
          );
        } else if (reviewMatch && method === "POST") {
          response = await handleDocumentReview(
            req,
            baseHeaders,
            decodePathParam(reviewMatch[1] ?? ""),
            decodePathParam(reviewMatch[2] ?? ""),
            Number.parseInt(reviewMatch[3] ?? "", 10),
          );
        } else if (assignmentsMatch && method === "PUT") {
          response = await handleUpdateChangeAssignments(
            req,
            baseHeaders,
            decodePathParam(assignmentsMatch[1] ?? ""),
            decodePathParam(assignmentsMatch[2] ?? ""),
            Number.parseInt(assignmentsMatch[3] ?? "", 10),
          );
        } else if (publishMatch && method === "POST") {
          response = await handleDocumentPublish(
            req,
            baseHeaders,
            decodePathParam(publishMatch[1] ?? ""),
            decodePathParam(publishMatch[2] ?? ""),
            Number.parseInt(publishMatch[3] ?? "", 10),
          );
        } else if (changeUpdatesMatch && method === "GET") {
          response = await handleChangeUpdates(
            req,
            baseHeaders,
            decodePathParam(changeUpdatesMatch[1] ?? ""),
            decodePathParam(changeUpdatesMatch[2] ?? ""),
            Number.parseInt(changeUpdatesMatch[3] ?? "", 10),
          );
        } else if (discussionsMatch && method === "GET") {
          response = await handleListDiscussions(
            req,
            baseHeaders,
            decodePathParam(discussionsMatch[1] ?? ""),
            decodePathParam(discussionsMatch[2] ?? ""),
            Number.parseInt(discussionsMatch[3] ?? "", 10),
          );
        } else if (discussionsMatch && method === "POST") {
          response = await handleCreateDiscussionThread(
            req,
            baseHeaders,
            decodePathParam(discussionsMatch[1] ?? ""),
            decodePathParam(discussionsMatch[2] ?? ""),
            Number.parseInt(discussionsMatch[3] ?? "", 10),
          );
        } else if (discussionReactionMatch && method === "PUT") {
          response = await handleSetCommentReaction(
            req,
            baseHeaders,
            decodePathParam(discussionReactionMatch[1] ?? ""),
            decodePathParam(discussionReactionMatch[2] ?? ""),
            Number.parseInt(discussionReactionMatch[3] ?? "", 10),
            decodePathParam(discussionReactionMatch[4] ?? ""),
            Number.parseInt(discussionReactionMatch[5] ?? "", 10),
          );
        } else if (discussionRepliesMatch && method === "POST") {
          response = await handleReplyToDiscussion(
            req,
            baseHeaders,
            decodePathParam(discussionRepliesMatch[1] ?? ""),
            decodePathParam(discussionRepliesMatch[2] ?? ""),
            Number.parseInt(discussionRepliesMatch[3] ?? "", 10),
            decodePathParam(discussionRepliesMatch[4] ?? ""),
          );
        } else if (discussionResolveMatch && method === "POST") {
          response = await handleResolveDiscussion(
            req,
            baseHeaders,
            decodePathParam(discussionResolveMatch[1] ?? ""),
            decodePathParam(discussionResolveMatch[2] ?? ""),
            Number.parseInt(discussionResolveMatch[3] ?? "", 10),
            decodePathParam(discussionResolveMatch[4] ?? ""),
          );
        } else if (downloadMatch && method === "GET") {
          response = await handleDocumentDownload(
            req,
            baseHeaders,
            decodePathParam(downloadMatch[1] ?? ""),
            decodePathParam(downloadMatch[2] ?? ""),
          );
        } else if (historyMatch && method === "GET") {
          response = await handleDocumentHistory(
            req,
            baseHeaders,
            decodePathParam(historyMatch[1] ?? ""),
            decodePathParam(historyMatch[2] ?? ""),
          );
        } else if (closedChangesMatch && method === "GET") {
          response = await handleClosedChanges(
            req,
            baseHeaders,
            decodePathParam(closedChangesMatch[1] ?? ""),
            decodePathParam(closedChangesMatch[2] ?? ""),
          );
        } else if (versionsMatch && method === "POST") {
          response = await handleDocumentVersions(
            req,
            baseHeaders,
            decodePathParam(versionsMatch[1] ?? ""),
            decodePathParam(versionsMatch[2] ?? ""),
          );
        } else if (permissionsMatch && method === "GET") {
          response = await handleGetDocumentPermissions(
            req,
            baseHeaders,
            decodePathParam(permissionsMatch[1] ?? ""),
            decodePathParam(permissionsMatch[2] ?? ""),
          );
        } else if (permissionsMatch && method === "PUT") {
          response = await handleUpdateDocumentPermissions(
            req,
            baseHeaders,
            decodePathParam(permissionsMatch[1] ?? ""),
            decodePathParam(permissionsMatch[2] ?? ""),
          );
        } else if (adminSubscriptionGrantMatch && method === "POST") {
          response = await upsertLegacyAdminSubscriptionOverride(
            req,
            baseHeaders,
            adminSubscriptionGrantMatch[1] ?? "",
            "grant",
          );
        } else if (adminSubscriptionRevokeMatch && method === "POST") {
          response = await upsertLegacyAdminSubscriptionOverride(
            req,
            baseHeaders,
            adminSubscriptionRevokeMatch[1] ?? "",
            "revoke",
          );
        } else if (adminSubscriptionStatusMatch && method === "GET") {
          response = await handleAdminSubscriptionStatus(
            req,
            baseHeaders,
            adminSubscriptionStatusMatch[1] ?? "",
          );
        } else if (adminSubscriptionStatusMatch && method === "PUT") {
          response = await handleAdminSubscriptionBooleanUpdate(
            req,
            baseHeaders,
            adminSubscriptionStatusMatch[1] ?? "",
          );
        } else if (adminSubscriptionStatusMatch && method === "DELETE") {
          response = await upsertLegacyAdminSubscriptionOverride(
            req,
            baseHeaders,
            adminSubscriptionStatusMatch[1] ?? "",
            "revoke",
          );
        } else if (adminSubscriptionAccessActionMatch && method === "PUT") {
          response = await handleAdminSubscriptionAccessUpdate(
            req,
            baseHeaders,
            adminSubscriptionAccessActionMatch[1] ?? "",
          );
        } else if (adminSubscriptionAccessActionMatch && method === "DELETE") {
          response = await handleAdminSubscriptionAccessDelete(
            req,
            baseHeaders,
            adminSubscriptionAccessActionMatch[1] ?? "",
          );
        } else if (collaboratorsActionMatch && method === "PUT") {
          response = await handleAddCollaborator(
            req,
            baseHeaders,
            decodePathParam(collaboratorsActionMatch[1] ?? ""),
            decodePathParam(collaboratorsActionMatch[2] ?? ""),
            decodePathParam(collaboratorsActionMatch[3] ?? ""),
          );
        } else if (collaboratorsActionMatch && method === "DELETE") {
          response = await handleDeleteCollaborator(
            req,
            baseHeaders,
            decodePathParam(collaboratorsActionMatch[1] ?? ""),
            decodePathParam(collaboratorsActionMatch[2] ?? ""),
            decodePathParam(collaboratorsActionMatch[3] ?? ""),
          );
        } else if (collaboratorsMatch && method === "GET") {
          response = await handleDocumentCollaborators(
            req,
            baseHeaders,
            decodePathParam(collaboratorsMatch[1] ?? ""),
            decodePathParam(collaboratorsMatch[2] ?? ""),
          );
        } else if (documentMatch && method === "GET") {
          response = await handleDocumentDetail(
            req,
            baseHeaders,
            decodePathParam(documentMatch[1] ?? ""),
            decodePathParam(documentMatch[2] ?? ""),
          );
        } else {
          response = json(404, { error: "Not found." }, baseHeaders);
        }
      }

      const durationMs = Date.now() - startMs;
      const status = response.status;
      if (status >= 500) {
        logger.error("Response sent with 5xx status", {
          method,
          path: pathname,
          status,
          durationMs,
        });
      } else {
        logger.info("Response sent", {
          method,
          path: pathname,
          status,
          durationMs,
        });
      }

      return response;
    },
  });
}

if (import.meta.main) {
  const server = createApiServer();
  startCleanupTimer();
  logger.info("Bindersnap API listening", {
    url: `http://localhost:${server.port}`,
    port: server.port,
    env: config.nodeEnv,
  });
  if (config.devFeaturesEnabled) {
    logger.warn(
      "BINDERSNAP_DEV_FEATURES is enabled — /api/dev/grant-subscription is live",
    );
  }
  if (config.bypassSubscriptionForUsers.length > 0) {
    logger.warn("Paywall bypass allowlist is active", {
      users: config.bypassSubscriptionForUsers,
    });
  }
}
