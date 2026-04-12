export function ActivityLogPage() {
  return (
    <div className="activity-page">
      <div className="activity-header">
        <div className="bs-eyebrow">Activity Log</div>
        <h1 className="activity-heading">Activity Log</h1>
      </div>
      <div className="bs-card activity-placeholder">
        <p className="activity-placeholder-body">
          This page will show a chronological audit trail of all document
          activity — approvals, submissions, change requests, and publications.
        </p>
        <p className="activity-placeholder-body">
          Export as PDF will let you attach a formatted audit report to a
          compliance review.
        </p>
        <div className="activity-coming-soon">
          <span className="vault-status-badge vault-status-working">
            Coming soon
          </span>
        </div>
      </div>
    </div>
  );
}
