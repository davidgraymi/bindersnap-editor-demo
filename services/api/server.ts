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
import { slugifyGroupName } from "../../packages/utils/groupName";
import {
  buildDocumentFilePath,
  buildDocumentSlugPath,
} from "../../packages/utils/documentPath";
import { formatDocumentName } from "../../packages/utils/documentTitle";
import { mintDocumentUid } from "../../packages/utils/documentUid";
import {
  findWorkspaceRepo,
  listOrganizationWorkspaces,
  provisionWorkspace,
  readWorkspaceAccess,
  recomputeApprovalsWhitelist,
} from "./gitea-client/workspaces";
import {
  createDocumentVersionTag,
  findPendingDocumentBranch,
  findWorkspaceDocument,
  groupVersionsByDocument,
  listAllTags,
  listChangedDocuments,
  listDocumentVersions,
  listVersionsByDocument,
  listWorkspaceDocuments,
  readWorkspaceTree,
  type WorkspaceDocumentEntry,
  type WorkspaceTree,
  nextVersionFrom,
  toDocumentEntry,
} from "./gitea-client/workspaceDocuments";
import {
  addToBinderChange,
  proposeBinderFileChange,
  type BinderFileOperation,
} from "./gitea-client/binderFiles";
import {
  planFolderRename,
  planNewFolder,
  type ShapeChangeResult,
} from "./binderShape";
import {
  accessCostsSeat,
  addTeamMember,
  createOrganizationGroup,
  createWorkspaceRoleTeam,
  ensureStaffTeam,
  findOrganization,
  findOrganizationTeam,
  grantTeamOnRepo,
  isGroupLevel,
  isHigherAccess,
  isOrganizationOwnerDirect,
  listOrganizationMembers,
  listOrganizationOwners,
  listOrganizationTeams,
  listRepoTeams,
  listTeamMembers,
  listTeamRepos,
  OWNERS_TEAM_NAME,
  removeOrganizationMember,
  removeTeamMember,
  revokeTeamFromRepo,
  STAFF_TEAM_NAME,
  WORKSPACE_ROLES,
  workspaceTeamName,
  type WorkspaceRole,
} from "./gitea-client/orgs";
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
  DEFAULT_WORKSPACE_SETTINGS,
  workspaceSettingsStore,
  type ReviewSettings,
} from "./workspace-settings";
import {
  buildClosedChanges,
  resolveClosedOutcome,
  toVersionReviews,
} from "./document-history";
import type { ClosedChange } from "../../packages/api-schema/schemas/documents";
import type {
  BinderPeoplePayload,
  OrganizationPeoplePayload,
  DocumentVersion,
  WorkspaceDocumentListEntry,
  WorkspaceSummary,
} from "../../packages/api-schema/schemas/workspaces";
import {
  getCurrentUserRepoPermission,
  getLatestDocTag,
  getRepoBranchProtection,
  findUser,
  getRepoInfo,
  listDocTags,
  listRepoCollaborators,
  searchUsers,
  type RepoCollaboratorPermissionSummary,
  type RepoBranchProtection,
  type RepoUserSummary,
  type WorkspaceRepo,
} from "./gitea-client/repos";
import { proposeSignOffRules, readSignOffRules } from "./gitea-client/signOff";
import {
  validateSignOffRules,
  type SignOffRule,
  type SignOffScope,
} from "../../packages/utils/codeowners";
import {
  buildUploadBranchName,
  buildUploadCommitMessage,
  commitBinaryFile,
  createUploadBranch,
  documentSlugPathFromUploadBranch,
  validateUploadFile,
} from "./gitea-client/uploads";
import {
  createPullRequest,
  getPullRequestWithReviews,
  listBranchUpdates,
  listPullRequests,
  listPullRequestsWithReviews,
  getPullRequestHeadBranch,
  searchInvolvedChanges,
  type InvolvedChangeRef,
  mergeWorkspaceChange,
  updateChangeBranch,
  removePullReviewers,
  requestPullReviewers,
  setPullRequestAssignees,
  submitReview,
  type PullRequestWithApprovalState,
  type PullRequestWithReviews,
} from "./gitea-client/pullRequests";
import {
  buildChangeReviewers,
  approverLogins,
  countApprovals,
  planReviewerChanges,
  readAssignee,
  readRequestedReviewers,
} from "./change-assignments";
import { buildChangeUpdates } from "./change-updates";
import { buildVersionStamp } from "./version-stamp";

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
    // PATCH is here because a binder's rules are the first route to use it.
    // The browser sends a preflight for any method not on this list and the
    // request never leaves — which surfaces as "Failed to fetch" with nothing
    // in the API's log, because the API never saw it.
    headers.set(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    );
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
/**
 * The paywall's answer, in one place and typed.
 *
 * The organization is named because the SPA's banner has to say whose bill it
 * is: a person who belongs to two organizations learns nothing from "your
 * subscription has lapsed". `code` is what lets the SPA tell this from the
 * 402 that `GET /api/app/billing` returns with a billing status in it — a
 * distinction it used to draw by matching the request path, which every new
 * billing route had to remember to be added to.
 */
function paymentRequired(
  baseHeaders: Headers,
  organizationName: string | null,
): Response {
  return json(
    402,
    {
      error: "Subscription required.",
      code: "subscription_required" as const,
      organization: organizationName,
    },
    baseHeaders,
  );
}

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
    return paymentRequired(baseHeaders, organization?.name ?? null);
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

  return paymentRequired(baseHeaders, organization?.name ?? null);
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

function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dotIndex + 1).toLowerCase();
}

async function computeFileHashFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
/**
 * Quick find, in the nav.
 *
 * The same question the library page asks, asked shorter — so it runs through
 * the same reader. Two implementations of "where is that policy" would
 * eventually disagree about which binders count, and the one that disagreed
 * would be the one nobody tested.
 *
 * A read, so it is never gated.
 */
async function handleDocumentSearch(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const limit = Math.min(
    parsePositiveIntInput(url.searchParams.get("limit"), 8),
    50,
  );

  if (!query) {
    return json(400, { error: "q is required." }, baseHeaders);
  }

  try {
    const found = await readLibrary({ client: auth.client, query, limit });

    return json(
      200,
      { documents: found.documents, limit, hasMore: found.hasMore },
      baseHeaders,
    );
  } catch (err) {
    return responseFromError(err, baseHeaders, "Unable to search documents.");
  }
}

/** One open change as a list row carries it — the wire shape, not Gitea's. */
type PendingChangeRow = ReturnType<typeof buildPendingChangeRow>;

/** The same row on Home, which also says which document and which version. */
type HomePendingChangeRow = PendingChangeRow & {
  documentSlugPath: string | null;
  nextVersion: number | null;
};

