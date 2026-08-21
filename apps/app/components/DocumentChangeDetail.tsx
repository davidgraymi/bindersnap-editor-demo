import { useState } from "react";
import { ChevronLeft } from "lucide-react";

import type {
  PullRequestWithApprovalState,
  RepoBranchProtection,
} from "../api";
import { publishDocument, submitDocumentReview } from "../api";
import {
  capitalizeFirst,
  formatDate,
  getApprovalStateBadgeClass,
  getApprovalStateLabel,
  parseSubmissionSummary,
} from "../documentDisplay";
import { DocumentPreview } from "./DocumentPreview";
import { ReviewDiscussion } from "./ReviewDiscussion";

interface DocumentChangeDetailProps {
  owner: string;
  repo: string;
  currentUser: string;
  isAnonymous: boolean;
  pullRequest: PullRequestWithApprovalState;
  branchProtection: RepoBranchProtection | null;
  blockOnUnresolvedThreads: boolean;
  nextVersion: number;
  documentName: string;
  /** Canonical file name, so the proposed version can be previewed and saved. */
  fileName: string | null;
  /** Set while this change's file is being fetched for download. */
  downloading: boolean;
  onDownload: (gitRef: string, loaded?: Blob | null) => void;
  onChanged: () => void | Promise<void>;
  onBackToList: () => void;
}

interface PRActionState {
  status: "idle" | "submitting" | "error";
  error: string | null;
  changesComment: string;
  showChangesForm: boolean;
  showApproveConfirm: boolean;
}

const DEFAULT_PR_ACTION_STATE: PRActionState = {
  status: "idle",
  error: null,
  changesComment: "",
  showChangesForm: false,
  showApproveConfirm: false,
};

function readActionError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function canUserReview(
  currentUser: string,
  prAuthor: string | undefined,
  protection: RepoBranchProtection | null,
): { allowed: boolean; reason: string | null } {
  if (currentUser === prAuthor) {
    // Rendered separately as a callout, not as a denial.
    return { allowed: false, reason: null };
  }
  if (
    protection?.enableApprovalsWhitelist &&
    protection.approvalsWhitelistUsernames.length > 0 &&
    !protection.approvalsWhitelistUsernames.includes(currentUser)
  ) {
    return {
      allowed: false,
      reason: "Your account is not authorized to approve this document.",
    };
  }
  return { allowed: true, reason: null };
}

function canUserMerge(
  currentUser: string,
  protection: RepoBranchProtection | null,
): { allowed: boolean; reason: string | null } {
  if (
    protection?.enableMergeWhitelist &&
    protection.mergeWhitelistUsernames.length > 0 &&
    !protection.mergeWhitelistUsernames.includes(currentUser)
  ) {
    return {
      allowed: false,
      reason: "Your account is not authorized to publish this document.",
    };
  }
  return { allowed: true, reason: null };
}

/**
 * One change, on its own page.
 *
 * You cannot sign off on something you have not read, so the proposed file is
 * the body of the page — previewed inline and downloadable — with the decision
 * and the discussion beneath it.
 */
