import { useEffect, useMemo, useState } from "react";

import {
  buildDocumentDisplayPath,
  buildDocumentSlugPath,
} from "../../../packages/utils/documentPath";
import { createBinderDocument, validateUploadFile } from "../api";
import { formatFileSize } from "../documentFile";
import { ChangeTargetField } from "./ChangeTargetField";

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
  /**
   * The change request the policy is now in.
   *
   * **Not the document's page**, which is where this used to land. A filed
   * policy is not in the binder — it is a change request waiting on a decision,
   * and the binder's own list says so by not carrying it. Landing on the
   * document made the act look finished; landing on the change shows what
   * actually happened and what has to happen next.
   */
  onAdded: (changeNumber: number) => void;
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
  const [changeNumber, setChangeNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setName(suggestName(file.name));
    setError(null);
  }, [file]);

  // Where it will land, worked out by the same functions the server commits
  // with — so the address promised here is the address written.
  //
  // The *address*, not the filename: the server also writes a 26-character
  // identity segment into the name (ADR 0005), minted there because only the
  // server can mint one. Showing it here would put a blob nobody typed in front
  // of somebody being asked to confirm where their policy is going, and it is
  // not a thing they can act on.
  const slugPath = useMemo(
    () => buildDocumentSlugPath(name, folder || null),
    [name, folder],
  );
  const filePath = useMemo(
    () =>
      file
        ? buildDocumentDisplayPath(name, extensionOf(file.name), folder || null)
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
        changeNumber ?? undefined,
      );
      onAdded(created.pullRequestNumber ?? 0);
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
        <h2>Add a policy</h2>

        <div className="create-document-form">
          <label htmlFor="add-policy-file" className="upload-file-input-label">
            <span className="bs-label">Choose file</span>
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
            <span className="bs-label">What it is called</span>
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
            <span className="bs-label">Folder — optional</span>
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

          <ChangeTargetField
            org={org}
            binder={binder}
            value={changeNumber}
            onChange={setChangeNumber}
            disabled={submitting}
          />

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
            {changeNumber === null
              ? "This opens a change request. The policy joins the binder once it is approved and published."
              : "This goes into that change request. The policy joins the binder once the change is approved and published."}
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
