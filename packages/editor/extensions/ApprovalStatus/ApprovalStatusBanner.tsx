import type { ApprovalState } from "../../../gitea-client/pullRequests";

export interface ApprovalStatusBannerProps {
  approvalState: ApprovalState;
  prUrl?: string;
  onSubmitForReview?: () => void;
  onApprove?: () => void;
  onRequestChanges?: () => void;
}

type BannerTone = "pending" | "approved" | "rejected";

type BannerStateConfig = {
  badge: string;
  title: string;
  copy: string;
  tone: BannerTone;
  stateClass: string;
  linkLabel: string;
};

const BANNER_STATE_CONFIG: Record<ApprovalState, BannerStateConfig> = {
  working: {
    badge: "Draft",
    title: "Still in draft",
    copy: "Keep editing. Submit this version for review when it is ready.",
    tone: "pending",
    stateClass: "bs-approval--working",
    linkLabel: "Open review trail",
  },
  in_review: {
    badge: "In Review",
    title: "Review is open",
    copy: "The document is out for review. Approve it or send it back with changes.",
    tone: "pending",
    stateClass: "bs-approval--in-review",
    linkLabel: "Open review trail",
  },
  changes_requested: {
    badge: "Changes Requested",
    title: "Needs another pass",
    copy: "The review came back with edits. Update the draft and submit it again.",
    tone: "rejected",
    stateClass: "bs-approval--changes-requested",
    linkLabel: "Open review trail",
  },
  approved: {
    badge: "Approved",
    title: "Approved and signed off",
    copy: "This version has approval. Publish it when you are ready.",
    tone: "approved",
    stateClass: "bs-approval--approved",
    linkLabel: "Open review trail",
  },
  published: {
    badge: "Published",
    title: "Published record",
    copy: "This version is locked and ready for readers.",
    tone: "approved",
    stateClass: "bs-approval--published",
    linkLabel: "Open published record",
  },
};

const TONE_CLASS: Record<BannerTone, string> = {
  pending: "bs-approval--pending",
  approved: "bs-approval--approved",
  rejected: "bs-approval--rejected",
};

export function ApprovalStatusBanner({
  approvalState,
  prUrl,
  onSubmitForReview,
  onApprove,
  onRequestChanges,
}: ApprovalStatusBannerProps) {
  const config = BANNER_STATE_CONFIG[approvalState];
  const rootClassName = [
    "bs-approval",
    TONE_CLASS[config.tone],
    config.stateClass,
  ].join(" ");

  const primaryAction =
    approvalState === "working" || approvalState === "changes_requested"
      ? onSubmitForReview
        ? {
            label: "Submit for review",
            onClick: onSubmitForReview,
            className: "bs-btn-primary",
          }
        : null
      : approvalState === "in_review" && onApprove
        ? {
            label: "Approve",
            onClick: onApprove,
            className: "bs-btn-primary",
          }
        : null;

  const secondaryAction =
    approvalState === "in_review" && onRequestChanges
      ? {
          label: "Request changes",
          onClick: onRequestChanges,
          className: "bs-btn-secondary",
        }
      : null;

  return (
    <section
      className={rootClassName}
      data-state={approvalState}
      aria-label="Approval status"
    >
      <div className="bs-approval__badge">{config.badge}</div>
      <div className="bs-approval__body">
        <h2 className="bs-approval__title">{config.title}</h2>
        <p className="bs-approval__copy">{config.copy}</p>
      </div>
      {(primaryAction || secondaryAction || prUrl) && (
        <div className="bs-approval__actions">
          {primaryAction && (
            <button
              type="button"
              className={primaryAction.className}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              className={secondaryAction.className}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          )}
          {prUrl && (
            <a className="bs-approval__link" href={prUrl}>
              {config.linkLabel}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