export function DocumentChangeDetail({
  owner,
  repo,
  currentUser,
  isAnonymous,
  pullRequest,
  branchProtection,
  blockOnUnresolvedThreads,
  nextVersion,
  documentName,
  fileName,
  downloading,
  onDownload,
  onChanged,
  onBackToList,
}: DocumentChangeDetailProps) {
  const [actionState, setActionState] = useState<PRActionState>(
    DEFAULT_PR_ACTION_STATE,
  );
  const [unresolvedCount, setUnresolvedCount] = useState(0);

  const prNum = pullRequest.number ?? 0;
  const isSubmitting = actionState.status === "submitting";

  function updateActionState(update: Partial<PRActionState>) {
    setActionState((prev) => ({ ...prev, ...update }));
  }

  async function handleApprove() {
    updateActionState({ status: "submitting", error: null });
    try {
      await submitDocumentReview(owner, repo, prNum, "APPROVE", "APPROVED");
      updateActionState({ status: "idle" });
      await onChanged();
    } catch (err) {
      updateActionState({
        status: "error",
        error: readActionError(err, "Failed to submit approval."),
      });
    }
  }

  async function handleRequestChanges() {
    const comment = actionState.changesComment.trim();
    if (!comment) {
      updateActionState({
        error: "Enter a comment describing the required changes.",
      });
      return;
    }
    updateActionState({ status: "submitting", error: null });
    try {
      await submitDocumentReview(
        owner,
        repo,
        prNum,
        "REQUEST_CHANGES",
        comment,
      );
      updateActionState({
        status: "idle",
        showChangesForm: false,
        changesComment: "",
      });
      await onChanged();
    } catch (err) {
      updateActionState({
        status: "error",
        error: readActionError(err, "Failed to request changes."),
      });
    }
  }

  async function handlePublish() {
    updateActionState({ status: "submitting", error: null });
    try {
      await publishDocument(owner, repo, prNum, nextVersion);
      updateActionState({ status: "idle" });
      await onChanged();
    } catch (err) {
      updateActionState({
        status: "error",
        error: readActionError(err, "Failed to publish document."),
      });
    }
  }

  const reviewPerms = canUserReview(
    currentUser,
    pullRequest.user?.login,
    branchProtection,
  );
  const mergePerms = canUserMerge(currentUser, branchProtection);
  const mergeReady = pullRequest.approvalState === "approved";
  // The server enforces this too; the disabled button just avoids a pointless
  // round trip that ends in a 409.
  const threadsBlockPublish = blockOnUnresolvedThreads && unresolvedCount > 0;
  const ownSubmission = currentUser === pullRequest.user?.login;
  const summary = parseSubmissionSummary(pullRequest.body);
  const submitter = pullRequest.user?.login
    ? capitalizeFirst(pullRequest.user.login)
    : "Someone";
  const submittedDate = pullRequest.created_at
    ? formatDate(pullRequest.created_at)
    : null;
  const reviewRef = pullRequest.branchName?.trim() || null;

  return (
    <article className="change-detail">
      <header className="change-detail-header">
        <button
          className="change-detail-back"
          type="button"
          onClick={onBackToList}
        >
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          All changes
        </button>
        <div className="change-detail-heading">
          <h2 className="change-detail-title">
            {summary ?? `Submitted by ${submitter}`}
            <span className="change-detail-number">#{prNum}</span>
          </h2>
          <span
            className={getApprovalStateBadgeClass(pullRequest.approvalState)}
          >
            {getApprovalStateLabel(pullRequest.approvalState)}
          </span>
        </div>
        <p className="change-detail-meta">
          Submitted by {submitter}
          {submittedDate ? ` on ${submittedDate}` : ""} · Becomes v{nextVersion}{" "}
          when published
        </p>
      </header>

      <section className="change-detail-material">
        <h3 className="change-detail-section-title">
          The version under review
        </h3>
        {reviewRef ? (
          <>
            <p className="change-detail-section-note">
              The file exactly as submitted, read from <code>{reviewRef}</code>.
              Read it here or download it before you decide.
            </p>
            <DocumentPreview
              owner={owner}
              repo={repo}
              gitRef={reviewRef}
              fileName={fileName}
              downloading={downloading}
              onDownload={(loaded) => onDownload(reviewRef, loaded)}
            />
          </>
        ) : (
          <p className="vault-pr-notice">
            This change has no branch on record, so the submitted file cannot be
            shown here.
          </p>
        )}
      </section>

      {ownSubmission ? (
        <p className="vault-pr-own-notice">
          ℹ You submitted this version — waiting on other reviewers to approve.
        </p>
      ) : reviewPerms.allowed ? (
        <section className="change-detail-decision">
          <h3 className="change-detail-section-title">Your decision</h3>
          <div className="vault-pr-actions">
            {actionState.showApproveConfirm ? (
              <div className="vault-pr-confirm">
                <p className="vault-pr-confirm-heading">
                  Approve version {nextVersion} of {documentName}?
                </p>
                <p className="vault-pr-confirm-sub">
                  This approval will be recorded with your name and timestamp.
                </p>
                <div className="vault-pr-confirm-actions">
                  <button
                    className="bs-btn bs-btn-primary"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      updateActionState({ showApproveConfirm: false });
                      void handleApprove();
                    }}
                  >
                    {isSubmitting ? "Submitting…" : "Confirm Approval"}
                  </button>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      updateActionState({ showApproveConfirm: false })
                    }
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="bs-btn bs-btn-primary"
                type="button"
                disabled={isSubmitting}
                onClick={() => updateActionState({ showApproveConfirm: true })}
              >
                Approve
              </button>
            )}

            {actionState.showChangesForm ? (
              <div className="vault-pr-comment-form">
                <textarea
                  className="vault-pr-comment-input"
                  placeholder="Describe what needs to change…"
                  value={actionState.changesComment}
                  rows={3}
                  disabled={isSubmitting}
                  onChange={(e) =>
                    updateActionState({
                      changesComment: e.target.value,
                      error: null,
                    })
                  }
                />
                <div className="vault-pr-comment-actions">
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleRequestChanges()}
                  >
                    {isSubmitting ? "Submitting…" : "Send Feedback"}
                  </button>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      updateActionState({
                        showChangesForm: false,
                        changesComment: "",
                        error: null,
                      })
                    }
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="bs-btn bs-btn-secondary"
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  updateActionState({ showChangesForm: true, error: null })
                }
              >
                Request Changes
              </button>
            )}
          </div>
        </section>
      ) : reviewPerms.reason ? (
        <p className="vault-pr-notice">{reviewPerms.reason}</p>
      ) : null}

      <ReviewDiscussion
        owner={owner}
        repo={repo}
        pullNumber={prNum}
        canParticipate={!isAnonymous}
        blockOnUnresolvedThreads={blockOnUnresolvedThreads}
        onSummaryChange={(next) =>
          setUnresolvedCount((prev) =>
            prev === next.unresolvedCount ? prev : next.unresolvedCount,
          )
        }
      />

      {mergePerms.allowed && mergeReady ? (
        <div className="vault-pr-actions">
          <button
            className="bs-btn bs-btn-primary vault-pr-publish-btn"
            type="button"
            disabled={isSubmitting || threadsBlockPublish}
            title={
              threadsBlockPublish
                ? "Resolve every discussion thread before publishing."
                : undefined
            }
            onClick={() => void handlePublish()}
          >
            {isSubmitting ? "Publishing…" : "Publish as Official Version"}
          </button>
        </div>
      ) : mergeReady && !mergePerms.allowed ? (
        <p className="vault-pr-notice">{mergePerms.reason}</p>
      ) : null}

      {actionState.error ? (
        <p className="vault-pr-error" role="alert">
          {actionState.error}
        </p>
      ) : null}
    </article>
  );
}
