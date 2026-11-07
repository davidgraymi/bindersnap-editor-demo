import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertibleKind } from "../convertToEditor";
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
import type { EditorState } from "@tiptap/pm/state";
import { GitPullRequest, History, Pencil } from "lucide-react";

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
import {
  binderChangeQuery,
  changeUpdatesQuery,
  queryKeys,
} from "../data/queries";
import { formatAge, formatDocumentName } from "../documentDisplay";
import { parseEditorDocument } from "../editorDocumentHtml";
import {
  createDocumentState,
  showDocumentState,
} from "../../../packages/editor/documentState";
import type { OutlineSlot } from "../../../packages/editor/DocumentEditor";
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
import { readDroppedFiles, type DroppedFiles } from "../bulkUpload";
import {
  DraftFiles,
  type ArchiveUndo,
  type DraftFileTarget,
} from "./DraftFiles";
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

/**
 * How long the words rest before the editor saves them on its own: long
 * enough that a sentence is not saved a word at a time, short enough that a
 * closed laptop loses nothing worth retyping.
 */
const AUTOSAVE_IDLE_MS = 2_500;
/** However steadily somebody types, nothing waits longer than this. */
const AUTOSAVE_AT_MOST_MS = 30_000;
/** A save that did not land is tried again after this. */
const AUTOSAVE_RETRY_MS = 5_000;
/**
 * "Don't ask me again" for saving into a proposal: a habit of this person's
 * on this browser, not a setting of the binder's.
 */
const PROPOSAL_SAVE_ASK_KEY = "bindersnap:ask-before-saving-a-proposal";

