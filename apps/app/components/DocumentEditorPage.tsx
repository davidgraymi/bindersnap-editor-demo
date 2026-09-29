import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  Folder,
  GitBranch,
  GitPullRequest,
  History,
  Pencil,
} from "lucide-react";

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
import { buildBinderTree, folderPaths } from "../binderTree";
import { MoveToFolderModal } from "./MoveToFolderModal";
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
  /** The change request a proposed draft is waiting in. */
  onOpenChange: (changeNumber: number) => void;
  /**
   * Organize the draft's files from the editor's own panel. Each resolves
   * once the act is in the draft and the panel re-read — and, when the act
   * moved or archived the policy that is open, once the editor has followed
   * it. They reject with the server's reason.
   */
  onRenameFile: (target: DraftFileTarget, name: string) => Promise<void>;
  onMoveFile: (subject: DragSubject, folder: string) => Promise<void>;
  onArchiveFile: (slugPath: string) => Promise<void>;
  /** A copy of a policy, in the draft, opened in the editor. */
  onCopyFile: (slugPath: string) => Promise<void>;
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
  | { kind: "propose" }
  | { kind: "change"; number: number };

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

/**
 * A policy opened in this sitting, and what has been typed in it.
 *
 * **Several policies are open at once, as files are in any editor.** Moving
 * to another policy asked "Save your changes?" first, every time — a word
 * processor that would not let you leave a file without committing it. Now
 * the words stay here, in memory, and the file panel marks each policy with
 * unsaved words until Save (this one) or Save all (every one) commits them.
 */
interface OpenPolicy {
  detail: WorkspaceDocumentDetailPayload;
  /** What the editor holds now, saved or not. */
  doc: JSONContent;
  /**
   * The document as last saved, as the editor normalises it. Null until an
   * editor has read it — loading fills in attributes the file left out, and
   * comparing against the raw file called an untouched policy unsaved.
   */
  saved: string | null;
}

/**
 * What an open policy is known by: its identity, so a rename or a move in
 * this sitting — which changes its address — is still the same open file.
 */
function openKey(detail: WorkspaceDocumentDetailPayload): string {
  return detail.document.uid ?? detail.document.slugPath;
}

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

