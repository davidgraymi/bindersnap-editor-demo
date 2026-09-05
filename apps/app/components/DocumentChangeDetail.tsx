import { useCallback, useEffect, useState } from "react";
import { Download, FileText, GitCompare } from "lucide-react";

import type { ChangeUpdate, RepoBranchProtection } from "../api";
import {
  downloadDocument,
  listChangeUpdates,
  publishDocument,
  submitDocumentReview,
} from "../api";
import {
  buildProposedVersionFacts,
  describeChangeBody,
  describeChangeOpening,
  resolveReviewDecision,
} from "../changeReview";
import type { ComparisonBase } from "../documentComparison";
import type { ChangeRecord } from "../documentDisplay";
import {
  describeChangeOutcome,
  getChangeStateBadgeClass,
  getChangeStateLabel,
} from "../documentDisplay";
import type { DocumentChangeView } from "../routes";
import { ChangeReviewers } from "./ChangeReviewers";
import { DocumentComparison } from "./DocumentComparison";
import { DocumentPreview } from "./DocumentPreview";
import { ReviewTimeline } from "./ReviewTimeline";

interface DocumentChangeDetailProps {
  owner: string;
  repo: string;
  currentUser: string;
  isAnonymous: boolean;
  change: ChangeRecord;
  /**
   * Which screen is showing: the conversation, the proposed file, or that file
   * against the version it replaces.
   */
  view: DocumentChangeView;
  branchProtection: RepoBranchProtection | null;
  blockOnUnresolvedThreads: boolean;
  /** Whether this reader may set the reviewer list. */
  canManageAssignments: boolean;
  nextVersion: number;
  documentName: string;
  /** Canonical file name, so the proposed version can be previewed and saved. */
  fileName: string | null;
  /**
   * The published version this change is read against, or null when there is
   * none — the first version of a document replaces nothing.
   */
  comparisonBase: ComparisonBase | null;
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

/** Beyond this many, a row of pips is a smear rather than a count. */
const MAX_APPROVAL_BARS = 8;

function readActionError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function canUserReview(
  currentUser: string,
  prAuthor: string,
  protection: RepoBranchProtection | null,
): { allowed: boolean; reason: string | null } {
  if (currentUser === prAuthor) {
    // Rendered separately as a note, not as a denial.
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
 * How far through approval this change is, as a row of bars.
 *
 * "Awaiting review" counted nothing: one sign-off short and three short read
 * identically. Bars say it without being read at all, and the count under them
 * says it exactly. Who is holding it up is the reviewers row's job, right
 * below — it names people, which a meter never can.
 *
 * A document can demand no approvals at all, and the server can fail to read
 * the policy — both leave nothing to draw. The reviewer who just signed off
 * still needs to see that it registered, so the state badge stands in rather
 * than rendering nothing.
 */
function ApprovalBars({ change }: { change: ChangeRecord }) {
  const required = change.requiredApprovals ?? 0;
  if (required <= 0) {
    return (
      <div className="rev-approvals">
        <span className={getChangeStateBadgeClass(change)}>
          {getChangeStateLabel(change)}
        </span>
      </div>
    );
  }

  const filled = Math.min(change.approvalCount, required);
  const showBars = required <= MAX_APPROVAL_BARS;

  return (
    <div className="rev-approvals">
      {showBars ? (
        <div className="rev-approval-bars" aria-hidden="true">
          {Array.from({ length: required }, (_, index) => (
            <span
              key={index}
              className={`rev-approval-bar${
                index < filled ? " rev-approval-bar--filled" : ""
              }`}
            />
          ))}
        </div>
      ) : null}
      <span className="rev-approval-count">
        {change.approvalCount} of {required} approvals
      </span>
    </div>
  );
}

/**
 * One change, reviewed inside the Changes tab.
 *
 * The document's header and tabs stay put above this: a reviewer is never
 * anywhere but on the document, and a review that replaced the whole page made
 * them feel like they had left it. "← All changes" is the way back.
 *
 * The order down the page is the order a reviewer needs it in — what is being
 * proposed, who has to sign it off, then everything that has been said — and
 * the decision floats bottom right so it is reachable without scrolling back
 * to find it.
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
  comparisonBase,
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
  // and the timeline has already paid for the data.
  const [openThreadAuthors, setOpenThreadAuthors] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [updates, setUpdates] = useState<ChangeUpdate[]>([]);
  const [resetsApprovals, setResetsApprovals] = useState(false);

  const prNum = change.number;
  const isSubmitting = actionState.status === "submitting";

  // Stable so the preview loads the file once per ref rather than per render.
  const loadFile = useCallback(
    (gitRef: string) => downloadDocument(owner, repo, gitRef),
    [owner, repo],
  );

  // The updates are their own call: the Changes tab lists changes, and a list
  // has no use for the history inside each one. A failure costs the update
  // count and the update events, not the review.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const payload = await listChangeUpdates(owner, repo, prNum);
        if (cancelled) return;
        setUpdates(payload.updates);
        setResetsApprovals(payload.resetsApprovals);
      } catch {
        if (cancelled) return;
        setUpdates([]);
        setResetsApprovals(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, repo, prNum]);

  function updateActionState(update: Partial<PRActionState>) {
    setActionState((prev) => ({ ...prev, ...update }));
  }

  async function handleApprove() {
    updateActionState({ status: "submitting", error: null });
    try {
      // No body: an approval with nothing to say should record nothing. The
      // page quotes review bodies on the timeline, and "APPROVED" quoted back
      // reads as something the approver actually typed.
      await submitDocumentReview(owner, repo, prNum, "APPROVE");
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
  const opening = describeChangeOpening(change, nextVersion);
  const description = describeChangeBody(change.summary, change.description);
  const outcome = describeChangeOutcome(change);
  const proposed = buildProposedVersionFacts({
    fileName,
    branchName: change.branchName,
    submittedAt: change.submittedAt,
    updates,
  });
  const decision = resolveReviewDecision({
    open: change.open,
    isAnonymous,
    ownSubmission,
    mergeReady,
    canReview: reviewPerms.allowed,
    canMerge: mergePerms.allowed,
  });

  if (view === "compare") {
    return (
      <article className="change-detail">
        <button className="rev-back" type="button" onClick={onBackToList}>
          ← All changes
        </button>
        <h2 className="rev-title">{change.summary}</h2>
        <section className="rev-file-view">
          {proposed.ref === null ? (
            <p className="vault-pr-notice">
              This change has no branch on record, so there is nothing to
              compare.
            </p>
          ) : comparisonBase === null ? (
            <p className="vault-pr-notice">
              Nothing has been published for this document yet, so this change
              has no earlier version to be read against. Open it instead.
            </p>
          ) : (
            <>
              <p className="rev-file-note">
                What this change does to {comparisonBase.label} — added,
                removed, and rewritten.
              </p>
              <DocumentComparison
                owner={owner}
                repo={repo}
                base={comparisonBase}
                headRef={proposed.ref}
                headLabel={proposed.updateLabel ?? "This change"}
                fileName={fileName}
                onDownload={(gitRef) => onDownload(gitRef, null)}
              />
            </>
          )}
          <div className="rev-file-actions">
            <button
              className="rev-btn rev-btn--ghost"
              type="button"
              onClick={() => onViewChange("preview")}
            >
              Read the proposed version
            </button>
            <button
              className="rev-btn rev-btn--ghost"
              type="button"
              onClick={() => onViewChange("discussion")}
            >
              Back to the review
            </button>
          </div>
        </section>
      </article>
    );
  }

  if (view === "preview") {
    return (
      <article className="change-detail">
        <button className="rev-back" type="button" onClick={onBackToList}>
          ← All changes
        </button>
        <h2 className="rev-title">{change.summary}</h2>
        <section className="rev-file-view">
          {proposed.ref ? (
            <>
              <p className="rev-file-note">
                The file exactly as submitted
                {proposed.updateLabel ? `, ${proposed.updateLabel}` : ""}.
              </p>
              <DocumentPreview
                loadFile={loadFile}
                gitRef={proposed.ref}
                fileName={fileName}
                downloading={downloading}
                onDownload={(loaded) => onDownload(proposed.ref!, loaded)}
              />
            </>
          ) : (
            <p className="vault-pr-notice">
              This change has no branch on record, so the submitted file cannot
              be shown.
            </p>
          )}
          <div className="rev-file-actions">
            <button
              className="rev-btn rev-btn--ghost"
              type="button"
              disabled={!proposed.ref || comparisonBase === null}
              onClick={() => onViewChange("compare")}
            >
              Compare with {comparisonBase?.label ?? "the last version"}
            </button>
            <button
              className="rev-btn rev-btn--ghost"
              type="button"
              onClick={() => onViewChange("discussion")}
            >
              Back to the review
            </button>
          </div>
        </section>
      </article>
    );
  }

  return (
    <article className="change-detail">
      <button className="rev-back" type="button" onClick={onBackToList}>
        ← All changes
      </button>

      <header className="rev-header">
        <div className="rev-header-main">
          <h2 className="rev-title">{change.summary}</h2>
          <p className="rev-meta">
            {opening.who} opened this on {opening.when}
            {opening.becomes !== null ? (
              <>
                {" · becomes "}
                <strong>v{opening.becomes}</strong> when published
              </>
            ) : null}
          </p>
          {description ? (
            <p className="rev-description">{description}</p>
          ) : null}
        </div>
        <ApprovalBars change={change} />
      </header>

      {outcome ? (
        <p className="rev-outcome" role="status">
          {outcome}
        </p>
      ) : null}

      {/* Fixed chrome, same place on every change: the thing being approved,
          which update of it, and one button to go and read it. */}
      <div className="rev-proposed">
        <span className="rev-proposed-icon" aria-hidden="true">
          <FileText size={16} strokeWidth={1.5} />
        </span>
        <div className="rev-proposed-main">
          <p className="rev-proposed-title">Proposed version</p>
          <p className="rev-proposed-meta">
            {[proposed.fileName, proposed.updateLabel, proposed.date]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {proposed.ref ? (
          <button
            className="rev-link"
            type="button"
            disabled={downloading || !fileName}
            onClick={() => onDownload(proposed.ref!, null)}
          >
            <Download size={13} strokeWidth={1.75} aria-hidden="true" />
            {downloading ? "Downloading…" : "Download"}
          </button>
        ) : null}
        <button
          className="rev-btn rev-btn--ghost"
          type="button"
          disabled={!proposed.ref}
          onClick={() => onViewChange("preview")}
        >
          Open
        </button>
        {/* The question a reviewer actually opens a change with is "what is
            different?", not "what does it say?". One click, no downloads. */}
        <button
          className="rev-btn rev-btn--ghost"
          type="button"
          disabled={!proposed.ref || comparisonBase === null}
          title={
            comparisonBase === null
              ? "This document has no published version yet, so there is nothing to compare against."
              : undefined
          }
          onClick={() => onViewChange("compare")}
        >
          <GitCompare size={13} strokeWidth={1.75} aria-hidden="true" />
          Compare
        </button>
      </div>

      <ChangeReviewers
        owner={owner}
        repo={repo}
        pullNumber={prNum}
        submittedBy={change.submittedBy}
        reviewers={change.reviewers}
        currentUser={currentUser}
        openThreadAuthors={openThreadAuthors}
        canManage={canManageAssignments && change.open}
        onChanged={onChanged}
      />

      <ReviewTimeline
        owner={owner}
        repo={repo}
        change={change}
        updates={updates}
        resetsApprovals={resetsApprovals}
        canParticipate={!isAnonymous}
        currentUsername={currentUser}
        blockOnUnresolvedThreads={blockOnUnresolvedThreads}
        onOpenUpdate={
          proposed.ref === null ? null : () => onViewChange("preview")
        }
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
            // Identity churn here would re-render the reviewer list on every
            // poll, so a set that says the same thing stays the same set.
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

      {change.open && ownSubmission && decision !== "publish" ? (
        <p className="rev-note">
          You submitted this version — it is waiting on its reviewers.
        </p>
      ) : null}

      {change.open && !isAnonymous && !ownSubmission && reviewPerms.reason ? (
        <p className="rev-note">{reviewPerms.reason}</p>
      ) : null}

      {mergeReady && !mergePerms.allowed ? (
        <p className="rev-note">{mergePerms.reason}</p>
      ) : null}

      {actionState.error ? (
        <p className="vault-pr-error" role="alert">
          {actionState.error}
        </p>
      ) : null}

      {/* The decision, always reachable. A reviewer who has read enough should
          never have to scroll back through the argument to record it. */}
      {decision === "none" ? null : (
        <div className="rev-decision" role="group" aria-label="Your decision">
          {actionState.showApproveConfirm ? (
            <div className="rev-decision-confirm">
              <p className="rev-decision-confirm-line">
                Approve version {nextVersion} of {documentName}? Your name and
                the time go on the record.
              </p>
              <div className="rev-decision-row">
                <button
                  className="rev-btn rev-btn--ghost"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    updateActionState({ showApproveConfirm: false })
                  }
                >
                  Cancel
                </button>
                <button
                  className="rev-btn rev-btn--green"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    updateActionState({ showApproveConfirm: false });
                    void handleApprove();
                  }}
                >
                  {isSubmitting ? "Submitting…" : "Confirm Approval"}
                </button>
              </div>
            </div>
          ) : actionState.showChangesForm ? (
            <div className="rev-decision-confirm">
              <textarea
                className="rev-composer-input"
                placeholder="Describe what needs to change…"
                value={actionState.changesComment}
                rows={3}
                autoFocus
                disabled={isSubmitting}
                onChange={(event) =>
                  updateActionState({
                    changesComment: event.target.value,
                    error: null,
                  })
                }
              />
              <div className="rev-decision-row">
                <button
                  className="rev-btn rev-btn--ghost"
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
                <button
                  className="rev-btn rev-btn--ghost"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void handleRequestChanges()}
                >
                  {isSubmitting ? "Submitting…" : "Send Feedback"}
                </button>
              </div>
            </div>
          ) : decision === "publish" ? (
            <button
              className="rev-btn rev-btn--green"
              type="button"
              disabled={isSubmitting || threadsBlockPublish}
              title={
                threadsBlockPublish
                  ? "Resolve every discussion thread before publishing."
                  : undefined
              }
              onClick={() => void handlePublish()}
            >
              {isSubmitting ? "Publishing…" : "Publish"}
            </button>
          ) : (
            <>
              <button
                className="rev-btn rev-btn--ghost"
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  updateActionState({ showChangesForm: true, error: null })
                }
              >
                Request changes
              </button>
              <button
                className="rev-btn rev-btn--green"
                type="button"
                disabled={isSubmitting}
                onClick={() => updateActionState({ showApproveConfirm: true })}
              >
                Approve
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
