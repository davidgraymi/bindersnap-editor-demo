/**
 * Every question the app asks the API, as a key and the read that answers it.
 *
 * **Keys are hierarchical on purpose.** Everything about one organization sits
 * under `["organizations", org]`, so a write that changes an organization can
 * invalidate the lot with one prefix instead of naming each screen's query.
 */

import { queryOptions } from "@tanstack/react-query";

import {
  fetchBinder,
  fetchBinderArchive,
  fetchBinderChange,
  fetchBinderChanges,
  fetchBinderDocument,
  fetchBinderDocuments,
  fetchBinderDraft,
  fetchBinderHistory,
  fetchBinderPeople,
  fetchBinderSettings,
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

/** Where in a binder a read is made: a draft, a change's branch, or a ref. */
export interface BinderRef {
  draft?: string | null;
  change?: number | null;
  ref?: string | null;
}

/** The same place, always spelled the same, so two readers share a key. */
function refKey(at: BinderRef) {
  return {
    draft: at.draft ?? null,
    change: at.change ?? null,
    ref: at.ref ?? null,
  };
}

export const queryKeys = {
  organizations: () => ["organizations"] as const,
  organization: (org: string) => ["organizations", org] as const,
  organizationPeople: (org: string) =>
    ["organizations", org, "people"] as const,
  organizationBinders: (org: string) =>
    ["organizations", org, "binders"] as const,

  /**
   * Everything about one binder. A write to a binder invalidates this prefix,
   * which is every screen's read of it — overview, tree, changes, history.
   */
  binder: (org: string, binder: string) => ["binders", org, binder] as const,
  binderOverview: (org: string, binder: string) =>
    ["binders", org, binder, "overview"] as const,
  binderChanges: (org: string, binder: string, state: "open" | "closed") =>
    ["binders", org, binder, "changes", state] as const,
  binderChange: (org: string, binder: string, number: number) =>
    ["binders", org, binder, "change", number] as const,
  binderDocuments: (org: string, binder: string, at: BinderRef = {}) =>
    ["binders", org, binder, "documents", refKey(at)] as const,
  binderDocument: (
    org: string,
    binder: string,
    documentPath: string,
    at: BinderRef = {},
  ) => ["binders", org, binder, "document", documentPath, refKey(at)] as const,
  binderArchive: (org: string, binder: string, draft?: string) =>
    ["binders", org, binder, "archive", draft ?? null] as const,
  binderHistory: (org: string, binder: string) =>
    ["binders", org, binder, "history"] as const,
  binderDraft: (org: string, binder: string, branch?: string) =>
    ["binders", org, binder, "draft", branch ?? null] as const,
  binderSettings: (org: string, binder: string) =>
    ["binders", org, binder, "settings"] as const,
  binderPeople: (org: string, binder: string) =>
    ["binders", org, binder, "people"] as const,

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

/** A binder's header: its name, counts, and the latest change. */
export function binderQuery(org: string, binder: string) {
  return queryOptions({
    queryKey: queryKeys.binderOverview(org, binder),
    queryFn: ({ signal }) => fetchBinder(org, binder, { signal }),
  });
}

/** A binder's change requests, open or closed. */
export function binderChangesQuery(
  org: string,
  binder: string,
  state: "open" | "closed" = "open",
) {
  return queryOptions({
    queryKey: queryKeys.binderChanges(org, binder, state),
    queryFn: ({ signal }) => fetchBinderChanges(org, binder, state, { signal }),
  });
}

/** One change request. */
export function binderChangeQuery(org: string, binder: string, number: number) {
  return queryOptions({
    queryKey: queryKeys.binderChange(org, binder, number),
    queryFn: ({ signal }) => fetchBinderChange(org, binder, number, { signal }),
  });
}

/** A binder's documents and folders, on main or wherever `at` says. */
export function binderDocumentsQuery(
  org: string,
  binder: string,
  at: BinderRef = {},
) {
  return queryOptions({
    queryKey: queryKeys.binderDocuments(org, binder, at),
    queryFn: ({ signal }) =>
      fetchBinderDocuments(
        org,
        binder,
        at.draft ?? undefined,
        at.change ?? undefined,
        at.ref ?? undefined,
        { signal },
      ),
  });
}

/** One document, on main or wherever `at` says. */
export function binderDocumentQuery(
  org: string,
  binder: string,
  documentPath: string,
  at: BinderRef = {},
) {
  return queryOptions({
    queryKey: queryKeys.binderDocument(org, binder, documentPath, at),
    queryFn: ({ signal }) =>
      fetchBinderDocument(
        org,
        binder,
        documentPath,
        at.draft ?? undefined,
        at.change ?? undefined,
        at.ref ?? undefined,
        { signal },
      ),
  });
}

/** What a binder has taken off the record. */
export function binderArchiveQuery(
  org: string,
  binder: string,
  draft?: string,
) {
  return queryOptions({
    queryKey: queryKeys.binderArchive(org, binder, draft),
    queryFn: ({ signal }) => fetchBinderArchive(org, binder, draft, { signal }),
  });
}

/** Every version a binder has published. */
export function binderHistoryQuery(org: string, binder: string) {
  return queryOptions({
    queryKey: queryKeys.binderHistory(org, binder),
    queryFn: ({ signal }) => fetchBinderHistory(org, binder, { signal }),
  });
}

/** Your drafts in a binder, and the one named — the newest when unnamed. */
export function binderDraftQuery(org: string, binder: string, branch?: string) {
  return queryOptions({
    queryKey: queryKeys.binderDraft(org, binder, branch),
    queryFn: ({ signal }) => fetchBinderDraft(org, binder, branch, { signal }),
  });
}

/** A binder's rules and sign-off. */
export function binderSettingsQuery(org: string, binder: string) {
  return queryOptions({
    queryKey: queryKeys.binderSettings(org, binder),
    queryFn: ({ signal }) => fetchBinderSettings(org, binder, { signal }),
  });
}

/** Who is in a binder, and through what. */
export function binderPeopleQuery(org: string, binder: string) {
  return queryOptions({
    queryKey: queryKeys.binderPeople(org, binder),
    queryFn: ({ signal }) => fetchBinderPeople(org, binder, { signal }),
  });
}
