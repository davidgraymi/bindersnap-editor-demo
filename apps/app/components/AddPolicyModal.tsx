import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Upload } from "lucide-react";

import {
  buildDocumentDisplayPath,
  buildDocumentSlugPath,
} from "../../../packages/utils/documentPath";
import {
  createBinderDocument,
  fetchBinderDocuments,
  validateUploadFile,
} from "../api";
import { formatFileSize } from "../documentFile";
import { formatDocumentName } from "../documentDisplay";
import { AppIcon } from "./AppIcon";
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
  /**
   * The draft this goes into, when the binder is being edited.
   *
   * Set, and the policy joins the work in hand rather than opening a change
   * request of its own — which is the whole point of edit mode: four acts, one
   * request, and the author's own words on it.
   */
  draft?: string;
  onClose: () => void;
  /**
   * The change request the policy is now in.
   *
   * **Not the document's page**, which is where this used to land. A filed
   * policy is not in the binder — it is a change request waiting on a decision,
   * and the binder's own list says so by not carrying it. Landing on the
   * document made the act look finished; landing on the change shows what
   * actually happened and what has to happen next.
   *
   * **Null when it went into a draft**, where there is no change request to
   * send anybody to — the binder stays where it is and the draft bar counts
   * one act more.
   */
  onAdded: (changeNumber: number | null) => void;
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

/**
 * The picker's answer when somebody wants a folder the binder does not have.
 *
 * A picker of what exists is right — a typo used to file a policy in a folder
 * nobody would ever look in — but a binder's first policy has no folders to
 * pick from, so the picker has to be able to make one.
 */
const NEW_FOLDER = "\u0000new";

