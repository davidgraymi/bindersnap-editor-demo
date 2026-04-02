import { useCallback, useEffect, useState } from 'react';

import type { GiteaClient } from '../../../packages/gitea-client/client';
import type { PullRequestWithApprovalState } from '../../../packages/gitea-client/pullRequests';
import type { DocTag } from '../../../packages/gitea-client/repos';
import type { UploadResult } from '../../../packages/gitea-client/uploads';
import { listPullRequests } from '../../../packages/gitea-client/pullRequests';
import { listDocTags } from '../../../packages/gitea-client/repos';
import { UploadModal } from './UploadModal';

interface DocumentDetailProps {
  giteaClient: GiteaClient;
  owner: string;
  repo: string;
  uploaderSlug: string;
  onBack: () => void;
}

function getApprovalStateBadgeClass(state: string): string {
  switch (state) {
    case 'approved':
      return 'vault-status-badge vault-status-approved';
    case 'changes_requested':
      return 'vault-status-badge vault-status-changes';
    case 'in_review':
      return 'vault-status-badge vault-status-review';
    case 'published':
      return 'vault-status-badge vault-status-published';
    default:
      return 'vault-status-badge vault-status-working';
  }
}

function getApprovalStateLabel(state: string): string {
  switch (state) {
    case 'approved':
      return 'Approved';
    case 'changes_requested':
      return 'Changes Requested';
    case 'in_review':
      return 'In Review';
    case 'published':
      return 'Published';
    default:
      return 'Working';
  }
}

function formatDocumentName(repoName: string): string {
  return repoName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatTimestamp(timestamp: string): string {
  if (!timestamp) return 'Unknown';

  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return 'Unknown';
  }
}

function buildRawFileUrl(
  giteaBaseUrl: string,
  owner: string,
  repo: string,
  ref: string,
  canonicalFile: string
): string {
  return `${giteaBaseUrl}/${owner}/${repo}/raw/${ref}/${canonicalFile}`;
}

export function DocumentDetail({ giteaClient, owner, repo, uploaderSlug, onBack }: DocumentDetailProps) {
  const [tags, setTags] = useState<DocTag[]>([]);
  const [openPRs, setOpenPRs] = useState<PullRequestWithApprovalState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const giteaBaseUrl =
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_GITEA_BASE_URL ?? 'http://localhost:3000';

  const loadDocumentData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [docTags, pullRequests] = await Promise.all([
        listDocTags(giteaClient, owner, repo),
        listPullRequests({
          client: giteaClient,
          owner,
          repo,
          state: 'open',
        }),
      ]);

      setTags(docTags);
      setOpenPRs(pullRequests);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load document details.';
      setError(message);
      setTags([]);
      setOpenPRs([]);
    } finally {
      setIsLoading(false);
    }
  }, [giteaClient, owner, repo]);

  useEffect(() => {
    void loadDocumentData();
  }, [loadDocumentData]);

  const latestTag = tags.length > 0 ? tags[0] : null;
  const canonicalFileName = `${repo}.pdf`;
  const nextVersion = (latestTag?.version ?? 0) + 1;

  const handleUploadSuccess = (result: UploadResult) => {
    setShowUploadModal(false);
    void loadDocumentData();
  };

  if (isLoading) {
    return (
      <div className="vault-detail">
        <button className="bs-btn bs-btn-secondary" type="button" onClick={onBack}>
          ← Back to workspace
        </button>

        <div className="bs-card vault-empty-state">
          <div className="bs-eyebrow">Loading</div>
          <h2>Loading document details...</h2>
          <p>Fetching version history and pending reviews from Gitea.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="vault-detail">
        <button className="bs-btn bs-btn-secondary" type="button" onClick={onBack}>
          ← Back to workspace
        </button>

        <div className="bs-card vault-error-state">
          <div className="bs-eyebrow">Error</div>
          <h2>Unable to load document</h2>
          <p>{error}</p>
          <button className="bs-btn bs-btn-primary" type="button" onClick={() => void loadDocumentData()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vault-detail">
      <button className="bs-btn bs-btn-secondary" type="button" onClick={onBack}>
        ← Back to workspace
      </button>

      <section className="vault-section">
        <div className="bs-eyebrow">Document Detail</div>
        <h1>{formatDocumentName(repo)}</h1>
        <p className="vault-repo-path">
          {owner}/{repo}
        </p>
      </section>

      <section className="bs-card vault-section">
        <div className="bs-eyebrow">Current Version</div>
        <h2>{latestTag ? `Version ${latestTag.version}` : 'Unpublished'}</h2>
        {latestTag ? (
          <>
            <p>
              Published on {formatTimestamp(latestTag.created)} (tag: <code>{latestTag.name}</code>)
            </p>
            <a
              className="bs-btn bs-btn-secondary"
              href={buildRawFileUrl(giteaBaseUrl, owner, repo, 'main', canonicalFileName)}
              download
              target="_blank"
              rel="noopener noreferrer"
            >
              Download Current Version
            </a>
          </>
        ) : (
          <p>No published version exists yet. Publish your first version to begin tracking releases.</p>
        )}
        <button className="bs-btn bs-btn-primary" type="button" onClick={() => setShowUploadModal(true)}>
          Upload New Version
        </button>
      </section>

      {openPRs.length > 0 ? (
        <section className="bs-card vault-section">
          <div className="bs-eyebrow">Pending Reviews</div>
          <h2>{openPRs.length} Open Pull Request{openPRs.length === 1 ? '' : 's'}</h2>
          <div className="vault-pr-list">
            {openPRs.map((pr) => (
              <div className="vault-pr-item" key={pr.number}>
                <h3 className="vault-pr-title">
                  #{pr.number}: {pr.title}
                </h3>
                <div className="vault-pr-meta">
                  <span className={getApprovalStateBadgeClass(pr.approvalState)}>
                    {getApprovalStateLabel(pr.approvalState)}
                  </span>
                  {pr.head?.ref ? <span className="vault-pr-branch">{pr.head.ref}</span> : null}
                </div>
                {pr.body ? <p className="vault-pr-body">{pr.body}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="bs-card vault-section">
          <div className="bs-eyebrow">Pending Reviews</div>
          <h2>No pending reviews</h2>
          <p>All changes have been published. Upload a new version to start a review.</p>
        </section>
      )}

      <section className="bs-card vault-section">
        <div className="bs-eyebrow">Version History</div>
        <h2>Published Versions</h2>
        {tags.length > 0 ? (
          <div className="vault-version-list">
            {tags.map((tag) => (
              <div className="vault-version-item" key={tag.name}>
                <div className="vault-version-header">
                  <span className="vault-version-badge">v{tag.version}</span>
                  <span className="vault-version-date">{formatTimestamp(tag.created)}</span>
                </div>
                <p className="vault-version-sha">
                  Commit: <code>{tag.sha.slice(0, 7)}</code>
                </p>
                <a
                  className="bs-btn bs-btn-secondary vault-version-download"
                  href={buildRawFileUrl(giteaBaseUrl, owner, repo, tag.name, canonicalFileName)}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download v{tag.version}
                </a>
              </div>
            ))}
          </div>
        ) : (
          <p>No published versions yet.</p>
        )}
      </section>

      {showUploadModal && (
        <UploadModal
          giteaClient={giteaClient}
          owner={owner}
          repo={repo}
          docSlug={repo}
          uploaderSlug={uploaderSlug}
          nextVersion={nextVersion}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
}
