import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Clock } from "lucide-react";

import { describeGroupName } from "../../../packages/utils/groupName";
import { formatDocumentName } from "../documentDisplay";
import { AppIcon } from "./AppIcon";
import { PersonAvatar } from "./PersonAvatar";

/** One person, as the change payload carries them. */
interface RuleUser {
  login: string;
  fullName: string;
  avatarUrl: string;
}

/** One rule a change has to meet before it can be published. */
export interface ApprovalRule {
  kind: "approvers" | "sign-off";
  scope: "binder" | "folder" | "document" | "rules" | null;
  target: string;
  groups: string[];
  people: string[];
  required: number;
  eligible: RuleUser[];
  approvedBy: RuleUser[];
}

/** How many faces a row shows before it says "and N more". */
const FACES = 8;

function nameOf(user: RuleUser): string {
  return user.fullName.trim() || user.login;
}

function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "Board and Dr. Okafor": the groups and people a rule names. */
export function describeRuleOwners(
  rule: Pick<ApprovalRule, "groups" | "people" | "eligible">,
): string {
  const people = rule.people.map(
    (login) =>
      nameOf(
        rule.eligible.find((user) => user.login === login) ?? {
          login,
          fullName: "",
          avatarUrl: "",
        },
      ) || login,
  );
  const names = [
    ...rule.groups.map((group) =>
      group === "staff"
        ? "everyone at the organization"
        : describeGroupName(group),
    ),
    ...people,
  ];
  return names.length === 0 ? "nobody" : listSentence(names);
}

/** What a sign-off rule covers, the way the settings page says it. */
export function describeRuleTarget(
  rule: Pick<ApprovalRule, "kind" | "scope" | "target">,
): string {
  if (rule.kind === "approvers") return "Binder approvers";
  switch (rule.scope) {
    case "folder":
      return `Sign-off for ${rule.target
        .split("/")
        .map(formatDocumentName)
        .join(" / ")}`;
    case "document":
      return "Sign-off for this document";
    case "rules":
      return "Sign-off for the binder's rules";
    default:
      return "Sign-off for everything in this binder";
  }
}

export function ruleMet(rule: Pick<ApprovalRule, "approvedBy" | "required">) {
  return rule.approvedBy.length >= rule.required;
}

/**
 * The one line at the top: what the change still needs, or that it has it.
 *
 * Said as a requirement, the way GitLab's widget does — "Requires 2 approvals
 * from Board" — because that is the question a reviewer opens the change to
 * answer, and the count beside it says how far along it is.
 */
export function summarizeRules(rules: readonly ApprovalRule[]): string {
  if (rules.length === 0) return "No approvals required.";
  if (rules.every(ruleMet)) return "Every approval rule is met.";
  const approvers = rules.find((rule) => rule.kind === "approvers");
  const signOffs = rules.filter((rule) => rule.kind === "sign-off");
  const parts: string[] = [];
  if (approvers) {
    const count = approvers.required;
    parts.push(
      `${count} ${count === 1 ? "approval" : "approvals"} from ${describeRuleOwners(approvers)}`,
    );
  }
  if (signOffs.length > 0) {
    const owners = signOffs.map((rule) => describeRuleOwners(rule));
    parts.push(`a sign-off from ${listSentence([...new Set(owners)])}`);
  }
  return `Requires ${listSentence(parts)}.`;
}

function Faces({ users }: { users: readonly RuleUser[] }) {
  if (users.length === 0) return null;
  const shown = users.slice(0, FACES);
  return (
    <span className="rev-rules-faces">
      {shown.map((user) => (
        <span key={user.login} title={nameOf(user)}>
          <PersonAvatar person={user} size="sm" />
        </span>
      ))}
      {users.length > FACES ? (
        <span className="rev-rules-more">{users.length - FACES} more</span>
      ) : null}
    </span>
  );
}

/**
 * The approval rules a change is under, and who has met each.
 *
 * **Modelled on GitLab's approval widget**: one line that says what is
 * required and who has approved, which opens into a row per rule — who can
 * approve, how many of how many, and who has. Only approvals that count are
 * here. An approval from somebody who is not an approver counts for nothing,
 * so it is in the timeline and nowhere near this panel.
 *
 * Who was *asked* to review is the reviewers list in the rail, not this.
 */
export function ApprovalRules({ rules }: { rules: readonly ApprovalRule[] }) {
  const [open, setOpen] = useState(false);
  const met = rules.every(ruleMet);
  const approvedBy = [
    ...new Map(
      rules
        .flatMap((rule) => rule.approvedBy)
        .map((user) => [user.login, user]),
    ).values(),
  ];

  return (
    <section
      className={`bs-panel rev-rules${met ? " rev-rules--met" : ""}`}
      aria-label="Approval rules"
    >
      <button
        type="button"
        className="rev-rules-summary"
        aria-expanded={open}
        disabled={rules.length === 0}
        onClick={() => setOpen(!open)}
      >
        <AppIcon icon={met ? Check : Clock} size="sm" />
        <span className="rev-rules-line">
          <strong>{summarizeRules(rules)}</strong>
          {approvedBy.length > 0 ? (
            <>
              {" "}
              <span className="rev-rules-approved-label">Approved by</span>
            </>
          ) : null}
        </span>
        <Faces users={approvedBy} />
        {rules.length > 0 ? (
          <AppIcon icon={open ? ChevronUp : ChevronDown} size="sm" />
        ) : null}
      </button>

      {open ? (
        <table className="rev-rules-table">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Who can approve</th>
              <th scope="col">Approvals</th>
              <th scope="col">Approved by</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr
                key={`${rule.kind}:${rule.scope}:${rule.target}`}
                className={ruleMet(rule) ? "rev-rules-row--met" : undefined}
              >
                <th scope="row">
                  <span className="rev-rules-name">
                    {describeRuleTarget(rule)}
                  </span>
                  <span className="rev-rules-owners">
                    {describeRuleOwners(rule)}
                  </span>
                </th>
                <td>
                  {rule.eligible.length > 0 ? (
                    <Faces users={rule.eligible} />
                  ) : (
                    <span className="rev-rules-empty">
                      Nobody can approve this yet
                    </span>
                  )}
                </td>
                <td className="rev-rules-count">
                  {Math.min(rule.approvedBy.length, rule.required)} of{" "}
                  {rule.required}
                </td>
                <td>
                  <Faces users={rule.approvedBy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
