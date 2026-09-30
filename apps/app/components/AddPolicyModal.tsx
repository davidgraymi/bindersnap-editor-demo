import { useEffect, useMemo, useRef, useState } from "react";
import { FilePen, FileText, FolderUp, Upload, X } from "lucide-react";

import {
  buildDocumentDisplayPath,
  buildDocumentSlugPath,
} from "../../../packages/utils/documentPath";
import {
  createBinderDocument,
  discardBinderDraft,
  fetchBinderDocuments,
  openBinderDraft,
  proposeBinderDraft,
  validateUploadFile,
} from "../api";
import {
  describeBulkChange,
  filesFromDrop,
  filesFromInput,
  nameFromFile,
  planBulkUpload,
  type BulkSource,
} from "../bulkUpload";
import { formatFileSize } from "../documentFile";
import { formatDocumentName } from "../documentDisplay";
import { AppIcon } from "./AppIcon";
import { ChangeTargetField } from "./ChangeTargetField";
import { askReviewers } from "./ProposeChangePage";
import { ReviewerChooser } from "./ReviewerChooser";

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
  /** Who is adding it, so they are not offered as its reviewer. */
  currentUser: string;
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
  /**
   * A document started in the editor rather than uploaded: where it is, and
   * the draft it was started in, so the editor can open it there.
   *
   * Absent, and the dialog only uploads.
   */
  onWrite?: (slugPath: string, draft: string) => void;
  /**
   * Which choice the dialog opens on. The editor's New asks to write, since
   * somebody already in the word processor is not about to upload; the folder
   * is the one the open policy is in, where a sibling most likely goes.
   */
  initialMode?: "upload" | "write";
  initialFolder?: string;
}

/**
 * A new policy written here starts as its title and an empty paragraph to
 * type into — Word's blank document, with the one line every policy has.
 */
