import { useEffect, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";
import { Columns2, Download, FileText, Pencil } from "lucide-react";

import type { ChangeUpdate, RepoBranchProtection } from "../api";
import {
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
import type { ChangeScope } from "../changeScope";
import type { ChangeRecord } from "../documentDisplay";
import {
  describeChangeOutcome,
  getChangeStateBadgeClass,
  getChangeStateLabel,
} from "../documentDisplay";
import type { DocumentChangeView } from "../routes";
import { ChangeReviewers } from "./ChangeReviewers";
import { ReviewTimeline } from "./ReviewTimeline";

interface DocumentChangeDetailProps {
  /**
   * Which repository this change lives in.
   *
   * A change request is a Gitea pull request whether the thing it revises is a
   * repository of its own or a file inside a binder, so this screen serves
   * both and the scope is the only thing that differs.
   */
  scope: ChangeScope;
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
  /**
   * How many documents this change touches.
   *
   * Only the header cares: "becomes v2 when published" is printed under the
   * change's own title, and with several documents that is a sentence about
   * the change carrying a fact about one row of it. Publishing still uses
   * {@link nextVersion}, which is about the document being shown.
   */
  documentCount?: number;
  /**
   * "Renamed from Hand Hygiene", when this change renamed or refiled it.
   *
   * **A rename is a change even when not a word of the document changed**, and
   * the comparison cannot show it — the identity survives a rename and the
   * address does not, so both versions read identically and the screen said
   * "nothing changed" about a change that plainly did something.
   */
  documentMove?: string | null;
  /**
   * Open this document at its own address, on this change's branch.
   *
   * **A change request is a branch, and a document on it has an address.**
   * Reading the proposed version used to happen here, in a panel beside the
   * discussion: half a column wide, under a heading naming the change rather
   * than the document, at a URL that said nothing about which document it was.
   * It is the binder at another ref, which is what every other git front end
   * does and what a reader already knows how to use.
   */
  onOpenOnBranch?: (() => void) | null;
  /**
   * What this change is about, when it is **not** a document.
   *
   * A binder's sign-off rules are changed through the same review as a policy
   * — deliberately, because a product whose claim is that nothing changes
   * without approval should not exempt the rules that decide who approves. But
   * such a change versions nothing, so every word this page says about
   * versions is false for it: "becomes v1 when published" on a change that
   * publishes no version is exactly the kind of lie a compliance customer
   * notices.
   *
   * Set it, and the version wording and the document chrome are replaced by a
   * sentence saying what is actually being decided.
   */
  subject?: { title: string; description: string } | null;
  documentName: string;
  /** Canonical file name, so the proposed version can be previewed and saved. */
  fileName: string | null;
  /** Set while this change's file is being fetched for download. */
  downloading: boolean;
  onDownload: (gitRef: string, loaded?: Blob | null) => void;
  onChanged: () => void | Promise<void>;
  onViewChange: (view: DocumentChangeView) => void;
  onBackToList: () => void;
  /**
   * The reviewers this change is actually held for.
   *
   * **Real state, not a label we invent.** A sign-off rule puts its owners on
   * a change automatically; whether their request blocks is branch
   * protection's answer, and the server reads it. Only "Required" is marked —
   * a reviewer with no marker is one nothing is waiting on, which is what
   * "optional" means, and printing the word on every other row is labelling
   * the absence of a constraint.
   */
  requiredReviewers?: readonly string[];
  /** Rewrite the title and description. The author's, while it is open. */
  onEditSubject?:
    ((subject: { title: string; body: string }) => Promise<void>) | null;
  /** Where the required reviewers come from, for the reader who asks. */
  onOpenSignOffRules?: (() => void) | null;
  /**
   * Something about the change the reader has to know before deciding — that
   * the binder has moved on under it, in practice.
   *
   * Drawn under the change's own name rather than above the way back to the
   * list: the first sentence on a page should not be about a state nobody has
   * told you you are in.
   */
  banner?: React.ReactNode;
  /** Which of several documents the file screens are about. */
  documentPicker?: React.ReactNode;
  /**
   * Whether it is still open, or how it ended — the badge before the line
   * under the title.
   */
  status?: React.ReactNode;
  /** Overview and Changes: the change's two screens, as tabs under its header. */
  tabs?: React.ReactNode;
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
  scope,
  currentUser,
  isAnonymous,
  change,
  view,
  branchProtection,
  blockOnUnresolvedThreads,
  canManageAssignments,
  nextVersion,
  documentCount = 1,
  documentMove = null,
  onOpenOnBranch = null,
  subject = null,
  documentName,
  fileName,
  downloading,
  onDownload,
  onChanged,
  onViewChange,
  onBackToList,
  requiredReviewers = [],
  onEditSubject = null,
  onOpenSignOffRules = null,
  banner = null,
  documentPicker = null,
  status = null,
  tabs = null,
}: DocumentChangeDetailProps) {
  // Above every early return, like the other hooks here — the notes on
  // `DocumentPreview` record what hook order costs when it slips.
  const isReadOnly = useIsReadOnly();
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
  /** The title and description being rewritten, or null while they are not. */
  const [editing, setEditing] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [savingSubject, setSavingSubject] = useState(false);

  const prNum = change.number;
  const isSubmitting = actionState.status === "submitting";

  // The updates are their own call: the Changes tab lists changes, and a list
  // has no use for the history inside each one. A failure costs the update
  // count and the update events, not the review.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const payload = await listChangeUpdates(scope, prNum);
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
  }, [scope, prNum]);

  function updateActionState(update: Partial<PRActionState>) {
    setActionState((prev) => ({ ...prev, ...update }));
  }

  async function handleApprove() {
    updateActionState({ status: "submitting", error: null });
    try {
      // No body: an approval with nothing to say should record nothing. The
      // page quotes review bodies on the timeline, and "APPROVED" quoted back
      // reads as something the approver actually typed.
      await submitDocumentReview(scope, prNum, "APPROVE");
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
      await submitDocumentReview(scope, prNum, "REQUEST_CHANGES", comment);
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
      await publishDocument(scope, prNum, nextVersion);
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
  const opening = describeChangeOpening(
    change,
    subject || documentCount !== 1 ? null : nextVersion,
  );
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
  // A delinquent organization records no decisions. Folded into `decision`
  // rather than checked at each button because "none" is already the shape
  // this component draws when there is nothing to offer — and approving or
  // publishing here would be refused by the API anyway, after the customer
  // had typed a comment they are about to lose.
  const reviewDecision = isReadOnly ? "none" : decision;

  // **There is no in-page preview any anymore.** Reading what a change
  // proposes happens at the document's own address on the change's branch —
  // `/{org}/{binder}/{path}?change=N` — where it has its own title and the
  // whole width of the page. `?view=preview` still parses, and the change page
  // sends it there rather than 404ing a link somebody saved.

  // **The author's, and while it is open.** The server refuses anybody else,
  // and a button that fails is worse than one that is not there.
  const canEditSubject =
    onEditSubject !== null && change.open && ownSubmission && !isReadOnly;

  const saveSubject = async () => {
    if (!editing || !onEditSubject || editing.title.trim() === "") return;
    setSavingSubject(true);
    try {
      await onEditSubject({
        title: editing.title.trim(),
        body: editing.body,
      });
      setEditing(null);
    } catch (err) {
      updateActionState({
        status: "error",
        error: readActionError(err, "Unable to edit this change."),
      });
    } finally {
      setSavingSubject(false);
    }
  };

  /**
   * What is in the way, in the rail, in the same order on every change.
   *
   * A reviewer deciding needs to know what is holding the publish before they
   * are offered the buttons — not after pressing one.
   */
  const blockers: string[] = [
    threadsBlockPublish
      ? unresolvedCount === 1
        ? "One discussion is still open, and this binder holds the publish until every one is resolved."
        : `${unresolvedCount} discussions are still open, and this binder holds the publish until every one is resolved.`
      : null,
    change.open && ownSubmission && reviewDecision !== "publish"
      ? "You submitted this change — it is waiting on its reviewers."
      : null,
    change.open && !isAnonymous && !ownSubmission ? reviewPerms.reason : null,
    mergeReady && !mergePerms.allowed ? mergePerms.reason : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <article className="change-detail bs-with-rail">
      <div className="change-main">
        {/* The way back to the list is the trail in the top bar — `Clinical
            / Change requests / Change 4` — the same line every page has, so
            it is not drawn a second time here. */}
        {editing ? (
          /* A change request is open for days, and the first thing a
             reviewer's question produces is a better title. Once it is
             published the title is on the merge commit and in the version
             tag, which are the record — so this is offered while it is open
             and never after. */
          <div className="bs-fields change-subject-edit">
            <div className="bs-field">
              <label className="bs-field-label" htmlFor="change-title">
                What you are asking for
              </label>
              <input
                id="change-title"
                className="bs-input"
                type="text"
                value={editing.title}
                disabled={savingSubject}
                autoFocus
                onChange={(event) =>
                  setEditing({ ...editing, title: event.target.value })
                }
              />
            </div>
            <div className="bs-field">
              <label className="bs-field-label" htmlFor="change-body">
                Why
                <span className="bs-field-optional">optional</span>
              </label>
              <textarea
                id="change-body"
                className="bs-input"
                rows={5}
                value={editing.body}
                disabled={savingSubject}
                onChange={(event) =>
                  setEditing({ ...editing, body: event.target.value })
                }
              />
            </div>
            <div className="bs-field-row">
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn-primary"
                disabled={savingSubject || editing.title.trim() === ""}
                onClick={() => void saveSubject()}
              >
                {savingSubject ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                disabled={savingSubject}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <header className="bs-pagehead">
            <div className="bs-pagehead-body">
              <h1 className="bs-title rev-title">{change.summary}</h1>
              <p className="bs-facts">
                {status}
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
            {canEditSubject ? (
              <div className="bs-pagehead-actions">
                <button
                  type="button"
                  className="bs-actionbtn"
                  aria-label="Rewrite the title and description"
                  title="Edit"
                  onClick={() =>
                    setEditing({
                      title: change.summary,
                      body: change.description ?? "",
                    })
                  }
                >
                  <Pencil size={15} strokeWidth={1.6} aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </header>
        )}

        {tabs}

        {outcome ? (
          <p className="rev-outcome" role="status">
            {outcome}
          </p>
        ) : null}

        {banner}
        {documentPicker}

        <ReviewTimeline
          scope={scope}
          change={change}
          updates={updates}
          resetsApprovals={resetsApprovals}
          canParticipate={!isAnonymous}
          currentUsername={currentUser}
          blockOnUnresolvedThreads={blockOnUnresolvedThreads}
          onOpenUpdate={
            proposed.ref === null || !onOpenOnBranch
              ? null
              : () => onOpenOnBranch()
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
              // Identity churn here would re-render the reviewer list on
              // every poll, so a set that says the same thing stays the same
              // set.
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
      </div>

      {/* **Everything needed to decide, in one sticky rail, in the same order
          on every change**: what is proposed, who it is waiting on, what is in
          the way, and the two buttons. It was scattered down a single column
          between comments, with the approval meter floating top-right and
          colliding with the title whenever it wrapped — which it does at any
          realistic length. */}
      <aside className="bs-rail" aria-label="The decision">
        <div className="bs-panel">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">
              {subject ? subject.title : "Proposed version"}
            </h2>
          </div>
          {subject ? (
            <div className="bs-panel-body bs-rail-note">
              {subject.description}
            </div>
          ) : (
            <>
              <div className="bs-panel-body bs-rail-note">
                {[proposed.fileName, proposed.updateLabel, proposed.date]
                  .filter(Boolean)
                  .join(" · ")}
                {/* **A rename is a change even when not a word of the document
                    changed**, and no comparison can show it: the identity
                    survives a rename and the address does not, so both refs
                    read identically. Said here, beside the version it is true
                    of, rather than only on the screen that draws the diff. */}
                {documentMove ? <p>{documentMove}.</p> : null}
              </div>
              <div className="bs-panel-foot">
                <button
                  className="bs-btn bs-btn--sm bs-btn-secondary"
                  type="button"
                  disabled={!proposed.ref || !onOpenOnBranch}
                  onClick={() => onOpenOnBranch?.()}
                >
                  Open
                </button>
                {/* The question a reviewer actually opens a change with is
                    "what is different?", not "what does it say?".

                    **Held open for a document with nothing published yet.** It
                    used to be disabled, because this screen could only draw a
                    diff and a first version has no before. What it opens now
                    is the whole change, where a new document is simply read —
                    which is what a reviewer wants from a policy nobody has
                    seen. The only thing that can still make it impossible is
                    a change with no branch on record. */}
                <button
                  className="bs-btn bs-btn--sm bs-btn-secondary"
                  type="button"
                  disabled={!proposed.ref}
                  onClick={() => onViewChange("compare")}
                >
                  Compare
                </button>
                <span className="bs-panel-bar-spacer" />
                {/* A download arrow with the word "Download" beside it is the
                    word twice. */}
                {proposed.ref ? (
                  <button
                    className="bs-actionbtn"
                    type="button"
                    aria-label={`Download ${fileName ?? "this version"}`}
                    title="Download"
                    disabled={downloading || !fileName}
                    onClick={() => onDownload(proposed.ref!, null)}
                  >
                    <Download size={15} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>

        <div className="bs-panel">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title">Approvals</h2>
            <span className="bs-panel-bar-spacer" />
            <ApprovalBars change={change} />
          </div>
          <ChangeReviewers
            scope={scope}
            pullNumber={prNum}
            submittedBy={change.submittedBy}
            reviewers={change.reviewers}
            currentUser={currentUser}
            openThreadAuthors={openThreadAuthors}
            requiredReviewers={requiredReviewers}
            /* The button and the caveat share one foot, the way the mockup
               draws them — so the list owns both rather than having a second
               foot stacked under its own. */
            onOpenSignOffRules={onOpenSignOffRules}
            canManage={canManageAssignments && change.open}
            onChanged={onChanged}
          />
        </div>

        {blockers.length > 0 ? (
          <div className="bs-note bs-note--warn">
            {blockers.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}

        {actionState.error ? (
          <p className="bs-note bs-note--danger" role="alert">
            {actionState.error}
          </p>
        ) : null}

        {/* The decision, reachable at every scroll depth — which is the
            property the floating pill had and the reason it existed. It stops
            covering the comment somebody is reading in order to decide. */}
        {reviewDecision === "none" ? null : (
          <div className="rev-decision" role="group" aria-label="Your decision">
            {actionState.showApproveConfirm ? (
              <div className="rev-decision-confirm">
                <p className="rev-decision-confirm-line">
                  {subject
                    ? `Approve this change to ${documentName}? Your name and the time go on the record.`
                    : `Approve version ${nextVersion} of ${documentName}? Your name and the time go on the record.`}
                </p>
                <div className="rev-decision-row">
                  <button
                    className="bs-btn bs-btn--sm bs-btn--quiet"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() =>
                      updateActionState({ showApproveConfirm: false })
                    }
                  >
                    Cancel
                  </button>
                  <button
                    className="bs-btn bs-btn--sm bs-btn--approve"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      updateActionState({ showApproveConfirm: false });
                      void handleApprove();
                    }}
                  >
                    {isSubmitting ? "Submitting…" : "Confirm approval"}
                  </button>
                </div>
              </div>
            ) : actionState.showChangesForm ? (
              <div className="rev-decision-confirm">
                <textarea
                  className="bs-input"
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
                    className="bs-btn bs-btn--sm bs-btn--quiet"
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
                    className="bs-btn bs-btn--sm bs-btn-secondary"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleRequestChanges()}
                  >
                    {isSubmitting ? "Submitting…" : "Send"}
                  </button>
                </div>
              </div>
            ) : reviewDecision === "publish" ? (
              <button
                className="bs-btn bs-btn--approve bs-btn--block"
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
                {/* Putting your name on a policy permanently is the most
                    consequential act in the product, so it is the filled
                    button — and green, because green means approval here and
                    nothing else. The page's coral belongs to the next step,
                    not to the irreversible one. */}
                <button
                  className="bs-btn bs-btn--approve bs-btn--block"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    updateActionState({ showApproveConfirm: true })
                  }
                >
                  Approve
                </button>
                <button
                  className="bs-btn bs-btn-secondary bs-btn--block"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    updateActionState({ showChangesForm: true, error: null })
                  }
                >
                  Ask for changes
                </button>
              </>
            )}
          </div>
        )}
      </aside>
    </article>
  );
}
