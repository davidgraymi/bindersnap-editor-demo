import { useState } from "react";
import { Download, FileText } from "lucide-react";

import type { RepoBranchProtection } from "../api";
import { publishDocument, submitDocumentReview } from "../api";
import type { ChangeRecord } from "../documentDisplay";
import {
  capitalizeFirst,
  describeApprovalProgress,
  describeChangeOutcome,
  formatDate,
  getChangeStateBadgeClass,
  getChangeStateLabel,
} from "../documentDisplay";
import { ApprovalMeter } from "./ApprovalMeter";
import type { DocumentChangeView } from "../routes";
import { ChangeReviewers } from "./ChangeReviewers";
import { DocumentPreview } from "./DocumentPreview";
import { ReviewDiscussion } from "./ReviewDiscussion";

interface DocumentChangeDetailProps {
  owner: string;
  repo: string;
  currentUser: string;
  isAnonymous: boolean;
  change: ChangeRecord;
  /** Which half of the page is showing: the conversation or the file. */
  view: DocumentChangeView;
  branchProtection: RepoBranchProtection | null;
  blockOnUnresolvedThreads: boolean;
  /** Whether this reader may set the assignee and the reviewer list. */
  canManageAssignments: boolean;
  nextVersion: number;
  documentName: string;
  /** Canonical file name, so the proposed version can be previewed and saved. */
  fileName: string | null;
  /** Set while this change's file is being fetched for download. */
  downloading: boolean;
  onDownload: (gitRef: string, loaded?: Blob | null) => void;
  onChanged: () => void | Promise<void>;
  onViewChange: (view: DocumentChangeView) => void;
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
  prAuthor: string,
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
 * The decision gets made in the conversation, so the conversation is the page:
 * the discussion, the reviews, and the two buttons that end it. The file being
 * proposed is one click away on its own screen rather than a wall of preview
 * the reader has to scroll past to reach the argument about it.
 */
export function DocumentChangeDetail({
  owner,
  repo,
  currentUser,
  isAnonymous,
  change,
  view,
  branchProtection,
  blockOnUnresolvedThreads,
  canManageAssignments,
  nextVersion,
  documentName,
  fileName,
  downloading,
  onDownload,
  onChanged,
  onViewChange,
  onBackToList,
}: DocumentChangeDetailProps) {
  const [actionState, setActionState] = useState<PRActionState>(
    DEFAULT_PR_ACTION_STATE,
  );
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  // Who is still holding a thread open. The reviewer list needs it to tell a
  // reviewer who is done from one who raised a concern and never closed it,
  // and the discussion has already paid for the data.
  const [openThreadAuthors, setOpenThreadAuthors] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());

