import {
  AlertTriangle,
  ShieldCheck,
  ShieldMinus,
  ShieldUser,
} from "lucide-react";

import {
  describeSignOffChangeKind,
  summarizeSignOffChange,
  type SignOffChangeRow,
} from "../signOff";

/**
 * What a change would do to who signs things off, on the Changes tab.
 *
 * **The rules change nobody could see.** A change to `.gitea/CODEOWNERS`
 * versions no document, so the one screen that exists to say what a change
 * does said "this change versions no document" and sent the reviewer to the
 * change's description to find out what it was for — a description its author
 * can rewrite at any time, including after it has been approved (issue 921). The
 * one change in the product that alters a control was the one change explained
 * only by the person proposing it.
 *
 * So the rules are drawn here, from the two committed files, the way every
 * other panel on this screen is drawn from the two versions of a document.
 *
 * Three verbs, and only one of them is coloured as a loss: a gate coming down
 * is the change a reviewer must not miss. A gate going up or changing hands
 * still holds the publish for somebody.
 */
export function SignOffChangePanel({
  rows,
  unreadable = [],
  open = true,
}: {
  rows: readonly SignOffChangeRow[];
  /** Proposed lines Gitea would drop with nothing but a log warning. */
  unreadable?: readonly { line: number; text: string }[];
  /** Whether the change is still awaiting a decision — the wording differs. */
  open?: boolean;
}) {
  return (
    <section className="bs-panel cmp-rules" aria-labelledby="cmp-rules-title">
      <div className="bs-panel-bar">
        <h2 className="bs-panel-bar-title" id="cmp-rules-title">
          Who signs things off
        </h2>
        <span className="bs-panel-bar-spacer" />
        <span className="bs-row-meta">{summarizeSignOffChange(rows)}</span>
      </div>

      {/* Read from the binder itself, so the sentence is a fact about the
          change rather than a claim the change makes about itself. */}
      <p className="cmp-rules-note">
        {open
          ? "These rules decide who has to approve a change to each part of this binder. They take effect only once this change is published — until then the rules already in force apply, including to this change."
          : "These rules decide who has to approve a change to each part of this binder."}
      </p>

      {rows.length > 0 ? (
        <ul className="bs-row-list">
          {rows.map((row) => (
            <li className="bs-row" key={`${row.scope}:${row.target}`}>
              <span className={`bs-row-icon cmp-rules-icon--${row.kind}`}>
                <KindIcon kind={row.kind} />
              </span>
              <span className="bs-row-body">
                <span className="bs-row-name">{row.target}</span>
                <span className="bs-row-meta cmp-rules-who">
                  <Owners row={row} />
                </span>
              </span>
              <span className={`bs-status ${toneOf(row)}`}>
                {describeSignOffChangeKind(row.kind, open)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {/**
       * A proposed rule Gitea cannot read is not refused — it is left out, and
       * the gate it was meant to be then finds nothing to wait for. Approving
       * one is approving a rule that will not run, which is the single worst
       * state this file has, so it is said on the screen where the approving
       * happens.
       */}
      {unreadable.length > 0 ? (
        <p className="bs-note bs-note--warn cmp-rules-dropped" role="status">
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>
            {unreadable.length === 1
              ? "One proposed line is not a rule Bindersnap wrote, and Gitea would ignore it:"
              : `${unreadable.length} proposed lines are not rules Bindersnap wrote, and Gitea would ignore them:`}{" "}
            {unreadable.map((line) => `line ${line.line}`).join(", ")}. A rule
            Gitea ignores holds nothing.
          </span>
        </p>
      ) : null}
    </section>
  );
}

/** Who signs it off today, and who would — the fact under the rule's name. */
function Owners({ row }: { row: SignOffChangeRow }) {
  if (row.kind === "added") {
    return (
      <>
        Nobody signs this off today →{" "}
        <span className="cmp-rules-to">{row.to}</span> would
      </>
    );
  }

  if (row.kind === "removed") {
    return (
      <>
        <span className="cmp-rules-from">{row.from}</span> signs this off today
        → nobody would
      </>
    );
  }

  return (
    <>
      <span className="cmp-rules-from">{row.from}</span> →{" "}
      <span className="cmp-rules-to">{row.to}</span>
    </>
  );
}

function KindIcon({ kind }: { kind: SignOffChangeRow["kind"] }) {
  const props = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;
  if (kind === "removed") return <ShieldMinus {...props} />;
  if (kind === "reassigned") return <ShieldUser {...props} />;
  return <ShieldCheck {...props} />;
}

/** The chip's tone: a gate coming down is the only one drawn as a loss. */
function toneOf(row: SignOffChangeRow): string {
  if (row.kind === "removed") return "bs-status--changes";
  if (row.kind === "reassigned") return "bs-status--waiting";
  return "bs-status--approved";
}
