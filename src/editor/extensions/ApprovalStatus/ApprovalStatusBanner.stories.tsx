import { ApprovalStatusBanner } from "./ApprovalStatusBanner";
import type { ApprovalState } from "../../../services/gitea/pullRequests";
import "../../assets/bindersnap-editor.css";

export default {
  title: "Editor/ApprovalStatusBanner",
  component: ApprovalStatusBanner,
};

const STATUSES: ApprovalState[] = [
  "working",
  "in_review",
  "changes_requested",
  "approved",
  "published",
];

const sharedHandlers = {
  onSubmitForReview: () => undefined,
  onApprove: () => undefined,
  onRequestChanges: () => undefined,
};

export const AllStates = () => (
  <div
    className="bs-editor"
    style={{
      padding: "var(--brand-space-4)",
      background: "var(--bs-page-bg)",
    }}
  >
    <div
      style={{
        display: "grid",
        gap: "var(--brand-space-3)",
      }}
    >
      {STATUSES.map((approvalState) => (
        <ApprovalStatusBanner
          key={approvalState}
          approvalState={approvalState}
          prUrl="/pulls/42"
          {...sharedHandlers}
        />
      ))}
    </div>
  </div>
);
