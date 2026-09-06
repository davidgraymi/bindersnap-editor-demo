import { type FormEvent, useEffect, useState } from "react";
import {
  CheckCircle2,
  LoaderCircle,
  Search,
  Shield,
  UserRound,
} from "lucide-react";

import {
  clearAdminSubscriptionAccess,
  listAdminSubscriptionAccess,
  setAdminSubscriptionAccess,
  searchWorkspaceUsers,
  type AdminSubscriptionAccessUser,
  type SearchUsersPayload,
} from "../api";

interface AdminSubscriptionManagementPageProps {
  currentUsername: string;
}

function formatTimestamp(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString();
}

/**
 * The server resolves `config_bypass` before it looks at manual overrides, so
 * a user on the paywall bypass list keeps Pro access no matter what an admin
 * sets here. Saying so beats letting the admin revoke into the void.
 */
export function isOverrideOutranked(
  user: AdminSubscriptionAccessUser,
): boolean {
  return user.override !== null && user.accessSource === "config_bypass";
}

export function formatSourceLabel(user: AdminSubscriptionAccessUser): string {
  if (isOverrideOutranked(user)) {
    return "Config Bypass";
  }

  if (user.override) {
    return user.override.access === "grant"
      ? "Manual override is granting access"
      : "Manual override is revoking access";
  }

  if (user.accessSource === "none") {
    return user.hasAccess
      ? "Pro access is currently enabled"
      : "Pro access is currently disabled";
  }

  return user.accessSource
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function AdminSubscriptionManagementPage({
  currentUsername,
}: AdminSubscriptionManagementPageProps) {
  const [usernameQuery, setUsernameQuery] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoadingAccess, setIsLoadingAccess] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [accessState, setAccessState] =
    useState<AdminSubscriptionAccessUser | null>(null);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchUsersPayload["users"]>(
    [],
  );

  useEffect(() => {
    const normalizedQuery = usernameQuery.trim();

    if (normalizedQuery.length < 2) {
      setSuggestions([]);
      setIsSearchingUsers(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsSearchingUsers(true);

      searchWorkspaceUsers(normalizedQuery, 1, 6)
        .then((payload) => {
          if (!cancelled) {
            setSuggestions(payload.users);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsSearchingUsers(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [usernameQuery]);

  const loadAccessUser = async (
    username: string,
  ): Promise<AdminSubscriptionAccessUser> => {
    const payload = await listAdminSubscriptionAccess(username, 1, 20);
    const normalizedUsername = username.toLowerCase();
    const match = payload.users.find(
      (candidate) => candidate.username.toLowerCase() === normalizedUsername,
    );

    if (!match) {
      throw new Error(`No workspace user named ${username} was found.`);
    }

    return match;
  };

  const runLookup = async (username: string) => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setLookupError("Enter a username to check current Pro access.");
      setAccessState(null);
      setSelectedUsername(null);
      setNotice(null);
      return;
    }

    setIsLoadingAccess(true);
    setLookupError(null);
    setActionError(null);
    setNotice(null);

    try {
      const nextState = await loadAccessUser(normalizedUsername);
      setAccessState(nextState);
      setSelectedUsername(nextState.username);
      setUsernameQuery(nextState.username);
      setSuggestions([]);
    } catch (error) {
      setAccessState(null);
      setSelectedUsername(normalizedUsername);
      setLookupError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Unable to load Pro access details.",
      );
    } finally {
      setIsLoadingAccess(false);
    }
  };

  const handleLookupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runLookup(usernameQuery);
  };

  const handleSelectSuggestion = async (username: string) => {
    setUsernameQuery(username);
    await runLookup(username);
  };

  const handleAccessChange = async (hasProAccess: boolean) => {
    if (!selectedUsername) {
      return;
    }

    setIsMutating(true);
    setActionError(null);
    setNotice(null);

    try {
      const nextState = await setAdminSubscriptionAccess(
        selectedUsername,
        hasProAccess ? "grant" : "revoke",
      );
      setAccessState(nextState);
      setSelectedUsername(nextState.username);
      setUsernameQuery(nextState.username);
      setNotice(
        isOverrideOutranked(nextState)
          ? `Override recorded for ${nextState.username}, but it is not in effect.`
          : hasProAccess
            ? `Bindersnap Pro access granted for ${nextState.username}.`
            : `Bindersnap Pro access revoked for ${nextState.username}.`,
      );
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : hasProAccess
            ? "Unable to grant Bindersnap Pro access."
            : "Unable to revoke Bindersnap Pro access.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleClearOverride = async () => {
    if (!selectedUsername) {
      return;
    }

    setIsMutating(true);
    setActionError(null);
    setNotice(null);

    try {
      await clearAdminSubscriptionAccess(selectedUsername);
      const nextState = await loadAccessUser(selectedUsername);
      setAccessState(nextState);
      setNotice(`Manual override cleared for ${nextState.username}.`);
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.trim() !== ""
          ? error.message
          : "Unable to clear the manual override.",
      );
    } finally {
      setIsMutating(false);
    }
  };

  const formattedUpdatedAt = formatTimestamp(
    accessState?.override?.updatedAt ?? null,
  );

  return (
    <div className="admin-pro-page app-page-shell">
      <div className="admin-pro-header">
        <div className="admin-pro-header-copy">
          <h1>Bindersnap Pro access</h1>
          <p>
            Check a teammate&apos;s current subscription access, then grant or
            revoke manual Pro access without leaving the workspace shell.
          </p>
        </div>
        <div className="admin-pro-admin-pill">
          <Shield size={14} strokeWidth={1.8} aria-hidden="true" />
          Signed in as {currentUsername}
        </div>
      </div>

      <div className="admin-pro-grid">
        <section className="admin-pro-card">
          <div className="admin-pro-card-heading">
            <h2>Find a user</h2>
            <p>
              Search by Gitea username to inspect the current Bindersnap Pro
              state before making a manual override.
            </p>
          </div>

          <form className="admin-pro-lookup-form" onSubmit={handleLookupSubmit}>
            <label className="app-field" htmlFor="admin-pro-username">
              <span className="bs-label">Username</span>
              <div className="admin-pro-input-wrap">
                <Search
                  className="admin-pro-input-icon"
                  size={14}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <input
                  id="admin-pro-username"
                  className="bs-input admin-pro-input"
                  type="text"
                  value={usernameQuery}
                  onChange={(event) => setUsernameQuery(event.target.value)}
                  placeholder="Search by username"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </label>

            <button
              className="bs-btn bs-btn-primary admin-pro-submit"
              type="submit"
              disabled={isLoadingAccess || isMutating}
            >
              {isLoadingAccess ? "Checking access..." : "Load access state"}
            </button>
          </form>

          {isSearchingUsers || suggestions.length > 0 ? (
            <div className="admin-pro-suggestions">
              <div className="admin-pro-suggestions-header">
                <span>Matching users</span>
                {isSearchingUsers ? (
                  <LoaderCircle
                    className="admin-pro-spinner"
                    size={14}
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              {suggestions.length > 0 ? (
                <div className="admin-pro-suggestion-list" role="list">
                  {suggestions.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="admin-pro-suggestion"
                      onClick={() => void handleSelectSuggestion(user.login)}
                    >
                      <span className="admin-pro-suggestion-avatar">
                        <UserRound
                          size={14}
                          strokeWidth={1.6}
                          aria-hidden="true"
                        />
                      </span>
                      <span className="admin-pro-suggestion-copy">
                        <strong>{user.login}</strong>
                        <span>
                          {user.full_name || user.email || "Workspace user"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : !isSearchingUsers ? (
                <p className="admin-pro-muted">
                  No matching users yet. You can still look up an exact
                  username.
                </p>
              ) : null}
            </div>
          ) : null}

          {lookupError ? (
            <p className="app-inline-error">{lookupError}</p>
          ) : null}
        </section>

        <section className="admin-pro-card admin-pro-card--status">
          <div className="admin-pro-card-heading">
            <h2>Current access state</h2>
            <p>
              Manual overrides are intended for operational exceptions and
              support workflows, not routine subscription changes.
            </p>
          </div>

          {notice ? (
            <div className="admin-pro-notice" role="status">
              <CheckCircle2 size={16} strokeWidth={1.8} aria-hidden="true" />
              <span>{notice}</span>
            </div>
          ) : null}

          {actionError ? (
            <p className="app-inline-error">{actionError}</p>
          ) : null}

          {accessState ? (
            <div className="admin-pro-state-card">
              <div className="admin-pro-state-row">
                <div>
                  <p className="admin-pro-state-label">User</p>
                  <h3>{accessState.username}</h3>
                </div>
                <span
                  className={`admin-pro-status-badge${
                    accessState.hasAccess
                      ? " admin-pro-status-badge--active"
                      : " admin-pro-status-badge--inactive"
                  }`}
                >
                  {accessState.hasAccess ? "Pro Enabled" : "Pro Disabled"}
                </span>
              </div>

              <dl className="admin-pro-meta">
                <div>
                  <dt>Source</dt>
                  <dd>{formatSourceLabel(accessState)}</dd>
                </div>
                <div>
                  <dt>Manual override</dt>
                  <dd>
                    {!accessState.override
                      ? "Not active"
                      : isOverrideOutranked(accessState)
                        ? "Active but not in effect"
                        : "Active"}
                  </dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formattedUpdatedAt ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Updated by</dt>
                  <dd>{accessState.override?.updatedBy ?? "Not reported"}</dd>
                </div>
              </dl>

              {isOverrideOutranked(accessState) ? (
                <p className="admin-pro-muted" role="status">
                  {accessState.username} is on the deployment&apos;s paywall
                  bypass list, which the server resolves ahead of manual
                  overrides. Pro access stays on until that list changes —
                  granting or revoking here will not move it.
                </p>
              ) : null}

              <div className="admin-pro-actions">
                <button
                  type="button"
                  className="bs-btn bs-btn-primary"
                  disabled={isMutating || accessState.hasAccess}
                  onClick={() => void handleAccessChange(true)}
                >
                  {isMutating && !accessState.hasAccess
                    ? "Granting access..."
                    : "Grant Pro access"}
                </button>
                <button
                  type="button"
                  className="bs-btn bs-btn-secondary"
                  disabled={isMutating || !accessState.hasAccess}
                  onClick={() => void handleAccessChange(false)}
                >
                  {isMutating && accessState.hasAccess
                    ? "Revoking access..."
                    : "Revoke Pro access"}
                </button>
                {accessState.override ? (
                  <button
                    type="button"
                    className="bs-btn bs-btn-secondary"
                    disabled={isMutating}
                    onClick={() => void handleClearOverride()}
                  >
                    Clear manual override
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="admin-pro-empty-state">
              <Shield size={18} strokeWidth={1.7} aria-hidden="true" />
              <div>
                <h3>Load a user to review access</h3>
                <p>
                  Pick a teammate from search or enter an exact username to see
                  whether Bindersnap Pro is currently enabled.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
