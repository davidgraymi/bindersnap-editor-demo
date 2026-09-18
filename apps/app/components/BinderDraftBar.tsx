import { useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import type { DraftAct } from "../../../packages/api-schema/schemas/workspaces";
import { AppIcon } from "./AppIcon";

/**
 * What is in your draft, while you are editing a binder.
 *
 * **The draft is invisible otherwise, and that is the problem this solves.** A
 * draft is a branch: the acts on it are real and committed, and none of them
 * is on the record or in front of anybody. Without a bar saying so, edit mode
 * would look exactly like editing the binder itself — a rename that appears to
 * have happened, on a page that everybody else still sees unchanged.
 *
 * **A sticky footer, not a box above the tree** (D7). It shipped as a tall
 * coral panel wedged between the tabs and the work, which pushed the binder
 * down the page and spent the screen's one coral element on a status message.
 * At the bottom it is reachable at any scroll depth and never between you and
 * the thing you are rearranging.
 *
 * The acts are one line, with the rest a disclosure: they are the change
 * request's description, so they have to be reviewable before it is sent —
 * but a wall of them is not what somebody mid-rename is reading.
 *
 * **Propose** is the filled button because it is the only control that
 * finishes the work; **Discard** is quiet and destructive and belongs nowhere
 * near it.
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
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="bs-draftbar" role="status" aria-live="polite">
      <div className="bs-draftbar-row">
        <span className="bs-draftbar-mark" aria-hidden="true">
          {busy ? (
            <Loader2 size={15} strokeWidth={1.6} className="draft-bar-spin" />
          ) : (
            <AppIcon icon={Pencil} size="sm" />
          )}
        </span>

        <span className="bs-draftbar-body">
          {/* Continuous save, said plainly. There is no Save button and there
              is not going to be one, so the sentence has to carry the promise
              the missing button would have. */}
          <p className="bs-draftbar-title">
            {busy
              ? "Saving to your draft…"
              : acts.length === 0
                ? "You are editing. Nothing in your draft yet."
                : acts.length === 1
                  ? "1 change in your draft"
                  : `${acts.length} changes in your draft`}
          </p>

          {/* The acts themselves, not a count of them — the planners write
              each commit subject in the language of what was done, so this is
              already a readable account of the work, and it is the same list
              that prefills the change request. Newest first, because the
              thing just done is the thing being checked. */}
          <p className="bs-draftbar-note">
            {acts.length > 0
              ? acts.map((act) => act.summary).join(" · ")
              : "Rename something, make a folder, or add a policy. Nobody is asked to look until you propose it."}
          </p>

          {/* Other people's drafts: that they exist, and nothing more. Knowing
              somebody is editing is what stops two people making the same
              folder twice; reading their unproposed work is not something a
              draft offers. */}
          {others.length > 0 ? (
            <p className="bs-draftbar-note">
              {others.length === 1
                ? `${others[0]} is editing this binder too.`
                : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]} are editing this binder too.`}
            </p>
          ) : null}
        </span>

        {acts.length > 1 ? (
          <button
            type="button"
            className="bs-draftbar-toggle"
            aria-expanded={showAll}
            onClick={() => setShowAll((open) => !open)}
          >
            {showAll ? "Hide" : "Show all"}
          </button>
        ) : null}

        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn--quiet draft-bar-discard"
          onClick={onDiscard}
          disabled={busy}
        >
          Discard
        </button>
        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn-primary"
          onClick={onPropose}
          disabled={busy || acts.length === 0}
        >
          Propose
        </button>
      </div>

      {showAll && acts.length > 0 ? (
        <div className="bs-draftacts">
          <ol>
            {acts.map((act) => (
              <li key={act.sha}>{act.summary}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