/** `clinical/nursing` → "Clinical / Nursing". A folder is a slug too. */
function describeFolderPath(folder: string): string {
  return folder.split("/").map(formatDocumentName).join(" / ");
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
  draft,
  onClose,
  onAdded,
}: AddPolicyModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  /** What to call the folder, when the picker's answer is "a new one". */
  const [newFolder, setNewFolder] = useState("");
  /** The folders this binder has, so "where it goes" is a pick, not a path. */
  const [folders, setFolders] = useState<string[] | null>(null);
  /** True while a file is over the zone, so it says it will take it. */
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [changeNumber, setChangeNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setName(suggestName(file.name));
    setError(null);
  }, [file]);

  useEffect(() => {
    let cancelled = false;
    fetchBinderDocuments(org, binder, draft)
      .then((payload) => {
        if (!cancelled) setFolders(payload.folders);
      })
      // A binder whose folders cannot be read still takes a policy, at its
      // top level — which is what the picker then offers.
      .catch(() => {
        if (!cancelled) setFolders([]);
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder, draft]);

  /**
   * Take a file, whichever way it arrived.
   *
   * **Dragged, in practice.** A policy manager has the `.docx` open in the
   * window behind this one; what shipped was the browser's own
   * `Choose File / No file chosen`, which has nothing to drag onto.
   */
  const takeFile = (chosen: File | null) => {
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

  // Where it will land, worked out by the same functions the server commits
  // with — so the address promised here is the address written.
  //
  // The *address*, not the filename: the server also writes a 26-character
  // identity segment into the name (ADR 0005), minted there because only the
  // server can mint one. Showing it here would put a blob nobody typed in front
  // of somebody being asked to confirm where their policy is going, and it is
  // not a thing they can act on.
  const filedIn = folder === NEW_FOLDER ? newFolder.trim() : folder;

  const slugPath = useMemo(
    () => buildDocumentSlugPath(name, filedIn || null),
    [name, filedIn],
  );
  const filePath = useMemo(
    () =>
      file
        ? buildDocumentDisplayPath(
            name,
            extensionOf(file.name),
            filedIn || null,
          )
        : "",
    [file, name, filedIn],
  );

  const canSubmit =
    file !== null &&
    slugPath !== "" &&
    !submitting &&
    (folder !== NEW_FOLDER || newFolder.trim() !== "");

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
        filedIn || undefined,
        draft ? { draft } : changeNumber ? { changeNumber } : undefined,
      );
      onAdded(created.pullRequestNumber);
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

        <div className="create-document-form bs-fields">
          {/* The file input is behind the zone: the zone is the control, and
              clicking it opens the picker for somebody who would rather
              browse. */}
          <input
            id="add-policy-file"
            ref={fileInput}
            type="file"
            className="bs-hidden-file"
            onChange={(event) => takeFile(event.target.files?.[0] ?? null)}
            disabled={submitting}
          />

          {file ? (
            <div className="bs-dropzone bs-dropzone--filled">
              <span className="bs-dropzone-icon" aria-hidden="true">
                <AppIcon icon={FileText} size="lg" />
              </span>
              <span className="bs-dropzone-file">
                <span className="bs-dropzone-lead">{file.name}</span>
                <span className="bs-field-hint">
                  {formatFileSize(file.size)}
                </span>
              </span>
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                disabled={submitting}
                onClick={() => fileInput.current?.click()}
              >
                Replace
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`bs-dropzone${over ? " bs-dropzone--over" : ""}`}
              disabled={submitting}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setOver(false);
                takeFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <AppIcon icon={Upload} size="lg" aria-hidden="true" />
              <span className="bs-dropzone-lead">
                Drop the policy here, or choose a file
              </span>
              <span className="bs-field-hint">
                Word, PDF, Excel — whatever it is written in, up to 25 MB.
              </span>
            </button>
          )}

          <div className="bs-field">
            <label className="bs-field-label" htmlFor="add-policy-name">
              What it is called
            </label>
            <input
              id="add-policy-name"
              className="bs-input"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              placeholder="Infection Control"
              disabled={submitting}
            />
            {/* Derived rather than demanded, and editable rather than fixed:
                the file is already named, and retyping its name is work the
                screen can do. */}
            <p className="bs-field-hint">
              {file
                ? "Taken from the file name. This is what people will look for it under."
                : "Taken from the file name once you choose one."}
            </p>
          </div>

          <div className="bs-field">
            <label className="bs-field-label" htmlFor="add-policy-folder">
              Where it goes
            </label>
            {/* A picker of folders that exist, not a free-text path: a typo
                filed a policy in a folder nobody else would ever look in. */}
            <select
              id="add-policy-folder"
              className="bs-input"
              value={folder}
              disabled={submitting || folders === null}
              onChange={(event) => {
                setFolder(event.target.value);
                setError(null);
              }}
            >
              <option value="">The top level of the binder</option>
              {(folders ?? []).map((entry) => (
                <option key={entry} value={entry}>
                  {describeFolderPath(entry)}
                </option>
              ))}
              <option value={NEW_FOLDER}>A new folder…</option>
            </select>
          </div>

          {folder === NEW_FOLDER ? (
            <div className="bs-field">
              <label className="bs-field-label" htmlFor="add-policy-new-folder">
                What to call the folder
              </label>
              <input
                id="add-policy-new-folder"
                className="bs-input"
                type="text"
                value={newFolder}
                onChange={(event) => {
                  setNewFolder(event.target.value);
                  setError(null);
                }}
                placeholder="Nursing"
                disabled={submitting}
              />
            </div>
          ) : null}

          {/* Not while editing: a draft is already the answer to "where does
              this go", and offering a change request as well would be two. */}
          {draft ? null : (
            <ChangeTargetField
              org={org}
              binder={binder}
              value={changeNumber}
              onChange={setChangeNumber}
              disabled={submitting}
            />
          )}

          {/* Where it lands, before they commit to it. Folders nest as deep as
              anyone wants, and a customer who types one is entitled to see
              what the binder will actually call it. */}
          {filePath ? (
            <p className="bs-field-hint">
              Files as <code className="bs-filename">{filePath}</code>
            </p>
          ) : null}

          {error ? (
            <p className="bs-note bs-note--danger" role="alert">
              {error}
            </p>
          ) : null}

          {/* Nothing reaches the record without a decision — the same promise
              the whole product makes, said where somebody is about to make a
              change rather than only in the marketing. */}
          <p className="bs-field-hint">
            {draft
              ? "This goes into your draft. Nobody is asked to look at it until you propose it."
              : changeNumber === null
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
