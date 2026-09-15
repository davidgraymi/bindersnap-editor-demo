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
  acts,
  onCancel,
  onProposed,
}: ProposeChangePageProps) {
  const [title, setTitle] = useState("");
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
    <section className="binder-pane propose-page">
      <h2 className="propose-title">Propose your changes</h2>
      <p className="propose-lede">
        {acts.length === 1
          ? "One change, going to the people who sign this binder off."
          : `${acts.length} changes, going to the people who sign this binder off.`}
      </p>

      <div className="create-document-form">
        <label htmlFor="propose-title" className="create-document-field">
          <span className="bs-label">What you are asking for</span>
          <input
            id="propose-title"
            className="create-document-input"
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
        </label>

        <label htmlFor="propose-description" className="create-document-field">
          <span className="bs-label">Why — optional</span>
          <textarea
            id="propose-description"
            className="create-document-input propose-description"
            value={description}
            rows={8}
            onChange={(event) => {
              setDescription(event.target.value);
              setError(null);
            }}
            disabled={submitting}
          />
        </label>

        {/* Written down because it is what somebody about to press the button
            is actually unsure of: the acts are already committed, and this
            adds the request around them rather than doing the work again. */}
        <p className="add-policy-note">
          Your draft becomes a change request. Nothing joins the binder until it
          is approved and published.
        </p>

        {error ? (
          <p className="upload-error-message" role="alert">
            {error}
          </p>
        ) : null}

        <div className="upload-modal-actions">
          <button
            type="button"
            className="doc-header-submit"
            onClick={() => void handleSubmit()}
            disabled={title.trim() === "" || submitting}
          >
            {submitting ? "Opening a change…" : "Open the change request"}
          </button>
          <button
            type="button"
            className="bs-btn bs-btn-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Back to editing
          </button>
        </div>
      </div>
    </section>
  );
}
