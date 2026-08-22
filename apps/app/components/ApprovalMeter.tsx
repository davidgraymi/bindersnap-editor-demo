import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";

import type { ChangeRecord, ChangeStandingTone } from "../documentDisplay";
import { describeChangeStanding } from "../documentDisplay";

/** Beyond this many, a row of pips is a smear rather than a count. */
const MAX_PIPS = 6;

const TONE_ICONS: Record<ChangeStandingTone, typeof CircleCheck> = {
  blocked: CircleAlert,
  ready: CircleCheck,
  progress: CircleDashed,
};

interface ApprovalMeterProps {
  change: ChangeRecord;
  /**
   * Logins holding an unresolved thread. Only the change's own page has paid
   * for the discussion, so everywhere else this is empty and the pill simply
   * reports one fewer kind of blocker.
   */
  openThreadAuthors?: ReadonlySet<string>;
  /** Larger type and pips, for a change's own page rather than a list row. */
  size?: "row" | "detail";
}

/**
 * Where a change stands: how many sign-offs it has, against how many it needs,
 * and who is holding it up.
 *
 * "Awaiting review" is a status that answers nothing: one approval short and
 * three approvals short look identical, so nobody can tell whether the change
 * is nearly through or barely started. A count says it in four words, the pips
 * say it without reading at all, and the reason names the person to go talk to.
 *
 * This is deliberately the *only* thing on the page that reports publishability
 * — see `describeChangeStanding` for why a separate state badge alongside it
 * was worse than nothing.
 */
export function ApprovalMeter({
  change,
  openThreadAuthors,
  size = "row",
}: ApprovalMeterProps) {
  const standing = describeChangeStanding(change, openThreadAuthors);
  if (!standing) return null;

  const Icon = TONE_ICONS[standing.tone];
  const showPips =
    change.requiredApprovals > 0 && change.requiredApprovals <= MAX_PIPS;

  return (
    <span
      className={`approval-meter approval-meter--${size} approval-meter--${standing.tone}`}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
      {standing.progress ? (
        <span className="approval-meter-count">{standing.progress}</span>
      ) : null}
      {showPips ? (
        <span className="approval-meter-pips" aria-hidden="true">
          {Array.from({ length: change.requiredApprovals }, (_, index) => (
            <span
              key={index}
              className={`approval-meter-pip${
                index < change.approvalCount
                  ? " approval-meter-pip--filled"
                  : ""
              }`}
            />
          ))}
        </span>
      ) : null}
      <span className="approval-meter-reason">{standing.reason}</span>
    </span>
  );
}
