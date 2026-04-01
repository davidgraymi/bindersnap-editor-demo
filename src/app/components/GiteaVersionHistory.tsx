/**
 * Gitea-backed version history sidebar.
 *
 * Lists commits for a document file, allows viewing a historical version
 * in a read-only preview, and restoring any version as a new commit.
 */

import { useCallback, useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { History, Clock, User, Eye, RotateCcw } from "lucide-react";

import { GiteaApiError, type GiteaClient } from "../../services/gitea/client";
import { commitDocument, fetchDocumentAtSha, listDocumentCommits, type CommitSummary } from "../../services/gitea/documents";

interface GiteaVersionHistoryProps {
  client: GiteaClient;
  owner: string;
  repo: string;
  filePath: string;
  branch?: string;
  currentFileSha: string;
  /** Called when "View" is clicked — renders that version read-only in the editor. */
  onPreview: (content: JSONContent, commitSha: string) => void;
  /** Called when "Restore" succeeds — passes new file SHA. */
  onRestore: (newFileSha: string) => void;
  /** SHA of the commit currently being previewed (if any). */
  previewingSha?: string | null;
}

export function GiteaVersionHistory({
  client,
  owner,
  repo,
  filePath,
  branch = "main",
  currentFileSha,
  onPreview,
  onRestore,
  previewingSha,
}: GiteaVersionHistoryProps) {
  const [commits, setCommits] = useState<CommitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringsha, setRestoringSha] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listDocumentCommits({ client, owner, repo, filePath, limit: 50 });
        if (!cancelled) setCommits(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof GiteaApiError ? err.message : "Failed to load history.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, owner, repo, filePath]);

  const handleView = useCallback(
    async (commit: CommitSummary) => {
      try {
        const content = await fetchDocumentAtSha({ client, owner, repo, filePath, sha: commit.sha });
        onPreview(content, commit.sha);
      } catch (err) {
        const msg = err instanceof GiteaApiError ? err.message : "Failed to load version.";
        window.alert(msg);
      }
    },
    [client, owner, repo, filePath, onPreview]
  );

  const handleRestore = useCallback(
    async (commit: CommitSummary) => {
      const confirmed = window.confirm(
        `Restore to commit ${commit.sha.slice(0, 7)}?\n\n"${commit.message}"\n\nThis will create a new commit — history is preserved.`
      );
      if (!confirmed) return;

      setRestoringSha(commit.sha);
      try {
        const content = await fetchDocumentAtSha({ client, owner, repo, filePath, sha: commit.sha });
        const result = await commitDocument({
          client,
          owner,
          repo,
          filePath,
          branch,
          content,
          message: `Restored to "${commit.message.slice(0, 50)}"`,
          sha: currentFileSha || undefined,
        });

        // Refresh commit list
        const refreshed = await listDocumentCommits({ client, owner, repo, filePath, limit: 50 });
        setCommits(refreshed);
        onRestore(result.fileSha ?? currentFileSha);
      } catch (err) {
        const msg = err instanceof GiteaApiError ? err.message : "Restore failed.";
        window.alert(msg);
      } finally {
        setRestoringSha(null);
      }
    },
    [client, owner, repo, filePath, branch, currentFileSha, onRestore]
  );

  return (
    <div className="vc-panel">
      <div className="vc-panel-header">
        <History size={20} />
        <h2>Version History</h2>
      </div>

      {loading ? (
        <div className="vc-section" style={{ padding: "var(--brand-space-4)" }}>
          <span style={{ color: "var(--bs-text-secondary)", fontSize: "var(--brand-text-sm)" }}>Loading…</span>
        </div>
      ) : error ? (
        <div className="vc-section" style={{ padding: "var(--brand-space-4)", color: "var(--bs-color-error)" }}>
          {error}
        </div>
      ) : (
        <div className="vc-section flex flex-1 min-h-0 flex-col">
          <div className="vc-header">
            <History size={16} />
            <span className="vc-title">{commits.length} commits</span>
          </div>

          <div className="vc-content flex-1 overflow-y-auto commit-list">
            {commits.length === 0 ? (
              <div className="empty-state">No commits yet</div>
            ) : (
              commits.map((commit) => {
                const isPreviewing = commit.sha === previewingSha;
                const isRestoring = commit.sha === restoringsha;

                return (
                  <div
                    key={commit.sha}
                    className={`commit-item${isPreviewing ? " selected-head" : ""}`}
                  >
                    <div className="commit-message" title={commit.message}>
                      {commit.message}
                    </div>
                    <div className="commit-meta">
                      <span className="commit-author">
                        <User size={10} /> {commit.author}
                      </span>
                      <span className="commit-date">
                        <Clock size={10} />
                        {new Date(commit.timestamp).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="commit-id">{commit.sha.slice(0, 7)}</div>
                    <div style={{ display: "flex", gap: "var(--brand-space-2)", marginTop: "var(--brand-space-2)" }}>
                      <button
                        className="bs-btn bs-btn-secondary"
                        style={{ flex: 1, fontSize: "var(--brand-text-xs)", padding: "2px 6px" }}
                        onClick={() => void handleView(commit)}
                        title="View this version (read-only)"
                      >
                        <Eye size={12} /> View
                      </button>
                      <button
                        className="bs-btn bs-btn-secondary"
                        style={{ flex: 1, fontSize: "var(--brand-text-xs)", padding: "2px 6px" }}
                        onClick={() => void handleRestore(commit)}
                        disabled={isRestoring}
                        title="Restore to this version (creates new commit)"
                      >
                        <RotateCcw size={12} /> {isRestoring ? "…" : "Restore"}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