function buildPendingChangeRow(
  entry: PullRequestWithReviews,
  requiredApprovals: number | null,
) {
  const approvalCount = countApprovals(entry.reviews);

  // Declared in the response contract from the beginning and never populated,
  // so `isRejected` read `undefined` everywhere — and `undefined` is falsy.
  // A change one reviewer had asked for work on, but which had its approvals
  // from others, was classed "ready to publish" on Home and in the library:
  // the two places that check this were checking nothing. `approvalState`
  // already folds each reviewer's latest answer, which is the same rule Gitea
  // merges on, so both answers are here for free.
  const isRejected = entry.pullRequest.approvalState === "changes_requested";

  return {
    ...entry.pullRequest,
    reviewers: buildChangeReviewers({
      requested: readRequestedReviewers(entry.pullRequest),
      reviews: entry.reviews,
      submittedBy: entry.pullRequest.user?.login ?? "",
    }),
    assignee: readAssignee(entry.pullRequest),
    approvalCount,
    requiredApprovals,
    isRejected,
    isApproved:
      !isRejected &&
      requiredApprovals !== null &&
      requiredApprovals > 0 &&
      approvalCount >= requiredApprovals,
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
    const [versionsByDocument, openWithReviews] = await Promise.all([
      // **The binder's own version tags, not `doc/vNNNN`.** That pattern is the
      // old one-repo-per-document model's, which nothing writes any more — so
      // this used to find nothing, `latestTag` was always null, and Home told
      // everybody their change "becomes v1 when you publish" however many
      // versions the document already had. A version number is the one thing
      // this product cannot be casually wrong about.
      listVersionsByDocument({ client, org: owner, workspace: repo }).catch(
        () => new Map<string, DocumentVersion[]>(),
      ),
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
      pendingPRs: pending
        .map((entry) => {
          // Which document this change is about comes from its branch, the same
          // convention the binder's own lists read. A version is per document,
          // so it belongs on the row rather than on the binder — one change can
          // touch several, and a single number for the binder would be a claim
          // about none of them.
          const slugPath = documentSlugPathFromUploadBranch(
            entry.pullRequest.head?.ref ?? "",
          );
          const versions = slugPath
            ? (versionsByDocument.get(slugPath) ?? [])
            : [];

          return {
            ...buildPendingChangeRow(entry, requiredApprovals),
            documentSlugPath: slugPath,
            nextVersion: slugPath === null ? null : nextVersionFrom(versions),
          };
        })
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
      pendingPRs: [] as HomePendingChangeRow[],
      error: errorMessage,
    };
  }
}

/**
 * The library: every policy in every binder this person can reach.
 *
 * **Rebuilt on binders.** It used to search Gitea for *repositories*, because a
 * document was a repository — so the page's saved views ("mine", "everyone's")
 * and its owner filters were questions about who owned a repo. Under ADR 0004 a
 * document is a file inside a binder owned by the organization, and nobody
 * owns a document: the questions the old filters answered no longer exist, so
 * they are gone rather than reinterpreted into something that would quietly
 * mean something else.
 *
 * What is left is the question the page is actually opened with — "where is
 * that policy" — answered across every organization the reader belongs to.
 * Personal views stay cross-organization by decision; only an organization's
 * own pages are scoped to it.
 *
 * **Three Gitea calls per binder, not per document.** That is the property the
 * binder model bought and the reason this is affordable: a customer with five
 * binders and four hundred policies pays fifteen calls, where the old shape
 * paid roughly three per document. A binder that cannot be read is skipped
 * rather than failing the page — one restricted binder should not blank the
 * library.
 *
 * A read, so it is never gated.
 */
async function handleLibraryDocuments(
  req: Request,
  baseHeaders: Headers,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  try {
    const library = await readLibrary({
      client: auth.client,
      query: new URL(req.url).searchParams.get("q"),
    });

    return json(200, library, baseHeaders);
  } catch (err) {
    logger.error("Failed to read the library", {
      username: auth.session.username,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to load the documents.");
  }
}

/** One row of the library: a document, and the binder it is filed in. */
export interface LibraryDocument extends WorkspaceDocumentListEntry {
  organization: string;
  binder: string;
  binderDescription: string;
}

/**
 * Every policy in every binder this person can reach, optionally narrowed.
 *
 * Shared by the library page and the nav's quick find, because they ask the
 * same question at different lengths — and two implementations of "where is
 * that policy" would eventually disagree about which binders count.
 *
 * **Three Gitea calls per binder, not per document.** That is the property the
 * binder model bought and the reason this is affordable at all: a customer with
 * five binders and four hundred policies pays fifteen calls, where the old
 * repo-per-document shape paid roughly three per document.
 *
 * A binder that cannot be read is skipped rather than failing the whole read.
 * One restricted binder should not blank the library.
 */
async function readLibrary(params: {
  client: GiteaClient;
  query?: string | null;
  /** Cap the rows returned. Quick find wants a handful; the page wants all. */
  limit?: number;
}): Promise<{
  documents: LibraryDocument[];
  binders: Array<{ organization: string; name: string; description: string }>;
  hasMore: boolean;
}> {
  const { client, limit } = params;
  const query = params.query?.trim().toLowerCase() || null;

  const organizations = await listSessionOrganizations(client);

  const binders = (
    await Promise.all(
      organizations.map((organization) =>
        listOrganizationWorkspaces({
          client,
          org: organization.name,
        }).catch(() => []),
      ),
    )
  ).flat();

  const rows = (
    await Promise.all(
      binders.map(async (binder) => {
        const documents = await readBinderDocuments({
          client,
          org: binder.owner,
          workspace: binder.name,
        }).catch(() => []);

        return documents.map((document) => ({
          ...document,
          organization: binder.owner,
          binder: binder.name,
          binderDescription: binder.description,
        }));
      }),
    )
  ).flat();

  // Matched here rather than at Gitea, because the question spans binders and
  // Gitea's search is per repository. The whole set is already in hand — the
  // per-binder reads are what cost anything — so filtering it is free.
  const matched = (
    query
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(query) ||
            row.slugPath.toLowerCase().includes(query) ||
            row.binder.toLowerCase().includes(query),
        )
      : rows
  ).sort(
    (left, right) =>
      left.binder.localeCompare(right.binder) ||
      left.slugPath.localeCompare(right.slugPath),
  );

  return {
    documents: limit === undefined ? matched : matched.slice(0, limit),
    binders: binders.map((binder) => ({
      organization: binder.owner,
      name: binder.name,
      description: binder.description,
    })),
    hasMore: limit !== undefined && matched.length > limit,
  };
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

    // **Two kinds of change legitimately version nothing.** A sign-off change
    // rewrites `.gitea/CODEOWNERS` — who has to approve what — and a shape
    // change can be a folder made and nothing filed in it yet. Both are real
    // acts with nothing to tag.
    //
    // The refusal is still right for everything else: a change that versions
    // nothing is a mistake, and publishing it silently would leave somebody
    // waiting for a version that never arrives.
    //
    // Told apart by the branch, the same way an upload is
    // (`upload/<slugPath>/…`). Neither prefix is under that one, deliberately:
    // the binder reads an upload branch to work out which document a change is
    // about, and a folder rename is about no single document — one that moved
    // twelve would have to pick one to be named after.
    const changeBranch = await getPullRequestHeadBranch({
      client,
      owner,
      repo: workspaceName,
      pullNumber,
    });
    const mayVersionNothing =
      changeBranch.startsWith("sign-off/") || changeBranch.startsWith("shape/");

    if (documents.length === 0 && !mayVersionNothing) {
      return json(
        409,
        { error: "This change does not touch any document." },
        baseHeaders,
      );
    }

    // **A content file with no identity segment is refused, loudly** (ADR
    // 0005). Every document Bindersnap writes carries a UID in its filename,
    // and that UID is what its version tags are named after. A file without one
    // cannot be versioned: publishing it would merge the change and then
    // silently write no tag, leaving somebody waiting for a version that never
    // arrives — and the next publish would do the same thing again.
    //
    // Refusing before the merge is the point. ADR 0004 names degrading quietly
    // as the failure to avoid twice over: the old config parser falling back to
    // the permissive policy, and Gitea's CODEOWNERS parser dropping a line it
    // cannot compile. This is the same shape and gets the same answer.
    const unidentified = documents.filter((document) => document.uid === null);
    if (unidentified.length > 0) {
      return json(
        409,
        {
          error:
            unidentified.length === 1
              ? `"${unidentified[0]!.path}" was not added through Bindersnap, so it has no version history to add to. Remove it from this change, or add it as a document.`
              : `${unidentified.length} files in this change were not added through Bindersnap, so they have no version history to add to: ${unidentified
                  .map((document) => `"${document.path}"`)
                  .join(", ")}.`,
        },
        baseHeaders,
      );
    }

    const reviewSettings = await readBinderSettings(workspace);
    // Read here rather than beside the tag write, so a failure to read the
    // protection cannot happen after the merge has already landed.
    const protection = await readWorkspaceProtection(owner, workspaceName);

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
            uid: document.uid,
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

    // **The policy in force, stamped onto the event.** ADR 0004: when
    // configuration shapes what happened, do not version the configuration —
    // write it into the annotated tag, where it is immutable, attached to the
    // exact publish, and readable from a bare clone with no application and no
    // database running. That is what makes it evidence rather than a settings
    // row a surveyor would have to be told to trust.
    //
    // Read after the merge, because the approvals that count are the ones that
    // stood when Gitea accepted it — an approval dismissed on the way in is not
    // a signature on what was published.
    const merged = await getPullRequestWithReviews({
      client,
      owner,
      repo: workspaceName,
      pullNumber,
    }).catch(() => null);

    const stampedPolicy = {
      requiredApprovals: await readRequiredApprovals(owner, workspaceName),
      approvedBy: merged ? approverLogins(merged.reviews) : [],
      blockOnUnresolvedThreads: reviewSettings.blockOnUnresolvedThreads,
      signOffEnforced: protection?.blockOnCodeownerReviews ?? false,
      publishedBy: session.username,
      changeNumber: pullNumber,
    };

    // Sequential: Gitea serializes repository writes, and a partial failure
    // here is easier to read in order than interleaved.
    const tags = [];
    for (const { document, version } of nextVersions) {
      tags.push(
        await createDocumentVersionTag({
          client,
          org: owner,
          workspace: workspaceName,
          // Not null: the guard above refused this change if any file lacked
          // an identity, which is what makes this assertion safe rather than
          // hopeful.
          uid: document.uid!,
          slugPath: document.slugPath,
          version,
          target: "main",
          message: buildVersionStamp({
            ...stampedPolicy,
            // The title the product shows, by the rule the product shows it
            // with. A tag reading "hand-hygiene-and-ppe" while every screen
            // says "Hand Hygiene and PPE" is two names for one policy in the
            // hands of somebody holding a clone and a screenshot.
            title: formatDocumentName(document.name),
            slugPath: document.slugPath,
            path: document.path,
            version,
          }),
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

/**
 * Whether `main` has moved on since this change branched off it.
 *
 * A binder protects `main` with `block_on_outdated_branch`, so a change that
 * is behind is refused however many approvals it has. The merge base is the
 * base branch's head exactly when the change is up to date, and Gitea returns
 * both on the pull request — so this is free, and it is the difference between
 * a Publish button that explains itself and one that just fails.
 *
 * Unknown either way is treated as up to date: a missing field should not
 * invent a blocker, and the merge is still the authority.
 */
function isChangeBehindBase(pullRequest: {
  merge_base?: string;
  base?: { sha?: string } | null;
}): boolean {
  const mergeBase = pullRequest.merge_base ?? "";
  const baseHead = pullRequest.base?.sha ?? "";
  if (mergeBase === "" || baseHead === "") return false;
  return mergeBase !== baseHead;
}

/**
 * One change in a binder.
 *
 * ADR 0004: "the unit of approval is the change, not the document." So this is
 * a question about the change — what it proposes, who has to sign it off, and
 * which documents publishing it would version — rather than a question about
 * any one of the documents it touches.
 *
 * A read, so it is never gated.
 */
async function handleWorkspaceChangeDetail(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  pullNumber: number,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client } = auth;

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const [
      entry,
      documents,
      requiredApprovals,
      reviewSettings,
      discussions,
      access,
    ] = await Promise.all([
      getPullRequestWithReviews({
        client,
        owner: orgName,
        repo: workspaceName,
        pullNumber,
      }),
      listChangedDocuments({
        client,
        org: orgName,
        workspace: workspaceName,
        pullNumber,
      }),
      readRequiredApprovals(orgName, workspaceName),
      readBinderSettings(workspace),
      listDiscussions({
        client,
        owner: orgName,
        repo: workspaceName,
        pullNumber,
      }),
      readWorkspaceAccess({ client, org: orgName, name: workspaceName }),
    ]);

    // The version each document reaches if this is published. One call per
    // document the change touches — which is a handful, on a page about one
    // change, and it is the difference between "Publish" and "Publish v4".
    const withVersions = await Promise.all(
      documents.map(async (document) => {
        const versions = await listDocumentVersions({
          client,
          org: orgName,
          workspace: workspaceName,
          uid: document.uid,
        });
        return {
          ...document,
          nextVersion: nextVersionFrom(versions),
          currentVersion: versions[0] ?? null,
          versions,
        };
      }),
    );

    return json(
      200,
      {
        organization: orgName,
        workspace: workspaceName,
        change: buildPendingChangeRow(entry, requiredApprovals),
        documents: withVersions,
        // `main` has moved on if the change's merge base is no longer the base
        // branch's head. Both are on the pull request Gitea already returned,
        // so knowing this costs nothing.
        isBehind: isChangeBehindBase(entry.pullRequest),
        blockOnUnresolvedThreads: reviewSettings.blockOnUnresolvedThreads,
        unresolvedThreadCount: discussions.unresolvedCount,
        canManage: access.push,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to read a binder change", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      pullNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to read the change.");
  }
}

/**
 * Bring a change's branch up to date with the binder's `main`.
 *
 * A mutation, and a deliberate one: it moves the branch, so the approvals
 * collected so far are dismissed as stale. The page says that before the
 * button is pressed rather than after.
 */
async function handleWorkspaceChangeUpdate(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  pullNumber: number,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client } = auth;

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const caughtUp = await updateChangeBranch({
      client,
      owner: orgName,
      repo: workspaceName,
      pullNumber,
    });

    logger.info("Binder change brought up to date", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      pullNumber,
      // The push went through either way; false means Gitea had not finished
      // recomputing the merge base, so the page may still draw it as behind
      // for a moment.
      caughtUp,
    });

    return json(200, { ok: true, caughtUp }, baseHeaders);
  } catch (err) {
    logger.error("Failed to bring a binder change up to date", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      pullNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to bring the change up to date.",
    );
  }
}

/**
 * Approve a binder change, ask for work on it, or just say something.
 *
 * Whether the review counts is Gitea's to decide, not ours: officialness comes
 * from the branch protection, which is where ADR 0004 insists the permission
 * stays. This only carries the verdict across.
 */
async function handleWorkspaceChangeReview(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  pullNumber: number,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

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
      { error: "event must be APPROVE, REQUEST_CHANGES, or COMMENT." },
      baseHeaders,
    );
  }

  // An approval needs no words; asking for work, or saying something, does —
  // a reviewer who blocks a change without saying why has not reviewed it.
  const reviewBody = event === "APPROVE" ? bodyText || "APPROVED" : bodyText;
  if ((event === "REQUEST_CHANGES" || event === "COMMENT") && !reviewBody) {
    return json(
      400,
      { error: "body is required for REQUEST_CHANGES and COMMENT reviews." },
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

    const review = await submitReview({
      client,
      owner: orgName,
      repo: workspaceName,
      pullNumber,
      event,
      body: reviewBody,
    });

    return json(200, { review }, baseHeaders);
  } catch (err) {
    logger.error("Failed to review a binder change", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      pullNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to submit the review.");
  }
}

/**
 * The binder itself: what it is called, what it is for, how much is in it.
 *
 * The header of a repository page. The two counts live here rather than in the
 * tabs' own payloads because the tab bar shows both at once — somebody reading
 * Documents still needs to see that three changes are waiting.
 */
async function handleWorkspaceOverview(
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

    const [documents, openChanges] = await Promise.all([
      listWorkspaceDocuments({
        client: auth.client,
        org: orgName,
        workspace: workspaceName,
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
        workspace,
        documentCount: documents.length,
        openChangeCount: openChanges.length,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to read a binder", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to open this binder.");
  }
}

/**
 * Which documents a change is about, without a call per change.
 *
 * Two sources, neither of which costs anything. An open change carries its
 * document in its branch name — `upload/<slugPath>/…`, the convention the
 * upload path writes. A published one is named exactly by the version tags on
 * its merge commit, which is one tags read for the whole binder.
 *
 * A change made outside Bindersnap matches neither, and gets an empty list:
 * the row then simply does not describe itself, which beats guessing.
 */
function describeChangeDocuments(params: {
  branchName: string;
  mergeCommitSha: string | null;
  versionsByCommit: Map<string, Array<{ slugPath: string; version: number }>>;
}): Array<{ slugPath: string; name: string; version: number | null }> {
  const { branchName, mergeCommitSha, versionsByCommit } = params;

  const published = mergeCommitSha
    ? (versionsByCommit.get(mergeCommitSha) ?? [])
    : [];
  if (published.length > 0) {
    return published.map((entry) => ({
      slugPath: entry.slugPath,
      name: entry.slugPath.slice(entry.slugPath.lastIndexOf("/") + 1),
      version: entry.version,
    }));
  }

  const slugPath = documentSlugPathFromUploadBranch(branchName);
  if (slugPath === null) return [];

  return [
    {
      slugPath,
      name: slugPath.slice(slugPath.lastIndexOf("/") + 1),
      version: null,
    },
  ];
}

/**
 * The binder's change requests, open or closed.
 *
 * One shape for both, because the list shows them in one place and a row reads
 * the same either way. `state` is a query rather than two routes for the same
 * reason GitHub does it: it is one list with a filter on it.
 */
async function handleListWorkspaceChanges(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client } = auth;
  const state =
    new URL(req.url).searchParams.get("state") === "closed" ? "closed" : "open";

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const [entries, requiredApprovals, versionsByDocument] = await Promise.all([
      listPullRequestsWithReviews({
        client,
        owner: orgName,
        repo: workspaceName,
        state,
      }),
      readRequiredApprovals(orgName, workspaceName),
      listVersionsByDocument({
        client,
        org: orgName,
        workspace: workspaceName,
      }),
    ]);

    // Tags keyed the other way round: a merge commit carries one tag per
    // document the change published, which is what names a closed change.
    const versionsByCommit = new Map<
      string,
      Array<{ slugPath: string; version: number }>
    >();
    for (const [slugPath, versions] of versionsByDocument) {
      for (const version of versions) {
        const existing = versionsByCommit.get(version.commitSha);
        const entry = { slugPath, version: version.version };
        if (existing) {
          existing.push(entry);
        } else {
          versionsByCommit.set(version.commitSha, [entry]);
        }
      }
    }

    const changes = entries
      .map(({ pullRequest, reviews }) => {
        const row = buildPendingChangeRow(
          { pullRequest, reviews },
          requiredApprovals,
        );
        const isOpen = pullRequest.state === "open";
        const decided = isOpen
          ? null
          : resolveClosedOutcome(pullRequest, reviews);
        const mergeCommitSha =
          (pullRequest as { merge_commit_sha?: string }).merge_commit_sha ??
          null;

        return {
          number: row.number ?? 0,
          title: pullRequest.title ?? "",
          body: pullRequest.body ?? "",
          branchName: row.branchName,
          submittedBy: pullRequest.user?.login ?? "",
          submittedAt: pullRequest.created_at ?? "",
          closedAt: isOpen
            ? null
            : ((pullRequest as { merged_at?: string; closed_at?: string })
                .merged_at ??
              (pullRequest as { closed_at?: string }).closed_at ??
              null),
          outcome: decided ? decided.outcome : ("open" as const),
          decidedBy: decided ? decided.decidedBy : null,
          approvalState: row.approvalState,
          approvalCount: row.approvalCount,
          requiredApprovals: row.requiredApprovals,
          isApproved: row.isApproved,
          isRejected: row.isRejected,
          reviews: toVersionReviews(reviews),
          reviewers: row.reviewers,
          assignee: row.assignee,
          documents: describeChangeDocuments({
            branchName: row.branchName,
            mergeCommitSha,
            versionsByCommit,
          }),
        };
      })
      .sort((left, right) => right.number - left.number);

    return json(
      200,
      { organization: orgName, workspace: workspaceName, state, changes },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to list a binder's changes", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      state,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to list the changes.");
  }
}

/**
 * Everything this binder has ever published, newest first.
 *
 * ADR 0004: "who approved v4 of infection control" is answered by tag → commit
 * → pull request → reviews, and this walks that chain once for the whole
 * binder rather than once per document. Two calls: the tags, and the closed
 * changes that produced them.
 *
 * A read, so it is never gated — this is the page a surveyor is shown.
 */
async function handleWorkspaceHistory(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client } = auth;

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const [versionsByDocument, closed] = await Promise.all([
      listVersionsByDocument({
        client,
        org: orgName,
        workspace: workspaceName,
      }),
      listPullRequestsWithReviews({
        client,
        owner: orgName,
        repo: workspaceName,
        state: "closed",
      }),
    ]);

    // The merge commit is the join: a tag points at it, and the change that
    // produced it carries who submitted the change and who signed it off.
    const changeByCommit = new Map<string, PullRequestWithReviews>();
    for (const entry of closed) {
      const sha = (entry.pullRequest as { merge_commit_sha?: string })
        .merge_commit_sha;
      if (sha) changeByCommit.set(sha, entry);
    }

    const versions = [...versionsByDocument.entries()]
      .flatMap(([slugPath, documentVersions]) =>
        documentVersions.map((version) => {
          const change = changeByCommit.get(version.commitSha) ?? null;
          const lastSlash = slugPath.lastIndexOf("/");

          return {
            slugPath,
            name: lastSlash === -1 ? slugPath : slugPath.slice(lastSlash + 1),
            folder: lastSlash === -1 ? "" : slugPath.slice(0, lastSlash),
            version: version.version,
            tag: version.tag,
            commitSha: version.commitSha,
            publishedAt: version.publishedAt,
            changeNumber: change?.pullRequest.number ?? null,
            changeTitle: change?.pullRequest.title ?? "",
            submittedBy: change?.pullRequest.user?.login ?? "",
            // Whose approval actually stood. A dismissed or stale review is
            // not a sign-off, and this is the page somebody proves that on.
            approvers: change
              ? [
                  ...new Set(
                    change.reviews
                      .filter(
                        (review) =>
                          (review.state ?? "").toUpperCase() === "APPROVED" &&
                          review.stale !== true &&
                          review.dismissed !== true,
                      )
                      .map((review) => review.user?.login ?? "")
                      .filter((login) => login !== ""),
                  ),
                ]
              : [],
          };
        }),
      )
      // Newest first, and a binder's documents do not advance together — so
      // the date is what orders them, with the version breaking a tie between
      // two published by the same change.
      .sort((left, right) => {
        if (left.publishedAt !== right.publishedAt) {
          return right.publishedAt.localeCompare(left.publishedAt);
        }
        return left.slugPath.localeCompare(right.slugPath);
      });

    return json(
      200,
      { organization: orgName, workspace: workspaceName, versions },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to read a binder's history", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to read the history.");
  }
}

/**
 * Who can act in a binder, and what has to be true before a policy changes.
 *
 * The people come from the teams *granted onto the repository*, not from the
 * organization's team list filtered by name: ADR 0004's direction is that
 * teams belong to the organization and a binder adopts them, so a customer's
 * own committee granted onto two binders is the shape to expect. Only the
 * repository knows which teams reach it.
 *
 * The rules come from two places and are shown as one, because a customer does
 * not care which of us enforces what: branch protection is Gitea's and is
 * enforced at the merge, and the unresolved-threads gate has no Gitea
 * equivalent and is enforced by the BFF at publish.
 *
 * A read, so it is never gated.
 */
async function handleWorkspaceSettings(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client } = auth;

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const [
      teams,
      protection,
      reviewSettings,
      access,
      signOff,
      tree,
      orgTeams,
      openChanges,
    ] = await Promise.all([
      // A member without admin on the binder cannot list its teams. That costs
      // them the people, not the page.
      listRepoTeams({ client, owner: orgName, repo: workspaceName }).catch(
        () => [],
      ),
      // Read with the service account: how many approvals a change needs is
      // policy every reviewer is entitled to, and Gitea only shows the rule to
      // a repository admin.
      readWorkspaceProtection(orgName, workspaceName),
      readBinderSettings(workspace),
      readWorkspaceAccess({ client, org: orgName, name: workspaceName }),
      readSignOffRules({
        client,
        org: orgName,
        workspace: workspaceName,
      }).catch(() => ({ exists: false, rules: [], unreadable: [] })),
      // The whole tree, not just the documents: a sign-off rule can name a
      // folder somebody made and has not filed anything in yet, and deriving
      // the folder list from document paths would offer only the folders that
      // already hold something.
      readWorkspaceTree({
        client,
        org: orgName,
        workspace: workspaceName,
      }).catch(() => ({ documents: [], folders: [], paths: [] })),
      // The folders a rule may name are this binder's; the **groups** a rule
      // may name are the organization's, and deliberately not only the ones
      // granted here — a committee that signs off without gaining access is a
      // team granted onto no repository, which ADR 0004 already allows for.
      // Listing them needs org ownership, so a binder admin who is not an owner
      // falls back to the teams granted here rather than losing the page.
      listOrganizationTeams({ client, org: orgName }).catch(() => null),
      listPullRequests({
        client,
        owner: orgName,
        repo: workspaceName,
        state: "open",
      }).catch(() => []),
    ]);

    const withMembers = await Promise.all(
      teams.map(async (team) => ({
        id: team.id,
        name: team.name,
        description: team.description,
        access: team.codeAccess,
        members: (
          await listTeamMembers({ client, teamId: team.id }).catch(() => [])
        ).map((member) => ({
          login: member.login,
          fullName: member.fullName,
        })),
      })),
    );

    // **A rule whose group is empty enforces nothing**, verified against a
    // running Gitea: there is no owner to wait for, so the gate passes and the
    // page's promise is false. Read only for the groups a rule actually names,
    // which is a handful — asking for every team's membership would put an
    // organization-sized fan-out on a settings page.
    const emptySignOffGroups = await findEmptySignOffGroups({
      client,
      rules: signOff.rules,
      teams: orgTeams ?? teams,
    });

    return json(
      200,
      {
        organization: orgName,
        workspace: workspaceName,
        teams: withMembers.sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
        rules: {
          requiredApprovals: protection?.requiredApprovals ?? null,
          dismissStaleApprovals: protection?.dismissStaleApprovals ?? false,
          // No rule at all is not the same as a rule that allows pushing, but
          // it has the same consequence, so it is reported the same way.
          pushBlocked: protection ? !protection.enablePush : false,
          blockOnUnresolvedThreads: reviewSettings.blockOnUnresolvedThreads,
        },
        signOff: {
          /**
           * Whether Gitea will actually hold a merge for these rules.
           *
           * False on a Gitea without `block_on_codeowner_reviews` — which is
           * what production runs — and the page has to say so, because rules
           * that are listed but not enforced are worse than no rules at all.
           */
          enforced: protection?.blockOnCodeownerReviews ?? false,
          exists: signOff.exists,
          rules: signOff.rules,
          // Lines Gitea would drop with only a log warning. Surfaced because a
          // rule the screen omits is a rule somebody believes is not there.
          unreadable: signOff.unreadable,
          folders: tree.folders,
          /**
           * The documents a rule may name. A document rule carries an
           * identity, so this is what lets the screen offer "Hand Hygiene"
           * rather than a ULID — and what lets it say when a rule names a
           * document the binder no longer holds.
           */
          documents: tree.documents
            .filter((entry) => entry.uid !== null)
            .map((entry) => ({
              uid: entry.uid!,
              slugPath: entry.slugPath,
              name: entry.name,
              folder: entry.folder,
            })),
          // The ones the line above drops. A binder filed before ADR 0005 has
          // no identities at all, so this list is empty and the picker offers
          // no documents — which, unexplained, reads as a missing feature
          // rather than as a binder that cannot use it yet.
          unnameableDocuments: tree.documents.filter(
            (entry) => entry.uid === null,
          ).length,
          groups: (orgTeams ?? teams)
            .map((team) => team.name)
            .filter((name) => name !== STAFF_TEAM_NAME)
            .sort((left, right) => left.localeCompare(right)),
          emptyGroups: emptySignOffGroups,
          /**
           * An open sign-off change, if there is one. Offering to open a second
           * would leave two competing versions of the rules in review, and
           * whichever merged last would silently win.
           */
          pendingChange:
            openChanges.find((change) =>
              (change.head?.ref ?? "").startsWith("sign-off/"),
            )?.number ?? null,
        },
        canManage: access.admin,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to read a binder's settings", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to read the settings.");
  }
}

/**
 * Change a binder's rules.
 *
 * **Immediate, unlike the sign-off rules two functions down, and the difference
 * is worth stating.** A sign-off rule decides *who has to approve* a change, so
 * changing it goes through the same approval a policy does — a product whose
 * claim is that nothing reaches the record without approval should not exempt
 * the rules that decide who approves. This setting decides whether the binder
 * refuses to publish while a discussion is still open. It gates nobody out and
 * it changes no permission, so making an administrator open a change to tick a
 * checkbox would be ceremony without a reason.
 *
 * **The change is recorded either way.** That is what the committed config file
 * bought and it is kept — `settings_events` says who relaxed the requirement
 * and when, indexed, without a git branch or an untyped file that fails open.
 *
 * Who may do it is Gitea's answer: the caller's own token has to have admin on
 * the repository, which `readWorkspaceAccess` asks by reading the repository as
 * them. An app-side role check standing in for a permission question is the
 * tripwire ADR 0004 names.
 */
async function handleBinderRules(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const body = (await req.json().catch(() => null)) as {
      blockOnUnresolvedThreads?: unknown;
    } | null;

    if (typeof body?.blockOnUnresolvedThreads !== "boolean") {
      return json(
        400,
        {
          error:
            "Say whether a change must have every discussion resolved before it can be published.",
        },
        baseHeaders,
      );
    }

    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const access = await readWorkspaceAccess({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!access.admin) {
      return json(
        403,
        { error: "Only a binder administrator can change its rules." },
        baseHeaders,
      );
    }

    const events = await workspaceSettingsStore.set({
      giteaRepoId: workspace.id,
      organization: orgName,
      workspace: workspaceName,
      settings: { blockOnUnresolvedThreads: body.blockOnUnresolvedThreads },
      changedBy: session.username,
    });

    logger.info("Binder rules changed", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      changed: events.map((event) => event.setting),
    });

    return json(
      200,
      {
        organization: orgName,
        workspace: workspaceName,
        blockOnUnresolvedThreads: body.blockOnUnresolvedThreads,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to change a binder's rules", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to change the rules.");
  }
}

/**
 * Propose new per-folder sign-off rules.
 *
 * **This does not change anything, and the response says so by returning a
 * change number.** `main` is protected, so the regenerated file goes onto a
 * branch and opens a change like any other. A product whose claim is that
 * nothing reaches the record without approval should not exempt the rules that
 * decide who approves — and because Gitea reads CODEOWNERS from the base
 * branch, the rules already in force are the ones governing this very change.
 * That is the right authority and it falls out for free.
 *
 * **Validated before a single call to Gitea.** The generator owes this: a bad
 * rule here is our bug rather than a customer's typo, and Gitea's own parser
 * drops a line it cannot compile with nothing but a log warning — so a
 * malformed file does not fail loudly, it silently stops enforcing while every
 * screen still says sign-off is required. Verified against a running Gitea
 * 28.0.0 on 2026-09-08.
 */
async function handleBinderSignOffRules(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const body = (await req.json().catch(() => null)) as {
      rules?: unknown;
    } | null;

    const rules = parseSignOffRulesInput(body?.rules);
    if (rules === null) {
      return json(
        400,
        {
          error:
            "Send the rules as a list, each naming the binder, a folder or a document, and the groups or people who sign it off.",
        },
        baseHeaders,
      );
    }

    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    // Every group a rule names has to exist, or the rule can never be
    // satisfied and the binder cannot publish. Read from the organization
    // rather than from the binder, because a group that signs off without
    // gaining access is a team granted onto no repository.
    const orgTeams = await listOrganizationTeams({
      client,
      org: orgName,
    }).catch(() =>
      listRepoTeams({ client, owner: orgName, repo: workspaceName }).catch(
        () => [],
      ),
    );

    // The binder's documents, so a rule naming one that is not there is
    // refused rather than committed as a rule that can never be satisfied.
    const binderDocuments = await listWorkspaceDocuments({
      client,
      org: orgName,
      workspace: workspaceName,
    }).catch(() => null);

    const validation = validateSignOffRules({
      org: orgName,
      rules,
      knownTeams: orgTeams.map((team) => team.name),
      knownDocuments:
        binderDocuments
          ?.map((entry) => entry.uid)
          .filter((uid): uid is string => uid !== null) ?? undefined,
    });
    if (!validation.ok) {
      return json(
        422,
        { error: validation.problems.join(" "), problems: validation.problems },
        baseHeaders,
      );
    }

    // One open sign-off change at a time. Two would leave competing versions
    // of the rules in review, and whichever merged last would silently win —
    // with no screen able to say that the other one had been overwritten.
    const open = await listPullRequests({
      client,
      owner: orgName,
      repo: workspaceName,
      state: "open",
    });
    const pending = open.find((change) =>
      (change.head?.ref ?? "").startsWith("sign-off/"),
    );
    if (pending) {
      return json(
        409,
        {
          error: `This binder already has a sign-off change waiting for a decision. Publish or withdraw change ${pending.number} first.`,
          changeNumber: pending.number,
        },
        baseHeaders,
      );
    }

    const proposed = await proposeSignOffRules({
      client,
      org: orgName,
      workspace: workspaceName,
      rules,
      // So the change's body names each document rather than printing its
      // identity at a reviewer who is being asked to approve it.
      documentNames: new Map(
        (binderDocuments ?? [])
          .filter((entry) => entry.uid !== null)
          .map((entry) => [entry.uid!, formatDocumentName(entry.name)]),
      ),
      author: session.username,
    });

    logger.info("Sign-off rules proposed", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      changeNumber: proposed.changeNumber,
      ruleCount: rules.length,
    });

    return json(201, proposed, baseHeaders);
  } catch (err) {
    logger.error("Failed to propose sign-off rules", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to propose the sign-off rules.",
    );
  }
}

function isSignOffScope(input: unknown): input is SignOffScope {
  return input === "binder" || input === "folder" || input === "document";
}

/** The request body, or `null` when it is not the shape this route takes. */
function parseSignOffRulesInput(input: unknown): SignOffRule[] | null {
  if (!Array.isArray(input)) return null;

  const rules: SignOffRule[] = [];

  for (const entry of input) {
    if (typeof entry !== "object" || entry === null) return null;
    const candidate = entry as {
      scope?: unknown;
      target?: unknown;
      teams?: unknown;
      users?: unknown;
    };

    if (!isSignOffScope(candidate.scope)) return null;
    if (typeof candidate.target !== "string") return null;

    const teams = toStringList(candidate.teams);
    const users = toStringList(candidate.users);
    if (teams === null || users === null) return null;

    rules.push({
      scope: candidate.scope,
      target: candidate.target.trim(),
      teams,
      users,
    });
  }

  return rules;
}

function toStringList(input: unknown): string[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed !== "") out.push(trimmed);
  }
  return out;
}

