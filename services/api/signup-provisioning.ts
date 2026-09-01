import { GiteaApiError, type GiteaClient } from "./gitea-client/client";
import { findOrganization } from "./gitea-client/orgs";
import {
  provisionOrganization,
  type ProvisionedOrganization,
} from "./gitea-client/workspaces";
import { logger } from "./logger";
import {
  recordProvisionedOrganization,
  type OrganizationBackend,
  type OrganizationRecord,
} from "./organizations";

/**
 * What signup does beyond creating an account, per ADR 0004: the organization,
 * its first binder, that binder's rules and role teams.
 *
 * "Signup creates the org — there is no personal mode that has to be upgraded
 * later, because that upgrade is the migration being paid for now." So there is
 * no path here that leaves a person owning documents.
 */

/** The first binder every organization gets. Renameable; not special. */
export const DEFAULT_WORKSPACE_NAME = "policies";

const DEFAULT_WORKSPACE_DESCRIPTION =
  "Your first binder: one set of rules, one set of people.";

/** Gitea usernames and organization names share one namespace. */
const MAX_NAME_LENGTH = 40;

/**
 * How many `-2`, `-3` … suffixes to try before giving up. Collisions are rare
 * and each attempt is a round trip, so the bound is small on purpose.
 */
const MAX_NAME_ATTEMPTS = 20;

/**
 * Reduce a display name to something Gitea will accept as an org username:
 * alphanumerics, dash, underscore and dot, not starting or ending with a
 * separator.
 */
export function slugifyOrganizationName(input: string): string {
  const slug = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[-._]+$/, "");

  return slug;
}

/**
 * The organization's Gitea name.
 *
 * It cannot be the user's own username: Gitea keeps users and organizations in
 * one namespace, so `alice` the org and `alice` the person cannot both exist.
 * A requested name that slugifies to the username gets the same treatment as no
 * request at all.
 *
 * The name is not an identifier — the org id is, and Gitea renames orgs — so a
 * suffix here costs nothing downstream.
 */
export function deriveOrganizationName(
  username: string,
  requested?: string,
): string {
  const fromRequest = requested ? slugifyOrganizationName(requested) : "";
  const fromUsername = slugifyOrganizationName(username);

  if (fromRequest && fromRequest !== fromUsername) {
    return fromRequest;
  }

  const base = fromUsername || "org";
  return `${base.slice(0, MAX_NAME_LENGTH - "-org".length)}-org`;
}

/** `name`, `name-2`, `name-3` … */
export function nameAttempt(name: string, attempt: number): string {
  if (attempt <= 1) return name;

  const suffix = `-${attempt}`;
  return `${name.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
}

export interface ProvisionSignupParams {
  /** Must be the new user's own token: Gitea makes the creator an Owner. */
  client: GiteaClient;
  username: string;
  /** Optional display name for the organization, from the signup form. */
  organizationName?: string;
  workspaceName?: string;
  store?: OrganizationBackend;
  now?: number;
}

export interface SignupProvisionResult {
  organization: OrganizationRecord;
  provisioned: ProvisionedOrganization;
}

/**
 * Provision, then record the local half.
 *
 * Every Gitea step is idempotent, so a re-run repairs a partial failure rather
 * than duplicating anything, and the trial does not restart on a second run.
 */
export async function provisionSignup(
  params: ProvisionSignupParams,
): Promise<SignupProvisionResult> {
  const { client, username } = params;

  const orgName = await resolveAvailableOrganizationName(
    client,
    deriveOrganizationName(username, params.organizationName),
  );

  const provisioned = await provisionOrganization({
    client,
    orgName,
    orgFullName: params.organizationName?.trim() || undefined,
    workspaceName: params.workspaceName ?? DEFAULT_WORKSPACE_NAME,
    workspaceDescription: DEFAULT_WORKSPACE_DESCRIPTION,
  });

  const organization = await recordProvisionedOrganization({
    giteaOrgId: provisioned.organization.id,
    name: provisioned.organization.name,
    createdBy: username,
    store: params.store,
    now: params.now,
  });

  return { organization, provisioned };
}

async function resolveAvailableOrganizationName(
  client: GiteaClient,
  base: string,
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = nameAttempt(base, attempt);
    if (!(await findOrganization({ client, org: candidate }))) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to find an available organization name based on "${base}".`,
  );
}

/**
 * Provision as part of signup, never failing the signup itself.
 *
 * The account and the session are already real by the time this runs, and a
 * Gitea hiccup here should not strand someone at a login form for an account
 * that exists. The organization is not yet load-bearing — documents still live
 * in the per-user repositories ADR 0004 supersedes — so an org that failed to
 * appear is repaired by re-running provisioning, which is the same job the
 * backfill does for every account that predates this.
 */
export async function provisionSignupBestEffort(
  params: ProvisionSignupParams,
): Promise<SignupProvisionResult | null> {
  try {
    const result = await provisionSignup(params);
    logger.info("Provisioned organization and first workspace at signup", {
      username: params.username,
      organization: result.organization.name,
      giteaOrgId: result.organization.giteaOrgId,
      workspace: result.provisioned.workspace.workspace.name,
    });
    return result;
  } catch (err) {
    logger.error("Failed to provision organization at signup", {
      username: params.username,
      status: err instanceof GiteaApiError ? err.status : undefined,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
