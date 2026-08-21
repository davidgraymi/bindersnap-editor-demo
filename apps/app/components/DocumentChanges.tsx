import { GitPullRequest } from "lucide-react";

import type { PullRequestWithApprovalState } from "../api";
import {
  capitalizeFirst,
  formatDate,
  getApprovalStateBadgeClass,
  getApprovalStateLabel,
  parseSubmissionSummary,
} from "../documentDisplay";

interface DocumentChangesProps {
  isAnonymous: boolean;
  openPullRequests: PullRequestWithApprovalState[];
  nextVersion: number;
  onOpenChange: (pullNumber: number) => void;
  onSubmitVersion: () => void;
}

/**
 * The index of everything waiting on a decision.
 *
 * A list, not a stack of open reviews: each change gets its own page, so
 * reaching #3 never means scrolling past #4 through #10.
 */
export function DocumentChanges({
  isAnonymous,
  openPullRequests,
  nextVersion,
  onOpenChange,
  onSubmitVersion,
}: DocumentChangesProps) {
  if (openPullRequests.length === 0) {
    return (
      <section className="bs-card doc-empty">
        <h2>No pending approvals</h2>
        <p>
          Nothing is waiting on a decision. Every version has been published or
          withdrawn.
        </p>
        {!isAnonymous ? (
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            onClick={onSubmitVersion}
          >
            Submit New Version
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="change-list" aria-label="Open changes">
      <header className="change-list-header">
        <h2 className="change-list-title">
          {openPullRequests.length} change
          {openPullRequests.length === 1 ? "" : "s"} waiting on a decision
        </h2>
        <p className="change-list-note">
          Open one to read the submitted file, download it, and record your
          decision.
        </p>
      </header>

      <ul className="change-list-rows">
        {openPullRequests.map((pr) => {
          const prNum = pr.number ?? 0;
          const submitter = pr.user?.login
            ? capitalizeFirst(pr.user.login)
            : "Someone";
          const submittedDate = pr.created_at
            ? formatDate(pr.created_at)
            : null;

          return (
            <li className="change-row" key={prNum}>
              <button
                className="change-row-btn"
                type="button"
                onClick={() => onOpenChange(prNum)}
              >
                <GitPullRequest
                  className="change-row-icon"
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="change-row-main">
                  <span className="change-row-title">
                    {parseSubmissionSummary(pr.body) ??
                      `Submitted by ${submitter}`}
                  </span>
                  <span className="change-row-meta">
                    #{prNum} · Submitted by {submitter}
                    {submittedDate ? ` on ${submittedDate}` : ""} · Becomes v
                    {nextVersion} when published
                  </span>
                </span>
                <span className={getApprovalStateBadgeClass(pr.approvalState)}>
                  {getApprovalStateLabel(pr.approvalState)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