/**
 * Every folder that holds a document, plus every folder above it.
 *
 * A sign-off rule is set on a folder, and the folders a binder has are exactly
 * the ones its documents live in — git has no empty directories, so there is
 * nothing else to offer. Intermediate folders are included because
 * `policies/nursing/infection-control.docx` means a customer may reasonably
 * want a rule on `policies` as well as on `policies/nursing`; both are real
 * places in the tree.
 */
/**
 * The groups a rule names that have nobody in them.
 *
 * A rule whose owners are an empty team is enforced by nothing — Gitea has no
 * owner to wait for, so `HasAllRequiredCodeownerReviews` finds nothing
 * outstanding and the merge goes through. Verified on a running Gitea on
 * 2026-09-10 by approving a change with every human in the organization while
 * the folder's rule named an empty group: it merged.
 *
 * That is the same silent failure as a pattern Gitea cannot compile, and it
 * gets the same treatment — said on the page rather than left to be found by
 * whoever eventually audits the binder.
 *
 * One call per group *named by a rule*, which is a handful. Asking for every
 * team in the organization would be an organization-sized fan-out on a settings
 * page, to answer a question about three of them. A group whose membership
 * cannot be read is left out: reporting "this enforces nothing" on a failed
 * request would be a worse lie than saying nothing.
 */
