import { useEffect, useMemo, useRef, useState } from "react";

import type { GiteaClient } from "../../../packages/gitea-client/client";
import { GiteaApiError, unwrap } from "../../../packages/gitea-client/client";
import type { components } from "../../../packages/gitea-client/spec/gitea";

type GiteaUser = components["schemas"]["User"];
type RepoCollaboratorPermission =
  components["schemas"]["RepoCollaboratorPermission"];

type WritablePermission = "read" | "write" | "admin";
type DisplayPermission = WritablePermission | "owner" | "unknown";

interface CollaboratorRow {
  login: string;
  fullName: string;
  email: string;
  permission: DisplayPermission;
  roleName: string;
  avatarUrl: string;
  isCurrentUser: boolean;
}

interface SearchResultRow {
  login: string;
  fullName: string;
  email: string;
  avatarUrl: string;
}

interface DocumentCollaboratorsProps {
  giteaClient: GiteaClient;
  owner: string;
  repo: string;
  currentUsername: string;
}

interface CollaboratorPageResult {
  rows: CollaboratorRow[];
  hasMore: boolean;
}

const COLLABORATORS_PAGE_SIZE = 12;
const SEARCH_PAGE_SIZE = 8;
const DEBOUNCE_MS = 250;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getUserLogin(user: GiteaUser): string {
  return (
    readString((user as { login?: unknown }).login) ||
    readString((user as { username?: unknown }).username)
  );
}

function getUserFullName(user: GiteaUser): string {
  return (
    readString((user as { full_name?: unknown }).full_name) ||
    readString((user as { fullName?: unknown }).fullName)
  );
}

function getUserEmail(user: GiteaUser): string {
  return readString((user as { email?: unknown }).email);
}

function getUserAvatarUrl(user: GiteaUser): string {
  return readString((user as { avatar_url?: unknown }).avatar_url);
}

function normalizeDisplayPermission(permission?: string): DisplayPermission {
  switch (permission?.toLowerCase()) {
    case "read":
      return "read";
    case "write":
      return "write";
    case "admin":
      return "admin";
    case "owner":
      return "owner";
    default:
      return "unknown";
  }
}

function normalizeWritablePermission(permission?: string): WritablePermission {
  switch (permission?.toLowerCase()) {
    case "read":
      return "read";
    case "admin":
      return "admin";
    case "write":
    default:
      return "write";
  }
}

function formatPermissionLabel(permission: DisplayPermission): string {
  switch (permission) {
    case "read":
      return "Read";
    case "write":
      return "Write";
    case "admin":
      return "Admin";
    case "owner":
      return "Owner";
    default:
      return "Unknown";
  }
}

function permissionBadgeClass(permission: DisplayPermission): string {
  switch (permission) {
    case "admin":
    case "owner":
      return "collaborator-permission-badge collaborator-permission-power";
    case "write":
      return "collaborator-permission-badge collaborator-permission-write";
    case "read":
      return "collaborator-permission-badge collaborator-permission-read";
    default:
      return "collaborator-permission-badge collaborator-permission-unknown";
  }
}

function isManagedPermission(permission: DisplayPermission): boolean {
  return (
    permission === "read" || permission === "write" || permission === "admin"
  );
}

function readPermissionError(err: unknown, fallback: string): string {
  if (err instanceof GiteaApiError && err.status === 403) {
    return "You do not have permission to manage collaborators for this repository.";
  }

  if (err instanceof GiteaApiError && err.status === 404) {
    return "That collaborator could not be found in Gitea.";
  }

  return err instanceof Error ? err.message : fallback;
}

function normalizeCollaborator(
  user: GiteaUser,
  permission: RepoCollaboratorPermission | null,
  currentUsername: string,
): CollaboratorRow | null {
  const login = getUserLogin(user);
  if (!login) {
    return null;
  }

  return {
    login,
    fullName: getUserFullName(user),
    email: getUserEmail(user),
    permission: normalizeDisplayPermission(permission?.permission),
    roleName: readString(permission?.role_name),
    avatarUrl: getUserAvatarUrl(user),
    isCurrentUser: login === currentUsername,
  };
}