/** `nursing/night` as the tree names it: Nursing / Night. */
function folderLabel(folder: string): string {
  return folder.split("/").map(formatDocumentName).join(" / ");
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
  onOpenChange,
  change = null,
  onRenameFile,
  onMoveFile,
  onArchiveFile,
  onRestoreFile,
  onReadArchive,
  onCopyFile,
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

  /** Every policy opened in this draft this sitting, by {@link openKey}. */
  const opened = useRef(new Map<string, OpenPolicy>());
  /** Which of them is on screen. */
  const shownKey = useRef<string | null>(null);
  /** The draft (or change) they were opened in; another one starts afresh. */
  const openedIn = useRef<string | null>(null);
  /** The other open policies with words not saved, by address. */
  const [unsavedElsewhere, setUnsavedElsewhere] = useState<
    ReadonlyMap<string, string>
  >(new Map());
  /** The panel's list, for finding an open policy after it moved. */
  const filesRef = useRef(files);
  filesRef.current = files;

  /** Where an open policy is now: moved or renamed since, the panel knows. */
  const addressOf = useCallback((policy: OpenPolicy): string => {
    const uid = policy.detail.document.uid;
    const listed = uid
      ? filesRef.current?.documents.find((entry) => entry.uid === uid)
      : undefined;
    return listed?.slugPath ?? policy.detail.document.slugPath;
  }, []);

  const isUnsaved = (policy: OpenPolicy) =>
    policy.saved !== null && JSON.stringify(policy.doc) !== policy.saved;

  /** Recount the open policies other than this one with unsaved words. */
  const recountElsewhere = useCallback(() => {
    const next = new Map<string, string>();
    for (const [key, policy] of opened.current) {
      if (key === shownKey.current) continue;
      if (
        policy.saved !== null &&
        JSON.stringify(policy.doc) !== policy.saved
      ) {
        next.set(
          addressOf(policy),
          formatDocumentName(policy.detail.document.name),
        );
      }
    }
    setUnsavedElsewhere(next);
  }, [addressOf]);
  // A rename or a move in the panel gives an open policy a new address; its
  // mark follows it there.
  useEffect(() => {
    recountElsewhere();
  }, [files, recountElsewhere]);

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

    // **The one on screen keeps its words as the next one opens.** The editor
    // still holds it here — the next render is what replaces it.
    const editor = editorRef.current;
    const was = shownKey.current ? opened.current.get(shownKey.current) : null;
    if (was && editor && !editor.isDestroyed) was.doc = editor.getJSON();

    // Another draft is another set of files: what was open was open there.
    const place = `${draft}|${changeNumber ?? ""}`;
    if (openedIn.current !== place) {
      opened.current.clear();
      openedIn.current = place;
    }

    // "Saved 2 minutes ago" was about the policy before this one, and so
    // were words kept on this device from last time.
    setSave({ kind: "idle" });
    setRecovered(null);

    // Open already: back at once, words and all, and its details read again
    // quietly — an act in the panel may have renamed or moved it since.
    const listed = filesRef.current?.documents.find(
      (entry) => entry.slugPath === documentPath,
    );
    const kept = [...opened.current.entries()].find(
      ([key, policy]) =>
        policy.detail.document.slugPath === documentPath ||
        (listed?.uid != null && key === listed.uid),
    );
    if (kept) {
      const [key, policy] = kept;
      shownKey.current = key;
      savedJson.current = policy.saved ?? "";
      setDirty(isUnsaved(policy));
      setLoad({ kind: "ready", detail: policy.detail, doc: policy.doc });
      recountElsewhere();
      const reread =
        changeNumber !== null
          ? fetchBinderDocument(
              org,
              binder,
              documentPath,
              undefined,
              changeNumber,
              draft,
            )
          : fetchBinderDocument(org, binder, documentPath, draft);
      reread
        .then((detail) => {
          if (cancelled || shownKey.current !== key) return;
          policy.detail = detail;
          setLoad((now) => (now.kind === "ready" ? { ...now, detail } : now));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    shownKey.current = null;
    setLoad({ kind: "loading" });
    recountElsewhere();

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
      const key = openKey(detail);
      opened.current.set(key, { detail, doc, saved: null });
      shownKey.current = key;
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
    // `recountElsewhere` is stable; `isUnsaved` reads only its argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, binder, documentPath, draft, changeNumber]);

  // "Saved 3 minutes ago" has to keep counting while nobody types.
  useEffect(() => {
    if (save.kind !== "saved") return;
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [save.kind]);

  // Leaving with unsaved words asks first, as every word processor does. The
  // browser writes the question; all a page can do is ask for it.
  const anyUnsaved = dirty || unsavedElsewhere.size > 0;
  useEffect(() => {
    if (!anyUnsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [anyUnsaved]);

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
    const shown = shownKey.current
      ? opened.current.get(shownKey.current)
      : undefined;
    if (shown) shown.doc = doc;
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
      const shown = shownKey.current
        ? opened.current.get(shownKey.current)
        : undefined;
      if (shown) shown.saved = json;
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

  /**
   * Save every open policy with unsaved words: this one, then the others.
   *
   * Each is its own save — one act in the draft per policy, "Edit Hand
   * Hygiene", as a save from the editor always is — at the address the policy
   * has now, which a rename in the panel may have changed since it was opened.
   */
  const saveAll = useCallback(async (): Promise<boolean> => {
    if (save.kind === "saving" || !draft) return false;
    if (dirty && !(await saveNow())) return false;

    const others = [...opened.current.entries()].filter(
      ([key, policy]) => key !== shownKey.current && isUnsaved(policy),
    );
    if (others.length === 0) return true;

    setSave({ kind: "saving" });
    for (const [, policy] of others) {
      const json = JSON.stringify(policy.doc);
      try {
        await reviseBinderDocument(
          org,
          binder,
          new File([JSON.stringify(policy.doc, null, 2)], "document.json", {
            type: "application/json",
          }),
          addressOf(policy),
          change ? { changeNumber: change.number } : { draft },
          "editor",
        );
        policy.saved = json;
        dropWords(recoveryKey(org, binder, draft, addressOf(policy)));
      } catch (err) {
        recountElsewhere();
        setSave({
          kind: "failed",
          message: errorMessage(
            err,
            `Unable to save ${formatDocumentName(policy.detail.document.name)}. Its words are still here.`,
          ),
        });
        onSaved();
        return false;
      }
    }
    recountElsewhere();
    setSave({ kind: "saved", at: new Date().toISOString() });
    onSaved();
    return true;
    // `isUnsaved` reads only its argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    addressOf,
    binder,
    change,
    dirty,
    draft,
    onSaved,
    org,
    recountElsewhere,
    save.kind,
    saveNow,
  ]);

  /**
   * Save one policy by its address, open on screen or not — before an act
   * that reads what is saved (a copy) or takes it away (archive).
   */
  const saveOne = async (slugPath: string): Promise<boolean> => {
    if (slugPath === documentPath) return dirty ? saveNow() : true;
    const policy = [...opened.current.values()].find(
      (entry) => addressOf(entry) === slugPath,
    );
    if (!policy || !isUnsaved(policy) || !draft) return true;
    try {
      await reviseBinderDocument(
        org,
        binder,
        new File([JSON.stringify(policy.doc, null, 2)], "document.json", {
          type: "application/json",
        }),
        slugPath,
        change ? { changeNumber: change.number } : { draft },
        "editor",
      );
      policy.saved = JSON.stringify(policy.doc);
      recountElsewhere();
      return true;
    } catch (err) {
      setFilesError(errorMessage(err, "Unable to save that policy first."));
      return false;
    }
  };

  const go = (to: Leaving) => {
    if (to.kind === "close") onClose();
    else if (to.kind === "open") onOpenDocument(to.slugPath);
    else if (to.kind === "draft") onSwitchDraft(to.branch);
    else if (to.kind === "start") void onStartDraft(to.name);
    else if (to.kind === "propose") onPropose();
    else if (to.kind === "change") onOpenChange(to.number);
    else onNewDocument(to.folder);
  };

  /**
   * One act on the draft's files, from the panel.
   *
   * **A rename or a move leaves unsaved words where they are.** An open
   * policy is known by its identity, so after a rename it is the same open
   * file at a new address, words and all — they used to be saved first,
   * because the editor read the policy afresh at the new address. Archiving
   * and copying read or remove what is saved, so the words of the one they
   * act on go first, into the draft, without a question.
   */
  const [filesBusy, setFilesBusy] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const actOnFiles = async (
    /** The policy whose saved words the act reads or removes, if any. */
    savesFirst: string | null,
    act: () => Promise<void>,
    failed: string,
  ): Promise<boolean> => {
    if (filesBusy) return false;
    setFilesError(null);
    if (savesFirst !== null && !(await saveOne(savesFirst))) return false;
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

  /**
   * The title is the name, and the name is changed there — as a Google Doc's
   * or a Word file's online is. Not on a change request (revised here, never
   * reshaped), and not on a file this product did not write, which has no
   * identity for its history to follow (ADR 0005).
   */
  const [titling, setTitling] = useState(false);
  /** The Move picker, opened from where the title says it is filed. */
  const [refiling, setRefiling] = useState(false);
  const everyFolder = useMemo(
    () =>
      files
        ? folderPaths(buildBinderTree(files.documents, [...files.folders]))
        : [],
    [files],
  );
  const renamable =
    !change &&
    files !== null &&
    (load.kind === "ready" || load.kind === "foreign") &&
    load.detail.document.uid !== null;

  /**
   * Another policy opens at once, words kept; leaving the editor — or this
   * draft — asks first while any open policy has words not saved.
   */
  const leave = (to: Leaving) => {
    if (to.kind === "open" || to.kind === "new" || !anyUnsaved) go(to);
    else setLeaving(to);
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
  // The others are one glance away in the panel's marks; the count is here
  // too, beside this one's, so the status bar tells the whole story.
  const statusElsewhere =
    unsavedElsewhere.size === 0
      ? ""
      : ` · ${unsavedElsewhere.size} other ${
          unsavedElsewhere.size === 1 ? "policy" : "policies"
        } unsaved`;

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
            // edit to this one: a fresh editor. By identity, not address, so
            // renaming or moving the open one keeps its editor and its undo.
            key={openKey(load.detail)}
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
              // called a document nobody had touched "unsaved". A policy open
              // already keeps the baseline it was first read with, and
              // whatever was typed in it since.
              const shown = shownKey.current
                ? opened.current.get(shownKey.current)
                : undefined;
              const now = JSON.stringify(editor.getJSON());
              if (shown && shown.saved !== null) {
                savedJson.current = shown.saved;
                setDirty(now !== shown.saved);
                return;
              }
              savedJson.current = now;
              if (shown) {
                shown.saved = now;
                shown.doc = editor.getJSON();
              }
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
                {statusElsewhere}
              </span>
            }
          />
        </Suspense>
      </div>
    );
  }

  /** Every open policy with words not saved, this one first. */
  const unsavedNames = [...(dirty ? [name] : []), ...unsavedElsewhere.values()];
  const saveWord = unsavedNames.length > 1 ? "Save all" : "Save";
  const ask = leaving
    ? leaving.kind === "close"
      ? { save: `${saveWord} and close`, drop: "Close without saving" }
      : leaving.kind === "propose"
        ? { save: `${saveWord} and propose`, drop: "Propose without them" }
        : leaving.kind === "draft" || leaving.kind === "start"
          ? { save: `${saveWord} and switch`, drop: "Switch without saving" }
          : { save: `${saveWord} first`, drop: "Don't save" }
    : null;

  /** Thrown away on purpose, every one: not offered back next time either. */
  const dropUnsaved = () => {
    setDirty(false);
    forgetKept();
    for (const policy of opened.current.values()) {
      if (!isUnsaved(policy) || !draft) continue;
      dropWords(recoveryKey(org, binder, draft, addressOf(policy)));
      policy.doc = JSON.parse(policy.saved!) as JSONContent;
    }
    setUnsavedElsewhere(new Map());
  };

  // Something to propose: words not saved yet, or anything already in the
  // draft. An empty draft proposed is a change request with nothing in it.
  const current = drafts?.draft ?? null;
  const proposable = anyUnsaved || (current?.acts.length ?? 0) > 0;

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
                    null,
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
          {/* **Where it is filed, beside what it is called** — and the way
              to file it somewhere else, as the folder beside a Google Doc's
              title is. The folder was only in the panel's tree, which is
              shut on a tablet. */}
          {renamable &&
          !titling &&
          (load.kind === "ready" || load.kind === "foreign") ? (
            <button
              type="button"
              className="doc-editor-folder"
              title="Move to another folder"
              aria-label={`Move ${name}, filed ${
                load.detail.document.folder === ""
                  ? "at the top level"
                  : `in ${folderLabel(load.detail.document.folder)}`
              }`}
              disabled={filesBusy}
              onClick={() => setRefiling(true)}
            >
              <Folder size={13} strokeWidth={1.75} aria-hidden="true" />
              <span>
                {load.detail.document.folder === ""
                  ? "Top level"
                  : folderLabel(load.detail.document.folder)}
              </span>
            </button>
          ) : null}
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
                {current?.changeNumber != null
                  ? ` · proposed as change ${current.changeNumber} — its reviewers see every save`
                  : " · nothing on record changes until it is approved"}
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
          {/* The others with unsaved words, saved in one press — shown only
              while there are any, as an editor's Save All is live only then. */}
          {unsavedElsewhere.size > 0 ? (
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              disabled={save.kind === "saving"}
              title={`Save ${[...unsavedElsewhere.values()].join(", ")}${
                dirty ? ` and ${name}` : ""
              }`}
              onClick={() => void saveAll()}
            >
              Save all ({unsavedElsewhere.size + (dirty ? 1 : 0)})
            </button>
          ) : null}
          {/* **Proposed from where it was written.** It meant Close, the
              binder, Edit, and the bar's Propose — four steps, and a chance at
              each to land in a different draft from the one just saved. A
              change request has been proposed already. */}
          {change ? null : current?.changeNumber != null ? (
            /* Proposed already: the way to its change request, where Propose
               was. A branch with a pull request open on it still takes
               pushes, and the pull request is one click away. */
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              disabled={save.kind === "saving"}
              title="Its discussion, reviewers and sign-off"
              onClick={() =>
                leave({ kind: "change", number: current.changeNumber! })
              }
            >
              <GitPullRequest size={14} strokeWidth={1.75} aria-hidden="true" />
              Change {current.changeNumber}
            </button>
          ) : (
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
            unsavedElsewhere={unsavedElsewhere}
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
                      null,
                      () => onRenameFile(target, name),
                      "Unable to rename that.",
                    )
            }
            onMove={
              change
                ? undefined
                : (subject, folder) =>
                    void actOnFiles(
                      null,
                      () => onMoveFile(subject, folder),
                      "Unable to move that.",
                    )
            }
            onArchive={
              change
                ? undefined
                : (slugPath) =>
                    actOnFiles(
                      slugPath,
                      () => onArchiveFile(slugPath),
                      "Unable to archive that.",
                    )
            }
            onCopy={
              change
                ? undefined
                : (slugPath) =>
                    void actOnFiles(
                      // The copy is made from what is saved, so the words of
                      // the one being copied go first.
                      slugPath,
                      () => onCopyFile(slugPath),
                      "Unable to copy that.",
                    )
            }
            archivedCount={files.archivedCount ?? 0}
            onReadArchive={change ? undefined : onReadArchive}
            onRestore={
              change
                ? undefined
                : (uid) =>
                    actOnFiles(
                      null,
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

      {refiling && (load.kind === "ready" || load.kind === "foreign") ? (
        <MoveToFolderModal
          subject={{
            kind: "document",
            slugPath: documentPath,
            folder: load.detail.document.folder,
          }}
          label={name}
          folders={everyFolder}
          onClose={() => setRefiling(false)}
          onMove={(folder) => {
            setRefiling(false);
            void actOnFiles(
              null,
              () =>
                onMoveFile(
                  {
                    kind: "document",
                    slugPath: documentPath,
                    folder: load.detail.document.folder,
                  },
                  folder,
                ),
              "Unable to move this document.",
            );
          }}
        />
      ) : null}

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
            <h2 id="doc-editor-close-title">
              {unsavedNames.length > 1
                ? `Save your changes to ${unsavedNames.length} policies?`
                : `Save your changes to ${unsavedNames[0] ?? name}?`}
            </h2>
            <p id="doc-editor-close-body" className="add-policy-note">
              {unsavedNames.length > 1
                ? `${unsavedNames.join(", ")} have words not saved yet. `
                : ""}
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
                  void saveAll().then((saved) => {
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
                  dropUnsaved();
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
