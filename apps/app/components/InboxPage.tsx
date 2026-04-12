import { useEffect, useState } from "react";
import { getWorkspaceDocuments } from "../api";
import type { WorkspaceDocumentSummary } from "../api";

export interface InboxPageProps {
  currentUsername: string;
  onSelectDocument: (owner: string, repo: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 2) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function humanizeRepoName(repoName: string): string {
  return repoName
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function InboxPage({
  currentUsername,
  onSelectDocument,
}: InboxPageProps) {
  const [documents, setDocuments] = useState<WorkspaceDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    getWorkspaceDocuments()
      .then((docs) => {
        if (!cancelled) {
          setDocuments(docs);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Unable to load inbox.",
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="inbox-page">
        <div className="bs-eyebrow">Inbox</div>
        <p className="inbox-loading">Loading your inbox...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="inbox-page">
        <div className="bs-eyebrow">Inbox</div>
        <p className="inbox-error">{error}</p>
      </div>
    );
  }

  // "Needs Your Review": in_review PRs not submitted by the current user
  const needsReview: Array<{
    doc: WorkspaceDocumentSummary;
    prCreatedAt: string;
    prSubmitter: string;
  }> = [];

  // "Waiting on Others": in_review PRs submitted by the current user
  const waitingOnOthers: Array<{
    doc: WorkspaceDocumentSummary;
    prCreatedAt: string;
  }> = [];

  // "Recently Approved": docs with a latestTag and no pending PRs (max 5)
  const recentlyApproved: WorkspaceDocumentSummary[] = [];

  for (const doc of documents) {
    const inReviewPRs = doc.pendingPRs.filter(
      (pr) => pr.approvalState === "in_review",
    );

    if (inReviewPRs.length === 0) {
      if (doc.latestTag) {
        recentlyApproved.push(doc);
      }
      continue;
    }

    for (const pr of inReviewPRs) {
      const submitter = pr.user?.login ?? "";
      if (submitter !== currentUsername) {
        needsReview.push({
          doc,
          prCreatedAt: pr.created_at ?? "",
          prSubmitter: submitter,
        });
      } else {
        waitingOnOthers.push({
          doc,
          prCreatedAt: pr.created_at ?? "",
        });
      }
    }
  }

  // Sort Needs Your Review — newest first
  needsReview.sort(
    (a, b) =>
      new Date(b.prCreatedAt).getTime() - new Date(a.prCreatedAt).getTime(),
  );

  const recentlyApprovedSlice = recentlyApproved.slice(0, 5);

  const totalAttention = needsReview.length + waitingOnOthers.length;
  const allClear =
    needsReview.length === 0 &&
    waitingOnOthers.length === 0 &&
    recentlyApprovedSlice.length === 0;

  return (
    <div className="inbox-page">
      <div className="inbox-header">
        <div className="bs-eyebrow">Inbox</div>
        <h1 className="inbox-heading">
          {allClear
            ? "All clear"
            : totalAttention > 0
              ? `Your attention is needed on ${totalAttention} ${totalAttention === 1 ? "document" : "documents"}.`
              : "Nothing urgent right now."}
        </h1>
      </div>

      {allClear ? (
        <div className="bs-card inbox-all-clear">
          <p className="inbox-all-clear-text">
            You're all caught up. No documents need your attention right now.
          </p>
        </div>
      ) : (
        <div className="inbox-sections">
          {needsReview.length > 0 ? (
            <section className="inbox-section">
              <div className="inbox-section-rule">
                <span className="inbox-section-label">Needs Your Review</span>
              </div>
              <div className="inbox-section-items">
                {needsReview.map(({ doc, prCreatedAt, prSubmitter }) => (
                  <div
                    key={`${doc.repo.owner?.login ?? ""}/${doc.repo.name}`}
                    className="bs-card inbox-item inbox-item--review"
                  >
                    <div className="inbox-item-body">
                      <p className="inbox-item-title">
                        {humanizeRepoName(doc.repo.name)}
                        {doc.latestTag ? (
                          <span className="inbox-item-version">
                            {" "}
                            — {doc.latestTag.name}
                          </span>
                        ) : null}
                      </p>
                      <p className="inbox-item-meta">
                        Submitted by {prSubmitter || "unknown"}
                        {prCreatedAt
                          ? ` · ${formatRelativeTime(prCreatedAt)}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="bs-btn bs-btn-primary inbox-review-btn"
                      onClick={() =>
                        onSelectDocument(
                          doc.repo.owner?.login ?? "",
                          doc.repo.name,
                        )
                      }
                    >
                      Review Now →
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {waitingOnOthers.length > 0 ? (
            <section className="inbox-section">
              <div className="inbox-section-rule">
                <span className="inbox-section-label">Waiting on Others</span>
              </div>
              <div className="inbox-section-items">
                {waitingOnOthers.map(({ doc, prCreatedAt }) => (
                  <div
                    key={`${doc.repo.owner?.login ?? ""}/${doc.repo.name}`}
                    className="bs-card inbox-item inbox-item--waiting"
                  >
                    <div className="inbox-item-body">
                      <p className="inbox-item-title">
                        {humanizeRepoName(doc.repo.name)}
                        {doc.latestTag ? (
                          <span className="inbox-item-version">
                            {" "}
                            — {doc.latestTag.name}
                          </span>
                        ) : null}
                      </p>
                      {prCreatedAt ? (
                        <p className="inbox-item-meta">
                          Submitted {formatRelativeTime(prCreatedAt)}
                        </p>
                      ) : null}
                    </div>
                    <span className="vault-status-badge vault-status-review inbox-status-text">
                      Awaiting approval
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {recentlyApprovedSlice.length > 0 ? (
            <section className="inbox-section">
              <div className="inbox-section-rule">
                <span className="inbox-section-label">Recently Approved</span>
              </div>
              <div className="inbox-section-items">
                {recentlyApprovedSlice.map((doc) => (
                  <div
                    key={`${doc.repo.owner?.login ?? ""}/${doc.repo.name}`}
                    className="bs-card inbox-item inbox-item--approved"
                  >
                    <div className="inbox-item-body">
                      <p className="inbox-item-title">
                        {humanizeRepoName(doc.repo.name)}
                        {doc.latestTag ? (
                          <span className="inbox-item-version">
                            {" "}
                            — {doc.latestTag.name}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <span className="vault-status-badge vault-status-approved inbox-status-text">
                      Current version
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
