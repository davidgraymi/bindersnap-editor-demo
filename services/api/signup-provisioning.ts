import {
  MAX_ORGANIZATION_NAME_LENGTH as MAX_NAME_LENGTH,
  slugifyOrganizationName,
} from "../../packages/utils/organizationName";

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
 * What signup does beyond creating an account, per ADR 0004: the organization.
 *
 * "Signup creates the org — there is no personal mode that has to be upgraded
 * later, because that upgrade is the migration being paid for now."
 *
 * It no longer creates a binder along with it. ADR 0004's migration step 1 said
 * to, but a binder is the container a customer's records live in, and its name
 * is the owner's to choose — "policies" was a guess nobody made and nobody
 * could act on, since documents are still their own repositories and nothing
 * was ever written into it. Members create workspaces themselves.
 */

/**
 * How many `-2`, `-3` … suffixes to try before giving up. Collisions are rare
 * and each attempt is a round trip, so the bound is small on purpose.
 */
const MAX_NAME_ATTEMPTS = 20;

export { slugifyOrganizationName };

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

  const provisioned = await provisionOrganizationUnderAvailableName({
    client,
    base: deriveOrganizationName(username, params.organizationName),
    orgFullName: params.organizationName?.trim() || undefined,
    owner: username,
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

interface ProvisionUnderAvailableNameParams {
  client: GiteaClient;
  base: string;
  orgFullName?: string;
  owner: string;
}

/**
 * Step through `name`, `name-2`, `name-3` … until one is actually free.
 *
 * Asking whether a name is taken is not enough, because the honest answer is
 * not always available: organizations are private, and Gitea answers
 * `GET /orgs/{org}` for a private organization the caller cannot see with a
 * **404**, identical to the answer for a name nobody holds. Two customers of
 * the same name is the ordinary case — every second one would be told the name
 * was free and then refused at creation.
 *
 * So the creation itself is the availability check. Gitea rejects a taken name
 * with 422 (`ErrUserAlreadyExist`, or a reserved or malformed name), and 422 is
 * the only status that means "try the next one" — anything else is a real
 * failure and is raised rather than walked past twenty times.
 *
 * A 422 leaves nothing behind: the organization is the only thing
 * `provisionOrganization` creates, so a failure there leaves no partial state.
 */
async function provisionOrganizationUnderAvailableName(
  params: ProvisionUnderAvailableNameParams,
): Promise<ProvisionedOrganization> {
  const { client, base, ...rest } = params;
  let lastConflict: GiteaApiError | null = null;

  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const orgName = nameAttempt(base, attempt);

    // A name we can see is taken is not worth a create call. This also keeps
    // provisioning out of an organization that exists and is visible but is
    // somebody else's.
    if (await findOrganization({ client, org: orgName })) {
      continue;
    }

    try {
      return await provisionOrganization({ client, orgName, ...rest });
    } catch (err) {
      if (err instanceof GiteaApiError && err.status === 422) {
        lastConflict = err;
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Unable to find an available organization name based on "${base}"` +
      (lastConflict ? `: ${lastConflict.message}` : "."),
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
    logger.info("Provisioned organization at signup", {
      username: params.username,
      organization: result.organization.name,
      giteaOrgId: result.organization.giteaOrgId,
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
