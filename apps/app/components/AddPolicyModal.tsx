import { useEffect, useMemo, useState } from "react";

import {
  buildDocumentFilePath,
  buildDocumentSlugPath,
} from "../../../packages/utils/documentPath";
import { createBinderDocument, validateUploadFile } from "../api";
import { formatFileSize } from "../documentFile";

/**
 * Adding a policy to a binder.
 *
 * The binder already exists, is already protected, and already has its people,
 * so this asks for the three things it cannot know: the file, what to call it,
 * and which folder to file it in. Everything the old create-a-document modal
 * did — making a repository, protecting its branch, installing rules — is a
 * property of the binder now, which is why this screen is short.
 */

interface AddPolicyModalProps {
  org: string;
  binder: string;
  onClose: () => void;
  /** The document's identity, which is the address its page lives at. */
  onAdded: (slugPath: string) => void;
}

/** `Infection_Control_Policy_v3.docx` → `Infection Control Policy v3`. */
function suggestName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const lastDot = base.lastIndexOf(".");
  return (lastDot <= 0 ? base : base.slice(0, lastDot))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The extension the server will keep, so the preview can show it. */
function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const lastDot = base.lastIndexOf(".");
  return lastDot <= 0 ? "" : base.slice(lastDot + 1);
}

export function AddPolicyModal({
  org,
  binder,
  onClose,
  onAdded,
}: AddPolicyModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setName(suggestName(file.name));
    setError(null);
  }, [file]);

  // Where it will land, worked out by the same function the server commits
  // with — so the address promised here is the address written.
  const slugPath = useMemo(
    () => buildDocumentSlugPath(name, folder || null),
    [name, folder],
  );
  const filePath = useMemo(
    () =>
      file
        ? buildDocumentFilePath(name, extensionOf(file.name), folder || null)
        : "",
    [file, name, folder],
  );

  const canSubmit = file !== null && slugPath !== "" && !submitting;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
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
      const created = await createBinderDocument(
        org,
        binder,
        file,
        name.trim(),
        folder.trim() || undefined,
      );
      onAdded(created.slugPath);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to add this policy.",
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
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bs-eyebrow">{binder}</div>
        <h2>Add a policy</h2>

        <div className="create-document-form">
          <label htmlFor="add-policy-file" className="upload-file-input-label">
            <span className="bs-eyebrow">Choose file</span>
            <input
              id="add-policy-file"
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

          <label htmlFor="add-policy-name" className="create-document-field">
            <span className="bs-eyebrow">What it is called</span>
            <input
              id="add-policy-name"
              className="create-document-input"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder="Infection Control"
              disabled={submitting}
            />
          </label>

          <label htmlFor="add-policy-folder" className="create-document-field">
            <span className="bs-eyebrow">Folder — optional</span>
            <input
              id="add-policy-folder"
              className="create-document-input"
              type="text"
              value={folder}
              onChange={(event) => {
                setFolder(event.target.value);
                setError(null);
              }}
              placeholder="Nursing"
              disabled={submitting}
            />
          </label>

          {/* Where it lands, before they commit to it. Folders nest as deep as
              anyone wants, and a customer who types one is entitled to see
              what the binder will actually call it. */}
          {filePath ? (
            <p className="add-policy-path">
              Files as <code>{filePath}</code>
            </p>
          ) : null}

          {error ? (
            <p className="upload-error-message" role="alert">
              {error}
            </p>
          ) : null}

          {/* Nothing reaches the record without a decision — the same promise
              the whole product makes, said where somebody is about to make a
              change rather than only in the marketing. */}
          <p className="add-policy-note">
            This opens a change. The policy joins the binder once it is approved
            and published.
          </p>

          <div className="upload-modal-actions">
            <button
              className="bs-btn bs-btn-primary"
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {submitting ? "Adding…" : "Add policy"}
            </button>
            <button
              className="bs-btn bs-btn-secondary"
              type="button"
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
