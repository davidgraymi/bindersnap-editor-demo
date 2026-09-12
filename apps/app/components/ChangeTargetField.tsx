import { useEffect, useState } from "react";

import { fetchBinderChanges } from "../api";
import { parseChangeTitle } from "../documentDisplay";

/**
 * Which change request this act goes into.
 *
 * **The change is the unit of approval** (ADR 0004 §4) — a revision that
 * touches three cross-referencing policies should be reviewed and published as
 * one act. Every act opening a change request of its own made that impossible
 * to express: three policies meant three change requests, approved separately
 * and publishable apart, which is the exact thing the rule exists to prevent.
 *
 * So the question is asked where the act happens, with the safe answer first. A
 * binder with nothing in flight does not ask it at all — there is only one
 * possible answer, and a control with one option is furniture.
 *
 * Sign-off changes are left out by the server for a reason worth repeating
 * here: one of those rewrites who has to approve things, and putting a policy
 * in it would fold a permission decision and a policy into one approval.
 */

export interface ChangeTargetFieldProps {
  org: string;
  binder: string;
  /** null means "open a new change request". */
  value: number | null;
  onChange: (changeNumber: number | null) => void;
  disabled?: boolean;
}

interface OpenChange {
  number: number;
  title: string;
}

export function ChangeTargetField({
  org,
  binder,
  value,
  onChange,
  disabled = false,
}: ChangeTargetFieldProps) {
  const [changes, setChanges] = useState<OpenChange[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBinderChanges(org, binder, "open")
      .then((payload) => {
        if (cancelled) return;
        setChanges(
          payload.changes
            // A sign-off change is about who approves, not about a policy. The
            // server refuses one; not offering it is the kinder half.
            .filter((change) => !change.branchName.startsWith("sign-off/"))
            .map((change) => ({
              number: change.number,
              // The same name the changes list shows, so the option a person
              // picks here reads identically to the row they will land on.
              title: parseChangeTitle(change.body, change.submittedBy),
            })),
        );
      })
      // A binder whose changes cannot be read still files policies — it just
      // cannot offer to put one in something. Failing the upload over this
      // would be losing the act to a piece of small print.
      .catch(() => {
        if (!cancelled) setChanges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  if (changes === null || changes.length === 0) return null;

  return (
    <label htmlFor="change-target" className="create-document-field">
      <span className="bs-label">Put it in</span>
      <select
        id="change-target"
        className="create-document-input"
        value={value === null ? "" : String(value)}
        disabled={disabled}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
      >
        <option value="">A new change request</option>
        {changes.map((change) => (
          <option key={change.number} value={change.number}>
            {change.title || `Change ${change.number}`}
          </option>
        ))}
      </select>
    </label>
  );
}
