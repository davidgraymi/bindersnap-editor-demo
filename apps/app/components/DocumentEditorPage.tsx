import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { GitBranch, GitPullRequest, History, Pencil } from "lucide-react";

import type {
  BinderArchivePayload,
  BinderDraftPayload,
  WorkspaceDocumentDetailPayload,
  WorkspaceDocumentListEntry,
} from "../../../packages/api-schema/schemas/workspaces";
import {
  downloadBinderDocument,
  fetchBinderDocument,
  reviseBinderDocument,
} from "../api";
import { formatAge, formatDocumentName } from "../documentDisplay";
import { parseEditorDocument } from "../editorDocumentHtml";
import {
  dropWords,
  keepWords,
  readWords,
  recoveryKey,
  worthOffering,
  type RecoveredWords,
} from "../editorRecovery";
import type { DragSubject } from "../binderMove";
import { BinderDraftPicker } from "./BinderDraftPicker";
import { InlineRename } from "./BinderPage";
import { DraftFiles, type DraftFileTarget } from "./DraftFiles";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * A document open in the editor, saving into your draft.
 *
 * **Where the words go is the whole of this page.** The editor itself is a
 * word processor and knows nothing about binders; this is what makes Save
 * mean something here. It commits the document to the draft you are editing
 * the binder in, as you, and nothing more — the version on record does not
 * move, nobody is asked to review anything, and the draft bar counts one more
 * act. The draft is chosen here too — the picker in the title bar — and
 * proposed from here when the author is ready, so writing a policy and asking
 * for it to be approved never needs a trip back through the binder.
 *
 * The editor is loaded on demand: Tiptap, ProseMirror and the ribbon are a
 * large download that most visits to a policy never need.
 */

const DocumentEditor = lazy(() =>
  import("../../../packages/editor/DocumentEditor").then((module) => ({
    default: module.DocumentEditor,
  })),
);

interface DocumentEditorPageProps {
  org: string;
  binder: string;
  documentPath: string;
  /** The draft to read from and save into. Null while the shell finds it. */
  draft: string | null;
  /** What the draft is called, to say where Save puts things. */
  draftName: string | null;
  /** Back to the document, still in edit mode. */
  onClose: () => void;
  /** A save landed: the draft has one more act to count. */
  onSaved: () => void;
  /** The binder's name, for the file panel. */
  binderName: string;
  /**
   * The draft's files, for the panel beside the page. Null while they are
   * read, or when they cannot be — the editor still opens.
   */
  files: {
    documents: readonly WorkspaceDocumentListEntry[];
    folders: readonly string[];
    /** What the draft has written, so the panel can mark those rows. */
    touched?: readonly string[];
    /** How many policies are archived, as the draft stands. */
    archivedCount?: number;
  } | null;
  /** Open another policy in the editor, in the same draft. */
  onOpenDocument: (slugPath: string) => void;
  /** Start a new policy in the draft: in `folder`, or beside this one. */
  onNewDocument: (folder?: string) => void;
  /** Your drafts in this binder, for the picker in the title bar. */
  drafts: BinderDraftPayload | null;
  /** A draft is being started or renamed. */
  draftBusy?: boolean;
  /** Carry on in another of your drafts, on this same policy. */
  onSwitchDraft: (branch: string) => void;
  /** Start a new draft, called something, on this same policy. */
  onStartDraft: (name: string) => void | Promise<void>;
  onRenameDraft: (branch: string, name: string) => void | Promise<void>;
  /** Ask for the draft to be approved: the propose step, for this draft. */
  onPropose: () => void;
  /**
   * Organize the draft's files from the editor's own panel. Each resolves
   * once the act is in the draft and the panel re-read — and, when the act
   * moved or archived the policy that is open, once the editor has followed
   * it. They reject with the server's reason.
   */
  onRenameFile: (target: DraftFileTarget, name: string) => Promise<void>;
  onMoveFile: (subject: DragSubject, folder: string) => Promise<void>;
  onArchiveFile: (slugPath: string) => Promise<void>;
  /** Bring an archived policy back, into the draft. */
  onRestoreFile: (uid: string) => Promise<void>;
  /** What is archived, as the draft stands. */
  onReadArchive: () => Promise<BinderArchivePayload["documents"]>;
  /** Make a folder in the draft. */
  onNewFolder: (parent?: string) => void;
  /**
   * Saving into an open change request rather than a draft. `draft` is then
   * the change's branch, read from and saved to; there is nothing to propose,
   * because it already has been, and every save is in front of its reviewers.
   */
  change?: { number: number; title: string } | null;
}