  const prNum = change.number;
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
      // Publishing ends the review, so the page it happened on is finished
      // too. The index confirms it: nothing is waiting on a decision.
      onBackToList();
    } catch (err) {
      updateActionState({
        status: "error",
        error: readActionError(err, "Failed to publish document."),
      });
    }
  }

  const reviewPerms = canUserReview(
    currentUser,
    change.submittedBy,
    branchProtection,
  );
  const mergePerms = canUserMerge(currentUser, branchProtection);
  const mergeReady = change.open && change.approvalState === "approved";
  // The server enforces this too; the disabled button just avoids a pointless
  // round trip that ends in a 409.
  const threadsBlockPublish = blockOnUnresolvedThreads && unresolvedCount > 0;
  const ownSubmission = currentUser === change.submittedBy;
  const submitter = capitalizeFirst(change.submittedBy || "someone");
  const submittedDate = change.submittedAt
    ? formatDate(change.submittedAt)
    : null;
  const reviewRef = change.branchName;
  const outcome = describeChangeOutcome(change);
  const canDecide = change.open && !isAnonymous;
  // The approval count replaces "awaiting approval" and nothing else: a
  // request for changes, or the way a closed change ended, still needs saying.
  const showStateBadge =
    !change.open ||
    change.approvalState === "changes_requested" ||
    describeApprovalProgress(change) === null;

  return (
    <article className="change-detail">
      <header className="change-detail-header">
        <div className="change-detail-heading">
          <h2 className="change-detail-title">
            {change.summary}
            <span className="change-detail-number">#{prNum}</span>
          </h2>
          {/* An open change is described by how far through approval it is,
              not by the word "awaiting" — but a reviewer asking for work
              still outranks the count, and a closed change is only its
              outcome. */}
          <span className="change-detail-state">
            {showStateBadge ? (
              <span className={getChangeStateBadgeClass(change)}>
                {getChangeStateLabel(change)}
              </span>
            ) : null}
            {change.open ? (
              <ApprovalMeter
                approvalCount={change.approvalCount}
                requiredApprovals={change.requiredApprovals}
                size="detail"
              />
            ) : null}
          </span>
        </div>
        <p className="change-detail-meta">
          Submitted by {submitter}
          {submittedDate ? ` on ${submittedDate}` : ""}
          {change.open ? ` · becomes v${nextVersion} when published` : ""}
        </p>

        <nav className="change-views" aria-label="Change views">
          <button
            className={`change-view-tab${view === "discussion" ? " change-view-tab--active" : ""}`}
            type="button"
            aria-current={view === "discussion" ? "page" : undefined}
            onClick={() => onViewChange("discussion")}
          >
            Discussion
          </button>
          <button
            className={`change-view-tab${view === "preview" ? " change-view-tab--active" : ""}`}
            type="button"
            aria-current={view === "preview" ? "page" : undefined}
            onClick={() => onViewChange("preview")}
          >
            Preview
          </button>
        </nav>
      </header>

      {outcome ? (
        <p className="change-outcome-banner" role="status">
          {outcome}
        </p>
      ) : null}

      {view === "preview" ? (
        <section className="change-file-view">
          {reviewRef ? (
            <>
              <p className="change-detail-section-note">
                The file exactly as submitted, read from{" "}
                <code>{reviewRef}</code>.
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
              This change has no branch on record, so the submitted file cannot
              be shown.
            </p>
          )}
        </section>
      ) : (
        <>
          {reviewRef ? (
            <div className="change-file-strip">
              <FileText size={15} strokeWidth={1.5} aria-hidden="true" />
              <span className="change-file-strip-name">
                {fileName ?? "The submitted file"}
              </span>
              <span className="change-file-strip-spacer" />
              <button
                className="bs-btn bs-btn-secondary change-file-strip-btn"
                type="button"
                onClick={() => onViewChange("preview")}
              >
                Preview
              </button>
              <button
                className="bs-btn bs-btn-secondary change-file-strip-btn"
                type="button"
                disabled={downloading || !fileName}
                onClick={() => onDownload(reviewRef, null)}
              >
                <Download size={14} strokeWidth={1.5} aria-hidden="true" />
                {downloading ? "Downloading…" : "Download"}
              </button>
            </div>
          ) : null}

          <ChangeReviewers
            owner={owner}
            repo={repo}
            pullNumber={prNum}
            submittedBy={change.submittedBy}
            assignee={change.assignee}
            reviewers={change.reviewers}
            approvalCount={change.approvalCount}
            requiredApprovals={change.requiredApprovals}
            openThreadAuthors={openThreadAuthors}
            canManage={canManageAssignments && change.open}
            onChanged={onChanged}
          />

          <ReviewDiscussion
            owner={owner}
            repo={repo}
            pullNumber={prNum}
            opening={{
              author: change.submittedBy,
              at: change.submittedAt,
              body: change.description,
            }}
            reviews={change.reviews}
            closing={
              change.outcome
                ? {
                    kind: change.outcome,
                    actor: change.decidedBy,
                    at: change.closedAt,
                    publishedVersion: change.publishedVersion,
                  }
                : null
            }
            canParticipate={!isAnonymous}
            blockOnUnresolvedThreads={blockOnUnresolvedThreads}
            onSummaryChange={(next) => {
              setUnresolvedCount((prev) =>
                prev === next.unresolvedCount ? prev : next.unresolvedCount,
              );
              setOpenThreadAuthors((prev) => {
                const authors = new Set(
                  next.threads
                    .filter((thread) => !thread.resolved)
                    .map((thread) => thread.comments[0]?.author.login ?? "")
                    .filter(Boolean),
                );
                // Identity churn here would re-render the reviewer list on
                // every poll, so a set that says the same thing stays the
                // same set.
                if (
                  authors.size === prev.size &&
                  [...authors].every((login) => prev.has(login))
                ) {
                  return prev;
                }
                return authors;
              });
            }}
          />

          {change.open && ownSubmission ? (
            <p className="vault-pr-own-notice">
              ℹ You submitted this version — waiting on other reviewers to
              approve.
            </p>
          ) : canDecide && reviewPerms.allowed ? (
            <section className="change-detail-decision">
              <h3 className="change-detail-section-title">Your decision</h3>
              <div className="vault-pr-actions">
                {actionState.showApproveConfirm ? (
                  <div className="vault-pr-confirm">
                    <p className="vault-pr-confirm-heading">
                      Approve version {nextVersion} of {documentName}?
                    </p>
                    <p className="vault-pr-confirm-sub">
                      This approval will be recorded with your name and
                      timestamp.
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
                    onClick={() =>
                      updateActionState({ showApproveConfirm: true })
                    }
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
          ) : canDecide && reviewPerms.reason ? (
            <p className="vault-pr-notice">{reviewPerms.reason}</p>
          ) : null}

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
        </>
      )}
    </article>
  );
}
