import { useState } from "react";

import { proposeBinderDraft } from "../api";
import type { DraftAct } from "../../../packages/api-schema/schemas/workspaces";

/**
 * Writing up a draft, which is the moment it becomes a change request.
 *
 * **The words are the author's.** Until drafts existed the server wrote the
 * title — `Add nursing/hand-hygiene` — so the person who made the change did
 * not own the sentence explaining it to the people deciding on it. A change
 * request is a request: it is addressed to colleagues, and this is the screen
 * where somebody says what they are asking for and why.
 *
 * **The description is prefilled; the title is not.** The acts on a draft are
 * its commits, each written in the language of what was done, so the list of
 * them is already an accurate account of the work and nobody should have to
 * retype it. The title is the one thing no planner can write — "what is this
 * change *for*" is not derivable from four renames — so it starts empty, and
 * the button stays off until it is answered.
 *
 * Oldest first here, unlike the draft bar. The bar answers "did that last
 * thing land"; this is a narrative, and a narrative runs forwards.
 */

interface ProposeChangePageProps {
  org: string;
  binder: string;
  /** Which draft is being proposed. A person may have several. */
  draft: string;
  /**
   * What its author called it, prefilled as the title when they wrote one.
   *
   * **The name is not a second thing to write.** Somebody who started a draft
   * called "Reorganise nursing" has already said what this is for, and asking
   * again on the way out invites either a worse sentence or the same one
   * retyped. Still editable — the work a draft turned into is often not what
   * it was started for, and this is the last chance to say so.
   *
   * Empty when nobody named it. A draft started by pressing Edit takes the
   * date it was made, and "Draft of 19 September" in front of reviewers as the
   * sentence explaining a change is exactly what this screen exists to
   * prevent — so the box stays empty and the button stays off until somebody
   * answers it.
   */
  name: string;
  /** Newest first, as the draft returns them. */
  acts: readonly DraftAct[];
  onCancel: () => void;
  onProposed: (changeNumber: number) => void;
}

/** The acts as a description somebody can edit rather than start from nothing. */
export function describeActs(acts: readonly DraftAct[]): string {
  return [...acts]
    .reverse()
    .map((act) => `- ${act.summary}`)
    .join("\n");
}

export function ProposeChangePage({
  org,
  binder,
  draft,
  name,
  acts,
  onCancel,
  onProposed,
}: ProposeChangePageProps) {
  const [title, setTitle] = useState(name);
  const [description, setDescription] = useState(() => describeActs(acts));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (title.trim() === "") return;
    setSubmitting(true);
    setError(null);

    try {
      const proposed = await proposeBinderDraft(
        org,
        binder,
        title.trim(),
        description,
        draft,
      );
      onProposed(proposed.changeNumber);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to open a change request.",
      );
      setSubmitting(false);
    }
  };

  return (
    <section className="binder-pane">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">Propose your changes</h1>
          <p className="bs-subtitle">
            {acts.length === 1
              ? "One change, going to the people who sign this binder off."
              : `${acts.length} changes, going to the people who sign this binder off.`}{" "}
            Nothing joins the binder until it is approved and published.
          </p>
        </div>
      </div>

      <div className="bs-with-rail">
        <div className="bs-fields">
          <div className="bs-field">
            <label className="bs-field-label" htmlFor="propose-title">
              What you are asking for
            </label>
            <input
              id="propose-title"
              className="bs-input"
              type="text"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setError(null);
              }}
              placeholder="Reorganise the nursing policies"
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="bs-field">
            <label className="bs-field-label" htmlFor="propose-description">
              Why
              <span className="bs-field-optional">optional</span>
            </label>
            <textarea
              id="propose-description"
              className="bs-input propose-description"
              value={description}
              rows={8}
              onChange={(event) => {
                setDescription(event.target.value);
                setError(null);
              }}
              disabled={submitting}
            />
          </div>

          {error ? (
            <p className="bs-note bs-note--danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="bs-field-row">
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => void handleSubmit()}
              disabled={title.trim() === "" || submitting}
            >
              {submitting ? "Opening a change…" : "Open the change request"}
            </button>
            <button
              type="button"
              className="bs-btn bs-btn--quiet"
              onClick={onCancel}
              disabled={submitting}
            >
              Back to editing
            </button>
          </div>
        </div>

        {/* **What is actually in the envelope**, beside the form rather than
            summarised in the prefilled description. Somebody who has been
            editing for twenty minutes cannot check a paragraph against what
            they meant to send; they can check a list. Oldest first, because
            this is a narrative and a narrative runs forwards. */}
        <aside className="bs-rail" aria-label="What you are sending">
          <div className="bs-panel">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title">
                {acts.length === 1 ? "1 change" : `${acts.length} changes`}
              </h2>
            </div>
            <ol className="bs-row-list">
              {[...acts].reverse().map((act) => (
                <li className="bs-row" key={act.sha}>
                  <span className="bs-row-body">
                    <span className="bs-row-name bs-row-name--wrap">
                      {act.summary}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </section>
  );
}
