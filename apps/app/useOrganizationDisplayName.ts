/**
 * The organizations this reader belongs to, and the two questions asked of them.
 *
 * The address bar carries the Gitea org username — `riverside-health` — and
 * that is the only name most screens have to hand. It is not the name the
 * customer chose: "Riverside Health" is, and the organization switcher in the
 * top bar has been showing it all along, directly above headings that showed
 * the slug.
 *
 * Hooks rather than props drilled from the shell because several screens want
 * the same answer and none of them own the list. Failure is silent on purpose:
 * every caller falls back to what it displayed before — the slug, or nothing —
 * so a switcher-sized problem never becomes an error on a page about something
 * else.
 *
 * **One request, however many callers.** The list is small, changes rarely, and
 * is wanted by the sidebar, the organization page and the binder header at the
 * same moment. Without the cache below, opening a binder fired the same request
 * three times. Cached as the promise rather than the result so that concurrent
 * callers during the first flight share it too, and dropped on failure so a
 * transient error is not remembered forever.
 */

import { useEffect, useState } from "react";

import { fetchOrganizations } from "./api";
import type { OrganizationSummary } from "../../packages/api-schema/schemas/organizations";

let inFlight: Promise<OrganizationSummary[]> | null = null;

function loadOrganizations(): Promise<OrganizationSummary[]> {
  if (!inFlight) {
    inFlight = fetchOrganizations().catch((err: unknown) => {
      // Not remembered: the next caller should get a fresh attempt rather than
      // this failure replayed for the life of the tab.
      inFlight = null;
      throw err;
    });
  }
  return inFlight;
}

/** Only for tests: forget what was fetched. */
export function resetOrganizationsCache(): void {
  inFlight = null;
}

function useOrganizations(): OrganizationSummary[] | null {
  const [organizations, setOrganizations] = useState<
    OrganizationSummary[] | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    loadOrganizations()
      .then((rows) => {
        if (!cancelled) setOrganizations(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return organizations;
}

/** What an organization calls itself, given what the URL calls it. */
export function useOrganizationDisplayName(org: string): string {
  const organizations = useOrganizations();
  const match = organizations?.find((row) => row.name === org);
  return match?.displayName || org;
}

/**
 * Which organization a page that names none should act on.
 *
 * **The oldest, by Gitea id** — the same rule the server applies in
 * `services/api/session-organization.ts`, which logs "belongs to several
 * organizations; using the oldest" and returns the lowest id. Taking whichever
 * Gitea happened to list first meant the client could disagree with the server
 * about the same question, which showed up as a sidebar and a search pointed at
 * a different organization from the one the API was answering for.
 *
 * Deterministic rather than correct: for somebody in two organizations the
 * oldest is a guess, just a repeatable one. Remembering the organization the
 * reader last visited would be the better answer and is a bigger change than
 * this one.
 */
export function defaultOrganization(
  organizations: readonly OrganizationSummary[],
): OrganizationSummary | null {
  let oldest: OrganizationSummary | null = null;
  for (const organization of organizations) {
    if (!oldest || organization.id < oldest.id) oldest = organization;
  }
  return oldest;
}

/**
 * The organization a page that names none should act on.
 *
 * Home, the review queue and Activity belong to the reader rather than to one
 * organization, but the sidebar's People, Binders and Organization entries have
 * to point somewhere. Null until the list answers, and null for somebody in no
 * organization at all — the caller renders those entries inert rather than
 * guessing at a destination.
 */
export function useDefaultOrganization(): string | null {
  const organizations = useOrganizations();
  return organizations
    ? (defaultOrganization(organizations)?.name ?? null)
    : null;
}
