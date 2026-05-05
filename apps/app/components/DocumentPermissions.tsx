import { useEffect, useRef, useState } from "react";
import {
  getDocumentPermissions,
  searchWorkspaceUsers,
  updateDocumentPermissions,
} from "../api";
import type { DocumentPermissionsPayload } from "../api";
import type { RepoUserSummary } from "../../../packages/gitea-client/repos";

interface DocumentPermissionsProps {
  owner: string;
  repo: string;
  currentUsername: string;
}

interface UserResult {
  login: string;
  fullName: string;
}

function toUserResult(u: RepoUserSummary): UserResult {
  return {
    login: u.login,
    fullName: u.full_name || u.login,
  };
}

// ── User picker sub-component ─────────────────────────────────

interface UserPickerFieldProps {
  id: string;
  selected: string[];
  onChange: (users: string[]) => void;
  disabled: boolean;
}

function UserPickerField({
  id,
  selected,
  onChange,
  disabled,
}: UserPickerFieldProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const searchId = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const q = debouncedQuery;
    const reqId = ++searchId.current;

    if (q.length < 2) {
      setResults([]);
      setIsSearching(false);
      setIsOpen(false);
      return;
    }

    setIsSearching(true);

    void (async () => {
      try {
        const data = await searchWorkspaceUsers(q, 1, 8);
        if (reqId !== searchId.current) return;
        setResults(data.users.map(toUserResult));
      } catch {
        if (reqId !== searchId.current) return;
        setResults([]);
      } finally {
        if (reqId === searchId.current) setIsSearching(false);
      }
    })();
  }, [debouncedQuery]);

  const visible = results.filter((u) => !selected.includes(u.login));

  function add(login: string) {
    onChange([...selected, login]);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setIsOpen(false);
  }

  function remove(login: string) {
    onChange(selected.filter((u) => u !== login));
  }

  return (
    <div className="perms-picker">
      {selected.length > 0 && (
        <div className="perms-picker-chips">
          {selected.map((login) => (
            <span className="perms-picker-chip" key={login}>
              @{login}
              {!disabled && (
                <button
                  type="button"
                  className="perms-picker-chip-remove"
                  aria-label={`Remove ${login}`}
                  onClick={() => remove(login)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="perms-picker-shell">
          <input
            id={id}
            type="search"
            className="bs-input perms-picker-input"
            placeholder="Search by name or username…"
            value={query}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(e.target.value.trim().length >= 2);
            }}
          />
          {isOpen && query.trim().length >= 2 && (
            <div className="perms-picker-dropdown" role="listbox">
              {isSearching ? (
                <p className="perms-picker-state">Searching…</p>
              ) : visible.length === 0 ? (
                <p className="perms-picker-state">
                  {results.length > 0
                    ? "All matching users are already added."
                    : "No users found."}
                </p>
              ) : (
                visible.map((user) => (
                  <button
                    key={user.login}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="perms-picker-result"
                    onClick={() => add(user.login)}
                  >
                    <span className="perms-picker-result-name">
                      {user.fullName !== user.login ? user.fullName : ""}
                    </span>
                    <span className="perms-picker-result-login">
                      @{user.login}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function DocumentPermissions({
  owner,
  repo,
  currentUsername,
}: DocumentPermissionsProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [requiredApprovals, setRequiredApprovals] = useState(1);
  const [enableApprovalsWhitelist, setEnableApprovalsWhitelist] =
    useState(false);
  const [approvalsWhitelistUsers, setApprovalsWhitelistUsers] = useState<
    string[]
  >([]);
  const [enableMergeWhitelist, setEnableMergeWhitelist] = useState(false);
  const [mergeWhitelistUsers, setMergeWhitelistUsers] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(true);
  const [isInternal, setIsInternal] = useState(false);

  const [currentUserPermission, setCurrentUserPermission] = useState<
    string | null
  >(null);
  const isOwner =
    currentUsername === owner || currentUserPermission === "owner";

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setSaveSuccess(false);

    void (async () => {
      try {
        const data = await getDocumentPermissions(owner, repo);
        applyPayload(data);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Unable to load permissions.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [owner, repo]);

  function applyPayload(data: DocumentPermissionsPayload): void {
    const bp = data.branchProtection;
    setRequiredApprovals(bp?.requiredApprovals ?? 1);
    setEnableApprovalsWhitelist(bp?.enableApprovalsWhitelist ?? false);
    setApprovalsWhitelistUsers(bp?.approvalsWhitelistUsernames ?? []);
    setEnableMergeWhitelist(bp?.enableMergeWhitelist ?? false);
    setMergeWhitelistUsers(bp?.mergeWhitelistUsernames ?? []);
    setIsPrivate(data.isPrivate);
    setIsInternal(data.isInternal);
    setCurrentUserPermission(data.currentUserPermission?.access ?? null);
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const data = await updateDocumentPermissions(owner, repo, {
        requiredApprovals,
        enableApprovalsWhitelist,
        approvalsWhitelistUsernames: enableApprovalsWhitelist
          ? approvalsWhitelistUsers
          : [],
        enableMergeWhitelist,
        mergeWhitelistUsernames: enableMergeWhitelist
          ? mergeWhitelistUsers
          : [],
        isPrivate,
      });
      applyPayload(data);
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Unable to save permissions.",
      );
    } finally {
      setSaving(false);
    }
  }

  const disabled = !isOwner || saving;

  if (loading) {
    return (
      <div className="perms-page">
        <p className="perms-state-text">Loading permissions…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="perms-page">
        <div className="perms-notice perms-notice--error">
          <div className="bs-eyebrow">Error</div>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="perms-page">
      {!isOwner && (
        <div className="perms-notice">
          Only the document owner can change permissions. You can view these
          settings but cannot modify them.
        </div>
      )}

      <div className="perms-card">
        {/* Review Rules */}
        <div className="perms-group">
          <p className="perms-group-heading">Review Rules</p>

          <div className="perms-row perms-row--split">
            <div className="perms-row-main">
              <label className="perms-row-label" htmlFor="required-approvals">
                Required approvals
              </label>
              <p className="perms-row-hint">
                Minimum approvals needed before a change can be published.
              </p>
            </div>
            <input
              id="required-approvals"
              className="perms-number-input"
              type="number"
              min={0}
              max={20}
              value={requiredApprovals}
              disabled={disabled}
              onChange={(e) =>
                setRequiredApprovals(Math.max(0, Number(e.target.value)))
              }
            />
          </div>

          <div className="perms-row perms-row--split">
            <div className="perms-row-main">
              <label className="perms-row-label" htmlFor="restrict-approvers">
                Restrict who can approve
              </label>
              <p className="perms-row-hint">
                When enabled, only the users listed can submit approvals.
              </p>
            </div>
            <input
              id="restrict-approvers"
              type="checkbox"
              className="perms-checkbox"
              checked={enableApprovalsWhitelist}
              disabled={disabled}
              onChange={(e) => setEnableApprovalsWhitelist(e.target.checked)}
            />
          </div>

          {enableApprovalsWhitelist && (
            <div className="perms-row perms-row--sub">
              <label className="perms-sub-label" htmlFor="approvals-picker">
                Allowed approvers
              </label>
              <UserPickerField
                id="approvals-picker"
                selected={approvalsWhitelistUsers}
                onChange={setApprovalsWhitelistUsers}
                disabled={disabled}
              />
            </div>
          )}
        </div>

        {/* Publish Rules */}
        <div className="perms-group">
          <p className="perms-group-heading">Publish Rules</p>

          <div className="perms-row perms-row--split">
            <div className="perms-row-main">
              <label className="perms-row-label" htmlFor="restrict-publishers">
                Restrict who can publish
              </label>
              <p className="perms-row-hint">
                When enabled, only the users listed can publish approved
                changes.
              </p>
            </div>
            <input
              id="restrict-publishers"
              type="checkbox"
              className="perms-checkbox"
              checked={enableMergeWhitelist}
              disabled={disabled}
              onChange={(e) => setEnableMergeWhitelist(e.target.checked)}
            />
          </div>

          {enableMergeWhitelist && (
            <div className="perms-row perms-row--sub">
              <label className="perms-sub-label" htmlFor="publishers-picker">
                Allowed publishers
              </label>
              <UserPickerField
                id="publishers-picker"
                selected={mergeWhitelistUsers}
                onChange={setMergeWhitelistUsers}
                disabled={disabled}
              />
            </div>
          )}
        </div>

        {/* Visibility */}
        <div className="perms-group">
          <p className="perms-group-heading">Visibility</p>

          {isInternal ? (
            <div className="perms-notice">
              <div className="bs-eyebrow">Internal (Gitea)</div>
              <p>
                This document uses <strong>Internal</strong> visibility —
                accessible to all logged-in Gitea users but not listed on your
                profile or in search results. To change it, update the
                repository visibility in Gitea settings.
              </p>
            </div>
          ) : (
            <>
              <div className="perms-radio-group">
                <label
                  className={`perms-radio-option${isPrivate ? " perms-radio-option--selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="doc-visibility"
                    value="private"
                    checked={isPrivate}
                    disabled={disabled}
                    onChange={() => setIsPrivate(true)}
                  />
                  <div>
                    <div className="perms-radio-title">Private</div>
                    <div className="perms-radio-desc">
                      Only collaborators you've added can access this document.
                      It won't appear in search results or on your profile.
                    </div>
                  </div>
                </label>
                <label
                  className={`perms-radio-option${!isPrivate ? " perms-radio-option--selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="doc-visibility"
                    value="public"
                    checked={!isPrivate}
                    disabled={disabled}
                    onChange={() => setIsPrivate(false)}
                  />
                  <div>
                    <div className="perms-radio-title">Public</div>
                    <div className="perms-radio-desc">
                      Anyone on the internet can view this document and its full
                      revision history without an account.
                    </div>
                  </div>
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {isOwner && (
          <div className="perms-footer">
            <div className="perms-footer-messages">
              {saveError && (
                <p className="perms-save-error" role="alert">
                  {saveError}
                </p>
              )}
              {saveSuccess && (
                <p className="perms-save-success" role="status">
                  Permissions saved.
                </p>
              )}
            </div>
            <button
              className="bs-btn bs-btn-primary"
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving…" : "Save permissions"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
