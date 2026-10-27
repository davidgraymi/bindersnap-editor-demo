/**
 * The site admin's console (issue #840): every account, organization and
 * binder on this deployment, and whether the parts that keep it running are
 * well — the view Gitea's own site administration gives, in Bindersnap's
 * words.
 *
 * Everything here is a read. Who exists, who belongs where and which binders
 * there are is Gitea's to answer, through the service account's read token
 * (`read:admin` lists every account and organization; a site admin's
 * `read:repository` sees every repository). What Gitea has no primitive for —
 * billing, the trial, whether an address was confirmed, the outbox — comes
 * from the API's own SQLite, exactly as the rest of the API reads it. Nothing
 * is copied from one to the other.
 */

import type { EffectiveSubscriptionAccess, GrantLapse } from "./subscriptions";
import type { OrganizationRecord } from "./organizations";
import { unwrap, type GiteaClient } from "./gitea-client/client";
import type { components } from "./gitea-client/spec/gitea";

type GiteaUser = components["schemas"]["User"];
type GiteaOrganization = components["schemas"]["Organization"];
type GiteaRepository = components["schemas"]["Repository"];

/** Gitea's page ceiling; a larger page is silently this. */
export const ADMIN_PAGE_LIMIT = 50;

export interface AdminPage {
  page: number;
  limit: number;
  /** Gitea's `X-Total-Count`, when it sent one. */
  total: number | null;
  hasMore: boolean;
}

