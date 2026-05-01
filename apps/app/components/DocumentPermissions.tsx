import { useEffect, useState } from "react";
import { getDocumentPermissions, updateDocumentPermissions } from "../api";
import type { DocumentPermissionsPayload } from "../api";

interface DocumentPermissionsProps {
  owner: string;
  repo: string;
  currentUsername: string;
}

function parseUsernameList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

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
  const [approvalsWhitelistInput, setApprovalsWhitelistInput] = useState("");
  const [enableMergeWhitelist, setEnableMergeWhitelist] = useState(false);
  const [mergeWhitelistInput, setMergeWhitelistInput] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

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
    setApprovalsWhitelistInput(
      (bp?.approvalsWhitelistUsernames ?? []).join(", "),
    );
    setEnableMergeWhitelist(bp?.enableMergeWhitelist ?? false);
    setMergeWhitelistInput((bp?.mergeWhitelistUsernames ?? []).join(", "));
    setIsPrivate(data.isPrivate);
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
          ? parseUsernameList(approvalsWhitelistInput)
          : [],
        enableMergeWhitelist,
        mergeWhitelistUsernames: enableMergeWhitelist
          ? parseUsernameList(mergeWhitelistInput)
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

  return (
    <div className="vault-detail permissions-page">
      <section className="vault-section permissions-hero">
        <div className="bs-eyebrow">Permissions</div>
        <h1>Document permissions</h1>
        <p>
          Control approval requirements, restrict who can approve or publish,
          and manage public read access for{" "}
          <code>
            {owner}/{repo}
          </code>
          .
        </p>
      </section>

      {loading ? (
        <section className="bs-card permissions-panel" role="status">
          Loading permissions...
        </section>
      ) : loadError ? (
        <section className="bs-card permissions-panel permissions-error">
          <div className="bs-eyebrow">Error</div>
          <h2>Unable to load permissions</h2>
          <p>{loadError}</p>
        </section>
      ) : !isOwner ? (
        <section className="bs-card permissions-panel permissions-readonly">
          <div className="bs-eyebrow">Read-Only</div>
          <h2>Only the document owner can change permissions</h2>
          <p>You can view these settings but cannot modify them.</p>
        </section>
      ) : null}

      {!loading && !loadError ? (
        <>
          <section className="bs-card permissions-panel">
            <div className="permissions-panel-header">
              <div className="bs-eyebrow">Review Rules</div>
              <h2>Approval requirements</h2>
            </div>
            <p className="permissions-description">
              Set the minimum number of approvals required before a document can
              be published.
            </p>
            <div className="permissions-field">
              <label className="permissions-label" htmlFor="required-approvals">
                Required approvals
              </label>
              <input
                id="required-approvals"
                className="bs-input permissions-number-input"
                type="number"
                min={0}
                max={20}
                value={requiredApprovals}
                disabled={!isOwner || saving}
                onChange={(e) =>
                  setRequiredApprovals(Math.max(0, Number(e.target.value)))
                }
              />
              <p className="permissions-hint">
                Set to 0 to allow publishing without any approvals.
              </p>
            </div>

            <div className="permissions-field">
              <label className="permissions-toggle-label">
                <input
                  type="checkbox"
                  className="permissions-toggle"
                  checked={enableApprovalsWhitelist}
                  disabled={!isOwner || saving}
                  onChange={(e) =>
                    setEnableApprovalsWhitelist(e.target.checked)
                  }
                />
                <span>Restrict approvals to specific users</span>
              </label>
            </div>

            {enableApprovalsWhitelist ? (
              <div className="permissions-field">
                <label
                  className="permissions-label"
                  htmlFor="approvals-whitelist"
                >
                  Allowed approvers (comma or space separated usernames)
                </label>
                <input
                  id="approvals-whitelist"
                  className="bs-input"
                  type="text"
                  placeholder="alice, bob, carol"
                  value={approvalsWhitelistInput}
                  disabled={!isOwner || saving}
                  onChange={(e) => setApprovalsWhitelistInput(e.target.value)}
                />
              </div>
            ) : null}
          </section>

          <section className="bs-card permissions-panel">
            <div className="permissions-panel-header">
              <div className="bs-eyebrow">Publish Rules</div>
              <h2>Publish restrictions</h2>
            </div>
            <p className="permissions-description">
              Control who is allowed to publish (merge) approved documents.
            </p>
            <div className="permissions-field">
              <label className="permissions-toggle-label">
                <input
                  type="checkbox"
                  className="permissions-toggle"
                  checked={enableMergeWhitelist}
                  disabled={!isOwner || saving}
                  onChange={(e) => setEnableMergeWhitelist(e.target.checked)}
                />
                <span>Restrict publishing to specific users</span>
              </label>
            </div>

            {enableMergeWhitelist ? (
              <div className="permissions-field">
                <label className="permissions-label" htmlFor="merge-whitelist">
                  Allowed publishers (comma or space separated usernames)
                </label>
                <input
                  id="merge-whitelist"
                  className="bs-input"
                  type="text"
                  placeholder="alice, bob"
                  value={mergeWhitelistInput}
                  disabled={!isOwner || saving}
                  onChange={(e) => setMergeWhitelistInput(e.target.value)}
                />
              </div>
            ) : null}
          </section>

          <section className="bs-card permissions-panel">
            <div className="permissions-panel-header">
              <div className="bs-eyebrow">Public Access</div>
              <h2>Visibility</h2>
            </div>
            <p className="permissions-description">
              Public documents can be read by anyone — including anonymous
              visitors. Reviews and version history are visible too. Private
              documents are only accessible to collaborators.
            </p>
            <div className="permissions-field">
              <label className="permissions-toggle-label">
                <input
                  type="checkbox"
                  className="permissions-toggle"
                  checked={isPrivate}
                  disabled={!isOwner || saving}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                <span>Keep this document private</span>
              </label>
              <p className="permissions-hint">
                {isPrivate
                  ? "Only collaborators can access this document."
                  : "Anyone can read this document and its review history."}
              </p>
            </div>
          </section>

          {isOwner ? (
            <div className="permissions-actions">
              {saveError ? (
                <p className="permissions-save-error" role="alert">
                  {saveError}
                </p>
              ) : saveSuccess ? (
                <p className="permissions-save-success" role="status">
                  Permissions saved.
                </p>
              ) : null}
              <button
                className="bs-btn bs-btn-primary"
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving..." : "Save permissions"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
