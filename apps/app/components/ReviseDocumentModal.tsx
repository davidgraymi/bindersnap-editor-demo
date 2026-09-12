import { useState } from "react";

import { reviseBinderDocument, validateUploadFile } from "../api";
import { formatDocumentName } from "../documentDisplay";
import { formatFileSize } from "../documentFile";
import { ChangeTargetField } from "./ChangeTargetField";

/**
 * A new version of a policy that is already in the binder.
 *
 * **The act this replaces was not one.** Revising a policy meant using "Add a
 * policy" and typing a name that slugged to exactly the same thing as the one
 * already filed — get a character wrong and you had two policies at two
 * addresses instead of one policy on its second version. Nothing about that was
 * a workflow; it was what was left over from a path that could only create.
 *
 * So this asks for one thing: the file. The policy is the one whose page you
 * are on, its name does not change, and its version follows the one on record.
 *
 * **The format may change.** A policy kept as a Word file can be replaced by a
 * PDF and it is the same policy on its next version, because a document's
 * identity is a segment of its filename rather than the whole of it (ADR 0005).
 * Said on the screen, because it is the question somebody about to drag a
 * different file in will actually have.
 */

interface ReviseDocumentModalProps {
  org: string;
  binder: string;
  /** The document's address — what the server resolves it by. */
  slugPath: string;
  /** Its name, for the heading. */
  name: string;
  /** The version on record, so the screen can say which one this becomes. */
  currentVersion: number | null;
  onClose: () => void;
  /** The change that would publish it. */
  onProposed: (changeNumber: number) => void;
}

export function ReviseDocumentModal({
  org,
  binder,
  slugPath,
  name,
  currentVersion,
  onClose,
  onProposed,
}: ReviseDocumentModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [changeNumber, setChangeNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const becomes = (currentVersion ?? 0) + 1;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    setError(null);
    if (!chosen) {
      setFile(null);
      return;
    }

    const validation = validateUploadFile(chosen);
    if (!validation.valid) {
      setFile(null);
      setError(validation.reason ?? "That file cannot be uploaded.");
      return;
    }

    setFile(chosen);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setSubmitting(true);
    setError(null);

    try {
      const proposed = await reviseBinderDocument(
        org,
        binder,
        file,
        slugPath,
        changeNumber ?? undefined,
      );
      onProposed(proposed.pullRequestNumber ?? 0);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to propose a new version.",
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
        aria-labelledby="revise-document-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="revise-document-title">
          New version of {formatDocumentName(name)}
        </h2>

        <div className="create-document-form">
          <p className="add-policy-note">
            {currentVersion === null
              ? "This becomes version 1 once the change is published."
              : `On version ${currentVersion} now. This becomes version ${becomes} once the change is published.`}
          </p>

          <label
            htmlFor="revise-document-file"
            className="upload-file-input-label"
          >
            <span className="bs-label">The new file</span>
            <input
              id="revise-document-file"
              type="file"
              className="upload-file-input"
              onChange={handleFileChange}
              disabled={submitting}
            />
          </label>

          {file ? (
            <p className="create-document-file-summary">
              <strong>Selected:</strong> {file.name} (
              {formatFileSize(file.size)})
            </p>
          ) : null}

          <ChangeTargetField
            org={org}
            binder={binder}
            value={changeNumber}
            onChange={setChangeNumber}
            disabled={submitting}
          />

          {/* The question somebody dragging a different format in will have,
              answered before they ask it. */}
          <p className="add-policy-note">
            It can be a different format from the one on record — a Word policy
            replaced by a PDF is the same policy, on its next version.
          </p>

          {error ? (
            <p className="upload-error-message" role="alert">
              {error}
            </p>
          ) : null}

          {/* Nothing on this screen saves, and the button's word is "propose"
              for the same reason the sign-off page's is. */}
          <p className="add-policy-note">
            {changeNumber === null
              ? "This opens a change request. The version on record does not change until it is published."
              : "This goes into that change request. The version on record does not change until the change is published."}
          </p>

          <div className="upload-modal-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => void handleSubmit()}
              disabled={file === null || submitting}
            >
              {submitting ? "Opening a change…" : "Propose this version"}
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
