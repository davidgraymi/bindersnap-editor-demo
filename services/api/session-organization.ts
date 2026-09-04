import type { GiteaClient } from "./gitea-client/client";
import { logger } from "./logger";
import type { SessionRecord } from "./sessions";

/**
 * Which organization a session belongs to.
 *
 * Membership is Gitea's (ADR 0004, question 1: "does Gitea model it
 * natively?"), so this asks Gitea every time rather than keeping a
 * username → org table that could disagree with the thing that actually
 * enforces access. That costs one request on a gated mutation, which is the
 * right trade for never being wrong about who a person's organization is.
 *
 * One organization per customer is the model. Multi-org membership is out of
 * scope and deliberately not precluded: the shape returned here is a list, and
 * the callers that need a single answer say so by calling
 * `resolveSessionOrganization`.
 */

export interface SessionOrganization {
  id: number;
  /** The Gitea org username: the URL segment, and never shown as a title. */
  name: string;
  /**
   * What the owner called it, from Gitea's `full_name`.
   *
   * Naming is the one thing an organization needs from the person who creates
   * it, so the typed name has to survive the slugification that produces
   * `name`. Falls back to the slug for an organization created before anyone
   * was asked, or by hand in Gitea.
   */
  displayName: string;
}

interface GiteaOrgRow {
  id?: number;
  username?: string;
  name?: string;
  full_name?: string;
}

function normalizeOrgRows(rows: GiteaOrgRow[]): SessionOrganization[] {
  return rows
    .map((org) => {
      const name = org.username ?? org.name ?? "";
      return {
        id: org.id ?? 0,
        name,
        displayName: org.full_name?.trim() || name,
      };
    })
    .filter((org) => org.id > 0);
}

/** The oldest organization in the list — deterministic rather than arbitrary. */
function oldest(
  organizations: SessionOrganization[],
): SessionOrganization | null {
  if (organizations.length === 0) return null;
  return organizations.reduce((found, org) =>
    org.id < found.id ? org : found,
  );
}

export async function listSessionOrganizations(
  client: GiteaClient,
): Promise<SessionOrganization[]> {
  const { data, error, response } = await client.GET("/user/orgs", {
    params: { query: { limit: 50 } },
  });

  if (error !== undefined || !response.ok || !data) {
    logger.warn("Unable to list the session's organizations", {
      status: response.status,
    });
    return [];
  }

  return normalizeOrgRows(data as GiteaOrgRow[]);
}

/**
 * The organization of someone other than the caller — the admin console's
 * question, since an override applies to an organization and an admin types a
 * person's name. Private orgs are only visible here to a site admin, which the
 * admin routes already require.
 */
export async function resolveOrganizationForUser(
  client: GiteaClient,
  username: string,
): Promise<SessionOrganization | null> {
  const { data, error, response } = await client.GET("/users/{username}/orgs", {
    params: { path: { username }, query: { limit: 50 } },
  });

  if (error !== undefined || !response.ok || !data) {
    logger.info("Unable to list a user's organizations", {
      username,
      status: response.status,
    });
    return null;
  }

  return oldest(normalizeOrgRows(data as GiteaOrgRow[]));
}

/**
 * The one organization this session acts for, or null.
 *
 * Null is a real answer, not an error: an account that predates ADR 0004, or
 * one whose signup provisioning failed, has none until the backfill runs.
 * Callers decide what that means — for the paywall it means "no organization
 * to bill", which is not access.
 */
export async function resolveSessionOrganization(
  client: GiteaClient,
  session: SessionRecord,
): Promise<SessionOrganization | null> {
  const organizations = await listSessionOrganizations(client);

  if (organizations.length === 0) {
    logger.info("Session has no organization", {
      username: session.username,
    });
    return null;
  }

  if (organizations.length > 1) {
    // Not an error — Gitea allows it and a person may be in an org we did not
    // create. Deterministic rather than arbitrary: lowest id is the oldest.
    logger.info("Session belongs to several organizations; using the oldest", {
      username: session.username,
      organizations: organizations.map((org) => org.name),
    });
  }

  return oldest(organizations);
}
