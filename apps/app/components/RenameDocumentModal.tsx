import { useState } from "react";

import { renameBinderDocument } from "../api";
import { formatDocumentName } from "../documentDisplay";
import { ChangeTargetField } from "./ChangeTargetField";

/**
 * Renaming a policy, filing it somewhere else, or both.
 *
 * **This is the act ADR 0005 was written for.** A document's identity is a
 * segment of its filename rather than the whole of it, so the version tags
 * still match after the human half changes — the policy carries on from the
 * version it was on instead of restarting at v1 with every tag it had orphaned
 * behind it. Until that landed, shipping this would have quietly destroyed the
 * compliance record of anything anybody renamed.
 *
 * Name and folder together, because they are one question — "where does this
 * live and what is it called" — and splitting them into two change requests
 * would make a common act twice the ceremony.
 */

interface RenameDocumentModalProps {
  org: string;
  binder: string;
  /** The document's address, which is what the server resolves it by. */
  slugPath: string;
  name: string;
  folder: string;
  /** The binder's folders, so filing it elsewhere is a choice rather than typing. */
  folders: string[];
  onClose: () => void;
  onProposed: (changeNumber: number) => void;
}

export function RenameDocumentModal({
  org,
  binder,
  slugPath,
  name,
  folder,
  folders,
  onClose,
  onProposed,
}: RenameDocumentModalProps) {
  const [nextName, setNextName] = useState(() => formatDocumentName(name));
  const [nextFolder, setNextFolder] = useState(folder);
  const [changeNumber, setChangeNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A folder the binder no longer has is still offered when this document is
  // in it, so opening the screen to rename a policy cannot silently refile it.
  const options = folders.includes(folder) ? folders : [folder, ...folders];

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const proposed = await renameBinderDocument(
        org,
        binder,
        slugPath,
        { name: nextName.trim(), folder: nextFolder },
        changeNumber ?? undefined,
      );
      onProposed(proposed.changeNumber);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to rename this policy.",
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
        aria-labelledby="rename-document-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="rename-document-title">Rename or move</h2>

        <div className="create-document-form">
          <label
            htmlFor="rename-document-name"
            className="create-document-field"
          >
            <span className="bs-label">What it is called</span>
            <input
              id="rename-document-name"
              className="create-document-input"
              type="text"
              value={nextName}
              onChange={(event) => {
                setNextName(event.target.value);
                setError(null);
              }}
              disabled={submitting}
              autoFocus
            />
          </label>

          <label
            htmlFor="rename-document-folder"
            className="create-document-field"
          >
            <span className="bs-label">Folder</span>
            <select
              id="rename-document-folder"
              className="create-document-input"
              value={nextFolder}
              disabled={submitting}
              onChange={(event) => {
                setNextFolder(event.target.value);
                setError(null);
              }}
            >
              <option value="">The binder&rsquo;s top level</option>
              {options
                .filter((entry) => entry !== "")
                .map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
            </select>
          </label>

          <ChangeTargetField
            org={org}
            binder={binder}
            value={changeNumber}
            onChange={setChangeNumber}
            disabled={submitting}
          />

          {error ? (
            <p className="upload-error-message" role="alert">
              {error}
            </p>
          ) : null}

          {/* The reassurance that matters, because it is the thing somebody
              hesitating over this button is actually worried about. */}
          <p className="add-policy-note">
            Every version stays with it. A renamed policy carries on from the
            version it is on rather than starting again.
          </p>

          <div className="upload-modal-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => void handleSubmit()}
              disabled={nextName.trim() === "" || submitting}
            >
              {submitting ? "Opening a change…" : "Propose this"}
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
