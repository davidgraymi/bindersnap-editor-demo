import { CircleCheck, CircleDashed } from "lucide-react";

import {
  describeApprovalProgress,
  hasEnoughApprovals,
} from "../documentDisplay";

/** Beyond this many, a row of pips is a smear rather than a count. */
const MAX_PIPS = 6;

interface ApprovalMeterProps {
  approvalCount: number;
  requiredApprovals: number;
  /** Larger type and pips, for a change's own page rather than a list row. */
  size?: "row" | "detail";
}

/**
 * How many sign-offs a change has, against how many it needs.
 *
 * "Awaiting review" is a status that answers nothing: one approval short and
 * three approvals short look identical, so nobody can tell whether the change
 * is nearly through or barely started. A count says it in four words, and the
 * pips say it without reading at all.
 */
export function ApprovalMeter({
  approvalCount,
  requiredApprovals,
  size = "row",
}: ApprovalMeterProps) {
  const progress = describeApprovalProgress({
    approvalCount,
    requiredApprovals,
  });
  if (!progress) return null;

  const met = hasEnoughApprovals({ approvalCount, requiredApprovals });
  const Icon = met ? CircleCheck : CircleDashed;
  const showPips = requiredApprovals <= MAX_PIPS;

  return (
    <span
      className={`approval-meter approval-meter--${size}${
        met ? " approval-meter--met" : ""
      }`}
      title={
        met
          ? "Every approval this document requires is in."
          : `${requiredApprovals - approvalCount} more approval${
              requiredApprovals - approvalCount === 1 ? "" : "s"
            } needed before this can be published.`
      }
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="approval-meter-count">{progress}</span>
      {showPips ? (
        <span className="approval-meter-pips" aria-hidden="true">
          {Array.from({ length: requiredApprovals }, (_, index) => (
            <span
              key={index}
              className={`approval-meter-pip${
                index < approvalCount ? " approval-meter-pip--filled" : ""
              }`}
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}