function blankPolicy(name: string): string {
  return JSON.stringify(
    {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: name }],
        },
        { type: "paragraph" },
      ],
    },
    null,
    2,
  );
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
  currentUser,
  draft,
  onClose,
  onAdded,
  onWrite,
  initialMode = "upload",
  initialFolder = "",
}: AddPolicyModalProps) {
  /**
   * Upload a file written elsewhere, or write a new one here.
   *
   * Upload stays first because it is what a binder is mostly filled with —
   * the Word files and PDFs a team already has. Writing here is the other
   * half of the product, and it is one click away rather than a separate
   * menu somebody has to find.
   */
  const [mode, setMode] = useState<"upload" | "write">(initialMode);
  const writing = mode === "write" && onWrite !== undefined;
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(initialFolder);
  /** Who the change this opens is sent to. */
  const [reviewers, setReviewers] = useState<string[]>([]);
  /** What to call the folder, when the picker's answer is "a new one". */
  const [newFolder, setNewFolder] = useState("");
  /** The folders this binder has, so "where it goes" is a pick, not a path. */
  const [folders, setFolders] = useState<string[] | null>(null);
  /** True while a file is over the zone, so it says it will take it. */
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  /**
   * Several files, or a folder: everything goes into one change request.
   * Null for the ordinary one file.
   */
  const [sources, setSources] = useState<BulkSource[] | null>(null);
  /** How far a bulk upload has got, while it runs. */
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  /** The files a bulk upload could not add, and why. */
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>(
    [],
  );
  /** The change a bulk upload opened, once some of it has landed. */
  const [bulkChange, setBulkChange] = useState<number | null>(null);
  const [changeNumber, setChangeNumber] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    setName(nameFromFile(file.name));
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

  /** One file is the ordinary dialog; more than one, or a folder, is a batch. */
  const takeSources = (found: BulkSource[], fromFolder: boolean) => {
    setError(null);
    if (found.length === 0) return;
    if (found.length === 1 && !fromFolder) {
      setSources(null);
      takeFile(found[0]!.file as File);
      return;
    }
    setFile(null);
    setSources(found);
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

  const plan = useMemo(
    () =>
      sources
        ? planBulkUpload(sources as (BulkSource & { file: File })[], filedIn)
        : null,
    [sources, filedIn],
  );

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

  const canSubmit = plan
    ? plan.items.length > 0 &&
      !submitting &&
      (folder !== NEW_FOLDER || newFolder.trim() !== "")
    : (writing || file !== null) &&
      slugPath !== "" &&
      !submitting &&
      (folder !== NEW_FOLDER || newFolder.trim() !== "");

  /**
   * Add every planned file, one after another, then open one change.
   *
   * **Into a draft of their own first.** Added straight into an open change,
   * each file after the first was an "update" to it — the timeline said so a
   * hundred times, and said earlier approvals were reset when there were none.
   * Staged in a fresh draft and proposed once, the change opens whole, with
   * one line saying it did.
   *
   * **One at a time, on purpose.** Each is a commit on the same branch, and
   * two sent at once would race for the branch head. A file that is refused
   * does not stop the rest: the person is told which, and the change that
   * holds the others is still theirs to open.
   */
  const submitBatch = async () => {
    if (!plan) return;
    setSubmitting(true);
    setError(null);
    setFailures([]);
    const failed: { name: string; reason: string }[] = [];
    const added: typeof plan.items = [];
    const subject = describeBulkChange(plan.items);

    let target: { draft: string } | { changeNumber: number };
    let staged: string | null = null;
    try {
      if (draft) {
        target = { draft };
      } else if (changeNumber !== null) {
        target = { changeNumber };
      } else {
        const opened = await openBinderDraft(org, binder, subject.title);
        staged = opened.draft?.branch ?? null;
        if (!staged)
          throw new Error("A draft to add them to could not be started.");
        target = { draft: staged };
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to add these documents.",
      );
      setSubmitting(false);
      return;
    }

    for (const [index, item] of plan.items.entries()) {
      setProgress({ done: index, total: plan.items.length });
      try {
        await createBinderDocument(
          org,
          binder,
          item.file,
          item.name,
          item.folder || undefined,
          target,
        );
        added.push(item);
      } catch (err) {
        failed.push({
          name: item.relativePath,
          reason:
            err instanceof Error && err.message.trim() !== ""
              ? err.message
              : "It could not be added.",
        });
      }
    }
    setProgress({ done: plan.items.length, total: plan.items.length });

    let opened: number | null = changeNumber;
    if (staged) {
      if (added.length === 0) {
        await discardBinderDraft(org, binder, staged).catch(() => undefined);
      } else {
        try {
          const done = describeBulkChange(added);
          const proposed = await proposeBinderDraft(
            org,
            binder,
            done.title,
            done.body,
            staged,
          );
          opened = proposed.changeNumber;
          setBulkChange(opened);
          await askReviewers(org, binder, opened, reviewers);
        } catch (err) {
          failed.push({
            name: "The change request",
            reason:
              err instanceof Error && err.message.trim() !== ""
                ? `${err.message} The documents are in your draft “${subject.title}”.`
                : `It could not be opened. The documents are in your draft “${subject.title}”.`,
          });
        }
      }
    }
    setProgress(null);

    if (failed.length === 0) {
      onAdded(draft ? null : opened);
      return;
    }
    setFailures(failed);
    setSubmitting(false);
  };

  const handleSubmit = async () => {
    if (writing) {
      await startWriting();
      return;
    }
    if (plan) {
      await submitBatch();
      return;
    }
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
      // Only a change this opened: one added to an existing change already
      // has its reviewers, and a draft is asked nobody until it is proposed.
      if (changeNumber === null && created.pullRequestNumber) {
        await askReviewers(org, binder, created.pullRequestNumber, reviewers);
      }
      onAdded(created.pullRequestNumber);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to add this document.",
      );
      setSubmitting(false);
    }
  };

  /**
   * Start it in your draft and open it in the editor.
   *
   * **Always a draft, never a change request of its own.** A blank page is
   * not something to ask three colleagues to approve; it is somewhere to
   * start. The draft is the one you are in, or the one editing opens.
   */
  const startWriting = async () => {
    if (!onWrite) return;
    setSubmitting(true);
    setError(null);
    try {
      const title = name.trim();
      const created = await createBinderDocument(
        org,
        binder,
        new File([blankPolicy(title)], "document.json", {
          type: "application/json",
        }),
        title,
        filedIn || undefined,
        { draft: draft ?? true },
      );
      onWrite(created.slugPath, created.branch);
    } catch (err) {
      setError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to start this document.",
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
        <h2>{plan ? "Add documents" : "Add a document"}</h2>

        <div className="create-document-form bs-fields">
          {onWrite ? (
            <div
              className="bs-fields add-policy-mode"
              role="radiogroup"
              aria-label="How to add it"
            >
              <label className="bs-choice">
                <input
                  type="radio"
                  name="add-policy-mode"
                  checked={mode === "upload"}
                  disabled={submitting}
                  onChange={() => setMode("upload")}
                />
                <Upload
                  className="bs-choice-icon"
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span>
                  <span className="bs-choice-name">Upload a file</span>
                  <span className="bs-choice-note">
                    A Word document, PDF or spreadsheet you already have.
                  </span>
                </span>
              </label>
              <label className="bs-choice">
                <input
                  type="radio"
                  name="add-policy-mode"
                  checked={mode === "write"}
                  disabled={submitting}
                  onChange={() => {
                    setMode("write");
                    setError(null);
                  }}
                />
                <FilePen
                  className="bs-choice-icon"
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span>
                  <span className="bs-choice-name">Write it here</span>
                  <span className="bs-choice-note">
                    A blank page in the editor, saved as you go into your draft.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {/* The file input is behind the zone: the zone is the control, and
              clicking it opens the picker for somebody who would rather
              browse. */}
          <input
            id="add-policy-file"
            ref={fileInput}
            type="file"
            multiple
            className="bs-hidden-file"
            onChange={(event) => {
              takeSources(filesFromInput(event.target.files), false);
              event.target.value = "";
            }}
            disabled={submitting}
          />
          <input
            id="add-policy-folder-input"
            ref={folderInput}
            type="file"
            className="bs-hidden-file"
            // Not in React's types, and every browser we support has it.
            {...{ webkitdirectory: "", directory: "" }}
            onChange={(event) => {
              takeSources(filesFromInput(event.target.files), true);
              event.target.value = "";
            }}
            disabled={submitting}
          />

          {writing ? null : plan ? (
            <BulkList
              plan={plan}
              progress={progress}
              disabled={submitting}
              onRemove={(relativePath) =>
                setSources(
                  (current) =>
                    current?.filter(
                      (entry) => entry.relativePath !== relativePath,
                    ) ?? null,
                )
              }
              onClear={() => {
                setSources(null);
                setFailures([]);
              }}
            />
          ) : file ? (
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
                const items = event.dataTransfer.items;
                const hasFolder = Array.from(items ?? []).some(
                  (item) => item.webkitGetAsEntry?.()?.isDirectory,
                );
                if (items && (hasFolder || items.length > 1)) {
                  void filesFromDrop(items).then((found) =>
                    takeSources(found, hasFolder),
                  );
                  return;
                }
                takeFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <AppIcon icon={Upload} size="lg" aria-hidden="true" />
              <span className="bs-dropzone-lead">
                Drop documents or a folder here, or choose files
              </span>
              <span className="bs-field-hint">
                Word, PDF, Excel — whatever it is written in, up to 25 MB each.
              </span>
            </button>
          )}

          {writing || file || plan ? null : (
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn--quiet add-policy-folder-pick"
              disabled={submitting}
              onClick={() => folderInput.current?.click()}
            >
              <AppIcon icon={FolderUp} size="sm" aria-hidden="true" />
              Add a whole folder
            </button>
          )}

          {plan ? null : (
            <>
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
                  {writing
                    ? "Its title, and what people will look for it under."
                    : file
                      ? "Taken from the file name. This is what people will look for it under."
                      : "Taken from the file name once you choose one."}
                </p>
              </div>
            </>
          )}

          <div className="bs-field">
            <label className="bs-field-label" htmlFor="add-policy-folder">
              {plan ? "Where they go" : "Where it goes"}
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
          {draft || writing ? null : (
            <ChangeTargetField
              org={org}
              binder={binder}
              value={changeNumber}
              onChange={setChangeNumber}
              disabled={submitting}
            />
          )}

          {draft || writing || changeNumber !== null ? null : (
            <ReviewerChooser
              org={org}
              binder={binder}
              currentUser={currentUser}
              selected={reviewers}
              onChange={setReviewers}
              disabled={submitting}
            />
          )}

          {/* Where it lands, before they commit to it. Folders nest as deep as
              anyone wants, and a customer who types one is entitled to see
              what the binder will actually call it. */}
          {!plan && filePath && name.trim() !== "" ? (
            <p className="bs-field-hint">
              It goes in as <strong>{name.trim()}</strong>,{" "}
              {filedIn
                ? `in ${describeFolderPath(filedIn)}.`
                : "at the top of the binder."}
            </p>
          ) : null}

          {error ? (
            <p className="bs-note bs-note--danger" role="alert">
              {error}
            </p>
          ) : null}

          {failures.length > 0 ? (
            <div className="bs-note bs-note--danger" role="alert">
              <p>
                {failures.length === 1
                  ? "One file could not be added:"
                  : `${failures.length} files could not be added:`}
              </p>
              <ul className="bulk-failures">
                {failures.map((failure) => (
                  <li key={failure.name}>
                    <strong>{failure.name}</strong> — {failure.reason}
                  </li>
                ))}
              </ul>
              {bulkChange !== null ? (
                <button
                  type="button"
                  className="bs-btn bs-btn--sm bs-btn-secondary"
                  onClick={() => onAdded(bulkChange)}
                >
                  Open the change request with the others
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Nothing reaches the record without a decision — the same promise
              the whole product makes, said where somebody is about to make a
              change rather than only in the marketing. */}
          <p className="bs-field-hint">
            {writing
              ? "This starts it in your draft and opens it in the editor. Nobody is asked to look at it until you propose the draft."
              : draft
                ? "This goes into your draft. Nobody is asked to look at it until you propose it."
                : changeNumber === null
                  ? "This opens a change request. The document joins the binder once it is approved and published."
                  : "This goes into that change request. The document joins the binder once the change is approved and published."}
          </p>

          <div className="upload-modal-actions">
            <button
              className="bs-btn bs-btn-primary"
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {writing
                ? submitting
                  ? "Starting…"
                  : "Start writing"
                : plan
                  ? progress
                    ? `Adding ${progress.done + 1} of ${progress.total}…`
                    : plan.items.length === 1
                      ? "Add 1 document"
                      : `Add ${plan.items.length} documents`
                  : submitting
                    ? "Adding…"
                    : "Add document"}
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

/**
 * What a batch will add, and what it will leave out, before anything is sent.
 *
 * Every row can be taken out: a dropped folder is somebody's shared drive, and
 * the thing they did not mean to include is always in it.
 */
function BulkList({
  plan,
  progress,
  disabled,
  onRemove,
  onClear,
}: {
  plan: ReturnType<typeof planBulkUpload<File>>;
  progress: { done: number; total: number } | null;
  disabled: boolean;
  onRemove: (relativePath: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="bs-panel bulk-list">
      <div className="bs-panel-bar">
        <h3 className="bs-panel-bar-title">
          {plan.items.length === 1
            ? "1 document"
            : `${plan.items.length} documents`}
        </h3>
        <button
          type="button"
          className="bs-btn bs-btn--sm bs-btn--quiet"
          disabled={disabled}
          onClick={onClear}
        >
          Choose again
        </button>
      </div>
      {progress ? (
        <progress
          className="bulk-progress"
          value={progress.done}
          max={progress.total}
          aria-label="Documents added"
        />
      ) : null}
      <ul className="bs-row-list bulk-rows">
        {plan.items.map((item) => (
          <li className="bs-row" key={item.relativePath}>
            <span className="bs-row-icon" aria-hidden="true">
              <AppIcon icon={FileText} size="sm" />
            </span>
            <span className="bs-row-body">
              <span className="bs-row-name">{item.name}</span>
              <span className="bs-row-meta">
                {item.folder
                  ? item.folder.replace(/\//g, " › ")
                  : "The top level of the binder"}
                {" · "}
                {formatFileSize(item.file.size)}
              </span>
            </span>
            <button
              type="button"
              className="bs-rowact"
              aria-label={`Leave out ${item.name}`}
              disabled={disabled}
              onClick={() => onRemove(item.relativePath)}
            >
              <AppIcon icon={X} size="sm" />
            </button>
          </li>
        ))}
      </ul>
      {plan.skipped.length > 0 ? (
        <details className="bulk-skipped">
          <summary>
            {plan.skipped.length === 1
              ? "1 file left out"
              : `${plan.skipped.length} files left out`}
          </summary>
          <ul>
            {plan.skipped.map((skip) => (
              <li key={skip.relativePath}>
                {skip.relativePath} — {skip.reason}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