async function fetchCollaboratorPermission(
  giteaClient: GiteaClient,
  owner: string,
  repo: string,
  collaborator: string,
): Promise<RepoCollaboratorPermission | null> {
  try {
    return await unwrap(
      giteaClient.GET(
        "/repos/{owner}/{repo}/collaborators/{collaborator}/permission",
        {
          params: { path: { owner, repo, collaborator } },
        },
      ),
    );
  } catch (err) {
    if (err instanceof GiteaApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

async function fetchCollaboratorPage(
  giteaClient: GiteaClient,
  owner: string,
  repo: string,
  currentUsername: string,
  page: number,
  limit: number,
): Promise<CollaboratorPageResult> {
  const collaborators = await unwrap(
    giteaClient.GET("/repos/{owner}/{repo}/collaborators", {
      params: {
        path: { owner, repo },
        query: { page, limit },
      },
    }),
  );

  const rows = await Promise.all(
    collaborators.map(async (user) => {
      const login = getUserLogin(user);
      if (!login) {
        return null;
      }

      let permission: RepoCollaboratorPermission | null = null;
      try {
        permission = await fetchCollaboratorPermission(
          giteaClient,
          owner,
          repo,
          login,
        );
      } catch {
        permission = null;
      }

      return normalizeCollaborator(user, permission, currentUsername);
    }),
  );

  return {
    rows: rows.filter((row): row is CollaboratorRow => row !== null),
    hasMore: collaborators.length === limit,
  };
}

async function fetchCurrentUserPermission(
  giteaClient: GiteaClient,
  owner: string,
  repo: string,
  currentUsername: string,
): Promise<DisplayPermission | null> {
  if (!currentUsername) {
    return null;
  }

  if (currentUsername === owner) {
    return "owner";
  }

  const permission = await fetchCollaboratorPermission(
    giteaClient,
    owner,
    repo,
    currentUsername,
  );

  return normalizeDisplayPermission(permission?.permission);
}

function normalizeSearchResult(user: GiteaUser): SearchResultRow | null {
  const login = getUserLogin(user);
  if (!login) {
    return null;
  }

  return {
    login,
    fullName: getUserFullName(user),
    email: getUserEmail(user),
    avatarUrl: getUserAvatarUrl(user),
  };
}

function mergeCollaboratorRows(
  existing: CollaboratorRow[],
  incoming: CollaboratorRow[],
): CollaboratorRow[] {
  const rows = [...existing];

  for (const row of incoming) {
    const index = rows.findIndex((candidate) => candidate.login === row.login);
    if (index === -1) {
      rows.push(row);
      continue;
    }

    rows[index] = row;
  }

  return rows;
}

export function DocumentCollaborators({
  giteaClient,
  owner,
  repo,
  currentUsername,
}: DocumentCollaboratorsProps) {
  const [collaborators, setCollaborators] = useState<CollaboratorRow[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreCollaborators, setHasMoreCollaborators] = useState(true);
  const [isLoadingCollaborators, setIsLoadingCollaborators] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [collaboratorError, setCollaboratorError] = useState<string | null>(
    null,
  );
  const [currentPermission, setCurrentPermission] =
    useState<DisplayPermission | null>(null);
  const [permissionLoadError, setPermissionLoadError] = useState<string | null>(
    null,
  );
  const [permissionLoadPending, setPermissionLoadPending] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<
    Record<string, WritablePermission>
  >({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [manageError, setManageError] = useState<string | null>(null);
  const [defaultPermission, setDefaultPermission] =
    useState<WritablePermission>("write");

  const collaboratorRequestId = useRef(0);
  const permissionRequestId = useRef(0);
  const searchRequestId = useRef(0);

  const collaboratorMap = useMemo(() => {
    return new Map(collaborators.map((row) => [row.login, row]));
  }, [collaborators]);

  const canManageCollaborators =
    currentPermission === "owner" || currentPermission === "admin";

  useEffect(() => {
    const requestId = ++collaboratorRequestId.current;
    const permissionRequestIdValue = ++permissionRequestId.current;

    setCollaborators([]);
    setCurrentPage(1);
    setHasMoreCollaborators(true);
    setIsLoadingCollaborators(true);
    setIsLoadingMore(false);
    setCollaboratorError(null);
    setDraftPermissions({});
    setRowBusy({});
    setManageError(null);
    setSearchQuery("");
    setDebouncedSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setCurrentPermission(null);
    setPermissionLoadError(null);
    setPermissionLoadPending(true);

    void (async () => {
      try {
        const firstPage = await fetchCollaboratorPage(
          giteaClient,
          owner,
          repo,
          currentUsername,
          1,
          COLLABORATORS_PAGE_SIZE,
        );

        if (requestId !== collaboratorRequestId.current) {
          return;
        }

        setCollaborators(firstPage.rows);
        setHasMoreCollaborators(firstPage.hasMore);
      } catch (err) {
        if (requestId !== collaboratorRequestId.current) {
          return;
        }

        setCollaboratorError(
          readPermissionError(
            err,
            "Unable to load collaborators for this repository.",
          ),
        );
      } finally {
        if (requestId === collaboratorRequestId.current) {
          setIsLoadingCollaborators(false);
        }
      }
    })();

    void (async () => {
      try {
        const permission = await fetchCurrentUserPermission(
          giteaClient,
          owner,
          repo,
          currentUsername,
        );

        if (permissionRequestIdValue !== permissionRequestId.current) {
          return;
        }

        setCurrentPermission(permission);
      } catch (err) {
        if (permissionRequestIdValue !== permissionRequestId.current) {
          return;
        }

        setPermissionLoadError(
          readPermissionError(
            err,
            "Unable to confirm your repository permissions right now.",
          ),
        );
      } finally {
        if (permissionRequestIdValue === permissionRequestId.current) {
          setPermissionLoadPending(false);
        }
      }
    })();

    return () => {
      collaboratorRequestId.current += 1;
      permissionRequestId.current += 1;
      searchRequestId.current += 1;
    };
  }, [currentUsername, giteaClient, owner, repo]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
  }, [searchQuery]);

  useEffect(() => {
    const query = debouncedSearchQuery;
    const requestId = ++searchRequestId.current;

    if (query.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    void (async () => {
      try {
        const result = await unwrap(
          giteaClient.GET("/users/search", {
            params: {
              query: {
                q: query,
                page: 1,
                limit: SEARCH_PAGE_SIZE,
              },
            },
          }),
        );

        if (requestId !== searchRequestId.current) {
          return;
        }

        const rows = (result.data ?? [])
          .map(normalizeSearchResult)
          .filter((row): row is SearchResultRow => row !== null);
        setSearchResults(rows);

        if (result.ok === false) {
          setSearchError("Gitea reported a partial user search failure.");
        }
      } catch (err) {
        if (requestId !== searchRequestId.current) {
          return;
        }

        setSearchResults([]);
        setSearchError(
          readPermissionError(err, "Unable to search for users right now."),
        );
      } finally {
        if (requestId === searchRequestId.current) {
          setIsSearching(false);
        }
      }
    })();
  }, [debouncedSearchQuery, giteaClient]);

  function upsertCollaboratorRow(row: CollaboratorRow): void {
    setCollaborators((prev) => {
      const next = [...prev];
      const index = next.findIndex(
        (candidate) => candidate.login === row.login,
      );
      if (index === -1) {
        return [row, ...next];
      }

      next[index] = row;
      return next;
    });
  }

  function setBusy(login: string, busy: boolean): void {
    setRowBusy((prev) => ({
      ...prev,
      [login]: busy,
    }));
  }

  function updateDraftPermission(
    login: string,
    permission: WritablePermission,
  ): void {
    setDraftPermissions((prev) => ({
      ...prev,
      [login]: permission,
    }));
  }

  async function loadMoreCollaborators(): Promise<void> {
    if (isLoadingCollaborators || isLoadingMore || !hasMoreCollaborators) {
      return;
    }

    const nextPage = currentPage + 1;
    const requestId = ++collaboratorRequestId.current;
    setIsLoadingMore(true);
    setCollaboratorError(null);

    try {
      const page = await fetchCollaboratorPage(
        giteaClient,
        owner,
        repo,
        currentUsername,
        nextPage,
        COLLABORATORS_PAGE_SIZE,
      );

      if (requestId !== collaboratorRequestId.current) {
        return;
      }

      setCollaborators((prev) => mergeCollaboratorRows(prev, page.rows));
      setCurrentPage(nextPage);
      setHasMoreCollaborators(page.hasMore);
    } catch (err) {
      if (requestId !== collaboratorRequestId.current) {
        return;
      }

      setCollaboratorError(
        readPermissionError(
          err,
          "Unable to load more collaborators for this repository.",
        ),
      );
    } finally {
      if (requestId === collaboratorRequestId.current) {
        setIsLoadingMore(false);
      }
    }
  }

  async function handleGrantCollaborator(
    user: SearchResultRow,
    existingPermission?: DisplayPermission,
  ): Promise<void> {
    const login = user.login.trim();
    if (!login) {
      return;
    }

    const permission = draftPermissions[login] ?? defaultPermission;
    if (!isManagedPermission(existingPermission ?? permission)) {
      return;
    }

    setManageError(null);
    setBusy(login, true);

    try {
      await unwrap(
        giteaClient.PUT("/repos/{owner}/{repo}/collaborators/{collaborator}", {
          params: {
            path: { owner, repo, collaborator: login },
          },
          body: {
            permission,
          },
        }),
      );

      const updatedPermission = await fetchCollaboratorPermission(
        giteaClient,
        owner,
        repo,
        login,
      );

      const normalized = normalizeCollaborator(
        {
          login,
          full_name: user.fullName,
          email: user.email,
          avatar_url: user.avatarUrl,
        } as GiteaUser,
        updatedPermission,
        currentUsername,
      );

      if (normalized) {
        upsertCollaboratorRow(normalized);
      }

      setSearchResults((prev) =>
        prev.map((result) =>
          result.login === login
            ? {
                ...result,
                fullName: user.fullName,
                email: user.email,
                avatarUrl: user.avatarUrl,
              }
            : result,
        ),
      );
    } catch (err) {
      setManageError(
        readPermissionError(err, `Unable to update access for ${login}.`),
      );
    } finally {
      setBusy(login, false);
    }
  }

  function collaboratorActionLabel(row: CollaboratorRow): string {
    if (row.permission === "owner") {
      return "Owner access";
    }

    if (row.permission === "admin") {
      return "Update admin access";
    }

    return "Update access";
  }

  function renderUserIdentity(user: {
    login: string;
    fullName: string;
    email: string;
    avatarUrl: string;
  }) {
    const initials =
      user.fullName
        .split(" ")
        .filter(Boolean)
        .map((part) => part.charAt(0))
        .slice(0, 2)
        .join("")
        .toUpperCase() || user.login.slice(0, 2).toUpperCase();

    return (
      <div className="collaborator-identity">
        {user.avatarUrl ? (
          <img
            className="collaborator-avatar"
            alt=""
            src={user.avatarUrl}
            loading="lazy"
          />
        ) : (
          <div className="collaborator-avatar collaborator-avatar-fallback">
            {initials}
          </div>
        )}
        <div className="collaborator-identity-copy">
          <div className="collaborator-full-name">
            {user.fullName || user.login}
          </div>
          <div className="collaborator-username">@{user.login}</div>
        </div>
      </div>
    );
  }

  const loadedCount = collaborators.length;
  const activeSearch =
    debouncedSearchQuery.length >= 2
      ? `Search results for "${debouncedSearchQuery}"`
      : "";

  return (
    <div className="vault-detail collaborators-page">
      <section className="vault-section collaborators-hero">
        <div className="bs-eyebrow">Collaborators</div>
        <h1>Document access</h1>
        <p>
          Manage who can see and edit{" "}
          <code>
            {owner}/{repo}
          </code>
          . Every entry is pulled from Gitea, including permission data.
        </p>
      </section>

      <section
        className="collaborators-summary-grid"
        aria-label="Repository access summary"
      >
        <article className="bs-card collaborators-summary-card">
          <div className="collaborator-summary-label">Loaded collaborators</div>
          <div className="collaborator-summary-value">{loadedCount}</div>
          <p>Paginated from the repository collaborator list.</p>
        </article>

        <article className="bs-card collaborators-summary-card">
          <div className="collaborator-summary-label">Your access</div>
          <div className="collaborator-summary-value">
            {permissionLoadPending
              ? "Checking..."
              : formatPermissionLabel(currentPermission ?? "unknown")}
          </div>
          <p>
            {permissionLoadError
              ? permissionLoadError
              : canManageCollaborators
                ? "You can add or update collaborator access."
                : "View-only access for this repository."}
          </p>
        </article>

        <article className="bs-card collaborators-summary-card">
          <div className="collaborator-summary-label">Workspace state</div>
          <div className="collaborator-summary-value">
            {isLoadingCollaborators
              ? "Loading"
              : hasMoreCollaborators
                ? "More available"
                : "Complete"}
          </div>
          <p>
            {isLoadingCollaborators || isLoadingMore
              ? "Fetching collaborator pages from Gitea."
              : "Additional pages load on demand."}
          </p>
        </article>
      </section>

      {collaboratorError ? (
        <section className="bs-card collaborators-panel collaborators-panel-error">
          <div className="bs-eyebrow">Error</div>
          <h2>Unable to load collaborators</h2>
          <p>{collaboratorError}</p>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            onClick={() => {
              collaboratorRequestId.current += 1;
              permissionRequestId.current += 1;
              searchRequestId.current += 1;
              setIsLoadingCollaborators(true);
              setCollaboratorError(null);
              setCurrentPage(1);
              void (async () => {
                try {
                  const page = await fetchCollaboratorPage(
                    giteaClient,
                    owner,
                    repo,
                    currentUsername,
                    1,
                    COLLABORATORS_PAGE_SIZE,
                  );
                  setCollaborators(page.rows);
                  setHasMoreCollaborators(page.hasMore);
                } catch (err) {
                  setCollaboratorError(
                    readPermissionError(
                      err,
                      "Unable to load collaborators for this repository.",
                    ),
                  );
                } finally {
                  setIsLoadingCollaborators(false);
                }
              })();
            }}
          >
            Retry
          </button>
        </section>
      ) : null}

      <section className="bs-card collaborators-panel">
        <div className="collaborators-panel-header">
          <div>
            <div className="bs-eyebrow">Repository Members</div>
            <h2>Collaborators</h2>
          </div>
          <div className="collaborators-panel-meta">
            <span className="collaborator-panel-count">
              {loadedCount} shown
            </span>
            {isLoadingMore ? (
              <span className="collaborator-panel-status">Loading more...</span>
            ) : null}
          </div>
        </div>

        <div
          className="collaborators-table"
          role="table"
          aria-label="Collaborators"
        >
          <div className="collaborators-table-head" role="row">
            <div role="columnheader">Person</div>
            <div role="columnheader">Email</div>
            <div role="columnheader">Permission</div>
            <div role="columnheader">Actions</div>
          </div>

          {isLoadingCollaborators ? (
            <div
              className="collaborators-empty-state"
              role="status"
              aria-live="polite"
            >
              Loading collaborators...
            </div>
          ) : collaborators.length === 0 ? (
            <div className="collaborators-empty-state">
              No collaborators are listed for this repository yet.
            </div>
          ) : (
            collaborators.map((row) => {
              const editable = isManagedPermission(row.permission);
              const draftPermission =
                draftPermissions[row.login] ??
                (editable
                  ? normalizeWritablePermission(row.permission)
                  : "write");
              const busy = rowBusy[row.login] ?? false;

              return (
                <div className="collaborator-row" role="row" key={row.login}>
                  <div className="collaborator-row-cell" role="cell">
                    {renderUserIdentity(row)}
                    {row.isCurrentUser ? (
                      <div className="collaborator-current-user">You</div>
                    ) : null}
                  </div>
                  <div
                    className="collaborator-row-cell collaborator-row-email"
                    role="cell"
                  >
                    {row.email || "Not public"}
                  </div>
                  <div className="collaborator-row-cell" role="cell">
                    <span className={permissionBadgeClass(row.permission)}>
                      {formatPermissionLabel(row.permission)}
                    </span>
                    {row.roleName ? (
                      <div className="collaborator-role-name">
                        {row.roleName}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="collaborator-row-cell collaborator-row-actions"
                    role="cell"
                  >
                    {canManageCollaborators && editable ? (
                      <>
                        <select
                          className="collaborator-permission-select"
                          value={draftPermission}
                          disabled={busy}
                          onChange={(event) =>
                            updateDraftPermission(
                              row.login,
                              event.target.value as WritablePermission,
                            )
                          }
                        >
                          <option value="read">Read</option>
                          <option value="write">Write</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          className="bs-btn bs-btn-secondary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void handleGrantCollaborator(
                              {
                                login: row.login,
                                fullName: row.fullName,
                                email: row.email,
                                avatarUrl: row.avatarUrl,
                              },
                              row.permission,
                            )
                          }
                        >
                          {busy ? "Saving..." : collaboratorActionLabel(row)}
                        </button>
                      </>
                    ) : (
                      <div className="collaborator-row-note">
                        {row.permission === "owner"
                          ? "Repository owner"
                          : "No changes available"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {hasMoreCollaborators ? (
          <div className="collaborators-load-more">
            <button
              className="bs-btn bs-btn-secondary"
              type="button"
              disabled={isLoadingMore || isLoadingCollaborators}
              onClick={() => void loadMoreCollaborators()}
            >
              {isLoadingMore ? "Loading..." : "Load more collaborators"}
            </button>
          </div>
        ) : null}
      </section>

      {canManageCollaborators ? (
        <section className="bs-card collaborators-panel">
          <div className="collaborators-panel-header">
            <div>
              <div className="bs-eyebrow">Add People</div>
              <h2>Grant access</h2>
            </div>
            <div className="collaborators-panel-meta">
              <span className="collaborator-panel-status">
                Type a name, pick a match, then set access.
              </span>
            </div>
          </div>

          <div className="collaborator-search-form">
            <label
              className="collaborator-search-label"
              htmlFor="collaborator-search"
            >
              Search users by name
            </label>
            <div className="collaborator-search-input-row">
              <input
                id="collaborator-search"
                className="collaborator-search-input"
                type="search"
                value={searchQuery}
                placeholder="Start typing a name or username"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <select
                className="collaborator-permission-select collaborator-default-permission"
                value={defaultPermission}
                onChange={(event) =>
                  setDefaultPermission(event.target.value as WritablePermission)
                }
              >
                <option value="read">Read</option>
                <option value="write">Write</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <p className="collaborator-search-hint">
              Search results are loaded from Gitea after a short debounce.
            </p>
          </div>

          <div className="collaborator-search-results">
            {searchQuery.trim().length < 2 ? (
              <div className="collaborators-empty-state">
                Type at least two characters to search for a user.
              </div>
            ) : isSearching ? (
              <div className="collaborators-empty-state" role="status">
                Searching Gitea...
              </div>
            ) : searchError ? (
              <div className="collaborators-empty-state collaborators-search-error">
                {searchError}
              </div>
            ) : searchResults.length === 0 ? (
              <div className="collaborators-empty-state">
                No users matched that search.
              </div>
            ) : (
              <>
                <div className="collaborator-search-heading">
                  {activeSearch}
                </div>
                {searchResults.map((user) => {
                  const existing = collaboratorMap.get(user.login);
                  const busy = rowBusy[user.login] ?? false;
                  const permission = existing ? existing.permission : "unknown";
                  const editable =
                    !existing || isManagedPermission(existing.permission);
                  const selectValue =
                    draftPermissions[user.login] ?? defaultPermission;

                  return (
                    <article
                      className="collaborator-search-result"
                      key={user.login}
                    >
                      <div className="collaborator-search-result-main">
                        {renderUserIdentity(user)}
                        <div className="collaborator-search-result-copy">
                          {user.email ? (
                            <div className="collaborator-row-email">
                              {user.email}
                            </div>
                          ) : (
                            <div className="collaborator-row-email">
                              Email not public
                            </div>
                          )}
                          {existing ? (
                            <span className="collaborator-existing-badge">
                              Already a collaborator
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="collaborator-result-actions">
                        <select
                          className="collaborator-permission-select"
                          value={selectValue}
                          disabled={busy || !editable}
                          onChange={(event) =>
                            updateDraftPermission(
                              user.login,
                              event.target.value as WritablePermission,
                            )
                          }
                        >
                          <option value="read">Read</option>
                          <option value="write">Write</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          className="bs-btn bs-btn-primary"
                          type="button"
                          disabled={busy || !editable}
                          onClick={() =>
                            void handleGrantCollaborator(
                              user,
                              existing?.permission,
                            )
                          }
                        >
                          {busy
                            ? "Saving..."
                            : existing && editable
                              ? "Update access"
                              : existing
                                ? "Owner access"
                                : "Add collaborator"}
                        </button>
                        {existing ? (
                          <span className={permissionBadgeClass(permission)}>
                            {formatPermissionLabel(permission)}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </>
            )}
          </div>

          {manageError ? (
            <p className="collaborator-manage-error" role="alert">
              {manageError}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="bs-card collaborators-panel collaborators-readonly">
          <div className="bs-eyebrow">Access</div>
          <h2>Only owners and admins can add collaborators</h2>
          <p>
            {permissionLoadPending
              ? "Checking your repository access..."
              : "You can still review collaborator access, but only repo owners and admins can change it."}
          </p>
        </section>
      )}
    </div>
  );
}
