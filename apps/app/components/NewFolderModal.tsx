import { useState } from "react";

import { createBinderFolder } from "../api";
import { ChangeTargetField } from "./ChangeTargetField";

/**
 * Making a folder.
 *
 * **Git has no empty directories.** A folder exists because a file is in it, so
 * making an empty one means committing a placeholder — and `main` is protected,
 * so that commit goes through a change request like everything else. That is
 * heavier than making a folder in Finder, and the screen says so rather than
 * letting somebody press the button and wonder why nothing appeared.
 *
 * The alternative was folders that come into existence only when the first
 * policy is filed in one, which is a smaller lie but a lie: you would be unable
 * to lay out a filing structure before filling it.
 */

interface NewFolderModalProps {
  org: string;
  binder: string;
  /**
   * The draft this goes into, when the binder is being edited.
   *
   * Set, and there is no question left to ask: the folder joins the work in
   * hand and nothing is proposed to anybody until the draft is. Unset, and
   * this is the old behaviour — a change request, opened now.
   */
  draft?: string;
  onClose: () => void;
  /** Null when the folder went into a draft, which has no change request. */
  onProposed: (changeNumber: number | null) => void;
}

export function NewFolderModal({
  org,
  binder,
  draft,
  onClose,
  onProposed,
}: NewFolderModalProps) {
  const [folder, setFolder] = useState("");
  const [changeNumber, setChangeNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (folder.trim() === "") return;
    setSubmitting(true);
    setError(null);

    try {
      const proposed = await createBinderFolder(
        org,
        binder,
        folder.trim(),
        draft ? { draft } : changeNumber ? { changeNumber } : undefined,
      );
      onProposed(proposed.changeNumber);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to add that folder.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      className="upload-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="upload-modal create-document-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-folder-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="new-folder-title">New folder</h2>

        <div className="create-document-form">
          <label htmlFor="new-folder-name" className="create-document-field">
            <span className="bs-label">What to call it</span>
            <input
              id="new-folder-name"
              className="create-document-input"
              type="text"
              value={folder}
              onChange={(event) => {
                setFolder(event.target.value);
                setError(null);
              }}
              placeholder="Nursing"
              disabled={submitting}
              autoFocus
            />
          </label>

          {/* Folders nest, and typing a path is how you say so. Said out loud
              because nothing else on the screen would suggest it. */}
          <p className="add-policy-note">
            Use slashes to nest — <code>clinical/nursing</code> makes a folder
            inside a folder.
          </p>

          {draft ? null : (
            <ChangeTargetField
              org={org}
              binder={binder}
              value={changeNumber}
              onChange={setChangeNumber}
              disabled={submitting}
            />
          )}

          {error ? (
            <p className="upload-error-message" role="alert">
              {error}
            </p>
          ) : null}

          <p className="add-policy-note">
            {draft
              ? "This goes into your draft. Nobody is asked to look at it until you propose it."
              : "A binder’s folders are part of its record, so this is a change request like any other. The folder appears once it is published."}
          </p>

          <div className="upload-modal-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => void handleSubmit()}
              disabled={folder.trim() === "" || submitting}
            >
              {submitting
                ? draft
                  ? "Adding…"
                  : "Opening a change…"
                : "Add folder"}
            </button>
            <button
              type="button"
              className="bs-btn bs-btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
