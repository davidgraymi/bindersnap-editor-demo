export function ActivityLogPage() {
  return (
    <div className="activity-page app-page-shell">
      <div className="activity-header">
        <div className="bs-eyebrow">Audit Trail</div>
        <h1 className="activity-heading">Activity</h1>
        <p className="activity-subtitle">
          Every submission, approval, change request, and publication will land
          here in one chronological record.
        </p>
      </div>

      <div className="activity-preview-grid">
        <div className="activity-preview-card">
          <span className="activity-preview-label">Soon</span>
          <strong className="activity-preview-value">Approval feed</strong>
          <p className="activity-preview-copy">
            See exactly who signed off, who requested changes, and when each
            version became the official record.
          </p>
        </div>
        <div className="activity-preview-card">
          <span className="activity-preview-label">Exports</span>
          <strong className="activity-preview-value">Audit packets</strong>
          <p className="activity-preview-copy">
            Bundle a clean timeline into a review-ready report for compliance
            checks and external audits.
          </p>
        </div>
      </div>

      <div className="bs-card activity-placeholder">
        <div className="activity-placeholder-head">
          <div>
            <div className="bs-eyebrow">Timeline</div>
            <h2 className="activity-placeholder-title">
              The audit trail is on deck
            </h2>
          </div>
          <div className="activity-coming-soon">
            <span className="vault-status-badge vault-status-working">
              Coming soon
            </span>
          </div>
        </div>
        <p className="activity-placeholder-body">
          This page will show a chronological audit trail of all document
          activity across the workspace.
        </p>
        <div className="activity-placeholder-list" aria-label="Planned events">
          <div className="activity-placeholder-item">
            <span className="activity-placeholder-item-title">
              Submission opened
            </span>
            <span className="activity-placeholder-item-copy">
              Track who uploaded a new draft and when review started.
            </span>
          </div>
          <div className="activity-placeholder-item">
            <span className="activity-placeholder-item-title">
              Approval recorded
            </span>
            <span className="activity-placeholder-item-copy">
              Capture reviewer identity, timestamp, and document version.
            </span>
          </div>
          <div className="activity-placeholder-item">
            <span className="activity-placeholder-item-title">
              Official version published
            </span>
            <span className="activity-placeholder-item-copy">
              Mark when a reviewed document became the record of reference.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