/** Where the person was going when unsaved words stopped them. */
type Leaving =
  | { kind: "close" }
  | { kind: "open"; slugPath: string }
  | { kind: "new"; folder?: string }
  | { kind: "draft"; branch: string }
  | { kind: "start"; name: string }
  | { kind: "propose" };

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  /** The file is not one the editor writes — a Word file, a PDF. */
  | { kind: "foreign"; detail: WorkspaceDocumentDetailPayload }
  | { kind: "ready"; detail: WorkspaceDocumentDetailPayload; doc: JSONContent };

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

/** Nothing written yet but a title — what "Write it here" starts with. */
function isBlankPolicy(doc: JSONContent): boolean {
  const blocks = doc.content ?? [];
  const last = blocks[blocks.length - 1];
  return (
    blocks.length <= 2 &&
    last?.type === "paragraph" &&
    (last.content ?? []).length === 0
  );
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.trim() !== ""
    ? err.message
    : fallback;
}

export function DocumentEditorPage({
  org,
  binder,
  documentPath,
  draft,
  draftName,
  onClose,
  onSaved,
  binderName,
  files,
  onOpenDocument,
  onNewDocument,
  drafts,
  draftBusy = false,
  onSwitchDraft,
  onStartDraft,
  onRenameDraft,
  onPropose,
  change = null,
  onRenameFile,
  onMoveFile,
  onArchiveFile,
  onRestoreFile,
  onReadArchive,
  onNewFolder,
}: DocumentEditorPageProps) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const editorRef = useRef<Editor | null>(null);
  /** The document as last saved, to tell a real change from an undo back. */
  const savedJson = useRef<string>("");
  const [, setTick] = useState(0);

  // **The whole window is the desk.** Word does not keep your file browser
  // open beside the page, and here the product's map and the binder's files
  // squeezed Letter to half size on a laptop. While a document is open in the
  // editor the shell drops both; the top bar stays, as the way out.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("bs-writing");
    return () => html.classList.remove("bs-writing");
  }, []);

  // By number: the shell builds `change` afresh on every render.
  const changeNumber = change?.number ?? null;

  useEffect(() => {
    if (!draft) return;
    let cancelled = false;
    setLoad({ kind: "loading" });
    // "Saved 2 minutes ago" was about the policy before this one.
    setSave({ kind: "idle" });

    (async () => {
      // Read in the draft: a policy edited a minute ago is only there. On a
      // change request, at its branch — a proposed draft is not a draft any
      // more, and the server says so when asked for one.
      const detail =
        changeNumber !== null
          ? await fetchBinderDocument(
              org,
              binder,
              documentPath,
              undefined,
              changeNumber,
              draft,
            )
          : await fetchBinderDocument(org, binder, documentPath, draft);
      const blob = await downloadBinderDocument(
        org,
        binder,
        detail.document.path,
        draft,
      );
      const doc = parseEditorDocument(await blob.text());
      if (cancelled) return;
      if (doc === null) {
        setLoad({ kind: "foreign", detail });
        return;
      }
      savedJson.current = JSON.stringify(doc);
      setLoad({ kind: "ready", detail, doc });
    })().catch((err: unknown) => {
      if (!cancelled) {
        setLoad({
          kind: "error",
          message: errorMessage(err, "Unable to open this document."),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [org, binder, documentPath, draft, changeNumber]);

  // "Saved 3 minutes ago" has to keep counting while nobody types.
  useEffect(() => {
    if (save.kind !== "saved") return;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [save.kind]);

  // Leaving with unsaved words asks first, as every word processor does. The
  // browser writes the question; all a page can do is ask for it.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // AutoRecover: unsaved words kept on this device — see `editorRecovery.ts`.
  const keyRef = useRef<string | null>(null);
  keyRef.current = draft ? recoveryKey(org, binder, draft, documentPath) : null;
  const keepTimer = useRef<number | undefined>(undefined);
  const [recovered, setRecovered] = useState<RecoveredWords | null>(null);
  const forgetKept = useCallback(() => {
    window.clearTimeout(keepTimer.current);
    if (keyRef.current) dropWords(keyRef.current);
  }, []);
  useEffect(() => () => window.clearTimeout(keepTimer.current), []);

  const handleChange = useCallback((doc: JSONContent) => {
    const changed = JSON.stringify(doc) !== savedJson.current;
    setDirty(changed);
    window.clearTimeout(keepTimer.current);
    const key = keyRef.current;
    if (!key) return;
    if (!changed) {
      // Undone back to what is saved: nothing to recover.
      dropWords(key);
      return;
    }
    const base = savedJson.current;
    keepTimer.current = window.setTimeout(() => keepWords(key, doc, base), 800);
  }, []);

  const saveNow = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor || load.kind !== "ready" || !draft) return false;
    if (save.kind === "saving") return false;

    const doc = editor.getJSON();
    const json = JSON.stringify(doc);
    if (json === savedJson.current) {
      setDirty(false);
      return true;
    }

    setSave({ kind: "saving" });
    try {
      // Stored the way the seed and every earlier save stored it, so a diff
      // between two versions is a diff of the words and not of the spacing.
      const file = new File([JSON.stringify(doc, null, 2)], "document.json", {
        type: "application/json",
      });
      await reviseBinderDocument(
        org,
        binder,
        file,
        load.detail.document.slugPath,
        change ? { changeNumber: change.number } : { draft },
        "editor",
      );
      savedJson.current = json;
      // Anything typed while the save was in flight is still unsaved.
      const still = JSON.stringify(editor.getJSON()) !== json;
      setDirty(still);
      if (!still) forgetKept();
      setSave({ kind: "saved", at: new Date().toISOString() });
      onSaved();
      return true;
    } catch (err) {
      setSave({
        kind: "failed",
        message: errorMessage(
          err,
          "Unable to save. Your words are still here.",
        ),
      });
      return false;
    }
  }, [binder, change, draft, forgetKept, load, onSaved, org, save.kind]);

  const go = (to: Leaving) => {
    if (to.kind === "close") onClose();
    else if (to.kind === "open") onOpenDocument(to.slugPath);
    else if (to.kind === "draft") onSwitchDraft(to.branch);
    else if (to.kind === "start") void onStartDraft(to.name);
    else if (to.kind === "propose") onPropose();
    else onNewDocument(to.folder);
  };

  /**
   * One act on the draft's files, from the panel.
   *
   * **The open policy's words go first when the act moves it.** Renaming or
   * refiling it — or the folder it is in — gives it a new address, and the
   * editor follows it there by reading it again; archiving it closes it.
   * Either way what was typed and not saved would be read over, so it is saved
   * into the draft first, without a question: the act was asked for, and
   * saving is what the draft is for. Other rows' acts leave the words alone.
   */
  const [filesBusy, setFilesBusy] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const actOnFiles = async (
    movesOpen: boolean,
    act: () => Promise<void>,
    failed: string,
  ): Promise<boolean> => {
    if (filesBusy) return false;
    setFilesError(null);
    if (movesOpen && dirty) {
      const saved = await saveNow();
      if (!saved) return false;
    }
    setFilesBusy(true);
    try {
      await act();
      return true;
    } catch (err) {
      setFilesError(errorMessage(err, failed));
      return false;
    } finally {
      setFilesBusy(false);
    }
  };
  const holdsOpen = (folder: string) => documentPath.startsWith(`${folder}/`);

  /**
   * The title is the name, and the name is changed there — as a Google Doc's
   * or a Word file's online is. Not on a change request (revised here, never
   * reshaped), and not on a file this product did not write, which has no
   * identity for its history to follow (ADR 0005).
   */
  const [titling, setTitling] = useState(false);
  const renamable =
    !change &&
    files !== null &&
    (load.kind === "ready" || load.kind === "foreign") &&
    load.detail.document.uid !== null;

  /** Anywhere but here asks first while there are unsaved words. */
  const leave = (to: Leaving) => {
    if (dirty) setLeaving(to);
    else go(to);
  };

  // The name the address gives, until the document itself has been read, so
  // the title bar does not blink out between one policy and the next.
  const name =
    load.kind === "ready" || load.kind === "foreign"
      ? formatDocumentName(load.detail.document.name)
      : formatDocumentName(documentPath.split("/").pop() ?? documentPath);

  // The browser tab says which policy is open, and — as Word's title bar
  // does — when it has changes not saved yet.
  useEffect(() => {
    const was = document.title;
    document.title = `${dirty ? "• " : ""}${name} · Bindersnap`;
    return () => {
      document.title = was;
    };
  }, [dirty, name]);

  const status =
    save.kind === "saving"
      ? "Saving…"
      : save.kind === "failed"
        ? "Not saved"
        : dirty
          ? "Unsaved changes"
          : save.kind === "saved"
            ? `Saved ${formatAge(save.at)}`
            : "No changes yet";

  let body: ReactNode;
  if (!draft || load.kind === "loading") {
    body = (
      <div className="doc-editor-state">
        <SkeletonGroup label="Opening the editor">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  } else if (load.kind === "error") {
    body = (
      <div className="doc-editor-state">
        <p className="bs-note bs-note--danger" role="alert">
          {load.message}
        </p>
      </div>
    );
  } else if (load.kind === "foreign") {
    body = (
      <div className="doc-editor-state">
        <div className="bs-empty">
          <h2 className="bs-title">{name} is not a Bindersnap document</h2>
          <p>
            It was uploaded as a file, so it is edited in the program that made
            it. Make your changes there, then use Upload new version on the
            document's page.
          </p>
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={onClose}
          >
            Go to the document's page
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="doc-editor-frame">
        <Suspense
          fallback={
            <SkeletonGroup label="Loading the editor">
              <SkeletonLine width="medium" />
            </SkeletonGroup>
          }
        >
          <DocumentEditor
            // A policy opened from the file panel is a new document, not an
            // edit to this one: a fresh editor, a fresh undo history.
            key={load.detail.document.slugPath}
            label={name}
            initialContent={load.doc}
            // A policy just started is its title and an empty line: the
            // cursor goes on the empty line, ready to type, as Word's does.
            // Anything longer opens at the top, where it starts.
            autoFocus={isBlankPolicy(load.doc) ? "end" : "start"}
            onChange={handleChange}
            onSave={() => void saveNow()}
            onReady={(editor) => {
              editorRef.current = editor;
              // The baseline is the document as the editor holds it, not as
              // the file had it: loading normalises it (an empty paragraph at
              // the end, attributes filled in), and comparing against the file
              // called a document nobody had touched "unsaved".
              savedJson.current = JSON.stringify(editor.getJSON());
              setDirty(false);
              // Words that never reached a save, from last time.
              const key = keyRef.current;
              const kept = key ? readWords(key) : null;
              if (worthOffering(kept, savedJson.current)) setRecovered(kept);
              else {
                setRecovered(null);
                if (key) dropWords(key);
              }
            }}
            statusStart={
              <span
                className={`doc-editor-status${
                  dirty || save.kind === "failed"
                    ? " doc-editor-status--unsaved"
                    : ""
                }`}
                role="status"
              >
                {status}
              </span>
            }
          />
        </Suspense>
      </div>
    );
  }

  const ask = leaving
    ? leaving.kind === "close"
      ? { save: "Save and close", drop: "Close without saving" }
      : leaving.kind === "open"
        ? { save: "Save and open", drop: "Open without saving" }
        : leaving.kind === "propose"
          ? { save: "Save and propose", drop: "Propose without them" }
          : leaving.kind === "draft" || leaving.kind === "start"
            ? { save: "Save and switch", drop: "Switch without saving" }
            : { save: "Save first", drop: "Don't save" }
    : null;

  // Something to propose: words not saved yet, or anything already in the
  // draft. An empty draft proposed is a change request with nothing in it.
  const current = drafts?.draft ?? null;
  const proposable = dirty || (current?.acts.length ?? 0) > 0;

  return (
    <div className="doc-editor-page">
      <header className="doc-editor-head">
        <div className="doc-editor-head-body">
          <h1 className="doc-editor-title">
            {titling ? (
              <InlineRename
                className="doc-editor-title-input"
                initial={name}
                onCancel={() => setTitling(false)}
                onCommit={(typed) => {
                  setTitling(false);
                  const next = typed.trim();
                  if (next === "" || next === name) return;
                  void actOnFiles(
                    true,
                    () =>
                      onRenameFile(
                        { kind: "document", slugPath: documentPath },
                        next,
                      ),
                    "Unable to rename this document.",
                  );
                }}
              />
            ) : renamable ? (
              <button
                type="button"
                className="doc-editor-title-button"
                title="Rename this document"
                disabled={filesBusy}
                onClick={() => setTitling(true)}
              >
                <span className="doc-editor-title-text">{name}</span>
                <Pencil size={13} strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : (
              name
            )}
          </h1>
          {/* Where Save puts things, said before it is pressed. */}
          {change ? (
            <p
              className="doc-editor-where"
              title="The version on record does not change until the change is approved and published."
            >
              <GitPullRequest size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="doc-editor-where-label">Saving to</span>
              <strong>Change {change.number}</strong>
              <span className="doc-editor-where-more">
                · {change.title} — its reviewers see every save
              </span>
            </p>
          ) : (
            <p
              className="doc-editor-where"
              title="The version on record does not change until the draft is proposed and approved."
            >
              <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="doc-editor-where-label">Saving to</span>
              {/* **Which draft, and the way to the others, here.** Changing
                drafts meant closing the policy, finding the binder's own page
                and its picker, and opening the policy again — and with two
                drafts called "Draft of 27 September", saving into one and
                proposing the other. */}
              {drafts && current ? (
                <BinderDraftPicker
                  org={org}
                  drafts={drafts.drafts}
                  others={drafts.others}
                  current={current.branch}
                  busy={draftBusy}
                  onSwitch={(branch) => leave({ kind: "draft", branch })}
                  onStart={(name) => leave({ kind: "start", name })}
                  onRename={onRenameDraft}
                />
              ) : (
                <strong>{draftName ?? "your draft"}</strong>
              )}
              <span className="doc-editor-where-more">
                · nothing on record changes until it is approved
              </span>
            </p>
          )}
        </div>
        <div className="doc-editor-head-actions">
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={() => leave({ kind: "close" })}
          >
            Close
          </button>
          <button
            type="button"
            className={`bs-btn ${change ? "bs-btn-primary" : "bs-btn-secondary"} bs-btn--sm`}
            disabled={load.kind !== "ready" || !dirty || save.kind === "saving"}
            title={
              change
                ? `Save into change ${change.number} (Ctrl+S)`
                : "Save into your draft (Ctrl+S)"
            }
            onClick={() => void saveNow()}
          >
            {save.kind === "saving" ? "Saving…" : "Save"}
          </button>
          {/* **Proposed from where it was written.** It meant Close, the
              binder, Edit, and the bar's Propose — four steps, and a chance at
              each to land in a different draft from the one just saved. A
              change request has been proposed already. */}
          {change ? null : (
            <button
              type="button"
              className="bs-btn bs-btn-primary bs-btn--sm"
              disabled={!proposable || save.kind === "saving"}
              title={
                proposable
                  ? "Ask for this draft to be approved"
                  : "Nothing in this draft to propose yet"
              }
              onClick={() => leave({ kind: "propose" })}
            >
              Propose
            </button>
          )}
        </div>
      </header>

      {recovered && load.kind === "ready" ? (
        <div className="doc-editor-recover" role="status">
          <History size={15} strokeWidth={1.75} aria-hidden="true" />
          <p>
            <strong>Unsaved changes from {formatAge(recovered.at)}</strong> were
            kept on this device.
            {recovered.base !== savedJson.current
              ? " The policy has been saved differently since; restoring puts those words back in place of what is saved."
              : " Restore them to carry on where you left off."}
          </p>
          <div className="doc-editor-recover-actions">
            <button
              type="button"
              className="bs-btn bs-btn-primary bs-btn--sm"
              onClick={() => {
                const editor = editorRef.current;
                if (!editor || editor.isDestroyed) return;
                editor.commands.setContent(recovered.doc as JSONContent);
                handleChange(editor.getJSON());
                setRecovered(null);
                editor.commands.focus("end");
              }}
            >
              Restore
            </button>
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              onClick={() => {
                forgetKept();
                setRecovered(null);
              }}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {save.kind === "failed" ? (
        <p className="bs-note bs-note--danger doc-editor-alert" role="alert">
          {save.message}
        </p>
      ) : null}

      <div className="doc-editor-workspace">
        {files ? (
          <DraftFiles
            org={org}
            binder={binder}
            binderName={binderName}
            documents={files.documents}
            touched={files.touched}
            folders={files.folders}
            active={documentPath}
            unsaved={dirty}
            onOpen={(slugPath) => leave({ kind: "open", slugPath })}
            // A change request is revised, not added to or reshaped, here.
            onNew={
              change ? undefined : (folder) => leave({ kind: "new", folder })
            }
            onNewFolder={change ? undefined : onNewFolder}
            busy={filesBusy || save.kind === "saving"}
            onRename={
              change
                ? undefined
                : (target, name) =>
                    void actOnFiles(
                      target.kind === "document"
                        ? target.slugPath === documentPath
                        : holdsOpen(target.path),
                      () => onRenameFile(target, name),
                      "Unable to rename that.",
                    )
            }
            onMove={
              change
                ? undefined
                : (subject, folder) =>
                    void actOnFiles(
                      subject.kind === "document"
                        ? subject.slugPath === documentPath
                        : holdsOpen(subject.path),
                      () => onMoveFile(subject, folder),
                      "Unable to move that.",
                    )
            }
            onArchive={
              change
                ? undefined
                : (slugPath) =>
                    actOnFiles(
                      slugPath === documentPath,
                      () => onArchiveFile(slugPath),
                      "Unable to archive that.",
                    )
            }
            archivedCount={files.archivedCount ?? 0}
            onReadArchive={change ? undefined : onReadArchive}
            onRestore={
              change
                ? undefined
                : (uid) =>
                    actOnFiles(
                      false,
                      () => onRestoreFile(uid),
                      "Unable to restore that document.",
                    )
            }
          />
        ) : null}
        <div className="doc-editor-main">
          {filesError ? (
            <p
              className="bs-note bs-note--danger doc-editor-alert"
              role="alert"
            >
              {filesError}
            </p>
          ) : null}
          {body}
        </div>
      </div>

      {leaving && ask ? (
        <div
          className="upload-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setLeaving(null);
          }}
        >
          <div
            className="upload-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="doc-editor-close-title"
            aria-describedby="doc-editor-close-body"
          >
            <h2 id="doc-editor-close-title">Save your changes to {name}?</h2>
            <p id="doc-editor-close-body" className="add-policy-note">
              They go into your draft. Leaving without saving loses everything
              since the last save.
            </p>
            <div className="upload-modal-actions">
              <button
                type="button"
                className="bs-btn bs-btn-primary"
                autoFocus
                disabled={save.kind === "saving"}
                onClick={() => {
                  const to = leaving;
                  void saveNow().then((saved) => {
                    setLeaving(null);
                    if (saved) go(to);
                  });
                }}
              >
                {save.kind === "saving" ? "Saving…" : ask.save}
              </button>
              <button
                type="button"
                className="bs-btn bs-btn-secondary"
                onClick={() => {
                  const to = leaving;
                  setLeaving(null);
                  setDirty(false);
                  // Thrown away on purpose: not offered back next time.
                  forgetKept();
                  go(to);
                }}
              >
                {ask.drop}
              </button>
              <button
                type="button"
                className="bs-btn bs-btn-secondary"
                onClick={() => setLeaving(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