function asksBeforeSavingAProposal(): boolean {
  try {
    return globalThis.localStorage?.getItem(PROPOSAL_SAVE_ASK_KEY) !== "no";
  } catch {
    return true;
  }
}

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
  /**
   * Make a new, untitled policy in the draft — in `folder`, or beside this
   * one — and open it.
   */
  onNewDocument: (folder?: string) => Promise<void>;
  /**
   * Files dragged in from the computer: the add dialog, with them in it, to
   * go into `folder` — where they were dropped in the file panel — or beside
   * this policy when dropped on the page.
   */
  onUploadFiles?: (files: DroppedFiles, folder?: string) => void;
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
  /** A folder off the record, every policy in it, in the draft. */
  onArchiveFolder: (folder: string) => Promise<void>;
  /** A copy of a policy, in the draft, opened in the editor. */
  onCopyFile: (slugPath: string) => Promise<void>;
  /** Read a Word file or PDF into the editor's format, in the draft. */
  onConvertFile: (target: {
    slugPath: string;
    path: string;
    name: string;
  }) => void;
  /**
   * Bring an archived policy back, into the draft. `path` is where it was,
   * for one never published, which is read back from the draft's history.
   */
  onRestoreFile: (uid: string, path?: string) => Promise<void>;
  /** An archived folder back: its folders, then its policies. */
  onRestoreFolder: (
    folders: readonly string[],
    documents: readonly { uid: string; path: string }[],
  ) => Promise<void>;
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
  /**
   * Its words, cursor and undo history as the page's one editor last held
   * them — see `packages/editor/documentState.ts`. Absent until it has been
   * shown, and dropped when the editor is made afresh, whose plugins it would
   * not match.
   */
  state?: EditorState;
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
  onUploadFiles,
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
  onArchiveFolder,
  onRestoreFile,
  onRestoreFolder,
  onReadArchive,
  onCopyFile,
  onConvertFile,
  onNewFolder,
}: DocumentEditorPageProps) {
  const queryClient = useQueryClient();
  /**
   * Save, then let every read of this binder know: the document page, the
   * tree and the contents beside the editor were all read before these words.
   */
  const saveRevision = async (
    ...args: Parameters<typeof reviseBinderDocument>
  ): ReturnType<typeof reviseBinderDocument> => {
    const [org_, binder_, file, path, target, source] = args;
    const saved = await reviseBinderDocument(
      org_,
      binder_,
      file,
      path,
      target,
      source,
      // Saved on its own into an unproposed draft: the server may fold it
      // into the last save of the same policy, so the draft lists "Edit
      // Hand Hygiene" once rather than once per pause in the typing.
      { fold: autosaveRef.current },
    );
    void queryClient.invalidateQueries({
      queryKey: queryKeys.binder(org, binder),
    });
    return saved;
  };
  /**
   * **The editor saves on its own into a draft nobody has been shown.**
   * Nothing on record moves until the draft is proposed and approved, so a
   * save there costs nothing and forgetting one costs an afternoon. A draft
   * already proposed — or a change request edited in place — is different:
   * every save is in front of its reviewers, and may clear the approvals it
   * has, so there it stays a deliberate Save (and Ctrl+S), asked about first.
   * Until the drafts are read, nobody knows which this is, so nothing saves
   * on its own.
   */
  const current = drafts?.draft ?? null;
  const autosave =
    change === null &&
    current !== null &&
    current.branch === draft &&
    current.changeNumber === null;
  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const savingRef = useRef(false);
  savingRef.current = save.kind === "saving";
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const editorRef = useRef<Editor | null>(null);
  /** The document as last saved, to tell a real change from an undo back. */
  const savedJson = useRef<string>("");
  const [, setTick] = useState(0);

  // By number: the shell builds `change` afresh on every render.
  const changeNumber = change?.number ?? null;

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

  /**
   * A policy read ahead of the click that opens it, by address.
   *
   * **The pointer arriving on a row is the click's warning.** Reading a policy
   * is two requests — its details, then its file — and they were only asked
   * for once it was chosen, so every first open waited on both. A row hovered
   * or focused starts them, and the open that follows takes what came back.
   */
  const readAhead = useRef(
    new Map<
      string,
      Promise<{ detail: WorkspaceDocumentDetailPayload; text: string }>
    >(),
  );
  const readPolicy = useCallback(
    (path: string) => {
      const known = readAhead.current.get(path);
      if (known) return known;
      const reading = (async () => {
        // Read in the draft: a policy edited a minute ago is only there. On a
        // change request, at its branch.
        const detail =
          changeNumber !== null
            ? await fetchBinderDocument(
                org,
                binder,
                path,
                undefined,
                changeNumber,
                draft ?? undefined,
              )
            : await fetchBinderDocument(org, binder, path, draft ?? undefined);
        const blob = await downloadBinderDocument(
          org,
          binder,
          detail.document.path,
          draft ?? undefined,
        );
        return { detail, text: await blob.text() };
      })();
      readAhead.current.set(path, reading);
      // A failed read is not kept: the open that follows asks again, and
      // says why if it fails too.
      reading.catch(() => readAhead.current.delete(path));
      return reading;
    },
    [org, binder, draft, changeNumber],
  );
  // What was read ahead is about the files as they were: an act, a save or
  // another draft makes it stale.
  const listing = files?.documents;
  useEffect(() => {
    readAhead.current.clear();
  }, [listing, draft, changeNumber]);
  const readAheadOf = useCallback(
    (path: string) => {
      if (!draft || path === documentPath) return;
      const listed = filesRef.current?.documents.find(
        (entry) => entry.slugPath === path,
      );
      if (listed?.uid != null && opened.current.has(listed.uid)) {
        return;
      }
      readPolicy(path).catch(() => undefined);
    },
    [draft, documentPath, readPolicy],
  );

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

  useEffect(() => {
    if (!draft) return;
    let cancelled = false;

    // **The one on screen keeps its words as the next one opens.** The editor
    // still holds it here — the next render is what replaces it.
    const editor = editorRef.current;
    const live = editor && !editor.isDestroyed ? editor : null;
    const was = shownKey.current ? opened.current.get(shownKey.current) : null;
    if (was && live) {
      was.doc = live.getJSON();
      was.state = live.state;
    }

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
      // **In the same editor, as it was left** — words, cursor and undo.
      if (live && policy.saved !== null) {
        showDocumentState(
          live,
          policy.state ?? createDocumentState(live, policy.doc),
        );
        policy.state = live.state;
        live.commands.focus();
      }
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
    // Where focus was when the policy was asked for. If it has moved by the
    // time the policy arrives — to the file panel, a menu, a dialog — the
    // person has gone on to something else, and the editor does not take it.
    const focusAtOpen = document.activeElement;
    recountElsewhere();

    (async () => {
      // Taken from a read ahead when the row was pointed at; once taken it is
      // this policy's, and the next read of it is a fresh one.
      const { detail, text } = await readPolicy(documentPath);
      readAhead.current.delete(documentPath);
      const doc = parseEditorDocument(text);
      if (cancelled) return;
      if (doc === null) {
        setLoad({ kind: "foreign", detail });
        return;
      }
      savedJson.current = JSON.stringify(doc);
      const key = openKey(detail);
      const policy: OpenPolicy = { detail, doc, saved: null };
      opened.current.set(key, policy);
      shownKey.current = key;
      // The page's editor, when it has one, takes the policy in: a state of
      // its own, so its undo starts here and the last policy's is kept.
      const now = editorRef.current;
      if (now && !now.isDestroyed) {
        showDocumentState(now, createDocumentState(now, doc));
        policy.state = now.state;
        policy.doc = now.getJSON();
        policy.saved = JSON.stringify(policy.doc);
        savedJson.current = policy.saved;
        setDirty(false);
        offerKept(policy.saved);
        const here = document.activeElement;
        if (
          here === focusAtOpen ||
          here === null ||
          here === document.body ||
          now.view.dom.contains(here)
        ) {
          now.commands.focus(isBlankPolicy(doc) ? "end" : "start");
        }
      }
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
    // `recountElsewhere` is stable; `isUnsaved` reads only its argument;
    // `readPolicy` changes only with the draft, which is in the list.
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

  /** Words that never reached a save, from last time: offered, or let go. */
  const offerKept = (baseline: string) => {
    const key = keyRef.current;
    const kept = key ? readWords(key) : null;
    if (worthOffering(kept, baseline)) setRecovered(kept);
    else {
      setRecovered(null);
      if (key) dropWords(key);
    }
  };

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
    scheduleAutosave();
    // `scheduleAutosave` reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const shown = shownKey.current
        ? opened.current.get(shownKey.current)
        : undefined;
      await saveRevision(
        org,
        binder,
        file,
        // Where it is now: renamed or moved since it was opened, the details
        // read then name an address the draft no longer has.
        shown ? addressOf(shown) : load.detail.document.slugPath,
        change ? { changeNumber: change.number } : { draft },
        "editor",
      );
      savedJson.current = json;
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
  }, [
    addressOf,
    binder,
    change,
    draft,
    forgetKept,
    load,
    onSaved,
    org,
    save.kind,
  ]);

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
        await saveRevision(
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
      await saveRevision(
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

  /**
   * Saving on its own: after the words have rested, and never later than
   * {@link AUTOSAVE_AT_MOST_MS} after the first unsaved one, every open policy
   * with unsaved words is saved — the one on screen and any left open beside
   * it. One save at a time; a pause that comes while one is in flight waits
   * for it. A save that fails is tried again, and the words stay here and on
   * this device meanwhile.
   */
  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;
  const autosaveTimer = useRef<number | undefined>(undefined);
  /** When the oldest unsaved words must be saved by, whatever the typing. */
  const autosaveDue = useRef<number | null>(null);
  const runAutosave = useCallback(() => {
    window.clearTimeout(autosaveTimer.current);
    if (!autosaveRef.current) return;
    if (savingRef.current) {
      autosaveTimer.current = window.setTimeout(runAutosave, 500);
      return;
    }
    autosaveDue.current = null;
    void saveAllRef.current().then((saved) => {
      if (!saved && autosaveRef.current) {
        autosaveTimer.current = window.setTimeout(
          runAutosave,
          AUTOSAVE_RETRY_MS,
        );
      }
    });
  }, []);
  const scheduleAutosave = useCallback(() => {
    if (!autosaveRef.current) return;
    window.clearTimeout(autosaveTimer.current);
    const now = Date.now();
    autosaveDue.current ??= now + AUTOSAVE_AT_MOST_MS;
    autosaveTimer.current = window.setTimeout(
      runAutosave,
      Math.max(0, Math.min(AUTOSAVE_IDLE_MS, autosaveDue.current - now)),
    );
  }, [runAutosave]);
  useEffect(() => () => window.clearTimeout(autosaveTimer.current), []);
  // Words left unsaved in a policy moved away from, or typed before the
  // drafts were read: saved once the editor knows it may.
  useEffect(() => {
    if (autosave && anyUnsaved) scheduleAutosave();
  }, [autosave, anyUnsaved, documentPath, scheduleAutosave]);

  /**
   * Every save, said and done: what is in flight first, then whatever is
   * still unsaved. What leaving waits on while the editor saves on its own.
   */
  const flush = async (): Promise<boolean> => {
    window.clearTimeout(autosaveTimer.current);
    autosaveDue.current = null;
    while (savingRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
    }
    const saved = await saveAllRef.current();
    // Still trying: a person who stays after a failed save on the way out
    // gets their words saved as soon as saving works again.
    if (!saved && autosaveRef.current) {
      autosaveTimer.current = window.setTimeout(runAutosave, AUTOSAVE_RETRY_MS);
    }
    return saved;
  };

  /**
   * Save into a proposal — a proposed draft, or a change request edited in
   * place — asked about first: its reviewers see the save, and it may clear
   * the approvals it has. "Don't ask me again" is remembered on this browser.
   */
  const [confirming, setConfirming] = useState<"this" | "all" | null>(null);
  const [stopAsking, setStopAsking] = useState(false);
  const requestSave = (scope: "this" | "all") => {
    if (autosave) {
      void flush();
      return;
    }
    if (!asksBeforeSavingAProposal()) {
      void (scope === "all" ? saveAll() : saveNow());
      return;
    }
    setStopAsking(false);
    setConfirming(scope);
  };
  const confirmSave = () => {
    const scope = confirming;
    setConfirming(null);
    if (stopAsking) {
      try {
        globalThis.localStorage?.setItem(PROPOSAL_SAVE_ASK_KEY, "no");
      } catch {
        // Asked again next time, on a browser that keeps nothing.
      }
    }
    void (scope === "all" ? saveAll() : saveNow());
  };
  /** The change a save would go into, when it is one. */
  const proposalNumber = change?.number ?? current?.changeNumber ?? null;
  const proposalRead = useQuery({
    ...binderChangeQuery(org, binder, proposalNumber ?? 0),
    enabled: confirming !== null && proposalNumber !== null,
  });
  const proposalUpdates = useQuery({
    ...changeUpdatesQuery(org, binder, proposalNumber ?? 0),
    enabled: confirming !== null && proposalNumber !== null,
  });
  /** Approvals that would be cleared: only when the binder says a new version clears them. */
  const approvalsCleared = proposalUpdates.data?.resetsApprovals
    ? new Set(
        (proposalRead.data?.approvalRules ?? []).flatMap((rule) =>
          rule.approvedBy.map((person) => person.login),
        ),
      ).size
    : 0;

  const go = (to: Leaving) => {
    if (to.kind === "close") onClose();
    else if (to.kind === "open") onOpenDocument(to.slugPath);
    else if (to.kind === "draft") onSwitchDraft(to.branch);
    else if (to.kind === "start") void onStartDraft(to.name);
    else if (to.kind === "propose") onPropose();
    else if (to.kind === "change") onOpenChange(to.number);
    else
      void actOnFiles(
        null,
        () => onNewDocument(to.folder),
        "Unable to start a new document.",
      );
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
  /**
   * The file just archived or deleted from the panel, and when. Ctrl+Z, the
   * ribbon's Undo and the panel's own Undo all take it back; the panel says
   * so for a few seconds, and Ctrl+Z still reaches it after that, until the
   * page is edited or something else is archived.
   */
  const [lastArchive, setLastArchive] = useState<{
    record: ArchiveUndo;
    at: number;
  } | null>(null);
  const [archiveNotice, setArchiveNotice] = useState(false);
  useEffect(() => {
    if (!archiveNotice) return;
    const timer = window.setTimeout(() => setArchiveNotice(false), 12_000);
    return () => window.clearTimeout(timer);
  }, [archiveNotice, lastArchive]);

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
    // Saving on its own: the last words are saved on the way out, and only a
    // save that fails stops to ask.
    else if (autosave)
      void flush().then((saved) => (saved ? go(to) : setLeaving(to)));
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
    document.title = `${dirty && !autosave ? "• " : ""}${name} · Bindersnap`;
    return () => {
      document.title = was;
    };
  }, [autosave, dirty, name]);

  // Saving on its own, words typed are words on their way: "Saving…" from
  // the first key, as a word processor online says it.
  const status =
    save.kind === "saving"
      ? "Saving…"
      : save.kind === "failed"
        ? autosave
          ? "Not saved — trying again"
          : "Not saved"
        : dirty
          ? autosave
            ? "Saving…"
            : "Unsaved changes"
          : save.kind === "saved"
            ? `Saved ${formatAge(save.at)}`
            : "";
  // The others are one glance away in the panel's marks; the count is here
  // too, beside this one's, so the title bar tells the whole story.
  const statusElsewhere =
    unsavedElsewhere.size === 0 || autosave
      ? ""
      : `${status === "" ? "" : " · "}${unsavedElsewhere.size} other ${
          unsavedElsewhere.size === 1 ? "policy" : "policies"
        } unsaved`;

  // **One editor for the whole sitting.** While the next policy is read, the
  // last one stays on the page — still, and not editable — rather than the
  // page blanking to a skeleton between two policies; then the editor takes
  // the next one in (`documentState.ts`).
  const lastReady = useRef<Extract<LoadState, { kind: "ready" }> | null>(null);
  if (load.kind === "ready") lastReady.current = load;
  else if (load.kind !== "loading") lastReady.current = null;
  const frame =
    load.kind === "ready"
      ? load
      : load.kind === "loading"
        ? lastReady.current
        : null;

  const undoArchive = () => {
    if (!lastArchive || filesBusy) return;
    const { record } = lastArchive;
    setLastArchive(null);
    setArchiveNotice(false);
    void actOnFiles(
      null,
      () =>
        record.kind === "document"
          ? onRestoreFile(record.uid, record.path)
          : onRestoreFolder(record.folders, record.documents),
      record.kind === "document" && record.deleted
        ? "Unable to bring that document back."
        : "Unable to restore that.",
    );
  };
  const undoArchiveRef = useRef(undoArchive);
  undoArchiveRef.current = undoArchive;
  const hasArchiveUndo = lastArchive !== null;
  // Ctrl+Z with the focus anywhere but a text box — on the file panel, say,
  // where the act was done — takes the act back. In the page, the editor
  // decides between the act and the page's own last edit.
  useEffect(() => {
    if (!hasArchiveUndo) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "z" || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable]"))
      ) {
        return;
      }
      event.preventDefault();
      undoArchiveRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasArchiveUndo]);

  // The draft's files: under the ribbon, beside the page, once there is an
  // editor to put them in; beside whatever stands in for it until then.
  // A function, so the editor hands the panel the document's outline too: the
  // binder's files and this document's headings share one panel.
  const filesPanel = files
    ? (outline?: OutlineSlot) => (
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
          onReadAhead={readAheadOf}
          onOpen={(slugPath) => leave({ kind: "open", slugPath })}
          // A change request is revised, not added to or reshaped, here.
          onNew={
            change ? undefined : (folder) => leave({ kind: "new", folder })
          }
          onNewFolder={change ? undefined : onNewFolder}
          onUploadDrop={
            change || !onUploadFiles
              ? undefined
              : (data, folder) => {
                  const files = readDroppedFiles(data);
                  if (files) onUploadFiles(files, folder);
                }
          }
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
          onArchiveFolder={
            change
              ? undefined
              : (folder) =>
                  actOnFiles(
                    // The open policy's words go first when it is in the folder.
                    documentPath.startsWith(`${folder}/`) ? documentPath : null,
                    () => onArchiveFolder(folder),
                    "Unable to archive that folder.",
                  )
          }
          onConvert={change ? undefined : onConvertFile}
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
          onArchived={(record) => {
            setLastArchive({ record, at: Date.now() });
            setArchiveNotice(true);
          }}
          undo={archiveNotice ? (lastArchive?.record ?? null) : null}
          onUndo={undoArchive}
          outline={outline}
        />
      )
    : undefined;

  let body: ReactNode;
  /** Whether `body` is the editor, which then holds the file panel. */
  let inEditor = false;
  if (!draft || (load.kind === "loading" && !frame)) {
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
          {/* Not on a change request: the conversion goes into a draft, and
              this is somebody's change, saved into in place. */}
          {!change && convertibleKind(load.detail.document.path) !== null ? (
            <>
              <p>
                It was uploaded as a file. You can turn it into a Bindersnap
                document and edit it here, in your draft, or edit it in the
                program that made it and use Upload new version on the
                document's page.
              </p>
              <button
                type="button"
                className="bs-btn bs-btn-primary bs-btn--sm"
                onClick={() =>
                  onConvertFile({
                    slugPath: load.detail.document.slugPath,
                    path: load.detail.document.path,
                    name,
                  })
                }
              >
                Edit in Bindersnap
              </button>
            </>
          ) : (
            <p>
              It was uploaded as a file, so it is edited in the program that
              made it. Make your changes there, then use Upload new version on
              the document's page.
            </p>
          )}
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
  } else if (frame) {
    inEditor = true;
    body = (
      <div
        className={`doc-editor-frame${
          load.kind === "loading" ? " doc-editor-frame--opening" : ""
        }`}
        aria-busy={load.kind === "loading"}
      >
        <Suspense
          fallback={
            <SkeletonGroup label="Loading the editor">
              <SkeletonLine width="medium" />
            </SkeletonGroup>
          }
        >
          <DocumentEditor
            label={name}
            aside={filesPanel}
            // A file from the computer dropped on the page is a document to
            // add, not something to open in the browser. Pictures still go
            // into the page, where they were dropped.
            onDropFiles={
              change || !onUploadFiles
                ? undefined
                : (data) => {
                    const files = readDroppedFiles(data);
                    if (!files) return false;
                    onUploadFiles(files);
                    return true;
                  }
            }
            outsideUndo={
              lastArchive ? { at: lastArchive.at, run: undoArchive } : null
            }
            // Read when the editor is made; every policy after the first is
            // swapped in as a state of its own, undo and all.
            initialContent={frame.doc}
            editable={load.kind === "ready"}
            // A policy just started is its title and an empty line: the
            // cursor goes on the empty line, ready to type, as Word's does.
            // Anything longer opens at the top, where it starts.
            autoFocus={isBlankPolicy(frame.doc) ? "end" : "start"}
            onChange={handleChange}
            onSave={() => requestSave("this")}
            onReady={(editor) => {
              // A new editor: states made by the one before carry its plugins,
              // not these, so each open policy starts again from its words.
              if (editorRef.current !== editor) {
                for (const policy of opened.current.values()) {
                  policy.state = undefined;
                }
              }
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
              if (shown) shown.state = editor.state;
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
              offerKept(now);
            }}
          />
        </Suspense>
      </div>
    );
  }

  /** Every open policy with words not saved, this one first. */
  const unsavedNames = [...(dirty ? [name] : []), ...unsavedElsewhere.values()];
  // Saving on its own, this asks only when a save has failed: the choice is
  // to try it again, not to save at all.
  const saveWord = autosave
    ? "Try again"
    : unsavedNames.length > 1
      ? "Save all"
      : "Save";
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
      policy.state = undefined;
    }
    setUnsavedElsewhere(new Map());
  };

  // Something to propose: words not saved yet, or anything already in the
  // draft. An empty draft proposed is a change request with nothing in it.
  const proposable = anyUnsaved || (current?.acts.length ?? 0) > 0;

  return (
    <div className="doc-editor-page">
      <header className="doc-editor-head">
        {/* **The one bar while writing.** The app's own top bar goes while a
            document is open (`bs-writing`), so this line says everything the
            two used to: which binder, which folder, which document, which
            draft, whether it is saved — and the way out. */}
        <div className="doc-editor-head-body">
          {/* **Binder / document, and nothing between.** Where the policy
              is filed is the file panel's to show, open beside it; a folder
              here changed the bar's length with every policy opened, and
              moved everything after it. */}
          <span className="doc-editor-trail">
            <span className="doc-editor-trail-binder">{binderName}</span>
            <span className="doc-editor-trail-sep" aria-hidden="true">
              /
            </span>
          </span>
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
        </div>
        {/* Where Save puts things, and whether it has: one place for both.
            What a draft is — nothing on record moves until it is approved —
            is the picker's to say, in its menu, not this bar's on every
            visit. */}
        <div className="doc-editor-where">
          {change ? (
            <span
              className="doc-editor-change"
              title={`${change.title} — its reviewers see every save. The version on record does not change until the change is published.`}
            >
              <GitPullRequest size={14} strokeWidth={1.75} aria-hidden="true" />
              Change {change.number}
            </span>
          ) : drafts && current ? (
            /* **Which draft, and the way to the others, here.** Changing
               drafts meant closing the policy, finding the binder's own page
               and its picker, and opening the policy again — and with two
               drafts called "Draft of 27 September", saving into one and
               proposing the other. */
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
          <span
            className={`doc-editor-status${
              (dirty && !autosave) || save.kind === "failed"
                ? " doc-editor-status--unsaved"
                : ""
            }`}
            role="status"
          >
            {status}
            {statusElsewhere}
          </span>
        </div>
        <div className="doc-editor-head-actions">
          <button
            type="button"
            className="bs-btn bs-btn-secondary bs-btn--sm"
            onClick={() => leave({ kind: "close" })}
          >
            Close
          </button>
          {/* Saving on its own, there is nothing to press. Into a proposal,
              Save is deliberate — and asked about first. */}
          {autosave ? null : (
            <button
              type="button"
              className={`bs-btn ${change ? "bs-btn-primary" : "bs-btn-secondary"} bs-btn--sm`}
              disabled={
                load.kind !== "ready" || !dirty || save.kind === "saving"
              }
              title={
                proposalNumber !== null
                  ? `Save into change ${proposalNumber}, where its reviewers see it (Ctrl+S)`
                  : "Save into your draft (Ctrl+S)"
              }
              onClick={() => requestSave("this")}
            >
              {save.kind === "saving" ? "Saving…" : "Save"}
            </button>
          )}
          {/* The others with unsaved words, saved in one press — shown only
              while there are any, as an editor's Save All is live only then. */}
          {!autosave && unsavedElsewhere.size > 0 ? (
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              disabled={save.kind === "saving"}
              title={`Save ${[...unsavedElsewhere.values()].join(", ")}${
                dirty ? ` and ${name}` : ""
              }`}
              onClick={() => requestSave("all")}
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
        {/* Not the editor — a file it does not write: the panel without an
            outline, since there are no headings to show. */}
        {inEditor ? null : filesPanel?.()}
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
            <h2 id="doc-editor-close-title">
              {autosave
                ? "Your latest changes are not saved"
                : unsavedNames.length > 1
                  ? `Save your changes to ${unsavedNames.length} policies?`
                  : `Save your changes to ${unsavedNames[0] ?? name}?`}
            </h2>
            <p id="doc-editor-close-body" className="add-policy-note">
              {unsavedNames.length > 1
                ? `${unsavedNames.join(", ")} have words not saved yet. `
                : ""}
              {autosave
                ? "Saving them into your draft did not work just now. Try again, or leave without them."
                : proposalNumber !== null
                  ? `They go into change ${proposalNumber}, where its reviewers see them. Leaving without saving loses everything since the last save.`
                  : "They go into your draft. Leaving without saving loses everything since the last save."}
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

      {confirming !== null && proposalNumber !== null ? (
        <div
          className="upload-modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setConfirming(null);
          }}
        >
          <div
            className="upload-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="doc-editor-proposal-title"
            aria-describedby="doc-editor-proposal-body"
            onKeyDown={(event) => {
              if (event.key === "Escape") setConfirming(null);
            }}
          >
            <h2 id="doc-editor-proposal-title">
              Update change {proposalNumber}?
            </h2>
            <p id="doc-editor-proposal-body" className="add-policy-note">
              {confirming === "all" && unsavedNames.length > 1
                ? `${unsavedNames.join(", ")} go`
                : `${name} goes`}{" "}
              into the change its reviewers are reading, and they see this
              version from now on.
              {approvalsCleared > 0
                ? ` ${approvalsCleared === 1 ? "The approval" : `The ${approvalsCleared} approvals`} it has will be cleared, and it will need approving again.`
                : ""}
            </p>
            <label className="doc-editor-ask-again">
              <input
                className="bs-checkbox"
                type="checkbox"
                checked={stopAsking}
                onChange={(event) => setStopAsking(event.target.checked)}
              />
              Don't ask me again
            </label>
            <div className="upload-modal-actions">
              <button
                type="button"
                className="bs-btn bs-btn-primary"
                autoFocus
                onClick={confirmSave}
              >
                Update change {proposalNumber}
              </button>
              <button
                type="button"
                className="bs-btn bs-btn-secondary"
                onClick={() => setConfirming(null)}
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
