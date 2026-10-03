/**
 * Every question the app asks the API, as a key and the read that answers it.
 *
 * **Keys are hierarchical on purpose.** Everything about one organization sits
 * under `["organizations", org]`, so a write that changes an organization can
 * invalidate the lot with one prefix instead of naming each screen's query.
 */

import { queryOptions } from "@tanstack/react-query";

import { fetchOrganizationPeople, fetchOrganizations } from "../api";

export const queryKeys = {
  organizations: () => ["organizations"] as const,
  organization: (org: string) => ["organizations", org] as const,
  organizationPeople: (org: string) =>
    ["organizations", org, "people"] as const,
};

/** The organizations this session belongs to. */
export function organizationsQuery() {
  return queryOptions({
    queryKey: queryKeys.organizations(),
    queryFn: ({ signal }) => fetchOrganizations({ signal }),
  });
}

/** Who is in an organization, and its groups. */
export function organizationPeopleQuery(org: string) {
  return queryOptions({
    queryKey: queryKeys.organizationPeople(org),
    queryFn: ({ signal }) => fetchOrganizationPeople(org, { signal }),
  });
}
