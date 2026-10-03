/**
 * Every question the app asks the API, as a key and the read that answers it.
 *
 * **Keys are hierarchical on purpose.** Everything about one organization sits
 * under `["organizations", org]`, so a write that changes an organization can
 * invalidate the lot with one prefix instead of naming each screen's query.
 */

import { queryOptions } from "@tanstack/react-query";

import {
  fetchLibrary,
  fetchNotificationCount,
  fetchNotifications,
  fetchOnboarding,
  fetchOrganizationBinders,
  fetchOrganizationPeople,
  fetchOrganizations,
  getHomeChanges,
  searchDocuments,
} from "../api";

export const queryKeys = {
  organizations: () => ["organizations"] as const,
  organization: (org: string) => ["organizations", org] as const,
  organizationPeople: (org: string) =>
    ["organizations", org, "people"] as const,
  organizationBinders: (org: string) =>
    ["organizations", org, "binders"] as const,

  /** The changes this person is part of, everywhere — home and the queue. */
  homeChanges: () => ["home-changes"] as const,
  library: (query: string) => ["library", query] as const,
  search: (query: string, limit: number) =>
    ["library", "search", query, limit] as const,

  onboarding: () => ["onboarding"] as const,

  notifications: () => ["notifications"] as const,
  notificationList: (all: boolean) => ["notifications", "list", all] as const,
  notificationCount: () => ["notifications", "count"] as const,
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

/** The binders in an organization this person can see. */
export function organizationBindersQuery(org: string) {
  return queryOptions({
    queryKey: queryKeys.organizationBinders(org),
    queryFn: ({ signal }) => fetchOrganizationBinders(org, { signal }),
  });
}

/** Every open change this person is part of, and what was decided lately. */
export function homeChangesQuery() {
  return queryOptions({
    queryKey: queryKeys.homeChanges(),
    queryFn: ({ signal }) => getHomeChanges({ signal }),
  });
}

/** Every document this person can read, narrowed by what they typed. */
export function libraryQuery(query: string) {
  return queryOptions({
    queryKey: queryKeys.library(query),
    queryFn: ({ signal }) => fetchLibrary(query || undefined, { signal }),
  });
}

/** Quick find: the best few matches. */
export function searchQuery(query: string, limit = 8) {
  return queryOptions({
    queryKey: queryKeys.search(query, limit),
    queryFn: ({ signal }) => searchDocuments(query, limit, { signal }),
  });
}

/** The getting-started guide's progress. */
export function onboardingQuery() {
  return queryOptions({
    queryKey: queryKeys.onboarding(),
    queryFn: ({ signal }) => fetchOnboarding({ signal }),
  });
}

/** The bell's list: unread only, or everything. */
export function notificationListQuery(all: boolean) {
  return queryOptions({
    queryKey: queryKeys.notificationList(all),
    queryFn: ({ signal }) => fetchNotifications(all, { signal }),
  });
}

/** The number on the bell. */
export function notificationCountQuery() {
  return queryOptions({
    queryKey: queryKeys.notificationCount(),
    queryFn: ({ signal }) => fetchNotificationCount({ signal }),
  });
}
