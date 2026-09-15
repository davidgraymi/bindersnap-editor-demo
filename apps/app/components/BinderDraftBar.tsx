import { Loader2, Pencil } from "lucide-react";

import type { DraftAct } from "../../../packages/api-schema/schemas/workspaces";

/**
 * What is in your draft, while you are editing a binder.
 *
 * **The draft is invisible otherwise, and that is the problem this solves.** A
 * draft is a branch: the acts on it are real and committed, and none of them
 * is on the record or in front of anybody. Without a bar saying so, edit mode
 * would look exactly like editing the binder itself — a rename that appears to
 * have happened, on a page that everybody else still sees unchanged.
 *
 * So it says three things, in the order somebody needs them: that you are
 * editing, what you have done, and the two ways out. **Propose** is the filled
 * button because it is the only one that finishes the work; **Discard** is
 * quiet and destructive and belongs nowhere near it.
 *
 * Persistent rather than a toast. It is not an announcement of something that
 * happened — it is the state you are in, and it stays until you leave it.
 */

interface BinderDraftBarProps {
  /** Newest first, the way the server returns them. */
  acts: readonly DraftAct[];
  /** Somebody else is editing this binder too. Named, not counted. */
  others: readonly string[];
  /** True while an act is being committed, so the bar can say "saving". */
  busy?: boolean;
  onPropose: () => void;
  onDiscard: () => void;
}

export function BinderDraftBar({
  acts,
  others,
  busy = false,
  onPropose,
  onDiscard,
}: BinderDraftBarProps) {
  return (
    <div className="draft-bar" role="status" aria-live="polite">
      <div className="draft-bar-body">
        <span className="draft-bar-icon" aria-hidden="true">
          {busy ? (
            <Loader2 size={16} strokeWidth={1.6} className="draft-bar-spin" />
          ) : (
            <Pencil size={16} strokeWidth={1.6} />
          )}
        </span>

        <div className="draft-bar-text">
          {/* Continuous save, said plainly. There is no Save button and there
              is not going to be one, so the sentence has to carry the promise
              the missing button would have. */}
          <p className="draft-bar-title">
            {busy
              ? "Saving to your draft…"
              : acts.length === 0
                ? "You are editing. Nothing in your draft yet."
                : acts.length === 1
                  ? "1 change in your draft"
                  : `${acts.length} changes in your draft`}
          </p>

          {/* The acts themselves, not a count of them. The planners write each
              commit subject in the language of what was done — "Make the
              folder nursing" — so this list is already a readable account of
              the work, and it is the same list that prefills the change
              request. Newest first, because the thing just done is the thing
              being checked. */}
          {acts.length > 0 ? (
            <ul className="draft-bar-acts">
              {acts.map((act) => (
                <li key={act.sha}>{act.summary}</li>
              ))}
            </ul>
          ) : (
            <p className="draft-bar-note">
              Rename something, make a folder, or add a policy. Nobody is asked
              to look until you propose it.
            </p>
          )}

          {/* Other people's drafts: that they exist, and nothing more. Knowing
              somebody is editing is what stops two people making the same
              folder twice; reading their unproposed work is not something a
              draft offers. */}
          {others.length > 0 ? (
            <p className="draft-bar-note">
              {others.length === 1
                ? `${others[0]} is editing this binder too.`
                : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]} are editing this binder too.`}
            </p>
          ) : null}
        </div>
      </div>

      <div className="draft-bar-actions">
        <button
          type="button"
          className="bs-btn bs-btn-secondary draft-bar-discard"
          onClick={onDiscard}
          disabled={busy}
        >
          Discard
        </button>
        <button
          type="button"
          className="doc-header-submit"
          onClick={onPropose}
          disabled={busy || acts.length === 0}
        >
          Propose
        </button>
      </div>
    </div>
  );
}