async function findEmptySignOffGroups(params: {
  client: GiteaClient;
  rules: readonly SignOffRule[];
  teams: ReadonlyArray<{ id: number; name: string }>;
}): Promise<string[]> {
  const { client, rules, teams } = params;

  const named = new Set(rules.flatMap((rule) => rule.teams));
  const wanted = teams.filter((team) => named.has(team.name));

  const counted = await Promise.all(
    wanted.map(async (team) => ({
      name: team.name,
      members: await listTeamMembers({ client, teamId: team.id }).catch(
        () => null,
      ),
    })),
  );

  return counted
    .filter((entry) => entry.members !== null && entry.members.length === 0)
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * A binder's review policy, from the settings table.
 *
 * **This used to read a JSON file off a `bindersnap-config` branch**, which
 * ADR 0004's migration step 5 retires. The file cost a network round trip per
 * read, a dedicated branch that existed only because `main` is protected, and —
 * worst — it degraded silently to the permissive policy when it could not be
 * parsed, so a corrupt byte turned a control off with nothing said.
 *
 * A binder with no row is under the default rather than under an unknown, and
 * `workspace_settings` is keyed on the Gitea repository id because Gitea
 * renames repositories.
 */
async function readBinderSettings(
  workspace: Pick<WorkspaceSummary, "id">,
): Promise<ReviewSettings> {
  const stored = await workspaceSettingsStore
    .get(workspace.id)
    .catch(() => null);
  return {
    blockOnUnresolvedThreads:
      stored?.blockOnUnresolvedThreads ??
      DEFAULT_WORKSPACE_SETTINGS.blockOnUnresolvedThreads,
  };
}

/**
 * A binder's branch protection, read with the service account.
 *
 * The same reasoning as `readRequiredApprovals`, which this replaces for the
 * settings page: the rule is policy every member is entitled to see, and Gitea
 * shows it only to a repository admin. The whitelists are not returned to the
 * browser — who is on them is policy about named people.
 */
async function readWorkspaceProtection(
  owner: string,
  repo: string,
): Promise<RepoBranchProtection | null> {
  const client = createPrivilegedGiteaClient();
  if (!client) return null;

  try {
    return await getRepoBranchProtection(client, owner, repo, "main");
  } catch (err) {
    logger.error("Failed to read a binder's branch protection", {
      owner,
      repo,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Who is in the organization, and what groups it has.
 *
 * Teams-first, and a bounded number of calls: the members, the teams, and the
 * membership of each team. The obvious alternative —
 * `GET /repos/{owner}/{repo}/collaborators/{user}/permission` per person —
 * answers `none` for a member who can push, because team access granted per
 * unit lands in a field that endpoint never reads. It has bitten twice.
 *
 * A read, so it is never gated.
 */
async function handleOrganizationPeople(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const organization = await findOrganization({ client, org: orgName });
    if (!organization) {
      return json(404, { error: "No such organization." }, baseHeaders);
    }

    return json(
      200,
      await readOrganizationPeople(client, orgName, session.username),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to read an organization's people", {
      username: session.username,
      organization: orgName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to read the people.");
  }
}

/**
 * The organization's people and groups, assembled once.
 *
 * Pulled out of the handler because every mutation on this page answers with
 * the page again: adding somebody to a group changes two of the three lists on
 * it, and returning the whole thing is what stops the browser reassembling a
 * view of the world from a success message.
 */
async function readOrganizationPeople(
  client: GiteaClient,
  orgName: string,
  viewer: string,
): Promise<OrganizationPeoplePayload> {
  const [members, teams, binders, canManage] = await Promise.all([
    listOrganizationMembers({ client, org: orgName }),
    // A member who is not an owner cannot list the organization's teams.
    // That costs them the groups, not the page.
    listOrganizationTeams({ client, org: orgName }).catch(() => []),
    listOrganizationWorkspaces({ client, org: orgName }).catch(() => []),
    isOrganizationOwnerDirect({
      client,
      org: orgName,
      username: viewer,
    }),
  ]);

  // Two calls per team: who is in it, and which binders it reaches. Bounded by
  // the number of groups rather than by the number of people or binders, which
  // is the property that makes the teams-first read model worth having — the
  // per-user permission endpoint would be a call per person *and* answer `none`
  // for a member who can push.
  const membershipByTeam = await Promise.all(
    teams.map(async (team) => {
      const [teamMembers, teamRepos] = await Promise.all([
        listTeamMembers({ client, teamId: team.id }).catch(() => []),
        listTeamRepos({ client, teamId: team.id }).catch(() => []),
      ]);
      return { team, members: teamMembers, binders: teamRepos };
    }),
  );

  const teamsByLogin = new Map<string, string[]>();
  const owners = new Set<string>();
  for (const { team, members: teamMembers } of membershipByTeam) {
    for (const member of teamMembers) {
      const login = member.login.toLowerCase();
      if (team.name === OWNERS_TEAM_NAME) owners.add(login);
      // `staff` is everybody by definition, so listing it against every name
      // says nothing and crowds out the groups that do.
      if (team.name === STAFF_TEAM_NAME) continue;
      const existing = teamsByLogin.get(login);
      if (existing) {
        existing.push(team.name);
      } else {
        teamsByLogin.set(login, [team.name]);
      }
    }
  }

  return {
    organization: orgName,
    people: members
      .map((member) => ({
        login: member.login,
        fullName: member.fullName,
        isOwner: owners.has(member.login.toLowerCase()),
        teams: teamsByLogin.get(member.login.toLowerCase()) ?? [],
      }))
      // Owners first, then by name: the list answers "who runs this" before
      // it answers "who is here".
      .sort((left, right) => {
        if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
        return left.login.localeCompare(right.login);
      }),
    groups: membershipByTeam
      // `staff` is the organization's membership, not a group somebody composes
      // — the People count above is already the same number, and its only
      // control is each binder's own "who can see this" switch.
      .filter(({ team }) => team.name !== STAFF_TEAM_NAME)
      .map(({ team, members: teamMembers, binders: teamBinders }) => ({
        id: team.id,
        name: team.name,
        description: team.description,
        access: team.codeAccess,
        memberCount: teamMembers.length,
        members: teamMembers.map((member) => ({
          login: member.login,
          fullName: member.fullName,
        })),
        binders: [...teamBinders].sort((left, right) =>
          left.localeCompare(right),
        ),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    binders: binders
      .map((binder) => binder.name)
      .sort((left, right) => left.localeCompare(right)),
    canManage,
    viewer,
  };
}

/**
 * The sentence to refuse with when an act would leave the organization with no
 * owner, or `null` when it would not.
 *
 * **Both routes hit this rule and say the same thing.** Demoting the last owner
 * and removing them are different requests with the same consequence — an
 * organization nobody can administer, with no way back that does not involve
 * us — so they share one check rather than two that can drift apart.
 *
 * Counted from the Owners team, which is where ADR 0004 puts the answer: it is
 * Gitea's own object, it is what billing already reads, and it cannot
 * disagree with itself.
 */
async function refuseLastOwner(params: {
  client: GiteaClient;
  org: string;
  username: string;
}): Promise<string | null> {
  const { client, org, username } = params;

  const owners = await listOrganizationOwners({ client, org });
  const login = username.toLowerCase();

  if (!owners.some((owner) => owner.login.toLowerCase() === login)) {
    // Not an owner, so this act cannot take the last one away.
    return null;
  }

  if (owners.length > 1) return null;

  return `${org} needs at least one owner. Make someone else an owner first.`;
}

/**
 * Put somebody in the organization.
 *
 * **There is no invitation, and that is a decision rather than an omission.**
 * Gitea has no invitation primitive — `/orgs/{org}/members` is `GET` only, and
 * the only way in is `PUT /teams/{id}/members/{username}`, which needs the
 * account to exist. Building the pending-invitation half means a SQLite table,
 * four routes, address-bound acceptance and an email nobody can send yet: this
 * repository has no mail infrastructure at all. So an owner adds a person who
 * has already signed up, and the rest is the invitations issue, 426.
 *
 * Two consequences worth being straight about, because both are visible from
 * the outside. Somebody with no account cannot be added at all — hence the
 * refusal below, which names that cause rather than letting Gitea answer 404
 * and having every layer above read it as "no such organization". And nobody
 * consents to being added. Neither is a bug to be found later; they are the
 * shape of the MVP.
 *
 * `staff` before `Owners`, the same order every other path into the
 * organization uses: a failure part-way leaves them a member who can read the
 * open binders, which is the Member rung and a safe place to stop. The reverse
 * order could leave an owner who is not in the organization's own membership
 * team.
 *
 * Who may do it is Gitea's answer, not ours. `PUT /teams/{id}/members/...` is
 * guarded by organization ownership, so checking it here as well would be an
 * app-side ACL over a permission question — the tripwire ADR 0004 names.
 */
async function handleAddOrganizationPerson(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const body = (await req.json().catch(() => null)) as {
      username?: unknown;
      owner?: unknown;
    } | null;

    const username =
      typeof body?.username === "string" ? body.username.trim() : "";
    if (username === "") {
      return json(400, { error: "Name somebody to add." }, baseHeaders);
    }

    const owner = body?.owner === true;

    const organization = await findOrganization({ client, org: orgName });
    if (!organization) {
      return json(404, { error: "No such organization." }, baseHeaders);
    }

    // Asked before anything is written, so the refusal can name the cause.
    // This is the one refusal on this route a customer meets in normal use,
    // and it is the visible edge of having no invitation flow.
    const account = await findUser({ client, username });
    if (!account) {
      return json(
        404,
        {
          error:
            `${username} does not have a Bindersnap account yet. ` +
            `They need to sign up first — then you can add them here.`,
        },
        baseHeaders,
      );
    }

    await ensureOrganizationMembership({
      client,
      org: orgName,
      username: account.login,
    });

    if (owner) {
      const owners = await findOrganizationTeam({
        client,
        org: orgName,
        name: OWNERS_TEAM_NAME,
      });
      if (!owners) {
        return json(
          404,
          { error: "This organization has no owners team." },
          baseHeaders,
        );
      }
      await addTeamMember({
        client,
        teamId: owners.id,
        username: account.login,
      });
    }

    logger.info("Organization member added", {
      username: session.username,
      organization: orgName,
      subject: account.login,
      owner,
    });

    return json(
      200,
      await readOrganizationPeople(client, orgName, session.username),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to add somebody to an organization", {
      username: session.username,
      organization: orgName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to add them to the organization.",
    );
  }
}

/**
 * Promote somebody to owner, or demote them back to member.
 *
 * Two rungs and only two, because every third org-level role anyone proposes
 * turns out to be a binder role wearing a costume — and a rung above the binder
 * is the expensive kind: org-wide, invisible from the binder it affects, and
 * not something Gitea will enforce for us.
 *
 * An owner is a member of Gitea's built-in `Owners` team, so promoting is one
 * `addTeamMember` and demoting is one `removeTeamMember`. Nothing is stored,
 * and billing keeps reading the same team it always did.
 */
async function handleOrganizationPersonRole(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  username: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const body = (await req.json().catch(() => null)) as {
      owner?: unknown;
    } | null;

    if (typeof body?.owner !== "boolean") {
      return json(
        400,
        { error: "Say whether they should be an owner." },
        baseHeaders,
      );
    }

    const organization = await findOrganization({ client, org: orgName });
    if (!organization) {
      return json(404, { error: "No such organization." }, baseHeaders);
    }

    const owners = await findOrganizationTeam({
      client,
      org: orgName,
      name: OWNERS_TEAM_NAME,
    });
    if (!owners) {
      return json(
        404,
        { error: "This organization has no owners team." },
        baseHeaders,
      );
    }

    if (body.owner) {
      await addTeamMember({ client, teamId: owners.id, username });
    } else {
      const refusal = await refuseLastOwner({
        client,
        org: orgName,
        username,
      });
      if (refusal) return json(409, { error: refusal }, baseHeaders);

      await removeTeamMember({ client, teamId: owners.id, username });
    }

    logger.info("Organization role changed", {
      username: session.username,
      organization: orgName,
      subject: username,
      owner: body.owner,
    });

    return json(
      200,
      await readOrganizationPeople(client, orgName, session.username),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to change somebody's organization role", {
      username: session.username,
      organization: orgName,
      subject: username,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to change their role.");
  }
}

/**
 * Take somebody out of the organization.
 *
 * One Gitea call, and it reaches every team they were in — there is nothing of
 * ours to reconcile afterwards. **Everything they wrote, approved or commented
 * on stays exactly where it is**: those are git objects, and the record belongs
 * to the organization rather than to the author. That is the product's whole
 * claim, and removal is the moment somebody wants to hear it.
 */
async function handleRemoveOrganizationPerson(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  username: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const organization = await findOrganization({ client, org: orgName });
    if (!organization) {
      return json(404, { error: "No such organization." }, baseHeaders);
    }

    const refusal = await refuseLastOwner({
      client,
      org: orgName,
      username,
    });
    if (refusal) return json(409, { error: refusal }, baseHeaders);

    await removeOrganizationMember({ client, org: orgName, username });

    logger.info("Organization member removed", {
      username: session.username,
      organization: orgName,
      subject: username,
    });

    return json(
      200,
      await readOrganizationPeople(client, orgName, session.username),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to remove somebody from an organization", {
      username: session.username,
      organization: orgName,
      subject: username,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to take them out of the organization.",
    );
  }
}

/**
 * Name a group and level it, which is one act.
 *
 * A Gitea team carries one unit map, so a group's level is a property of the
 * group and not of the grant: "Quality Committee" cannot be an editor in one
 * binder and a reviewer in another. A form that asked for the two separately
 * would imply otherwise, and a UI that offered a level per binder would have
 * to refuse — so they are asked for together and the level travels with the
 * name everywhere it appears.
 *
 * Who may do it is Gitea's answer, not ours: `POST /orgs/{org}/teams` is
 * guarded by organization ownership. Checking it here as well would be an
 * app-side ACL over a permission question, which is the tripwire ADR 0004
 * names — `canManage` on the payload decides which buttons are drawn, and
 * Gitea decides what happens.
 */
async function handleCreateOrganizationGroup(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const body = (await req.json().catch(() => null)) as {
      name?: unknown;
      level?: unknown;
    } | null;

    const requested = typeof body?.name === "string" ? body.name : "";
    const name = slugifyGroupName(requested);
    if (name === "") {
      return json(
        400,
        { error: "A group needs a name with a letter or a number in it." },
        baseHeaders,
      );
    }

    if (!isGroupLevel(body?.level)) {
      return json(
        400,
        {
          error: "A group is created at one level: admin, editor or reviewer.",
        },
        baseHeaders,
      );
    }

    const organization = await findOrganization({ client, org: orgName });
    if (!organization) {
      return json(404, { error: "No such organization." }, baseHeaders);
    }

    const team = await createOrganizationGroup({
      client,
      org: orgName,
      name,
      level: body.level,
    });

    return json(
      201,
      {
        organization: orgName,
        group: {
          id: team.id,
          name: team.name,
          description: team.description,
          access: team.codeAccess,
          // Granted onto nothing and holding nobody: naming a group is free,
          // and both composing it onto a binder and filling it are separate,
          // deliberate acts.
          memberCount: 0,
          members: [],
          binders: [],
        },
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to create a group", {
      username: session.username,
      organization: orgName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to create the group.");
  }
}

/**
 * Put somebody in a group, or take them out of it.
 *
 * **No commit, no approval, and that is the point.** Who is in a group is a
 * personnel fact, not a policy decision, and the alternative — naming people in
 * a file on a protected branch — makes every joiner and leaver a change that
 * has to be approved by the very people the file is being edited to change.
 * A departing employee stays a required approver until somebody approves their
 * removal. Membership is one Gitea call and takes effect immediately.
 *
 * Adding somebody to a team is also how they join the organization: Gitea makes
 * team membership imply org membership, so there is no second list to keep in
 * step.
 */
async function handleOrganizationGroupMember(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  groupName: string,
  removing: string | null,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    let username = removing;
    if (username === null) {
      const body = (await req.json().catch(() => null)) as {
        username?: unknown;
      } | null;
      username = typeof body?.username === "string" ? body.username.trim() : "";
    }

    if (username === "") {
      return json(400, { error: "Name somebody to add." }, baseHeaders);
    }

    const organization = await findOrganization({ client, org: orgName });
    if (!organization) {
      return json(404, { error: "No such organization." }, baseHeaders);
    }

    const team = await findOrganizationTeam({
      client,
      org: orgName,
      name: groupName,
    });
    if (!team) {
      return json(404, { error: "No such group." }, baseHeaders);
    }

    if (removing === null) {
      await ensureOrganizationMembership({ client, org: orgName, username });
      await addTeamMember({ client, teamId: team.id, username });
    } else {
      await removeTeamMember({ client, teamId: team.id, username });
    }

    return json(
      200,
      await readOrganizationPeople(client, orgName, session.username),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to change a group's membership", {
      username: session.username,
      organization: orgName,
      group: groupName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to change who is in the group.",
    );
  }
}

/**
 * Put somebody in the organization, which means putting them in `staff`.
 *
 * **`staff` is what "everyone at Riverside Health can read this binder" is made
 * of**, and that promise is decoration unless the organization's members are
 * actually in it. Gitea makes team membership imply org membership, so adding
 * somebody to a binder's role team or to a group already lets them in — but it
 * lets them in *around* `staff`, and the failure is silent and unfindable: a
 * person added to Clinical as an editor cannot see HR, which is open to the
 * whole organization, and no screen can say why.
 *
 * So every path that admits somebody goes through here first. Before the grant
 * that prompted it, deliberately: if this fails the request fails having done
 * nothing, and if the grant afterwards fails they are a member who can read the
 * open binders — which is the Member rung, and a safe place to stop.
 *
 * Leaving is not the mirror of this. Taking somebody out of a binder or a group
 * leaves them in the organization; leaving the organization is its own act,
 * with its own confirmation.
 */
async function ensureOrganizationMembership(params: {
  client: GiteaClient;
  org: string;
  username: string;
}): Promise<void> {
  const { client, org, username } = params;
  const staff = await ensureStaffTeam({ client, org });
  await addTeamMember({ client, teamId: staff.id, username });
}

/**
 * The three levels, and the role team each one lives in.
 *
 * The same three a group is created at, deliberately: a person added directly
 * and a group adopted onto the binder have to mean the same thing, or "Priya is
 * an editor here" would depend on how she got here.
 */
const BINDER_LEVEL_ROLES: Record<string, WorkspaceRole> = {
  admin: "admins",
  editor: "authors",
  reviewer: "reviewers",
};

/** Every team name that is this binder's own, rather than an adopted group. */
function roleTeamNames(workspace: string): Set<string> {
  return new Set(
    WORKSPACE_ROLES.map((role) => workspaceTeamName(workspace, role)),
  );
}

/**
 * Who can act in this binder, one row per person.
 *
 * **Teams-first, and a bounded number of calls**: the teams granted here, then
 * each team's membership. The obvious alternative —
 * `GET /repos/{owner}/{repo}/collaborators/{user}/permission`, once per person —
 * is both a call per member and *wrong*: team access granted per unit lands in a
 * field that endpoint never reads, so it answers `none` for somebody who can
 * push. That has bitten twice.
 *
 * Somebody in two teams is shown at the higher of the two, computed the way
 * seats are ranked — `owner` is a level and it is above `admin`, which is the
 * trap ADR 0004 warns about and which this page's ancestor fell into.
 *
 * A read, so it is never gated.
 */
async function handleBinderPeople(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    return json(
      200,
      await readBinderPeople(client, orgName, workspaceName),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to read a binder's people", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to read the people.");
  }
}

/**
 * The binder's membership, assembled once.
 *
 * Pulled out because every mutation on this tab answers with the tab again:
 * promoting somebody changes their row, the seat count above it, and possibly
 * the groups list, and returning the whole thing is what stops the browser
 * reassembling a view of the world from a success message.
 */
async function readBinderPeople(
  client: GiteaClient,
  orgName: string,
  workspaceName: string,
): Promise<BinderPeoplePayload> {
  const [teams, access, organizationMembers] = await Promise.all([
    // A member without admin on the binder cannot list its teams. That costs
    // them the people, not the page.
    listRepoTeams({ client, owner: orgName, repo: workspaceName }).catch(
      () => [],
    ),
    readWorkspaceAccess({ client, org: orgName, name: workspaceName }),
    listOrganizationMembers({ client, org: orgName }).catch(() => []),
  ]);

  const withMembers = await Promise.all(
    teams.map(async (team) => ({
      team,
      members: await listTeamMembers({ client, teamId: team.id }).catch(
        () => [],
      ),
    })),
  );

  const ownTeams = roleTeamNames(workspaceName);

  interface Row {
    login: string;
    fullName: string;
    access: string;
    through: string;
    individual: boolean;
    /** Only the shared groups — this binder's own role teams are bookkeeping. */
    groups: string[];
  }

  const byLogin = new Map<string, Row>();
  for (const { team, members } of withMembers) {
    for (const member of members) {
      const key = member.login.toLowerCase();
      const held = byLogin.get(key);

      if (!held) {
        byLogin.set(key, {
          login: member.login,
          fullName: member.fullName,
          access: team.codeAccess,
          through: team.name,
          individual: ownTeams.has(team.name),
          groups: ownTeams.has(team.name) ? [] : [team.name],
        });
        continue;
      }

      if (!ownTeams.has(team.name)) held.groups.push(team.name);
      if (isHigherAccess(team.codeAccess, held.access)) {
        held.access = team.codeAccess;
        held.through = team.name;
        held.individual = ownTeams.has(team.name);
      }
    }
  }

  const people = [...byLogin.values()]
    .map((row) => ({
      ...row,
      groups: row.groups.sort((left, right) => left.localeCompare(right)),
      seat: accessCostsSeat(row.access),
    }))
    // The people who can change things first, then by name — the list answers
    // "who runs this" before it answers "who is here".
    .sort((left, right) => {
      if (left.access !== right.access) {
        return isHigherAccess(left.access, right.access) ? -1 : 1;
      }
      return left.login.localeCompare(right.login);
    });

  return {
    organization: orgName,
    workspace: workspaceName,
    people,
    groups: withMembers
      // **`staff` is not a group**, and listing it as one undoes the switch
      // above. It is the organization's membership, its only control here is
      // "who can see this binder", and a row beside the customer's own
      // committees — with its own Remove button — would make the most
      // consequential access choice in the product look like housekeeping.
      .filter(({ team }) => team.name !== STAFF_TEAM_NAME)
      .map(({ team, members }) => ({
        id: team.id,
        name: team.name,
        description: team.description,
        access: team.codeAccess,
        members: members.map((member) => ({
          login: member.login,
          fullName: member.fullName,
        })),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    // Derived from the unfiltered set, never stored: a copy could disagree with
    // the grant Gitea is the one enforcing.
    openToOrganization: teams.some((team) => team.name === STAFF_TEAM_NAME),
    organizationMembers: organizationMembers.map((member) => ({
      login: member.login,
      fullName: member.fullName,
    })),
    canManage: access.admin,
  };
}

/**
 * Add somebody to this binder at a level, or move them between its levels.
 *
 * **The role team is created on first use, not at provisioning.** A binder that
 * only ever adopts groups never makes one, so an organization with twenty
 * binders and three recurring groups holds five to eight teams rather than
 * sixty-two — and each one exists because somebody's action created it. The
 * lazy team is the same object `ROLE_TEAM_OPTIONS` has always described; only
 * the moment it is made has changed.
 *
 * **A role that comes from a group is refused, and the refusal says why.** A
 * group is one object across every binder it is granted onto, so changing
 * Aisha's role on this row would change it everywhere the group reaches. That
 * is a real constraint rather than a policy of ours, and the honest surface for
 * it is a sentence naming the group — which is also the answer to "why can she
 * approve here", on the row that raised the question.
 */
async function handleBinderPerson(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  /** The person being moved, when the URL names one rather than the body. */
  target: string | null,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const body = (await req.json().catch(() => null)) as {
      username?: unknown;
      level?: unknown;
    } | null;

    const username =
      target ??
      (typeof body?.username === "string" ? body.username.trim() : "");
    if (username === "") {
      return json(400, { error: "Name somebody to add." }, baseHeaders);
    }

    const level = typeof body?.level === "string" ? body.level : "";
    const role = BINDER_LEVEL_ROLES[level];
    if (!role) {
      return json(
        400,
        {
          error: "Somebody is added at one level: admin, editor or reviewer.",
        },
        baseHeaders,
      );
    }

    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    // Only a move needs the refusal. Adding somebody who is already here
    // through a group is the escape hatch the UX calls for — one person in a
    // group needing more in this one binder — and it is an *addition*, not a
    // change to the group.
    if (target !== null) {
      const refusal = await refuseGroupDerivedRole({
        client,
        org: orgName,
        workspace: workspaceName,
        username,
      });
      if (refusal) return json(409, { error: refusal }, baseHeaders);
    }

    await ensureOrganizationMembership({
      client,
      org: orgName,
      username,
    });

    // Leave whatever role they held here first, so a move cannot end with them
    // in two of this binder's teams and their effective access decided by
    // whichever ranks higher.
    await removeFromRoleTeams({
      client,
      org: orgName,
      workspace: workspaceName,
      username,
      except: role,
    });

    const team = await createWorkspaceRoleTeam({
      client,
      org: orgName,
      workspace: workspaceName,
      role,
    });
    // Idempotent, and needed on the first use of a team that already existed
    // but had been revoked. Before the membership, so a failure leaves the
    // person out rather than in a team that reaches nothing.
    await grantTeamOnRepo({
      client,
      teamId: team.id,
      org: orgName,
      repo: workspaceName,
    });
    await addTeamMember({ client, teamId: team.id, username });

    await recomputeApprovalsWhitelist({
      client,
      org: orgName,
      workspace: workspaceName,
    });

    return json(
      200,
      await readBinderPeople(client, orgName, workspaceName),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to change who can act in a binder", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to change who can act in this binder.",
    );
  }
}

/**
 * Take somebody out of this binder.
 *
 * Only out of *this binder's own* role teams. Removing them from a group would
 * change every binder that group reaches, which is not what the button on this
 * row says — so if that is the only thing holding them here, it is refused with
 * the group named and the cost of the alternative stated.
 */
async function handleRemoveBinderPerson(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  username: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const refusal = await refuseGroupDerivedRole({
      client,
      org: orgName,
      workspace: workspaceName,
      username,
    });
    if (refusal) return json(409, { error: refusal }, baseHeaders);

    await removeFromRoleTeams({
      client,
      org: orgName,
      workspace: workspaceName,
      username,
      except: null,
    });

    return json(
      200,
      await readBinderPeople(client, orgName, workspaceName),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to remove somebody from a binder", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to take them out of this binder.",
    );
  }
}

/**
 * The sentence to refuse with when somebody's access here is not ours to move.
 *
 * `null` when they hold an individual role in this binder, which is the case
 * that can be changed without touching another binder.
 */
async function refuseGroupDerivedRole(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  username: string;
}): Promise<string | null> {
  const { client, org, workspace, username } = params;
  const ownTeams = roleTeamNames(workspace);
  const login = username.toLowerCase();

  const teams = await listRepoTeams({ client, owner: org, repo: workspace });
  const holding: string[] = [];

  for (const team of teams) {
    const members = await listTeamMembers({ client, teamId: team.id }).catch(
      () => [],
    );
    if (!members.some((member) => member.login.toLowerCase() === login)) {
      continue;
    }
    if (ownTeams.has(team.name)) return null;
    holding.push(team.name);
  }

  if (holding.length === 0) {
    return `${username} is not in this binder.`;
  }

  const named = holding.join(", ");
  const reach = holding.length === 1 ? "that group" : "those groups";
  return `${username} is here through ${named}. A group carries one level across every binder it is added to, so changing it here would change it everywhere — change ${reach} on the organization, or add ${username} to this binder individually as well.`;
}

/** Out of this binder's own role teams, leaving groups exactly as they are. */
async function removeFromRoleTeams(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  username: string;
  /** A role to leave alone, so a move does not undo the half it just did. */
  except: WorkspaceRole | null;
}): Promise<void> {
  const { client, org, workspace, username, except } = params;

  const teams = await listOrganizationTeams({ client, org });
  for (const role of WORKSPACE_ROLES) {
    if (role === except) continue;
    const name = workspaceTeamName(workspace, role);
    const team = teams.find((candidate) => candidate.name === name);
    if (!team) continue;
    // They may well not be in it; Gitea answers 404 and that is not a failure
    // of this request.
    await removeTeamMember({ client, teamId: team.id, username }).catch(
      () => undefined,
    );
  }
}

/**
 * Open this binder to the whole organization, or close it again.
 *
 * One switch over one primitive: `staff` granted onto the repository, or not.
 * Nothing is stored — the answer is derived by asking Gitea which teams are
 * granted here, because a stored copy could disagree with the grant Gitea is
 * the one enforcing, and the one that matters is the one Gitea enforced.
 *
 * It is its own endpoint rather than a group grant with a friendlier name,
 * because the two are different acts to the person doing them. "Everyone at
 * Riverside Health can read this" is a decision about the binder; "add the
 * Quality Committee" is a decision about a group. Routing the first through
 * the second would put a team called `staff` in a picker beside the customer's
 * own committees and make the most consequential access choice in the product
 * look like housekeeping.
 *
 * The whitelist is rewritten in the same handler, for the reason every grant
 * is: granting `staff` read without whitelisting it produces readers whose
 * approvals are recorded, displayed, and satisfy nothing.
 */
async function handleBinderVisibility(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;

  try {
    const body = (await req.json().catch(() => null)) as {
      openToOrganization?: unknown;
    } | null;

    if (typeof body?.openToOrganization !== "boolean") {
      return json(
        400,
        { error: "Say whether the organization can read this binder." },
        baseHeaders,
      );
    }

    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const staff = await ensureStaffTeam({ client, org: orgName });

    if (body.openToOrganization) {
      await grantTeamOnRepo({
        client,
        teamId: staff.id,
        org: orgName,
        repo: workspaceName,
      });
    } else {
      await revokeTeamFromRepo({
        client,
        teamId: staff.id,
        org: orgName,
        repo: workspaceName,
      });
    }

    await recomputeApprovalsWhitelist({
      client,
      org: orgName,
      workspace: workspaceName,
    });

    logger.info("Binder visibility changed", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      openToOrganization: body.openToOrganization,
    });

    return json(
      200,
      await readBinderPeople(client, orgName, workspaceName),
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to change a binder's visibility", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to change who can see this binder.",
    );
  }
}

/**
 * Compose a group onto a binder, or take it off — and rewrite the approvals
 * whitelist to match, in the same handler.
 *
 * The whitelist is not a follow-up job, because the failure it prevents has no
 * error message: `enable_approvals_whitelist` is what makes a free reviewer's
 * approval count, and a granted team missing from the list has its members'
 * approvals recorded, displayed, and satisfying nothing. Recomputed rather than
 * appended to, so a revoke narrows it by the same code path a grant widens it —
 * and `Owners` goes on unconditionally, because Gitea never grants it onto a
 * repository and a list derived from the granted teams alone would stop
 * counting an owner's approval.
 *
 * Who may do it is Gitea's answer: `PUT /teams/{id}/repos/{org}/{repo}` refuses
 * anyone without admin on the repository. An organization owner has that
 * everywhere through `Owners`.
 */
async function handleBinderGroup(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  revoking: string | null,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { client, session } = auth;
  let groupName = revoking;

  try {
    if (groupName === null) {
      const body = (await req.json().catch(() => null)) as {
        group?: unknown;
      } | null;
      groupName = typeof body?.group === "string" ? body.group.trim() : "";
    }

    if (groupName === "") {
      return json(400, { error: "Name a group to add." }, baseHeaders);
    }

    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const team = await findOrganizationTeam({
      client,
      org: orgName,
      name: groupName,
    });
    if (!team) {
      return json(404, { error: "No such group." }, baseHeaders);
    }

    if (team.name === OWNERS_TEAM_NAME) {
      // Gitea gives Owners admin over the whole organization implicitly and
      // never grants it onto a repository. Offering to revoke it would be
      // offering something that cannot happen.
      return json(
        400,
        {
          error:
            "Owners administer every binder in the organization. That is not granted here and cannot be taken away here.",
        },
        baseHeaders,
      );
    }

    if (revoking === null) {
      await grantTeamOnRepo({
        client,
        teamId: team.id,
        org: orgName,
        repo: workspaceName,
      });
    } else {
      await revokeTeamFromRepo({
        client,
        teamId: team.id,
        org: orgName,
        repo: workspaceName,
      });
    }

    // After the grant, never before: the whitelist is derived from what Gitea
    // says is granted, so reading it first would write the state we just left.
    const approvalsWhitelist = await recomputeApprovalsWhitelist({
      client,
      org: orgName,
      workspace: workspaceName,
    });

    const teams = await listRepoTeams({
      client,
      owner: orgName,
      repo: workspaceName,
    });

    const withMembers = await Promise.all(
      teams.map(async (granted) => ({
        id: granted.id,
        name: granted.name,
        description: granted.description,
        access: granted.codeAccess,
        members: (
          await listTeamMembers({ client, teamId: granted.id }).catch(() => [])
        ).map((member) => ({
          login: member.login,
          fullName: member.fullName,
        })),
      })),
    );

    return json(
      200,
      {
        organization: orgName,
        workspace: workspaceName,
        teams: withMembers.sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
        approvalsWhitelist,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to change a binder's groups", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      group: groupName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to change who can act in this binder.",
    );
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

    return json(
      200,
      {
        organization: orgName,
        workspace: workspaceName,
        documents: await readBinderDocuments({
          client: auth.client,
          org: orgName,
          workspace: workspaceName,
        }),
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
 * Everything one binder holds — which is what is on `main`, and nothing else.
 *
 * **A binder is the record, so it lists the record.** It used to add a row per
 * policy that existed only inside an open change, so that a filing somebody had
 * just done was visible immediately. That reads well for ten seconds and badly
 * afterwards: a list whose whole job is to answer "what is in force here" was
 * mixing in things that are not in force — no version, no file, and no
 * guarantee of ever arriving. A reader could not tell the two apart at a
 * glance, which is the one thing this list must never allow.
 *
 * A policy in flight is not lost. It is a change request, and Change requests
 * is where it lives; the upload still opens the document's own page, which
 * says in as many words that it is in review.
 *
 * **Three calls for the whole binder**, whatever it holds — the tree, the open
 * changes, and the tags — rather than a pull request query and a tags query per
 * document, which is the cost the binder model exists to remove. A binder of
 * two hundred policies costs the same as one of two, which is the property that
 * makes the cross-binder library below affordable at all.
 */
async function readBinderDocuments(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
}): Promise<WorkspaceDocumentListEntry[]> {
  const { client, org, workspace } = params;

  const [documents, openChanges, tags] = await Promise.all([
    listWorkspaceDocuments({ client, org, workspace }),
    listPullRequests({ client, owner: org, repo: workspace, state: "open" }),
    listAllTags({ client, owner: org, repo: workspace }),
  ]);

  // Joined here rather than inside a fourth call, so the three above stay
  // parallel and a binder still costs three reads whatever it holds.
  const versionsByDocument = groupVersionsByDocument(tags, documents);
  const changesByDocument = await countOpenChangesByDocument({
    client,
    org,
    workspace,
    openChanges,
  });

  return documents
    .map((document) => ({
      ...document,
      state: "published" as const,
      openChangeCount: changesByDocument.get(document.slugPath) ?? 0,
      // A list of policies that does not say which version each one is at
      // answers none of the questions a list is opened to answer.
      latestVersion: versionsByDocument.get(document.slugPath)?.[0] ?? null,
    }))
    .sort((left, right) => left.slugPath.localeCompare(right.slugPath));
}

/**
 * The open changes that actually touch this document.
 *
 * Same reason as {@link countOpenChangesByDocument}: the branch name carries
 * one document, and a change request can hold several. A policy revised inside
 * somebody else's change used to show "nothing in review" on its own page,
 * which is the worst place to be wrong about it.
 */
async function filterChangesTouching<T extends { number?: number }>(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  openChanges: readonly T[];
  slugPath: string;
}): Promise<T[]> {
  const { client, org, workspace, openChanges, slugPath } = params;

  const touching = await Promise.all(
    openChanges.map(async (pull) => {
      if (typeof pull.number !== "number") return false;
      const documents = await listChangedDocuments({
        client,
        org,
        workspace,
        pullNumber: pull.number,
      }).catch(() => []);
      return documents.some((document) => document.slugPath === slugPath);
    }),
  );

  return openChanges.filter((_, index) => touching[index]);
}

/**
 * How many open changes touch each document.
 *
 * **This used to read the branch name** — `upload/<slugPath>/…` — which is one
 * document, and was free. That was the right trade while a change could only
 * ever be about one document, and it stopped being right the moment a change
 * request could hold several: the branch names whichever document opened it,
 * so every other policy in that change showed nothing in flight while a change
 * to it sat waiting for approval. A binder quietly understating what is being
 * changed is the failure this list exists to avoid.
 *
 * So it asks. One call per **open change**, run in parallel — not one per
 * document, which is the cost ADR 0004 actually set out to remove and which
 * this does not reintroduce: a binder of two hundred policies with three
 * changes in flight pays for three.
 *
 * A change whose files cannot be read counts for nothing rather than failing
 * the list: this decides a line of small print, and a binder is worth showing
 * without it.
 */
async function countOpenChangesByDocument(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  openChanges: ReadonlyArray<{ number?: number }>;
}): Promise<Map<string, number>> {
  const { client, org, workspace, openChanges } = params;

  const perChange = await Promise.all(
    openChanges.map(async (pull) =>
      typeof pull.number === "number"
        ? await listChangedDocuments({
            client,
            org,
            workspace,
            pullNumber: pull.number,
          }).catch(() => [])
        : [],
    ),
  );

  const counts = new Map<string, number>();
  for (const documents of perChange) {
    for (const document of documents) {
      counts.set(document.slugPath, (counts.get(document.slugPath) ?? 0) + 1);
    }
  }
  return counts;
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

    let ref = "main";
    let state: "published" | "proposed" = "published";
    let document = await findWorkspaceDocument({
      client: auth.client,
      org: orgName,
      workspace: workspaceName,
      documentPath,
    });

    // Not on the record, so it is either a document that was never uploaded or
    // one whose first change nobody has approved yet. The binder's list shows
    // the second as proposed, so its page has to open — a row that leads to a
    // 404 is worse than no row at all.
    if (!document) {
      // The branch carries the identity, and the URL may carry the file path,
      // so the extension comes off first — by the same rule the tree walk
      // uses, rather than a second copy of it.
      const branch = await findPendingDocumentBranch({
        client: auth.client,
        org: orgName,
        workspace: workspaceName,
        slugPath:
          toDocumentEntry({ path: documentPath, type: "blob" })?.slugPath ??
          documentPath,
      });

      if (branch) {
        document = await findWorkspaceDocument({
          client: auth.client,
          org: orgName,
          workspace: workspaceName,
          documentPath,
          ref: branch,
        });
        if (document) {
          ref = branch;
          state = "proposed";
        }
      }
    }

    if (!document) {
      return json(404, { error: "No such document." }, baseHeaders);
    }

    const resolved = document;
    const [versions, openChanges] = await Promise.all([
      listDocumentVersions({
        client: auth.client,
        org: orgName,
        workspace: workspaceName,
        uid: resolved.uid,
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
        document: resolved,
        state,
        ref,
        versions,
        latestVersion: versions[0] ?? null,
        openChanges: await filterChangesTouching({
          client: auth.client,
          org: orgName,
          workspace: workspaceName,
          openChanges,
          slugPath: resolved.slugPath,
        }),
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

/**
 * The bytes of one document in a binder, at whatever ref is asked for.
 *
 * Addressed under `raw/` rather than as a `download` suffix on the document
 * itself, because a document's path is the rest of the URL — a policy filed at
 * `nursing/download` would otherwise be indistinguishable from a request to
 * download `nursing`. Gitea addresses raw content the same way, for the same
 * reason.
 *
 * Never gated: reading the record is open forever, whatever the organization
 * owes us (ADR 0004).
 */
async function handleWorkspaceDocumentRaw(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  documentPath: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const ref = new URL(req.url).searchParams.get("ref")?.trim() || "main";

  try {
    // Resolved rather than trusted: the URL may carry the document's identity
    // (`nursing/hand-hygiene`) instead of its file path, and only the tree
    // knows which extension that identity currently wears.
    const document = await findWorkspaceDocument({
      client: auth.client,
      org: orgName,
      workspace: workspaceName,
      documentPath,
      ref,
    });
    if (!document) {
      return json(404, { error: "No such document." }, baseHeaders);
    }

    const response = await giteaFetch(
      `/api/v1/repos/${encodeURIComponent(orgName)}/${encodeURIComponent(workspaceName)}/raw/${document.path
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`,
      {
        method: "GET",
        headers: {
          Authorization: buildTokenAuthHeader(auth.session.giteaToken),
          Accept: "*/*",
        },
      },
    );

    if (!response.ok) {
      const errorMessage = await readGiteaErrorMessage(
        response,
        "Unable to download the document.",
      );
      logger.error("Gitea fetch failure on a binder document download", {
        status: response.status,
        organization: orgName,
        workspace: workspaceName,
        documentPath: document.path,
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
    logger.error("Failed to download a binder document", {
      username: auth.session.username,
      organization: orgName,
      workspace: workspaceName,
      documentPath,
      ref,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to download the document.",
    );
  }
}

/**
 * The change request an act should join, if the caller named one.
 *
 * **Every act used to open a change request of its own**, so revising three
 * cross-referencing policies produced three of them — approved separately and
 * publishable apart, which is the exact thing ADR 0004 §4 makes the change the
 * unit of approval to prevent. Naming one here puts the work into it instead.
 *
 * Checked against the binder's *open* changes rather than taken on trust: a
 * number that names a closed change, a change in another binder, or nothing at
 * all would otherwise commit onto whatever branch Gitea happened to resolve.
 */
async function resolveChangeToJoin(params: {
  client: GiteaClient;
  org: string;
  workspace: string;
  raw: string | null;
}): Promise<
  { changeNumber: number; branch: string } | { error: string } | null
> {
  const { client, org, workspace, raw } = params;
  if (raw === null || raw.trim() === "") return null;

  const changeNumber = Number(raw);
  if (!Number.isInteger(changeNumber) || changeNumber <= 0) {
    return { error: "That is not a change request number." };
  }

  const open = await listPullRequests({
    client,
    owner: org,
    repo: workspace,
    state: "open",
  });

  const match = open.find((pull) => pull.number === changeNumber);
  if (!match) {
    return {
      error: `Change ${changeNumber} is not open in this binder, so there is nothing to add to.`,
    };
  }

  // A sign-off change rewrites who has to approve things. Filing a policy into
  // it would put a permission decision and a policy in one approval, and the
  // binder reads that branch prefix to mean "this change is about no document".
  if ((match.head?.ref ?? "").startsWith("sign-off/")) {
    return {
      error: `Change ${changeNumber} changes who signs off on this binder. A policy cannot go in it.`,
    };
  }

  const branch = match.head?.ref ?? "";
  if (branch === "") {
    return {
      error: `Change ${changeNumber} has no branch to add to, so there is nowhere to put this.`,
    };
  }

  return { changeNumber, branch };
}

/**
 * The acts that change a binder's shape: folders, and where things are filed.
 *
 * One handler for three routes, because they differ only in how they work out
 * the operations — everything around that is identical, and three copies of
 * "resolve the binder, check the access, read the tree, join or open a change"
 * would drift apart at the edges.
 *
 * Like every other write to a binder, they propose rather than change: `main`
 * is protected, and a binder's shape is part of its record.
 */
async function handleBinderShapeChange(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
  workspaceName: string,
  plan: (context: {
    body: Record<string, unknown>;
    tree: WorkspaceTree;
  }) => ShapeChangeResult,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const { session, client } = auth;

  try {
    const body = ((await req.json().catch(() => null)) ?? {}) as Record<
      string,
      unknown
    >;

    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    const join = await resolveChangeToJoin({
      client,
      org: orgName,
      workspace: workspaceName,
      raw:
        typeof body.changeNumber === "number"
          ? String(body.changeNumber)
          : typeof body.changeNumber === "string"
            ? body.changeNumber
            : null,
    });
    if (join && "error" in join) {
      return json(409, { error: join.error }, baseHeaders);
    }

    // **Read the branch this is joining, not `main`.** A folder made five
    // minutes ago in the same change is a folder for these purposes, and a
    // rename has to see it — otherwise the second act in a change collides
    // with the first or refuses a folder that is right there.
    const tree = await readWorkspaceTree({
      client,
      org: orgName,
      workspace: workspaceName,
      ...(join ? { ref: join.branch } : {}),
    });

    const planned = plan({ body, tree });
    if ("error" in planned) {
      return json(409, { error: planned.error }, baseHeaders);
    }

    const proposed = join
      ? await addToBinderChange({
          client,
          org: orgName,
          workspace: workspaceName,
          changeNumber: join.changeNumber,
          operations: planned.operations,
          message: planned.message,
        })
      : await proposeBinderFileChange({
          client,
          org: orgName,
          workspace: workspaceName,
          branch: buildShapeBranchName(session.username),
          operations: planned.operations,
          message: planned.message,
          title: planned.title,
          body: [
            planned.title,
            "",
            `${session.username} proposed this from Bindersnap.`,
            "",
            "Nothing in this change alters what any policy says. It changes",
            "where things are filed, which the binder records like anything",
            "else.",
          ].join("\n"),
        });

    logger.info("Binder shape change proposed", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      changeNumber: proposed.changeNumber,
      operations: planned.operations.length,
    });

    return json(
      201,
      {
        organization: orgName,
        workspace: workspaceName,
        branch: proposed.branch,
        changeNumber: proposed.changeNumber,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to change a binder's shape", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to propose that change.",
    );
  }
}

/**
 * The branch a shape change lives on.
 *
 * Deliberately **not** under `upload/`, which carries a document's address and
 * is what the binder reads to work out which document an open change is about.
 * A folder rename is about no single document, and one that moved twelve would
 * have to pick one to name the branch after.
 */
function buildShapeBranchName(
  username: string,
  now: Date = new Date(),
): string {
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14);
  return `shape/${username}/${stamp}`;
}

/**
 * A new version of a document that is already in the binder.
 *
 * **The gap this closes.** Adding a policy was the only way anything reached a
 * binder, so revising one meant uploading a file whose name slugged to exactly
 * the same thing — and if it did not, you got a second document at a second
 * address instead of a second version of the first. That is not a workflow
 * anybody would choose; it is what was left over from a create-only path.
 *
 * The document is named by its **address**, and the file that lands keeps its
 * identity (ADR 0005). So a Word policy can be replaced by a PDF and it is
 * still the same policy, on v5 rather than back at v1 — the identity segment
 * does not change, only the extension after it, and the version tags are named
 * after the identity.
 *
 * Like every other write to a binder, it proposes rather than changes: `main`
 * is protected, so this opens a change request and answers with its number.
 */
async function handleReviseWorkspaceDocument(
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
  const documentPath = parseOptionalString(form.get("documentPath"));
  const joinRaw = parseOptionalString(form.get("changeNumber"));

  if (!file || !documentPath) {
    return json(
      400,
      { error: "file and documentPath are required." },
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
    const workspace = await findWorkspaceRepo({
      client,
      org: orgName,
      name: workspaceName,
    });
    if (!workspace) {
      return json(404, { error: "No such binder." }, baseHeaders);
    }

    // Read from `main`, deliberately. A revision revises what is on the record;
    // a document that only exists inside somebody else's open change is not
    // something to build a second change on top of.
    const existing = await findWorkspaceDocument({
      client,
      org: orgName,
      workspace: workspaceName,
      documentPath,
    });

    if (!existing) {
      return json(
        404,
        {
          error: `"${documentPath}" is not in this binder. A new policy is added rather than revised.`,
        },
        baseHeaders,
      );
    }

    if (existing.uid === null) {
      // No identity means no version series to add to, which is the same
      // refusal publish makes — said here, where it is still actionable.
      return json(
        409,
        {
          error: `"${existing.path}" was not added through Bindersnap, so it has no version history to revise.`,
        },
        baseHeaders,
      );
    }

    const buffer = await file.arrayBuffer();
    const [fullHash, base64Content] = await Promise.all([
      computeFileHashFromBuffer(buffer),
      Buffer.from(buffer).toString("base64"),
    ]);

    const nextPath = buildDocumentFilePath(
      existing.name,
      getFileExtension(file.name),
      existing.uid,
      existing.folder || null,
    );

    // **Replacing a .docx with a .pdf moves the file**, because the extension
    // is part of the filename. The identity segment is not, so this is still
    // the same document and its next version is the next one — which is the
    // whole reason the identity is a segment rather than the whole name.
    const operations: BinderFileOperation[] =
      nextPath === existing.path
        ? [{ kind: "write", path: nextPath, base64Content }]
        : [
            { kind: "remove", path: existing.path },
            { kind: "write", path: nextPath, base64Content },
          ];

    const join = await resolveChangeToJoin({
      client,
      org: orgName,
      workspace: workspaceName,
      raw: joinRaw,
    });
    if (join && "error" in join) {
      return json(409, { error: join.error }, baseHeaders);
    }

    const branch = buildUploadBranchName(
      existing.slugPath,
      session.username,
      fullHash.slice(0, 8),
    );

    const message = buildUploadCommitMessage({
      docSlug: existing.slugPath,
      canonicalFile: nextPath,
      sourceFilename: file.name,
      uploadBranch: join ? `change-${join.changeNumber}` : branch,
      uploaderSlug: session.username,
      fileHashSha256: fullHash,
    });

    const proposed = join
      ? await addToBinderChange({
          client,
          org: orgName,
          workspace: workspaceName,
          changeNumber: join.changeNumber,
          operations,
          message,
        })
      : await proposeBinderFileChange({
          client,
          org: orgName,
          workspace: workspaceName,
          branch,
          operations,
          message,
          title: `Update ${existing.slugPath}`,
          body: [
            `Update ${existing.slugPath}`,
            "",
            "A new version proposed from Bindersnap.",
            "",
            `Source file: ${file.name}`,
            `Document: ${existing.slugPath}`,
            `Binder: ${orgName}/${workspaceName}`,
            `Proposed by: ${session.username}`,
            `File hash (SHA-256): ${fullHash}`,
          ].join("\n"),
        });

    logger.info("Workspace document revised", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      documentPath: nextPath,
      changeNumber: proposed.changeNumber,
    });

    return json(
      201,
      {
        organization: orgName,
        workspace: workspaceName,
        documentPath: nextPath,
        slugPath: existing.slugPath,
        branch: proposed.branch,
        pullRequestNumber: proposed.changeNumber,
      },
      baseHeaders,
    );
  } catch (err) {
    logger.error("Failed to revise a document", {
      username: session.username,
      organization: orgName,
      workspace: workspaceName,
      documentPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(
      err,
      baseHeaders,
      "Unable to propose a new version.",
    );
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
  const joinRaw = parseOptionalString(form.get("changeNumber"));

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

  // **The identity, minted once and never again.** It is what this document's
  // version tags will be named after for the rest of its life, so it is decided
  // here — at the only moment a document comes into existence — and never
  // derived from anything a person can change afterwards (ADR 0005).
  const uid = mintDocumentUid();
  const extension = getFileExtension(file.name);
  const filePath = buildDocumentFilePath(name, extension, uid, folder);

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

    // Refuse anything that would land on an address already taken — including
    // the same name with a different extension. A URL has to name one thing:
    // `policy.md` and `policy.pdf` would both be `nursing/policy`, so a link to
    // that address would resolve to whichever came first alphabetically, and
    // publishing one would write the other's version tag.
    //
    // The identity deliberately excludes the extension so that re-uploading a
    // policy as a PDF keeps its history. That only works if nothing else can
    // claim the same identity, which is what this enforces.
    const collision = await findWorkspaceDocument({
      client,
      org: orgName,
      workspace: workspaceName,
      documentPath: slugPath,
    });

    if (collision) {
      return json(
        409,
        {
          error:
            collision.path === filePath
              ? `A document already lives at "${filePath}".`
              : `"${collision.path}" already answers to "${slugPath}". Two documents cannot share one address.`,
        },
        baseHeaders,
      );
    }

    // And one that is proposed but not yet published. `main` shows only
    // published documents, so without this two uploads race for the same
    // address, both succeed, and the collision appears later as two files
    // answering to one URL.
    const pending = await findPendingDocumentBranch({
      client,
      org: orgName,
      workspace: workspaceName,
      slugPath,
    });

    if (pending) {
      return json(
        409,
        {
          error: `An unpublished change already claims "${slugPath}" (${pending}).`,
        },
        baseHeaders,
      );
    }

    const join = await resolveChangeToJoin({
      client,
      org: orgName,
      workspace: workspaceName,
      raw: joinRaw,
    });
    if (join && "error" in join) {
      return json(409, { error: join.error }, baseHeaders);
    }

    // The address has to be free on the branch this is joining, too. `main`
    // does not know about a policy the same change added five minutes ago, so
    // checking only the record would let one change hold two documents at one
    // address — a collision that appears on publish rather than here.
    if (join) {
      const alreadyInChange = await findWorkspaceDocument({
        client,
        org: orgName,
        workspace: workspaceName,
        documentPath: slugPath,
        ref: join.branch,
      });
      if (alreadyInChange) {
        return json(
          409,
          {
            error: `Change ${join.changeNumber} already files something at "${slugPath}".`,
          },
          baseHeaders,
        );
      }
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

    const commitMessage = buildUploadCommitMessage({
      docSlug: slugPath,
      canonicalFile: filePath,
      sourceFilename: file.name,
      uploadBranch: join ? `change-${join.changeNumber}` : branchName,
      uploaderSlug: session.username,
      fileHashSha256: fullHash,
    });

    const operations: BinderFileOperation[] = [
      { kind: "write", path: filePath, base64Content },
    ];

    // No repository to create and no rules to install: the binder already has
    // a protected `main` and its role teams. That is the point of the level.
    const proposed = join
      ? await addToBinderChange({
          client,
          org: orgName,
          workspace: workspaceName,
          changeNumber: join.changeNumber,
          operations,
          message: commitMessage,
        })
      : await proposeBinderFileChange({
          client,
          org: orgName,
          workspace: workspaceName,
          branch: branchName,
          operations,
          message: commitMessage,
          title: `Add ${slugPath}`,
          body: [
            `Add ${slugPath}`,
            "",
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
      changeNumber: proposed.changeNumber,
    });

    return json(
      201,
      {
        organization: orgName,
        workspace: workspaceName,
        documentPath: filePath,
        slugPath,
        branch: proposed.branch,
        pullRequestNumber: proposed.changeNumber,
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
/**
 * The binders one organization owns.
 *
 * Distinct from `GET /api/app/binders`, and deliberately so. That one answers
 * a question about a person — everything I can act in, wherever it lives — and
 * is what the personal views are built on. This one answers a question about
 * an organization, which is what you are asking when you are looking at the
 * organization rather than at your day.
 */
async function handleListOrganizationWorkspaces(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
): Promise<Response> {
  const auth = await requireSession(req, baseHeaders);
  if (auth instanceof Response) return auth;

  try {
    const workspaces = await listOrganizationWorkspaces({
      client: auth.client,
      org: orgName,
    });
    return json(200, { workspaces }, baseHeaders);
  } catch (err) {
    logger.error("Failed to list an organization's binders", {
      username: auth.session.username,
      organization: orgName,
      error: err instanceof Error ? err.message : String(err),
    });
    return responseFromError(err, baseHeaders, "Unable to list the binders.");
  }
}

async function handleCreateWorkspace(
  req: Request,
  baseHeaders: Headers,
  orgName: string,
): Promise<Response> {
  const auth = await requireSubscription(req, baseHeaders);
  if (auth instanceof Response) return auth;

  const payload = await readJson<{
    name?: unknown;
    description?: unknown;
    openToOrganization?: unknown;
  }>(req);
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
      // Absent means open, which is the decided default — an older client that
      // does not ask gets the answer the product would have given anyway.
      openToOrganization: payload?.openToOrganization !== false,
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
        response = await handleLibraryDocuments(req, baseHeaders);
      } else if (pathname === "/api/app/documents/search" && method === "GET") {
        response = await handleDocumentSearch(req, baseHeaders);
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
        const workspaceDocumentsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/documents$/,
        );
        // A new version of a document already in the binder. The document is
        // named in the body rather than in the path, because a path suffix
        // would collide with a policy filed in a folder of that name —
        // `…/documents/nursing/revisions` is a real address a person could
        // have made.
        const workspaceDocumentRevisionsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/document-revisions$/,
        );
        // The acts that change where things are filed rather than what they
        // say. Each names its subject in the body for the same reason a
        // revision does: a folder called `folders` is a folder somebody could
        // legitimately make.
        const workspaceFoldersMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/folders$/,
        );
        const workspaceFolderRenamesMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/folder-renames$/,
        );
        // The document's path carries slashes — it is a path inside the binder,
        // not one segment — so this captures the rest of the URL.
        const workspaceDocumentMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/documents\/(.+)$/,
        );
        const workspacePublishMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/publish$/,
        );
        const workspaceChangeReviewMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/reviews$/,
        );
        const workspaceChangeUpdateMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/update$/,
        );
        // A binder is a Gitea repository and a change on it is a Gitea pull
        // request, so everything below is the document model's own handler
        // reached at the binder's address. Same behaviour, one namespace per
        // shape of thing — not a second implementation.
        const workspaceChangeDiscussionsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/discussions$/,
        );
        const workspaceChangeReplyMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/discussions\/([^/]+)\/comments$/,
        );
        const workspaceChangeResolveMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/discussions\/([^/]+)\/resolve$/,
        );
        const workspaceChangeReactionMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/discussions\/([^/]+)\/comments\/(\d+)\/reactions$/,
        );
        const workspaceChangeUpdatesMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/updates$/,
        );
        const workspaceChangeAssignmentsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)\/assignments$/,
        );
        const workspaceCollaboratorsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/collaborators$/,
        );
        const workspaceChangeMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes\/(\d+)$/,
        );
        // Raw content sits under its own segment rather than as a suffix on
        // the document, because the document's path is the rest of the URL.
        const workspaceDocumentRawMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/raw\/(.+)$/,
        );
        const createBinderMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/binders$/,
        );
        const organizationPeopleMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/people$/,
        );
        const organizationPersonRoleMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/people\/([^/]+)\/role$/,
        );
        const organizationPersonMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/people\/([^/]+)$/,
        );
        const organizationGroupsMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/groups$/,
        );
        const organizationGroupMembersMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/groups\/([^/]+)\/members$/,
        );
        const organizationGroupMemberMatch = pathname.match(
          /^\/api\/app\/orgs\/([^/]+)\/groups\/([^/]+)\/members\/([^/]+)$/,
        );
        const workspacePeopleMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/people$/,
        );
        const workspacePersonMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/people\/([^/]+)$/,
        );
        const workspaceVisibilityMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/visibility$/,
        );
        const workspaceGroupsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/groups$/,
        );
        const workspaceGroupMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/groups\/([^/]+)$/,
        );
        const workspaceChangesMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/changes$/,
        );
        const workspaceHistoryMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/history$/,
        );
        const workspaceSettingsMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/settings$/,
        );
        const workspaceSignOffMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/rules\/sign-off$/,
        );
        const workspaceRulesMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)\/rules$/,
        );
        // Last of the binder matchers, because every one above it is a longer
        // path under the same two segments.
        const workspaceOverviewMatch = pathname.match(
          /^\/api\/app\/binders\/([^/]+)\/([^/]+)$/,
        );

        if (organizationPeopleMatch && method === "GET") {
          response = await handleOrganizationPeople(
            req,
            baseHeaders,
            organizationPeopleMatch[1]!,
          );
        } else if (organizationPeopleMatch && method === "POST") {
          response = await handleAddOrganizationPerson(
            req,
            baseHeaders,
            organizationPeopleMatch[1]!,
          );
        } else if (organizationPersonRoleMatch && method === "POST") {
          response = await handleOrganizationPersonRole(
            req,
            baseHeaders,
            organizationPersonRoleMatch[1]!,
            organizationPersonRoleMatch[2]!,
          );
        } else if (organizationPersonMatch && method === "DELETE") {
          response = await handleRemoveOrganizationPerson(
            req,
            baseHeaders,
            organizationPersonMatch[1]!,
            organizationPersonMatch[2]!,
          );
        } else if (organizationGroupsMatch && method === "POST") {
          response = await handleCreateOrganizationGroup(
            req,
            baseHeaders,
            organizationGroupsMatch[1]!,
          );
        } else if (organizationGroupMembersMatch && method === "POST") {
          response = await handleOrganizationGroupMember(
            req,
            baseHeaders,
            organizationGroupMembersMatch[1]!,
            organizationGroupMembersMatch[2]!,
            null,
          );
        } else if (organizationGroupMemberMatch && method === "DELETE") {
          response = await handleOrganizationGroupMember(
            req,
            baseHeaders,
            organizationGroupMemberMatch[1]!,
            organizationGroupMemberMatch[2]!,
            organizationGroupMemberMatch[3]!,
          );
        } else if (workspaceVisibilityMatch && method === "POST") {
          response = await handleBinderVisibility(
            req,
            baseHeaders,
            workspaceVisibilityMatch[1]!,
            workspaceVisibilityMatch[2]!,
          );
        } else if (workspacePeopleMatch && method === "GET") {
          response = await handleBinderPeople(
            req,
            baseHeaders,
            workspacePeopleMatch[1]!,
            workspacePeopleMatch[2]!,
          );
        } else if (workspacePeopleMatch && method === "POST") {
          response = await handleBinderPerson(
            req,
            baseHeaders,
            workspacePeopleMatch[1]!,
            workspacePeopleMatch[2]!,
            null,
          );
        } else if (workspacePersonMatch && method === "POST") {
          response = await handleBinderPerson(
            req,
            baseHeaders,
            workspacePersonMatch[1]!,
            workspacePersonMatch[2]!,
            workspacePersonMatch[3]!,
          );
        } else if (workspacePersonMatch && method === "DELETE") {
          response = await handleRemoveBinderPerson(
            req,
            baseHeaders,
            workspacePersonMatch[1]!,
            workspacePersonMatch[2]!,
            workspacePersonMatch[3]!,
          );
        } else if (workspaceGroupsMatch && method === "POST") {
          response = await handleBinderGroup(
            req,
            baseHeaders,
            workspaceGroupsMatch[1]!,
            workspaceGroupsMatch[2]!,
            null,
          );
        } else if (workspaceGroupMatch && method === "DELETE") {
          response = await handleBinderGroup(
            req,
            baseHeaders,
            workspaceGroupMatch[1]!,
            workspaceGroupMatch[2]!,
            workspaceGroupMatch[3]!,
          );
        } else if (createBinderMatch && method === "GET") {
          response = await handleListOrganizationWorkspaces(
            req,
            baseHeaders,
            createBinderMatch[1]!,
          );
        } else if (createBinderMatch && method === "POST") {
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
        } else if (workspaceChangeReviewMatch && method === "POST") {
          response = await handleWorkspaceChangeReview(
            req,
            baseHeaders,
            workspaceChangeReviewMatch[1]!,
            workspaceChangeReviewMatch[2]!,
            Number.parseInt(workspaceChangeReviewMatch[3] ?? "", 10),
          );
        } else if (workspaceChangeDiscussionsMatch && method === "GET") {
          response = await handleListDiscussions(
            req,
            baseHeaders,
            workspaceChangeDiscussionsMatch[1]!,
            workspaceChangeDiscussionsMatch[2]!,
            Number.parseInt(workspaceChangeDiscussionsMatch[3] ?? "", 10),
          );
        } else if (workspaceChangeDiscussionsMatch && method === "POST") {
          response = await handleCreateDiscussionThread(
            req,
            baseHeaders,
            workspaceChangeDiscussionsMatch[1]!,
            workspaceChangeDiscussionsMatch[2]!,
            Number.parseInt(workspaceChangeDiscussionsMatch[3] ?? "", 10),
          );
        } else if (workspaceChangeReactionMatch && method === "PUT") {
          response = await handleSetCommentReaction(
            req,
            baseHeaders,
            workspaceChangeReactionMatch[1]!,
            workspaceChangeReactionMatch[2]!,
            Number.parseInt(workspaceChangeReactionMatch[3] ?? "", 10),
            decodePathParam(workspaceChangeReactionMatch[4] ?? ""),
            Number.parseInt(workspaceChangeReactionMatch[5] ?? "", 10),
          );
        } else if (workspaceChangeReplyMatch && method === "POST") {
          response = await handleReplyToDiscussion(
            req,
            baseHeaders,
            workspaceChangeReplyMatch[1]!,
            workspaceChangeReplyMatch[2]!,
            Number.parseInt(workspaceChangeReplyMatch[3] ?? "", 10),
            decodePathParam(workspaceChangeReplyMatch[4] ?? ""),
          );
        } else if (workspaceChangeResolveMatch && method === "POST") {
          response = await handleResolveDiscussion(
            req,
            baseHeaders,
            workspaceChangeResolveMatch[1]!,
            workspaceChangeResolveMatch[2]!,
            Number.parseInt(workspaceChangeResolveMatch[3] ?? "", 10),
            decodePathParam(workspaceChangeResolveMatch[4] ?? ""),
          );
        } else if (workspaceChangeUpdatesMatch && method === "GET") {
          response = await handleChangeUpdates(
            req,
            baseHeaders,
            workspaceChangeUpdatesMatch[1]!,
            workspaceChangeUpdatesMatch[2]!,
            Number.parseInt(workspaceChangeUpdatesMatch[3] ?? "", 10),
          );
        } else if (workspaceChangeAssignmentsMatch && method === "PUT") {
          response = await handleUpdateChangeAssignments(
            req,
            baseHeaders,
            workspaceChangeAssignmentsMatch[1]!,
            workspaceChangeAssignmentsMatch[2]!,
            Number.parseInt(workspaceChangeAssignmentsMatch[3] ?? "", 10),
          );
        } else if (workspaceCollaboratorsMatch && method === "GET") {
          response = await handleDocumentCollaborators(
            req,
            baseHeaders,
            workspaceCollaboratorsMatch[1]!,
            workspaceCollaboratorsMatch[2]!,
          );
        } else if (workspaceRulesMatch && method === "PATCH") {
          response = await handleBinderRules(
            req,
            baseHeaders,
            workspaceRulesMatch[1]!,
            workspaceRulesMatch[2]!,
          );
        } else if (workspaceSignOffMatch && method === "POST") {
          response = await handleBinderSignOffRules(
            req,
            baseHeaders,
            workspaceSignOffMatch[1]!,
            workspaceSignOffMatch[2]!,
          );
        } else if (workspaceSettingsMatch && method === "GET") {
          response = await handleWorkspaceSettings(
            req,
            baseHeaders,
            workspaceSettingsMatch[1]!,
            workspaceSettingsMatch[2]!,
          );
        } else if (workspaceHistoryMatch && method === "GET") {
          response = await handleWorkspaceHistory(
            req,
            baseHeaders,
            workspaceHistoryMatch[1]!,
            workspaceHistoryMatch[2]!,
          );
        } else if (workspaceChangesMatch && method === "GET") {
          response = await handleListWorkspaceChanges(
            req,
            baseHeaders,
            workspaceChangesMatch[1]!,
            workspaceChangesMatch[2]!,
          );
        } else if (workspaceChangeUpdateMatch && method === "POST") {
          response = await handleWorkspaceChangeUpdate(
            req,
            baseHeaders,
            workspaceChangeUpdateMatch[1]!,
            workspaceChangeUpdateMatch[2]!,
            Number.parseInt(workspaceChangeUpdateMatch[3] ?? "", 10),
          );
        } else if (workspaceChangeMatch && method === "GET") {
          response = await handleWorkspaceChangeDetail(
            req,
            baseHeaders,
            workspaceChangeMatch[1]!,
            workspaceChangeMatch[2]!,
            Number.parseInt(workspaceChangeMatch[3] ?? "", 10),
          );
        } else if (workspaceDocumentRawMatch && method === "GET") {
          response = await handleWorkspaceDocumentRaw(
            req,
            baseHeaders,
            workspaceDocumentRawMatch[1]!,
            workspaceDocumentRawMatch[2]!,
            decodeURIComponent(workspaceDocumentRawMatch[3]!),
          );
        } else if (workspaceDocumentMatch && method === "GET") {
          response = await handleWorkspaceDocumentDetail(
            req,
            baseHeaders,
            workspaceDocumentMatch[1]!,
            workspaceDocumentMatch[2]!,
            decodeURIComponent(workspaceDocumentMatch[3]!),
          );
        } else if (workspaceOverviewMatch && method === "GET") {
          response = await handleWorkspaceOverview(
            req,
            baseHeaders,
            workspaceOverviewMatch[1]!,
            workspaceOverviewMatch[2]!,
          );
        } else if (workspaceFoldersMatch && method === "POST") {
          return await handleBinderShapeChange(
            req,
            baseHeaders,
            workspaceFoldersMatch[1]!,
            workspaceFoldersMatch[2]!,
            ({ body, tree }) =>
              planNewFolder({
                folder: typeof body.folder === "string" ? body.folder : "",
                existingFolders: tree.folders,
              }),
          );
        } else if (workspaceFolderRenamesMatch && method === "POST") {
          return await handleBinderShapeChange(
            req,
            baseHeaders,
            workspaceFolderRenamesMatch[1]!,
            workspaceFolderRenamesMatch[2]!,
            ({ body, tree }) =>
              planFolderRename({
                from: typeof body.from === "string" ? body.from : "",
                to: typeof body.to === "string" ? body.to : "",
                paths: tree.paths,
                existingFolders: tree.folders,
              }),
          );
        } else if (workspaceDocumentRevisionsMatch && method === "POST") {
          return await handleReviseWorkspaceDocument(
            req,
            baseHeaders,
            workspaceDocumentRevisionsMatch[1]!,
            workspaceDocumentRevisionsMatch[2]!,
          );
        } else if (workspaceDocumentsMatch && method === "POST") {
          response = await handleCreateWorkspaceDocument(
            req,
            baseHeaders,
            workspaceDocumentsMatch[1]!,
            workspaceDocumentsMatch[2]!,
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