/** `X-Total-Count`, which Gitea sets on every paged list it answers. */
export function totalCount(response: Response): number | null {
  const raw = response.headers.get("x-total-count");
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pageOf(
  page: number,
  limit: number,
  shown: number,
  total: number | null,
): AdminPage {
  return {
    page,
    limit,
    total,
    hasMore: total === null ? shown === limit : page * limit < total,
  };
}

/** A Gitea timestamp as epoch ms; Gitea's zero time reads as never. */
export function giteaTime(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  // Gitea answers `0001-01-01T00:00:00Z` for "never", which parses.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function readPaged<T>(
  request: Promise<{ data?: T[]; error?: unknown; response: Response }>,
): Promise<{ items: T[]; total: number | null }> {
  const result = await request;
  const items = await unwrap(Promise.resolve(result));
  return { items, total: totalCount(result.response) };
}

// ─── People ──────────────────────────────────────────────────────────────

export type EmailConfirmation = "confirmed" | "waiting" | "predates";

export interface AdminUserDeps {
  client: GiteaClient;
  emailStatus(username: string): {
    state: EmailConfirmation;
    confirmedAt: number | null;
    sentAt: number | null;
  };
  liveSessions(username: string): Promise<number>;
  /** Where each of the person's organizations stands with us. */
  access(giteaOrgId: number): Promise<EffectiveSubscriptionAccess>;
}

/** One organization a person is in, and what it pays. */
export interface AdminUserOrganization {
  id: number;
  name: string;
  billing: AdminBillingState;
}

export interface AdminUserRow {
  username: string;
  fullName: string;
  email: string;
  emailConfirmation: EmailConfirmation;
  emailConfirmedAt: number | null;
  isSiteAdmin: boolean;
  /** Gitea's own switches: an inactive or prohibited account cannot sign in. */
  active: boolean;
  prohibitLogin: boolean;
  createdAt: number | null;
  lastLoginAt: number | null;
  liveSessions: number;
  organizations: AdminUserOrganization[];
}

export async function listAdminUsers(
  deps: AdminUserDeps,
  params: { page: number; limit: number; query: string },
): Promise<{ users: AdminUserRow[] } & AdminPage> {
  const { client } = deps;
  const { items, total } = await readPaged<GiteaUser>(
    client.GET("/admin/users", {
      params: {
        query: {
          page: params.page,
          limit: params.limit,
          sort: "created",
          order: "desc",
          ...(params.query ? { q: params.query } : {}),
        },
      },
    }),
  );

  const users = await Promise.all(
    items.map(async (user): Promise<AdminUserRow> => {
      const login = user.login ?? "";
      const [organizations, liveSessions] = await Promise.all([
        client
          .GET("/users/{username}/orgs", {
            params: { path: { username: login }, query: { limit: 50 } },
          })
          .then((result) => unwrap(Promise.resolve(result)))
          .then((orgs) =>
            Promise.all(
              orgs
                .map((org) => ({
                  id: org.id ?? 0,
                  name: org.username ?? org.name ?? "",
                }))
                .filter((org) => org.name !== "")
                .map(async (org): Promise<AdminUserOrganization> => ({
                  ...org,
                  billing: billingState(await deps.access(org.id)),
                })),
            ),
          )
          // One account's memberships failing to load is not the page failing.
          .catch(() => []),
        deps.liveSessions(login).catch(() => 0),
      ]);
      const email = deps.emailStatus(login);
      return {
        username: login,
        fullName: user.full_name ?? "",
        email: user.email ?? "",
        emailConfirmation: email.state,
        emailConfirmedAt: email.confirmedAt,
        isSiteAdmin: user.is_admin === true,
        active: user.active !== false,
        prohibitLogin: user.prohibit_login === true,
        createdAt: giteaTime(user.created),
        lastLoginAt: giteaTime(user.last_login),
        liveSessions,
        organizations,
      };
    }),
  );

  return { users, ...pageOf(params.page, params.limit, users.length, total) };
}

// ─── Organizations ───────────────────────────────────────────────────────

export interface AdminOrganizationDeps {
  client: GiteaClient;
  record(giteaOrgId: number): Promise<OrganizationRecord | null>;
  /** `writers` is the count already made for the row, for a writer limit. */
  access(
    giteaOrgId: number,
    writers?: () => Promise<number>,
  ): Promise<EffectiveSubscriptionAccess>;
  owners(org: string): Promise<string[]>;
  seats(org: string): Promise<number>;
}

export type AdminBillingState =
  | "paying"
  | "past_due"
  | "trial"
  | "trial_ended"
  | "comped"
  | "revoked"
  | "canceled"
  | "none";

/**
 * One word for where an organization stands with us, from the same
 * precedence `resolveAccess` uses — so the console never disagrees with the
 * paywall about who can write.
 */
export function billingState(
  access: EffectiveSubscriptionAccess,
): AdminBillingState {
  if (access.source === "admin_revoke") return "revoked";
  if (access.source === "admin_grant") return "comped";
  if (access.source === "stripe") {
    const status = access.subscription?.status;
    return status === "active" || status === "trialing" ? "paying" : "past_due";
  }
  if (access.source === "trial") return "trial";
  // A subscription that grants nothing has lapsed: unpaid, or a period that
  // ended past the grace with no webhook to say it renewed.
  const status = access.subscription?.status;
  if (status === "canceled" || status === "incomplete_expired") {
    return "canceled";
  }
  if (access.subscription) return "past_due";
  if (access.trialEndsAt !== null) return "trial_ended";
  return "none";
}

export interface AdminOrganizationRow {
  id: number;
  name: string;
  fullName: string;
  email: string;
  /** Not every Gitea org came through Bindersnap's signup. */
  known: boolean;
  createdBy: string | null;
  /** Unix seconds, as the organization's record keeps it. */
  createdAt: number | null;
  owners: string[];
  seats: number | null;
  binders: number | null;
  hasAccess: boolean;
  billing: AdminBillingState;
  stripeStatus: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: number | null;
  /** Free access a site admin gave, and whether it still counts. */
  freeAccess: AdminFreeAccess | null;
}

export interface AdminFreeAccess {
  /** Unix seconds, or null for no end. */
  expiresAt: number | null;
  /** Null for any number of writers. */
  maxWriters: number | null;
  reason: string | null;
  grantedBy: string;
  grantedAt: number;
  /** Why it no longer counts, or null while it does. */
  lapse: GrantLapse | null;
}

/** The free access on record, from what `resolveAccess` answered. */
export function freeAccessOf(
  access: EffectiveSubscriptionAccess,
): AdminFreeAccess | null {
  const override = access.override;
  if (override?.access !== "grant") return null;
  return {
    expiresAt: override.expiresAt ?? null,
    maxWriters: override.maxWriters ?? null,
    reason: override.reason,
    grantedBy: override.updatedBy,
    grantedAt: override.updatedAt,
    lapse: access.grantLapse ?? null,
  };
}

export async function listAdminOrganizations(
  deps: AdminOrganizationDeps,
  params: { page: number; limit: number },
): Promise<{ organizations: AdminOrganizationRow[] } & AdminPage> {
  const { client } = deps;
  const { items, total } = await readPaged<GiteaOrganization>(
    client.GET("/admin/orgs", {
      params: { query: { page: params.page, limit: params.limit } },
    }),
  );

  const organizations = await Promise.all(
    items.map(async (org): Promise<AdminOrganizationRow> => {
      const id = org.id ?? 0;
      const name = org.username ?? org.name ?? "";
      const seatCount = deps.seats(name).catch(() => null);
      const [record, access, owners, seats, binders] = await Promise.all([
        deps.record(id),
        // A writer limit is checked against the count this row shows. Not
        // counted (Gitea did not answer), the grant is taken at its word.
        deps.access(id, async () => (await seatCount) ?? 0),
        deps.owners(name).catch(() => []),
        seatCount,
        client
          .GET("/orgs/{org}/repos", {
            params: { path: { org: name }, query: { page: 1, limit: 1 } },
          })
          .then((result) =>
            result.error === undefined ? totalCount(result.response) : null,
          )
          .catch(() => null),
      ]);
      return {
        id,
        name,
        fullName: org.full_name ?? "",
        email: org.email ?? "",
        known: record !== null,
        createdBy: record?.createdBy ?? null,
        createdAt: record?.createdAt ?? null,
        owners,
        seats,
        binders,
        hasAccess: access.hasAccess,
        billing: billingState(access),
        stripeStatus: access.subscription?.status ?? null,
        stripeCustomerId: access.subscription?.stripeCustomerId ?? null,
        currentPeriodEnd: access.subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: access.subscription?.cancelAtPeriodEnd ?? false,
        trialEndsAt: access.trialEndsAt,
        freeAccess: freeAccessOf(access),
      };
    }),
  );

  return {
    organizations,
    ...pageOf(params.page, params.limit, organizations.length, total),
  };
}

// ─── Binders ─────────────────────────────────────────────────────────────

export interface AdminBinderRow {
  id: number;
  org: string;
  name: string;
  description: string;
  private: boolean;
  archived: boolean;
  empty: boolean;
  /** Kilobytes, as Gitea counts a repository. */
  sizeKb: number;
  openChanges: number;
  createdAt: number | null;
  updatedAt: number | null;
}

export async function listAdminBinders(
  client: GiteaClient,
  params: { page: number; limit: number; query: string },
): Promise<{ binders: AdminBinderRow[] } & AdminPage> {
  const result = await client.GET("/repos/search", {
    params: {
      query: {
        page: params.page,
        limit: params.limit,
        sort: "updated",
        order: "desc",
        ...(params.query ? { q: params.query } : {}),
      },
    },
  });
  const payload = await unwrap(Promise.resolve(result));
  const total = totalCount(result.response);

  const binders = (payload.data ?? []).map(
    (repo: GiteaRepository): AdminBinderRow => ({
      id: repo.id ?? 0,
      org: repo.owner?.login ?? "",
      name: repo.name ?? "",
      description: repo.description ?? "",
      private: repo.private === true,
      archived: repo.archived === true,
      empty: repo.empty === true,
      sizeKb: repo.size ?? 0,
      openChanges: repo.open_pr_counter ?? 0,
      createdAt: giteaTime(repo.created_at),
      updatedAt: giteaTime(repo.updated_at),
    }),
  );

  return {
    binders,
    ...pageOf(params.page, params.limit, binders.length, total),
  };
}

// ─── Overview ────────────────────────────────────────────────────────────

export type HealthStatus = "ok" | "warn" | "down";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

/** The Gitea call and how long it took, or why it failed. */
export async function checkGitea(client: GiteaClient): Promise<HealthCheck> {
  const started = performance.now();
  try {
    const version = await unwrap(client.GET("/version", {}));
    const ms = Math.round(performance.now() - started);
    return {
      id: "gitea",
      label: "Gitea",
      status: ms > 2000 ? "warn" : "ok",
      detail: `Version ${version.version ?? "unknown"}, answered in ${ms} ms.`,
    };
  } catch (err) {
    return {
      id: "gitea",
      label: "Gitea",
      status: "down",
      detail: err instanceof Error ? err.message : "Did not answer.",
    };
  }
}

/** Fifteen minutes without a send is a stuck outbox, not a slow one. */
export const MAIL_STALL_MS = 15 * 60_000;

export function checkMail(params: {
  transport: string;
  counts: { pending: number; failed: number; sent: number };
  oldestPendingAt: number | null;
  now: number;
}): HealthCheck {
  const { transport, counts, oldestPendingAt, now } = params;
  const base = { id: "mail", label: "Email" };
  const tally = `${counts.sent} sent, ${counts.pending} waiting, ${counts.failed} failed in the last 30 days.`;
  if (transport === "off" || transport === "") {
    return {
      ...base,
      status: "warn",
      detail: `No mail transport is configured. ${tally}`,
    };
  }
  if (oldestPendingAt !== null && now - oldestPendingAt > MAIL_STALL_MS) {
    const minutes = Math.round((now - oldestPendingAt) / 60_000);
    return {
      ...base,
      status: "down",
      detail: `The oldest email has waited ${minutes} minutes. ${tally}`,
    };
  }
  return {
    ...base,
    status: counts.failed > 0 ? "warn" : "ok",
    detail: `Sending through ${transport}. ${tally}`,
  };
}

export function checkJobs(counts: {
  pending: number;
  running: number;
  failed: number;
  done: number;
}): HealthCheck {
  return {
    id: "jobs",
    label: "Publishing",
    status: counts.failed > 0 ? "warn" : "ok",
    detail: `${counts.running} running, ${counts.pending} waiting, ${counts.failed} failed, ${counts.done} finished.`,
  };
}

export function checkStripe(params: {
  secretKey: boolean;
  webhookSecret: boolean;
  priceId: boolean;
}): HealthCheck {
  const missing = [
    params.secretKey ? null : "secret key",
    params.webhookSecret ? null : "webhook secret",
    params.priceId ? null : "price",
  ].filter((entry): entry is string => entry !== null);
  return {
    id: "stripe",
    label: "Stripe",
    status: missing.length === 0 ? "ok" : "warn",
    detail:
      missing.length === 0
        ? "Configured: checkout, the portal and webhooks can run."
        : `Missing its ${missing.join(", ")}: checkout or webhooks will refuse.`,
  };
}

export function checkReconciler(
  report: {
    binders: number;
    findings: unknown[];
    errors: unknown[];
    finishedAt?: number;
  } | null,
): HealthCheck {
  const base = { id: "reconciler", label: "Reconciler" };
  if (!report) {
    return {
      ...base,
      status: "warn",
      detail: "Has not finished a pass since the API started.",
    };
  }
  const status: HealthStatus =
    report.findings.length > 0 || report.errors.length > 0 ? "warn" : "ok";
  return {
    ...base,
    status,
    detail: `Last pass read ${report.binders} binders: ${report.findings.length} findings, ${report.errors.length} errors.`,
  };
}

export function checkGate(gate: {
  limit: number;
  inFlight: number;
  queued: number;
}): HealthCheck {
  return {
    id: "gate",
    label: "Gitea request queue",
    status: gate.queued > 0 ? "warn" : "ok",
    detail: `${gate.inFlight} of ${gate.limit} slots in use, ${gate.queued} waiting.`,
  };
}

export interface BillingTally {
  paying: number;
  pastDue: number;
  trial: number;
  trialEnded: number;
  comped: number;
  revoked: number;
  canceled: number;
  none: number;
}

/** How many organizations stand where, for the overview's billing line. */
export function tallyBilling(
  accesses: EffectiveSubscriptionAccess[],
): BillingTally {
  const tally: BillingTally = {
    paying: 0,
    pastDue: 0,
    trial: 0,
    trialEnded: 0,
    comped: 0,
    revoked: 0,
    canceled: 0,
    none: 0,
  };
  for (const access of accesses) {
    const state = billingState(access);
    if (state === "past_due") tally.pastDue += 1;
    else if (state === "trial_ended") tally.trialEnded += 1;
    else tally[state] += 1;
  }
  return tally;
}

/** A Gitea list's size, read from one row and its `X-Total-Count`. */
export async function countGitea(
  read: () => Promise<{ error?: unknown; response: Response }>,
): Promise<number | null> {
  try {
    const result = await read();
    return result.error === undefined ? totalCount(result.response) : null;
  } catch {
    return null;
  }
}
