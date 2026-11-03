import { useEffect, useState } from "react";

import type { ConvertedDocument } from "../convertToEditor";

/**
 * Turning a Word file or a PDF into a Bindersnap document.
 *
 * **Read first, written second.** The file is read and converted the moment
 * this opens, and nothing is written until the person presses the button — so
 * what a conversion loses is on the screen before it costs anything. Pressing
 * it puts the converted document into the author's draft as the next version
 * of the same document; the original stays in the record, and a reviewer sees
 * the conversion as a diff against it like any other change.
 *
 * Not automatic, on purpose: a Word file kept as a file is often kept exactly
 * as it is, and a PDF cannot be converted without guessing at its structure.
 */

interface ConvertDocumentModalProps<T extends ConvertedDocument> {
  /** The document's name, for the heading. */
  name: string;
  /** What kind of file it is, for the wording. */
  kind: "word" | "pdf";
  /** Read the file and convert it. Rejects with the reason it cannot be. */
  load: () => Promise<T>;
  /** Write the converted document into the draft and open the editor. */
  onConfirm: (converted: T) => Promise<void>;
  onClose: () => void;
}

export function ConvertDocumentModal<T extends ConvertedDocument>({
  name,
  kind,
  load,
  onConfirm,
  onClose,
}: ConvertDocumentModalProps<T>) {
  const [converted, setConverted] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (result) => {
        if (!cancelled) setConverted(result);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "That file could not be converted.",
        );
      },
    );
    return () => {
      cancelled = true;
    };
    // Read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = async () => {
    if (!converted) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(converted);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to convert that document.",
      );
      setSubmitting(false);
    }
  };

  const reading = converted === null && error === null;

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
        aria-labelledby="convert-document-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="convert-document-title">Edit {name} in Bindersnap</h2>

        <div className="create-document-form">
          <p className="add-policy-note">
            {kind === "pdf" ? "This PDF" : "This Word file"} becomes a
            Bindersnap document you can edit here. It goes into your draft as
            the next version of {name}, and nobody is asked to look at it until
            you propose it. The original stays in the record.
          </p>

          {reading ? (
            <p className="add-policy-note" role="status">
              Reading the file…
            </p>
          ) : null}

          {converted ? (
            <ul className="add-policy-note">
              {converted.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          {error ? (
            <p className="upload-error-message" role="alert">
              {error}
            </p>
          ) : null}

          <div className="upload-modal-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => void handleConfirm()}
              disabled={converted === null || submitting}
            >
              {submitting ? "Converting…" : "Convert and edit"}
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
