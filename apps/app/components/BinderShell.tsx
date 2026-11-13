import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppIcon, ICON, type IconGlyph } from "./AppIcon";
import { useIsReadOnly } from "../readOnlyContext";
import { ApiRequestError } from "../../../packages/api-client/mutator";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";
import { routeToPath } from "../routes";

import {
  archiveBinderDocument,
  archiveBinderFolder,
  createBinderFolder,
  createBinderDocument,
  discardBinderDraft,
  downloadBinderDocument,
  fetchBinderArchive,
  restoreBinderDocument,
  fetchBinderDraft,
  openBinderDraft,
  renameBinderDocument,
  renameBinderDraft,
  renameBinderFolder,
  reviseBinderDocument,
  type ActTarget,
} from "../api";
import {
  binderChangeQuery,
  binderDocumentsQuery,
  binderDraftQuery,
  binderQuery,
  queryKeys,
} from "../data/queries";
import type { DragSubject } from "../binderMove";
import type { DraftFileTarget } from "./DraftFiles";
import type {
  BinderDraftPayload,
  WorkspaceOverviewPayload,
} from "../../../packages/api-schema/schemas/workspaces";
import {
  buildBinderUrl,
  currentBinderAddress,
  DEFAULT_REF,
  draftFromSearch,
  editModeFromSearch,
  type BinderEditMode,
  type BinderTab,
} from "../binderShell";
import type { DocumentChangeView } from "../routes";
import { followInApp } from "../appLink";
import {
  buildDocumentEditUrl,
  pickPolicyToWrite,
  buildDocumentUrl,
} from "../binderDocument";
import { formatDocumentName } from "../documentDisplay";
import { copyName } from "../copyName";
import { blankDocument, untitledName } from "../newDocument";
import type { DroppedFiles } from "../bulkUpload";
import {
  convertibleKind,
  convertToEditorFile,
  type ConvertedDocument,
} from "../convertToEditor";
import { ConvertDocumentModal } from "./ConvertDocumentModal";
import { AddPolicyModal } from "./AddPolicyModal";
import { NewFolderModal } from "./NewFolderModal";
import { BinderArchive } from "./BinderArchive";
import { BinderDraftBar } from "./BinderDraftBar";
import { ProposeChangePage } from "./ProposeChangePage";
import { BinderChangePage } from "./BinderChangePage";
import { BinderChanges } from "./BinderChanges";
import { BinderHistory } from "./BinderHistory";
import { MyDrafts } from "./MyDrafts";
import { BinderSettings } from "./BinderSettings";
import {
  BINDER_SETTINGS_PAGES,
  binderSettingsSection,
} from "../binderSettings";
import { BinderDocumentPage } from "./BinderDocumentPage";
import { BinderBranchSummary } from "./BinderBranchSummary";
import { DocumentEditorPage } from "./DocumentEditorPage";
import { BinderLatestChange } from "./BinderLatestChange";
import { BinderRefPicker } from "./BinderRefPicker";
import { BinderDocuments } from "./BinderPage";
import type { SidebarBinder } from "./AppSidebar";
import type { DocumentRefView } from "../documentRefs";
import { SkeletonLine } from "./Skeleton";
import { PagePath } from "./LocationTrail";
import { SignOffRail } from "./SignOffRail";
import { describeFolder } from "../signOffPanel";
import { useWriteAction } from "../paywallContext";

/**
 * The binder, laid out the way a repository is.
 *
 * A binder *is* a Gitea repository (ADR 0004), and the shape people already
 * know for one is a name, a description, and a row of tabs: what is in it,
 * what is being changed, what happened, and who can do what. Following that
 * gives a customer a page they can read without being taught, and gives us a
 * baseline to pivot from rather than a layout invented per screen.
 *
 * One document is a file inside the binder, so it opens under the same header
 * with Documents still marked — you are still in the binder, further in.
 */

/**
 * Move the address bar, and tell the app it moved.
 *
 * The dispatch is the whole point, and leaving it out is the bug this
 * replaced. A tab click drops the document path off the URL, but the route
 * the app holds is only re-read on `popstate` — so without one, the app kept
 * rendering a document while the address bar said
 * `/{org}/{binder}/-/settings/people`, and every tab in the binder stopped working
 * the moment somebody opened a document. Same shape as the library's own
 * navigation, for the same reason.
 */
/**
 * The branch the address reads at, or null for the record.
 *
 * `main` named outright is the record too: a document on the record lives at
 * `/-/blob/main/…`, and treating that as "a branch" would draw the chrome of
 * reading somewhere else around the thing everybody reads.
 */
/** The folder's own name: "ICU", for `clinical-standards/icu`. */
function describeFolderName(folder: string): string {
  return formatDocumentName(folder.slice(folder.lastIndexOf("/") + 1));
}

/** "A folder in Governance · 2 documents", or "in Clinical Standards". */
function describeFolderMeta(params: {
  binderName: string;
  folder: string;
  documents: readonly { path: string }[] | null;
}): string {
  const { binderName, folder, documents } = params;
  const parent = folder.includes("/")
    ? describeFolder(folder.slice(0, folder.lastIndexOf("/")))
    : binderName;
  const count =
    documents?.filter((document) => document.path.startsWith(`${folder}/`))
      .length ?? null;
  return [
    `A folder in ${parent}`,
    count === null ? null : count === 1 ? "1 document" : `${count} documents`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function readRef(): string | null {
  const { ref } = currentBinderAddress();
  return ref === DEFAULT_REF ? null : ref;
}

/**
 * Whether a branch is one of this person's drafts — read from its name,
 * which says whose it is (`draft/<login>/<stamp>`), so the answer does not
 * wait on a list of drafts still being fetched. The server checks it again.
 */
function ownsDraftBranch(branch: string, user: string): boolean {
  const [kind, owner, stamp, ...rest] = branch.split("/");
  return (
    kind === "draft" && owner === user && Boolean(stamp) && rest.length === 0
  );
}

/**
 * To another address in the app. `replace` takes the place of the one open
 * rather than adding to Back: moving between policies in the editor is one
 * sitting, and Back leaves it rather than stepping through every file opened.
 */
function moveTo(url: string, { replace = false } = {}): void {
  if (replace) window.history.replaceState({}, "", url);
  else window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** A conversion read and waiting for a yes: the file, and where it was read. */
type LoadedConversion = ConvertedDocument & {
  file: File;
  /** The draft it was read from; null for the record. */
  readFrom: string | null;
};

interface BinderShellProps {
  org: string;
  binder: string;
  /** Set when the address is `/{org}/{binder}/{path}` — a file in the binder. */
  documentPath?: string;
  currentUser: string;
  /**
   * Tell the shell above which binder is on screen, and which of its screens.
   *
   * The sidebar draws the binder's own section (D1) and needs three things
   * this component already has: what it is called, how many changes are open,
   * and where you are inside it. Reported rather than fetched again, because
   * a second reader of the same binder is a second answer waiting to disagree.
   */
  onBinderChange?: (binder: SidebarBinder | null) => void;
  /**
   * Tell the shell above that the address names no binder, so its top bar
   * stops naming one. Called with false once a binder answers again.
   */
  onBinderMissing?: (missing: boolean) => void;
  /**
   * Open a document. `version` opens it at one published version — the
   * history links that way, because a row there is evidence of a version and
   * not a pointer at whatever the document says now.
   */
  onOpenDocument: (documentPath: string, version?: number | null) => void;
  onOpenBinder: () => void;
}

export function BinderShell({
  org,
  binder,
  documentPath,
  currentUser,
  onBinderChange,
  onBinderMissing,
  onOpenDocument,
  onOpenBinder,
}: BinderShellProps) {
  const isReadOnly = useIsReadOnly();
  const orgDisplayName = useOrganizationDisplayName(org);
  const queryClient = useQueryClient();
  // The header is context, not content: a binder whose counts cannot be read
  // still opens, and the tab that failed says so itself. The one exception is
  // a binder that is not there at all.
  const overviewRead = useQuery(binderQuery(org, binder));
  const overview: WorkspaceOverviewPayload | null = overviewRead.data ?? null;
  /**
   * The binder is not there — or not there for you, which Gitea answers the
   * same way on purpose, so a private binder's name does not leak.
   */
  const missing =
    overviewRead.error instanceof ApiRequestError &&
    overviewRead.error.status === 404;
  /**
   * Which version of this document is on screen, told by the page reading it.
   *
   * The open changes touching a document come back with the document, so only
   * that read knows them — and the control offering them lives at the top of
   * the file panel, which is up in the shell. Straight through.
   */
  const [reading, setReading] = useState<DocumentRefView | null>(null);
  const [adding, setAdding] = useState(false);
  /** Opened from the editor's New: start on Write, in the open policy's folder. */
  const [addingFolder, setAddingFolder] = useState(false);
  /** A Word file or PDF being read into the editor's format (issue 883). */
  const [converting, setConverting] = useState<{
    slugPath: string;
    path: string;
    name: string;
  } | null>(null);
  /** The folder a new document or folder goes in, from a folder's menu. */
  const [addingIn, setAddingIn] = useState<string | null>(null);
  /** Files dragged onto the editor, for the add dialog to open with. */
  const [dropped, setDropped] = useState<DroppedFiles | null>(null);

  // Back and forward are how somebody leaves a tab or a change, so the shell
  // follows the address bar rather than its own memory of what was clicked.
  const [tab, setTab] = useState<BinderTab>(() => currentBinderAddress().tab);
  const [openChange, setOpenChange] = useState<number | null>(
    () => currentBinderAddress().change,
  );
  const [changeView, setChangeView] = useState<DocumentChangeView>(
    () => currentBinderAddress().view,
  );
  const [editMode, setEditMode] = useState<BinderEditMode>(() =>
    editModeFromSearch(window.location.search),
  );
  const [archive, setArchive] = useState(() => currentBinderAddress().archive);
  /** A folder's page, `/-/tree/{ref}/{folder}`; null is the binder's top. */
  const [folder, setFolder] = useState<string | null>(
    () => currentBinderAddress().folder,
  );
  const [folderMissing, setFolderMissing] = useState(false);
  /**
   * Which of your drafts is being edited, from the address.
   *
   * Null means "whichever is newest", which is what a bare `?edit=1` meant
   * when a person could only have one. The server decides in the end: a branch
   * that is not yours, or one proposed since the link was made, falls back
   * rather than failing.
   */
  const [draftBranch, setDraftBranch] = useState<string | null>(() =>
    draftFromSearch(window.location.search),
  );
  /** The branch the documents are read on: `/-/tree/{ref}`, `/-/blob/{ref}`. */
  const [documentRefFromSearch, setDocumentRef] = useState<string | null>(() =>
    readRef(),
  );

  /**
   * Your draft in this binder, and whose else is open.
   *
   * Held by the shell rather than by the documents list because the bar spans
   * the page and the propose screen replaces it — three components asking the
   * same question would answer it three times and disagree between renders.
   */
  const [draft, setDraft] = useState<BinderDraftPayload | null>(null);
  const [startingEdit, setStartingEdit] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // Bumped to make the documents list re-read the binder after an act that
  // happened somewhere other than in the tree — a modal, in practice.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const handler = () => {
      const address = currentBinderAddress();
      setTab(address.tab);
      setOpenChange(address.change);
      setChangeView(address.view);
      setEditMode(editModeFromSearch(window.location.search));
      setDraftBranch(draftFromSearch(window.location.search));
      setDocumentRef(readRef());
      setArchive(address.archive);
      setFolder(address.folder);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  /**
   * Open a document, staying in edit mode if that is where it was opened from.
   *
   * **A policy renamed a moment ago is only at that name in the draft.** The
   * tree in edit mode shows the draft's names, and clicking one used to leave
   * edit mode on the way — so the page it landed on asked `main` for an
   * address `main` has never heard of, and said the document did not exist.
   * Keeping `?edit=1` on the address keeps the draft, and is also the way back
   * to what somebody was doing.
   */
  const openDocument = (documentPath: string, version?: number | null) => {
    if (editMode === "editing" && draft?.draft) {
      moveTo(
        buildDocumentUrl({
          org,
          binder,
          documentPath,
          version: null,
          edit: true,
        }),
      );
      return;
    }
    onOpenDocument(documentPath, version);
  };

  /** Where {@link openDocument} goes, for the rows that are links to it. */
  const documentHref = (documentPath: string) =>
    buildDocumentUrl({
      org,
      binder,
      documentPath,
      version: null,
      edit: editMode === "editing" && Boolean(draft?.draft),
    });

  /** A document on the branch the tree is read at. */
  const branchDocumentHref = (documentPath: string) =>
    buildDocumentUrl({
      org,
      binder,
      documentPath,
      version: null,
      ref: documentRefFromSearch,
    });

  /** Read the header again after something on the page changed the binder. */
  const loadOverview = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.binderOverview(org, binder),
    });
  }, [queryClient, org, binder]);

  /**
   * Read the draft whenever the address says we are editing.
   *
   * **A read, so it never starts one.** Landing on `?edit=1` from a reload or
   * a stale link has to find the draft that is there, not conjure a new one:
   * somebody who discarded their work and pressed Back would otherwise be put
   * straight back into an empty edit they had just thrown away. No draft means
   * the address is wrong about this binder, and the answer is to leave edit
   * mode rather than to invent a state to match it.
   */
  /**
   * The open change request the editor is saving into, when it is one rather
   * than a draft: its author, back in the words a reviewer asked about.
   */
  const writingChange =
    documentPath && editMode === "writing" && openChange !== null
      ? openChange
      : null;
  const changeRead = useQuery({
    ...binderChangeQuery(org, binder, writingChange ?? 0),
    enabled: writingChange !== null,
  });
  const writable =
    changeRead.data &&
    changeRead.data.change.state === "open" &&
    changeRead.data.change.branchName !== "" &&
    // Its author and its co-editors; the server refuses anyone else's save.
    changeRead.data.viewer.canEdit;
  const changeTarget =
    writingChange !== null && changeRead.data && writable
      ? {
          number: writingChange,
          branch: changeRead.data.change.branchName,
          title: changeRead.data.change.title,
        }
      : null;

  // Decided, its branch pruned, or unreadable: nothing to save into, so the
  // change itself, which says what became of it.
  useEffect(() => {
    if (writingChange === null) return;
    if (changeRead.isError || (changeRead.data && !writable)) {
      openChangeNumber(writingChange);
    }
    // `openChangeNumber` closes over org and binder, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    org,
    binder,
    writingChange,
    changeRead.isError,
    changeRead.data,
    writable,
  ]);

  /**
   * **A draft's home is the binder read at the draft**: `/-/tree/{draft}`
   * and a document at `/-/blob/{draft}/…`. That page reads what the draft
   * holds, and its bar proposes or discards it; Edit opens the editor in it.
   *
   * There used to be a mode between reading and the editor for this — the
   * binder at `?edit=1`, with Done and Edit, where the tree was renamed and
   * refiled in place. The editor's file panel does all of that, so the mode
   * was a third place to learn that did nothing the other two could not.
   */
  const homeDraftBranch =
    editMode === "off" &&
    documentRefFromSearch !== null &&
    ownsDraftBranch(documentRefFromSearch, currentUser)
      ? documentRefFromSearch
      : null;

  useEffect(() => {
    // Writing on a change request is not being in a draft: asking for one
    // would find none on that branch and leave edit mode.
    if (
      writingChange !== null ||
      (editMode === "off" && homeDraftBranch === null)
    ) {
      setDraft(null);
      return;
    }

    let cancelled = false;
    const asked = editMode === "off" ? homeDraftBranch : draftBranch;
    fetchBinderDraft(org, binder, asked ?? undefined)
      .then((payload) => {
        if (cancelled) return;
        if (editMode === "off") {
          // Reading: the bar is for the draft on the page and no other. The
          // server answers a draft it cannot find with the newest instead.
          setDraft(payload.draft?.branch === asked ? payload : null);
          return;
        }
        if (payload.draft) setDraft(payload);
        else leaveEditMode();
      })
      .catch(() => {
        if (cancelled) return;
        if (editMode === "off") setDraft(null);
        else leaveEditMode();
      });

    return () => {
      cancelled = true;
    };
    // `leaveEditMode` is stable for the life of a binder: it closes over org,
    // binder and the setters, all of which are in this list already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, binder, editMode, draftBranch, writingChange, homeDraftBranch]);

  /**
   * An address from before the organizing view was retired: `?edit=1`. It
   * goes where that view's work went — the draft's own page — so a link
   * somebody kept still lands in the same draft.
   */
  useEffect(() => {
    if (editMode !== "editing") return;
    const branch = draftBranch;
    moveTo(
      documentPath
        ? buildDocumentUrl({
            org,
            binder,
            documentPath,
            version: null,
            ref: branch,
          })
        : buildBinderUrl({ org, binder, ref: branch, folder }),
      { replace: true },
    );
  }, [org, binder, editMode, draftBranch, documentPath, folder]);

  /**
   * Your drafts while reading, so the binder's page and a document's can offer
   * the way into one. A read, never a start: looking at the record must not
   * make a draft.
   */
  const readingDrafts: BinderDraftPayload | null =
    useQuery({
      ...binderDraftQuery(org, binder),
      enabled: editMode === "off",
    }).data ?? null;
  // An act in a modal bumps this; the drafts it may have touched are read
  // again with everything else about the binder.
  useEffect(() => {
    if (reloadKey === 0) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.binder(org, binder),
    });
  }, [reloadKey, org, binder, queryClient]);
  /** Your drafts, whichever of the two reads has them. */
  const knownDrafts = draft ?? readingDrafts;
  /**
   * One of your drafts, when it is the branch being read
   * (`/-/tree/{draft}`): Edit carries on in it rather than in the newest.
   */
  const readingDraft =
    editMode === "off" && documentRefFromSearch
      ? ((readingDrafts?.drafts ?? []).find(
          (own) => own.branch === documentRefFromSearch,
        )?.branch ?? null)
      : null;
  const draftChoices = useMemo(
    () =>
      (knownDrafts?.drafts ?? []).map(({ branch, name }) => ({
        branch,
        name,
      })),
    [knownDrafts],
  );

  /**
   * Whether a branch is one of your drafts — read from its name, which says
   * whose it is (`draft/<login>/<stamp>`), so the answer does not wait on a
   * list of drafts still being fetched. The server checks it again.
   */
  const isOwnDraft = (branch: string) => ownsDraftBranch(branch, currentUser);

  const goToEdit = (
    next: BinderEditMode,
    branch: string | null = draftBranch,
  ) => {
    moveTo(buildBinderUrl({ org, binder, edit: next, draft: branch }));
    setEditMode(next);
    setDraftBranch(next === "off" ? null : branch);
    setArchive(false);
  };

  /**
   * The archive, and back out of it.
   *
   * Leaving edit mode on the way in. The archive is a view of the record —
   * what this binder held — and there is nothing on it to edit; carrying a
   * draft bar over it would offer Propose above a page with no acts on it.
   * Coming back out lands on the binder, not back in the edit.
   */
  const goToArchive = (open: boolean) => {
    moveTo(buildBinderUrl({ org, binder, archive: open }));
    setArchive(open);
    setEditMode("off");
  };

  /** The binder, or a folder of it, read at one of your drafts. */
  const draftHomeHref = (branch: string | null, at: string | null = null) =>
    buildBinderUrl({ org, binder, ref: branch, folder: at });

  const leaveEditMode = () => {
    setDraft(null);
    setDraftError(null);
    goToEdit("off");
  };

  /**
   * Edit on a binder: your draft, open in the editor.
   *
   * **Edit means write.** It opened the tree in edit mode, where the one thing
   * you cannot do is change a word; changing the words meant opening a policy
   * from there and pressing Edit a second time. It now opens the policy you
   * were last writing in the draft — or the binder's first — in the editor,
   * with the draft's files beside it. Renaming, refiling and folders are
   * Organize. A binder of nothing but Word files and PDFs has nothing to
   * write, so there Edit opens the tree as before.
   *
   * **In the draft on screen, when there is one.** Reached from the Drafts
   * page, the binder is open in a particular draft — not always your newest —
   * and Edit there carries on in that one rather than switching to another.
   */
  /**
   * Put a folder on the editor's desk, in the draft: a folder's name in the
   * file panel, an origin in the sign-off panel, Edit on a folder's page.
   * "" is the binder's top folder. Moving between things on the desk is one
   * sitting, so it replaces the address rather than adding to Back.
   */
  const openFolderInEditor = (
    path: string,
    branch: string | null = draft?.draft?.branch ?? draftBranch,
    { replace = editMode === "writing" }: { replace?: boolean } = {},
  ) => {
    setDraftBranch(branch);
    moveTo(
      buildBinderUrl({
        org,
        binder,
        folder: path === "" ? null : path,
        edit: "writing",
        draft: branch,
      }),
      { replace },
    );
    setEditMode("writing");
  };

  const startWriting = async (inDraft?: string | null) => {
    setStartingEdit(true);
    setDraftError(null);
    try {
      const payload = inDraft
        ? await fetchBinderDraft(org, binder, inDraft)
        : await openBinderDraft(org, binder);
      const branch = payload.draft?.branch ?? null;
      setDraft(payload);
      const listing = branch
        ? await queryClient.fetchQuery(
            binderDocumentsQuery(org, binder, { draft: branch }),
          )
        : null;
      // **Edit opens the editor on the page's place.** A folder's page puts
      // the folder on the desk; the binder opens the policy last written in
      // the draft, and a binder with nothing the editor writes opens on its
      // top folder rather than leaving the editor out of reach.
      const onAFolder = currentBinderAddress().folder;
      if (onAFolder) {
        openFolderInEditor(onAFolder, branch, { replace: false });
        return;
      }
      const target = listing
        ? pickPolicyToWrite(listing.documents, payload.draft?.acts ?? [])
        : null;
      if (!target) {
        openFolderInEditor("", branch, { replace: false });
        return;
      }
      setDraftBranch(branch);
      moveTo(
        buildDocumentEditUrl({
          org,
          binder,
          documentPath: target,
          draft: branch,
        }),
      );
      setEditMode("writing");
    } catch (err) {
      setDraftError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to open your draft to edit this binder.",
      );
    } finally {
      setStartingEdit(false);
    }
  };

  /**
   * Open a document in the editor, in your draft.
   *
   * **Edit is the same act on a policy as on the binder**: it opens your draft
   * (or resumes it — the server is idempotent) and the editor saves into it.
   * Already editing, it stays in the draft you are in rather than asking the
   * server for the newest, which might be a different one.
   */
  const writeDocument = async (slugPath: string) => {
    const open =
      editMode !== "off" ? draft?.draft?.branch : (readingDraft ?? undefined);
    if (open) {
      setDraftBranch(open);
      moveTo(
        buildDocumentEditUrl({
          org,
          binder,
          documentPath: slugPath,
          draft: open,
        }),
        // From one policy to the next in the editor: the same sitting.
        { replace: editMode === "writing" },
      );
      setEditMode("writing");
      return;
    }

    setStartingEdit(true);
    setDraftError(null);
    try {
      const payload = await openBinderDraft(org, binder);
      const branch = payload.draft?.branch ?? null;
      setDraft(payload);
      setDraftBranch(branch);
      moveTo(
        buildDocumentEditUrl({
          org,
          binder,
          documentPath: slugPath,
          draft: branch,
        }),
      );
      setEditMode("writing");
    } catch (err) {
      setDraftError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to open your draft to edit this document.",
      );
    } finally {
      setStartingEdit(false);
    }
  };

  /** Out of the editor, back to the document — still in the draft. */
  const closeEditor = () => {
    const branch = draft?.draft?.branch ?? draftBranch;
    if (!documentPath) {
      // From a folder on the desk: that folder, read at the draft, where
      // the bar proposes or discards it.
      moveTo(draftHomeHref(branch, writingFolder || null));
      return;
    }
    // The document, read at the draft: what was just written, as it reads.
    moveTo(
      buildDocumentUrl({
        org,
        binder,
        documentPath,
        version: null,
        ref: branch,
      }),
    );
  };

  /**
   * The policy the propose step was opened from, to go back to on Cancel.
   * Null when it was opened from the binder's own bar.
   */
  const [proposingFrom, setProposingFrom] = useState<string | null>(null);

  /** The same policy, in the editor, in another of your drafts. */
  const writeInDraft = (branch: string) => {
    if (!documentPath) return;
    setDraft(null);
    setDraftBranch(branch);
    moveTo(buildDocumentEditUrl({ org, binder, documentPath, draft: branch }));
    setEditMode("writing");
  };

  /** Start a draft from the editor, and carry on in it on the same policy. */
  const startDraftInEditor = async (name: string) => {
    setStartingEdit(true);
    setDraftError(null);
    try {
      const payload = await openBinderDraft(org, binder, name);
      const branch = payload.draft?.branch;
      if (branch) writeInDraft(branch);
    } catch (err) {
      setDraftError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to start another draft.",
      );
    } finally {
      setStartingEdit(false);
    }
  };

  /** Propose the draft the editor is saving into. */
  const proposeFromEditor = () => {
    const branch = draft?.draft?.branch ?? draftBranch;
    if (!branch) return;
    setProposingFrom(documentPath ?? null);
    goToEdit("proposing", branch);
  };

  /**
   * One act on the draft's files from the editor's panel, then the panel
   * re-read — and the editor after the policy it has open.
   *
   * **Followed by identity, not by address.** A rename or a move gives the
   * open policy a new address, and a folder renamed above it does too, without
   * the act naming it; its identity is the one thing that stays (ADR 0005). So
   * the policy is found again by `uid` in what the draft now holds, and the
   * address bar replaced rather than pushed: the old address is gone from the
   * draft, and Back to it would open nothing. Archived, it is gone altogether,
   * and the editor goes on to the policy {@link pickPolicyToWrite} picks — the
   * binder's tree only when there is none left to write.
   */
  const actInEditor = async (act: (target: ActTarget) => Promise<unknown>) => {
    const branch = draft?.draft?.branch ?? draftBranch;
    if (!branch || !documentPath) return;
    const was = contents?.documents.find(
      (entry) => entry.slugPath === documentPath,
    );
    await act({ draft: branch });
    refreshDraft();
    // Read fresh, into the same entry the navigation beside the page reads.
    await queryClient.invalidateQueries({
      queryKey: queryKeys.binder(org, binder),
    });
    const listing = await queryClient.fetchQuery(
      binderDocumentsQuery(org, binder, { draft: branch }),
    );
    const now = was?.uid
      ? listing.documents.find((entry) => entry.uid === was.uid)
      : listing.documents.find((entry) => entry.slugPath === documentPath);
    const next =
      now?.slugPath ??
      pickPolicyToWrite(listing.documents, draft?.draft?.acts ?? []);
    if (next === documentPath) return;
    if (!next) {
      // Nothing left to write: the binder's top folder, still in the editor.
      openFolderInEditor("", branch);
      return;
    }
    window.history.replaceState(
      {},
      "",
      buildDocumentEditUrl({ org, binder, documentPath: next, draft: branch }),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const renameInEditor = (target: DraftFileTarget, name: string) =>
    actInEditor((into) => {
      if (target.kind === "document") {
        return renameBinderDocument(
          org,
          binder,
          target.slugPath,
          { name },
          into,
        );
      }
      // Renaming a folder is moving it within its own parent.
      const cut = target.path.lastIndexOf("/");
      const parent = cut === -1 ? "" : target.path.slice(0, cut);
      return renameBinderFolder(
        org,
        binder,
        target.path,
        parent === "" ? name : `${parent}/${name}`,
        into,
      );
    });

  const moveInEditor = (subject: DragSubject, folder: string) =>
    actInEditor((into) => {
      if (subject.kind === "document") {
        return renameBinderDocument(
          org,
          binder,
          subject.slugPath,
          { folder },
          into,
        );
      }
      const name = subject.path.slice(subject.path.lastIndexOf("/") + 1);
      return renameBinderFolder(
        org,
        binder,
        subject.path,
        folder === "" ? name : `${folder}/${name}`,
        into,
      );
    });

  /**
   * A copy of a policy, beside it, in the draft — and open in the editor, as
   * Word's Save As leaves the copy on screen. The words as the draft has them;
   * the editor saves the open one first, so nothing typed is left out.
   */
  const copyInEditor = async (slugPath: string) => {
    const branch = draft?.draft?.branch ?? draftBranch;
    const entry = contents?.documents.find(
      (document) => document.slugPath === slugPath,
    );
    if (!branch || !entry) return;
    const words = await (
      await downloadBinderDocument(org, binder, entry.path, branch)
    ).text();
    const name = copyName(
      formatDocumentName(entry.name),
      (contents?.documents ?? [])
        .filter((document) => document.folder === entry.folder)
        .map((document) => formatDocumentName(document.name)),
    );
    const created = await createBinderDocument(
      org,
      binder,
      new File([words], "document.json", { type: "application/json" }),
      name,
      entry.folder || undefined,
      { draft: branch },
    );
    refreshDraft();
    moveTo(
      buildDocumentEditUrl({
        org,
        binder,
        documentPath: created.slugPath,
        draft: branch,
      }),
    );
    setEditMode("writing");
  };

  /**
   * A new document from the editor's panel: made at once in the draft, blank
   * and called "Untitled", and opened — no dialog first, as a new file is in
   * any other editor. In `folder`, or beside the policy that is open.
   */
  const newInEditor = async (folder?: string) => {
    const branch = draft?.draft?.branch ?? draftBranch;
    if (!branch) return;
    const into =
      folder ??
      (documentPath?.includes("/")
        ? documentPath.slice(0, documentPath.lastIndexOf("/"))
        : "");
    const name = untitledName(
      (contents?.documents ?? [])
        .filter((document) => document.folder === into)
        .map((document) => formatDocumentName(document.name)),
    );
    const created = await createBinderDocument(
      org,
      binder,
      new File([blankDocument()], "document.json", {
        type: "application/json",
      }),
      name,
      into || undefined,
      { draft: branch },
    );
    refreshDraft();
    moveTo(
      buildDocumentEditUrl({
        org,
        binder,
        documentPath: created.slugPath,
        draft: branch,
      }),
      { replace: true },
    );
    setEditMode("writing");
  };

  /**
   * Read a Word file or PDF as an editor document. Nothing is written: the
   * dialog shows what the conversion loses first.
   *
   * **Read from the draft it will be written into.** The conversion replaces
   * the document in your draft, so converting the version on record while
   * your draft holds a newer one would overwrite that work with an older copy.
   * Not editing, that is the draft Edit would resume — your newest — and the
   * record only when you have none. `readFrom` goes with the result so
   * {@link confirmConversion} can tell if the draft it opens is another one.
   */
  const loadConversion = async (target: {
    path: string;
  }): Promise<LoadedConversion> => {
    const readFrom =
      (editMode !== "off"
        ? draft?.draft?.branch
        : readingDrafts?.draft?.branch) ?? null;
    const file = await downloadBinderDocument(
      org,
      binder,
      target.path,
      readFrom ?? undefined,
    );
    const source = new File([file], target.path, { type: file.type });
    return { ...(await convertToEditorFile(source)), readFrom };
  };

  /**
   * Put the converted document into the draft as the next version of the same
   * document, and open the editor on it. The server keeps the identity segment
   * of the filename and removes the old file (ADR 0005), so version numbering
   * carries on; nothing reaches `main` until the draft is proposed and approved.
   */
  const confirmConversion = async (
    target: { path: string },
    converted: LoadedConversion,
  ) => {
    let branch = editMode !== "off" ? draft?.draft?.branch : undefined;
    if (!branch) {
      const payload = await openBinderDraft(org, binder);
      branch = payload.draft?.branch ?? undefined;
      setDraft(payload);
      setDraftBranch(branch ?? null);
      // Read from one draft, about to be written into another: what was read
      // may not be what that draft holds. A new draft starts from the record,
      // which is what was read when there was none.
      if (
        branch &&
        converted.readFrom !== null &&
        branch !== converted.readFrom
      ) {
        throw new Error(
          "Your draft changed while this was open. Close this and try again.",
        );
      }
    }
    if (!branch) throw new Error("Unable to open your draft.");

    const revised = await reviseBinderDocument(
      org,
      binder,
      converted.file,
      target.path,
      { draft: branch },
      "converted",
    );
    setConverting(null);
    refreshDraft();
    moveTo(
      buildDocumentEditUrl({
        org,
        binder,
        documentPath: revised.slugPath,
        draft: branch,
      }),
      // From the file's note in the editor, the same policy, now writable:
      // not a step for Back to take.
      { replace: editMode === "writing" },
    );
    setEditMode("writing");
  };

  const restoreInEditor = (uid: string, path?: string) =>
    actInEditor((into) => restoreBinderDocument(org, binder, uid, into, path));

  const readArchiveInEditor = async () => {
    const branch = draft?.draft?.branch ?? draftBranch;
    return (await fetchBinderArchive(org, binder, branch ?? undefined))
      .documents;
  };

  const archiveInEditor = (slugPath: string) =>
    actInEditor((into) => archiveBinderDocument(org, binder, slugPath, into));

  const archiveFolderInEditor = (folder: string) =>
    actInEditor((into) => archiveBinderFolder(org, binder, folder, into));

  /**
   * An archived folder back: its folders first, then every document in it.
   * A restored document goes back to its folder only while that folder
   * exists, and archiving the folder took it away, so the folders are made
   * again before anything is restored into them.
   */
  const restoreFolderInEditor = (
    folders: readonly string[],
    documents: readonly { uid: string; path: string }[],
  ) =>
    actInEditor(async (into) => {
      for (const folder of folders) {
        // One that is there already — a parent made with its child — is
        // refused, and that refusal is what was wanted.
        await createBinderFolder(org, binder, folder, into).catch(
          () => undefined,
        );
      }
      for (const document of documents) {
        await restoreBinderDocument(
          org,
          binder,
          document.uid,
          into,
          document.path,
        );
      }
    });

  /** Every file the draft has written, for the editor's panel to mark. */
  const draftTouched = useMemo(
    () => (draft?.draft?.acts ?? []).flatMap((act) => act.paths),
    [draft],
  );

  const renameDraft = async (branch: string, name: string) => {
    setStartingEdit(true);
    setDraftError(null);
    try {
      setDraft(await renameBinderDraft(org, binder, branch, name));
    } catch (err) {
      setDraftError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to rename your draft.",
      );
    } finally {
      setStartingEdit(false);
    }
  };

  /**
   * Throw this draft away, and land in another of yours if there is one.
   *
   * Leaving edit mode after discarding the only draft is right; doing it when
   * two more are open would make the picker's own Discard read as "stop
   * editing", which is a different act.
   */
  const discard = async () => {
    setStartingEdit(true);
    try {
      const gone = draft?.draft?.branch;
      await discardBinderDraft(org, binder, gone);
      // Back to the record. The page was the draft's own, and it is gone;
      // another of your drafts is in the picker, not somewhere to be put.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.binder(org, binder),
      });
      leaveEditMode();
    } catch (err) {
      setDraftError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to discard your draft.",
      );
    } finally {
      setStartingEdit(false);
    }
  };

  /**
   * Re-read the draft, so the bar counts the act that just landed — and
   * everything read about the binder, since the act changed what is in it.
   */
  const refreshDraft = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.binder(org, binder),
    });
    fetchBinderDraft(org, binder, draft?.draft?.branch ?? undefined)
      .then((payload) => {
        if (payload.draft) setDraft(payload);
        else if (editMode !== "off") leaveEditMode();
      })
      // The act itself succeeded; failing to recount it is not worth throwing
      // somebody out of the edit they are in the middle of.
      .catch(() => undefined);
  };

  const goTo = (next: BinderTab) => {
    moveTo(buildBinderUrl({ org, binder, tab: next }));
    setTab(next);
    setOpenChange(null);
    setEditMode("off");
    setArchive(false);
    setDraft(null);
  };

  const openChangeNumber = (
    changeNumber: number,
    view: DocumentChangeView = "discussion",
  ) => {
    moveTo(
      buildBinderUrl({
        org,
        binder,
        tab: "changes",
        change: changeNumber,
        view,
      }),
    );
    setTab("changes");
    setOpenChange(changeNumber);
    setChangeView(view);
  };

  // A document is a file in the binder, so Documents stays the tab you are on.
  // People & access and Change requests are pages of Settings, under its own
  // addresses; the binder's screen is Settings for all three.
  const activeTab: BinderTab = documentPath
    ? "documents"
    : tab === "people" || tab === "sign-off" || tab === "change-requests"
      ? "settings"
      : tab;

  const binderName = formatDocumentName(binder);

  /**
   * The binder's own page, read at a branch: `/-/tree/{ref}`.
   *
   * **The same page as the record's**, title, description and all — a branch
   * is the binder somewhere else, not a screen of the change that made it.
   * What differs is said by the picker over the tree and the card above it,
   * and the acts that write to the record are not offered.
   */
  const onBranch =
    documentRefFromSearch !== null &&
    !documentPath &&
    activeTab === "documents" &&
    openChange === null &&
    !archive &&
    editMode === "off";

  const draftForContents =
    editMode === "off" ? null : (draft?.draft?.branch ?? null);

  /**
   * The binder's contents, for the navigation beside an open policy.
   *
   * **Read only while one is open.** Every other binder screen draws the tree
   * itself, so asking for it there would be a second read of what is already
   * on the page — and two trees on one page is one too many. Navigation beside
   * the page, not the page: a binder whose contents cannot be read still shows
   * the policy somebody opened.
   */
  const onFolderPage =
    folder !== null &&
    !documentPath &&
    activeTab === "documents" &&
    openChange === null &&
    !archive &&
    editMode === "off";
  /** The address names a folder the binder does not have. */
  const missingFolder = onFolderPage && folderMissing;
  /**
   * A folder on the editor's desk: `/-/tree/{ref}/{folder}?edit=write`. ""
   * is the binder's top folder, which is where Edit on an empty binder lands.
   */
  const writingFolder =
    !documentPath &&
    editMode === "writing" &&
    activeTab === "documents" &&
    openChange === null &&
    !archive
      ? (folder ?? "")
      : null;
  const writing =
    editMode === "writing" && (Boolean(documentPath) || writingFolder !== null);
  /**
   * The branch a reading page is on: `/-/tree/{ref}`, `/-/blob/{ref}/…`. A
   * folder's page and the explorer beside a document read the same branch
   * the page does — a draft read as a branch is the draft, not the record.
   */
  const refForContents =
    editMode === "off" && documentRefFromSearch !== "main"
      ? documentRefFromSearch
      : null;
  const contentsRead = useQuery({
    ...binderDocumentsQuery(org, binder, {
      draft: draftForContents,
      change: openChange,
      ref: refForContents,
    }),
    enabled: Boolean(documentPath) || onFolderPage || writingFolder !== null,
  });
  // **Memoized, not rebuilt each render.** It is handed up to the sidebar by
  // an effect, and a new object every render re-ran that effect, re-rendered
  // the app, and rebuilt it again — a render loop for as long as a policy was
  // open.
  const listing = contentsRead.data;
  const contents: SidebarBinder["contents"] | null = useMemo(
    () =>
      (documentPath || onFolderPage || writingFolder !== null) && listing
        ? {
            documents: listing.documents,
            folders: listing.folders,
            active: null,
            activeFolder: onFolderPage ? folder : null,
            change: openChange,
          }
        : null,
    [documentPath, onFolderPage, writingFolder, folder, listing, openChange],
  );
  /** How many policies the binder has archived, read with the contents. */
  const archivedCount = contentsRead.data?.archivedCount ?? 0;

  useEffect(() => {
    if (!documentPath) setReading(null);
  }, [documentPath]);

  // Opening another policy reads the contents beside it again, as it always
  // has: the editor's saves change the tree, and a policy made a moment ago —
  // a copy, an upload — has to be in it when it opens.
  useEffect(() => {
    if (!documentPath) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.binderDocuments(org, binder, {
        draft: draftForContents,
        change: openChange,
        ref: refForContents,
      }),
    });
  }, [
    queryClient,
    org,
    binder,
    documentPath,
    draftForContents,
    openChange,
    refForContents,
  ]);

  // The sidebar's binder section, kept in step with what is on screen.
  useEffect(() => {
    // No binder, no binder section: its Changes, History and Settings would
    // each lead to another page about a binder that is not there.
    onBinderMissing?.(missing);
    if (missing) {
      onBinderChange?.(null);
      return;
    }
    onBinderChange?.({
      org,
      binder,
      name: binderName,
      // Which of Settings' pages, not only Settings: the sidebar lists them
      // and marks the one that is open.
      section: activeTab === "settings" ? tab : activeTab,
      openChangeCount: overview?.openChangeCount ?? null,
      // The active row is the address, not what the read happened to return:
      // the read is slower than the click, and a tree that marks the row a
      // moment late reads as a tree that marks the wrong one.
      contents: contents
        ? {
            ...contents,
            active: documentPath ?? null,
            // Clicking through the explorer stays on the branch being read —
            // and on the draft: a draft is a branch, and its files and
            // folders are read there like any other.
            ref: documentRefFromSearch ?? draftForContents,
            reading,
          }
        : null,
    });
    // Reporting is the effect; the shell above clears it when the route
    // leaves the binder, so there is nothing to undo here.
  }, [
    org,
    binder,
    binderName,
    activeTab,
    tab,
    overview?.openChangeCount,
    contents,
    reading,
    documentPath,
    documentRefFromSearch,
    draftForContents,
    onBinderChange,
    onBinderMissing,
    missing,
  ]);

  /**
   * The binder's own screens, for the strip a phone gets instead of a sidebar.
   *
   * Above 768px this is not rendered: the sidebar carries them, which is the
   * whole of D1. Below it the sidebar is `display: none`, so the strip is the
   * same shape the tab bar had — and that shape already worked.
   */
  const sections: Array<{
    id: BinderTab;
    label: string;
    count?: number;
    /**
     * Drawn instead of the word. History and Settings are the clock and the
     * gear the sidebar already uses, and their words pushed Settings off the
     * end of a 320px strip. The binder and its changes keep their words: they
     * carry counts, and they are where people are going.
     */
    icon?: IconGlyph;
  }> = [
    { id: "documents", label: binderName, count: overview?.documentCount },
    { id: "changes", label: "Changes", count: overview?.openChangeCount },
    { id: "history", label: "History", icon: ICON.history },
    { id: "settings", label: "Settings", icon: ICON.settings },
  ];

  /**
   * The page's one title, and it names the subject.
   *
   * Null on the screens that title themselves — a policy, a change request,
   * the propose step, the archive. That is the point of D1: with the binder
   * named in the sidebar, the page's `h1` belongs to whatever the page is
   * about, and there is exactly one of them.
   */
  const head: { title: string; subtitle?: string } | null =
    documentPath || writing
      ? null
      : openChange !== null
        ? null
        : archive
          ? null
          : editMode === "proposing"
            ? null
            : activeTab === "changes"
              ? {
                  title: "Change requests",
                  subtitle:
                    "Nothing joins this binder except a change that has been published.",
                }
              : activeTab === "drafts"
                ? {
                    title: "Drafts",
                    subtitle:
                      "Your saved work in this binder, and whether it has been proposed.",
                  }
                : activeTab === "history"
                  ? {
                      title: "History",
                      subtitle:
                        "Every change this binder has published, and what each one did.",
                    }
                  : activeTab === "settings"
                    ? // The page is named for the settings page it is, as the
                      // sidebar entry that opened it is, with the one sentence
                      // that says what that page decides.
                      (() => {
                        const page =
                          BINDER_SETTINGS_PAGES.find(
                            (entry) =>
                              entry.section === binderSettingsSection(tab),
                          ) ?? BINDER_SETTINGS_PAGES[0]!;
                        return {
                          title: page.label,
                          subtitle: page.description,
                        };
                      })()
                    : missingFolder
                      ? { title: "Folder not found", subtitle: "" }
                      : onFolderPage
                        ? {
                            title: describeFolderName(folder!),
                            subtitle: describeFolderMeta({
                              binderName,
                              folder: folder!,
                              documents: listing?.documents ?? null,
                            }),
                          }
                        : {
                            title: binderName,
                            ...(overview?.workspace.description
                              ? { subtitle: overview.workspace.description }
                              : {}),
                          };

  // **A page, not a broken binder.** An address with no binder behind it drew
  // the whole binder — its name made up from the address, Add a document and
  // Edit buttons, a subtitle that never loaded — around one red line. GitLab
  // answers a bad address with a page that says so and the way back.
  // Kept on screen while the organization cannot write, and answered with the
  // paywall: a missing button explains nothing, an offer does.
  const addDocument = useWriteAction(() => setAdding(true));

  // `?add=1` is the getting-started guide's "Add documents": the binder opens
  // with the dialog already up, and the address loses the flag so a reload
  // does not open it again. Read on arrival and on every in-app navigation,
  // because the guide's link can be followed from this binder's own page.
  useEffect(() => {
    const take = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("add") !== "1") return;
      params.delete("add");
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
      addDocument();
    };
    take();
    window.addEventListener("popstate", take);
    return () => window.removeEventListener("popstate", take);
  }, [org, binder, addDocument]);
  const editBinder = useWriteAction(
    () => void startWriting(readingDraft ?? undefined),
  );
  const editDocument = useWriteAction(
    (slugPath: string) => void writeDocument(slugPath),
  );
  const convertDocument = useWriteAction(
    (target: { slugPath: string; path: string; name: string }) =>
      setConverting(target),
  );

  const convertingKind = converting ? convertibleKind(converting.path) : null;

  if (missing) {
    const orgHref = routeToPath({ kind: "organization", org });
    return (
      <section className="docw-page">
        <div className="bs-empty not-found">
          <p className="not-found-code">404</p>
          <h1 className="bs-title">Binder not found</h1>
          <p>
            There is no binder at{" "}
            <code>
              /{org}/{binder}
            </code>
            , or it is one you have not been given access to. Its address may
            have changed if it was renamed.
          </p>
          <a
            className="bs-btn bs-btn-secondary bs-btn--sm"
            href={orgHref}
            onClick={(event) => followInApp(event, () => moveTo(orgHref))}
          >
            Back to {orgDisplayName}
          </a>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`docw-page${documentPath ? " docw-page--document" : ""}${
        writing ? " docw-page--writing" : ""
      }`}
    >
      {/* A phone has no sidebar, so the binder's screens are a strip — the
          shape the tab bar had, which already worked at that width. Above
          768px it is not drawn at all.

          **First on every screen.** It sat under the title on the screens
          the shell titles and above it on the ones that title themselves, so
          tapping History moved the row you had just tapped down the page. */}
      <nav className="binder-strip" aria-label="This binder">
        {sections.map((entry) => (
          <a
            key={entry.id}
            href={buildBinderUrl({ org, binder, tab: entry.id })}
            className={`binder-strip-item${
              entry.icon ? " binder-strip-item--icon" : ""
            }${activeTab === entry.id ? " binder-strip-item--active" : ""}`}
            title={entry.icon ? entry.label : undefined}
            aria-current={activeTab === entry.id ? "page" : undefined}
            onClick={(event) => followInApp(event, () => goTo(entry.id))}
          >
            {entry.icon ? (
              <>
                <AppIcon icon={entry.icon} size="md" />
                <span className="sr-only">{entry.label}</span>
              </>
            ) : (
              entry.label
            )}
            {entry.count !== undefined && entry.count > 0 ? (
              <span className="binder-strip-count">{entry.count}</span>
            ) : null}
          </a>
        ))}
      </nav>

      {head ? (
        <div className="bs-pagehead">
          <div className="bs-pagehead-body">
            <h1 className="bs-title">{head.title}</h1>
            {overview === null && activeTab === "documents" ? (
              <SkeletonLine width="medium" />
            ) : head.subtitle ? (
              <p className="bs-subtitle">{head.subtitle}</p>
            ) : null}
          </div>

          {/* The binder is where the work is, so the way to add to it is on
              the binder rather than in a menu somewhere else. Gone rather
              than disabled while the organization is read-only: the banner
              above says why once, and a row of dead buttons says it badly.

              The contents only. This is the page's one filled button, and on
              the other three screens the answer to "what is this page for" is
              not "add a policy". */}
          {/* Not on somebody else's branch, which nobody here writes to —
              but on one of your drafts, Edit carries on in it. */}
          {activeTab !== "documents" ||
          missingFolder ||
          (onBranch && !readingDraft) ? null : (
            <div className="bs-pagehead-actions">
              {/* **The same buttons in the same slots.** Reading, the header
                  offers Add a policy and Edit; editing, it offers the way
                  out. What it must never do is change what the primary slot
                  means the moment the control beside it is pressed, which is
                  what "[Add a policy] [Edit]" becoming "[New folder] [Add a
                  policy]" did.

                  While editing there is one button and it is the way out:
                  New folder and Add a policy have moved into the bar over the
                  tree they act on. Two of one control on a screen is one of
                  them in the wrong place, and the wrong one is the one that
                  is not beside the thing it adds to. */}
              {editMode === "off" ? (
                // **One button: Edit** (D8). Adding documents, uploading and
                // organizing are all in the editor's file panel now; Edit
                // opens it on this page's place. Not offered to a reader.
                overview?.workspace.access?.push === false ? null : (
                  <button
                    className="bs-btn bs-btn-primary"
                    type="button"
                    onClick={editBinder}
                    disabled={startingEdit}
                  >
                    {startingEdit ? "Opening your draft…" : "Edit"}
                  </button>
                )
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* Where in the binder this page is. The binder itself is in the top
          bar; this is the part that changes as you move around inside it.
          After the strip, so a phone reads binder, then where in it, then the
          title. Only the screens that title themselves are deep enough to
          draw one, so on a wide screen it is always straight above a title. */}
      {/* Not over the editor: its title bar names the policy and its file
          panel shows where it is filed. */}
      {writing ? null : (
        <PagePath
          route={
            documentPath
              ? { kind: "binderDocument", org, binder, documentPath }
              : {
                  kind: "binder",
                  org,
                  binder,
                  ...(onFolderPage ? { folder: folder! } : {}),
                }
          }
        />
      )}

      {/* Between the header and whatever is under it, because it is about the
          binder rather than about the list: the propose screen replaces the
          tree and the bar stays put above it, which is what makes "you are
          editing" a state rather than a property of one pane. */}
      {draftError ? (
        <p className="bs-note bs-note--danger" role="alert">
          {draftError}
        </p>
      ) : null}

      {/* **A document path wins over a change number**, and that order is the
          whole of this change. An address naming a document is asking for that
          document; `?change=` says which ref to read it at, the way `?draft=`
          and `?version=` do. The other way round, `/{org}/{binder}/{path}
          ?change=7` rendered the change's page and the path was ignored. */}
      {writing ? (
        <DocumentEditorPage
          org={org}
          binder={binder}
          documentPath={documentPath ?? ""}
          folder={writingFolder}
          onOpenFolder={(path) => openFolderInEditor(path)}
          draft={
            writingChange !== null
              ? (changeTarget?.branch ?? null)
              : (draft?.draft?.branch ?? null)
          }
          draftName={draft?.draft?.name ?? null}
          change={
            changeTarget
              ? { number: changeTarget.number, title: changeTarget.title }
              : null
          }
          /* Back to the change it was opened from, where the save shows. */
          onClose={
            writingChange !== null
              ? () => openChangeNumber(writingChange)
              : closeEditor
          }
          onSaved={writingChange !== null ? () => undefined : refreshDraft}
          binderName={binderName}
          /* The draft's files, which a change request is not. */
          files={
            contents && writingChange === null
              ? {
                  documents: contents.documents,
                  folders: contents.folders,
                  touched: draftTouched,
                  archivedCount,
                }
              : null
          }
          onOpenDocument={(slugPath) => void writeDocument(slugPath)}
          onNewDocument={newInEditor}
          onUpload={(folder) => {
            setAddingIn(folder);
            setDropped(null);
            setAdding(true);
          }}
          onUploadFiles={(files, folder) => {
            // Where it was dropped in the file panel; on the page, beside
            // the policy that is open, where a sibling most likely goes.
            setAddingIn(
              folder ??
                (documentPath?.includes("/")
                  ? documentPath.slice(0, documentPath.lastIndexOf("/"))
                  : ""),
            );
            setDropped(files);
            setAdding(true);
          }}
          drafts={draft}
          draftBusy={startingEdit}
          onSwitchDraft={writeInDraft}
          onStartDraft={startDraftInEditor}
          onRenameDraft={renameDraft}
          onPropose={proposeFromEditor}
          onOpenChange={(changeNumber) => openChangeNumber(changeNumber)}
          onRenameFile={renameInEditor}
          onMoveFile={moveInEditor}
          onArchiveFile={archiveInEditor}
          onArchiveFolder={archiveFolderInEditor}
          onRestoreFile={restoreInEditor}
          onRestoreFolder={restoreFolderInEditor}
          onCopyFile={copyInEditor}
          onConvertFile={convertDocument}
          onReadArchive={readArchiveInEditor}
          onNewFolder={(parent) => {
            setAddingIn(parent ?? null);
            setAddingFolder(true);
          }}
        />
      ) : documentPath ? (
        <BinderDocumentPage
          org={org}
          binder={binder}
          documentPath={documentPath}
          /* Reading what a change proposes, at the document's own address on
             that change's branch. */
          /* The branch the address names, which is what the page reads at.
             The change is where the reader came from. */
          documentRef={documentRefFromSearch}
          change={openChange}
          onRefsChange={setReading}
          /* Opened from the tree while editing, so it is read where the name
             it was clicked under actually exists. */
          draft={editMode === "off" ? null : (draft?.draft?.branch ?? null)}
          /* Read at one of your drafts, the page says which, as it did
             when it was opened from the organizing view. */
          draftName={
            editMode !== "off" ||
            (homeDraftBranch !== null &&
              draft?.draft?.branch === homeDraftBranch)
              ? (draft?.draft?.name ?? null)
              : null
          }
          drafts={draftChoices}
          onEditDocument={editDocument}
          canWriteBinder={overview?.workspace.access?.push ?? true}
          editing={startingEdit}
          onOpenBinder={onOpenBinder}
          onOpenChange={openChangeNumber}
        />
      ) : openChange !== null ? (
        <BinderChangePage
          org={org}
          binder={binder}
          changeNumber={openChange}
          currentUser={currentUser}
          view={changeView}
          onViewChange={(next) => openChangeNumber(openChange, next)}
          onBackToChanges={() => goTo("changes")}
          onOpenSignOffRules={() => goTo("change-requests")}
          /* The document's own address, on this change's branch — the binder
             at another ref rather than a panel inside the change. */
          /* **The branch, not the change.** A file lives on a branch, which
             is the address every code host gives it; the change rides along
             so the reader keeps the way back to where they came from. */
          onEditInEditor={(slugPath) => {
            moveTo(
              buildDocumentEditUrl({
                org,
                binder,
                documentPath: slugPath,
                draft: null,
                change: openChange,
              }),
            );
            setEditMode("writing");
          }}
          onOpenOnBranch={(slugPath, branch) =>
            moveTo(
              buildDocumentUrl({
                org,
                binder,
                documentPath: slugPath,
                version: null,
                ref: branch,
              }),
            )
          }
          /* **Your draft is a place, not a read of a change.** The chip on a
             change you proposed went to "Change requests / Change 22 /
             Proposed files" — the change's view of your branch, read-only,
             with no way back up the tree. It goes to the draft, where you can
             keep working and every save lands in the change. Somebody else's
             branch is still read under the change. */
          ownDraftHref={(branch) =>
            isOwnDraft(branch) ? draftHomeHref(branch) : null
          }
          onOpenBranch={(branch) => {
            // Yours or not, a branch is read at its own address. Yours has
            // the draft's bar on it.
            moveTo(buildBinderUrl({ org, binder, ref: branch }));
          }}
          onChanged={loadOverview}
        />
      ) : activeTab === "changes" ? (
        <BinderChanges
          org={org}
          binder={binder}
          onOpenChange={openChangeNumber}
        />
      ) : activeTab === "drafts" ? (
        <MyDrafts org={org} binder={binder} />
      ) : activeTab === "history" ? (
        <BinderHistory
          org={org}
          binder={binder}
          onOpenDocument={openDocument}
          onOpenChange={openChangeNumber}
          documentHref={(documentPath, version) =>
            buildDocumentUrl({ org, binder, documentPath, version })
          }
          changeHref={(change) =>
            buildBinderUrl({ org, binder, tab: "changes", change })
          }
        />
      ) : activeTab === "settings" ? (
        <BinderSettings
          org={org}
          binder={binder}
          section={binderSettingsSection(tab) ?? "general"}
          onSection={(section) =>
            goTo(
              BINDER_SETTINGS_PAGES.find((page) => page.section === section)
                ?.tab ?? "settings",
            )
          }
          onOpenChange={openChangeNumber}
          onDescribed={loadOverview}
          onDeleted={() => {
            // Its pages are gone; the organization's list is where it was.
            window.history.replaceState({}, "", `/${org}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          onRenamed={(renamed) => {
            // A new address for the same binder. Replace rather than push:
            // going Back to a name the binder no longer has is a redirect at
            // best and a 404 once somebody reuses it.
            window.history.replaceState(
              {},
              "",
              buildBinderUrl({ org, binder: renamed, tab: "settings" }),
            );
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        />
      ) : archive ? (
        <BinderArchive
          org={org}
          binder={binder}
          onBack={() => goToArchive(false)}
          onProposed={(changeNumber) => {
            loadOverview();
            openChangeNumber(changeNumber);
          }}
        />
      ) : editMode === "proposing" && draft?.draft ? (
        <ProposeChangePage
          org={org}
          binder={binder}
          draft={draft.draft.branch}
          /* Only a name somebody wrote. A draft started by pressing Edit takes
             the date it was made, and "Draft of 19 September" is not a sentence
             to put in front of reviewers as what a change is for. */
          name={draft.draft.named ? draft.draft.name : ""}
          acts={draft.draft.acts}
          currentUser={currentUser}
          onCancel={() => {
            // Back to the policy it was proposed from, still in the editor.
            const from = proposingFrom;
            setProposingFrom(null);
            if (from) {
              moveTo(
                buildDocumentEditUrl({
                  org,
                  binder,
                  documentPath: from,
                  draft: draft.draft!.branch,
                }),
              );
              setEditMode("writing");
            } else {
              // Proposed from the draft's own page: back to it.
              moveTo(draftHomeHref(draft.draft!.branch));
            }
          }}
          onProposed={(changeNumber) => {
            setProposingFrom(null);
            // Straight to the change request. The draft is a change request
            // now — it has reviewers, a number and somewhere to be discussed —
            // and leaving somebody on the tree they were editing would show
            // them a binder that still looks unproposed.
            setDraft(null);
            setEditMode("off");
            loadOverview();
            openChangeNumber(changeNumber);
          }}
        />
      ) : (
        <div
          className={
            // The rail beside the contents, on a branch as on the record.
            editMode === "off" ? "doc-workspace binder-workspace" : undefined
          }
        >
          {/* **A folder that is not there says so, and nothing else.** The
              page used to go on under the notice as though the folder
              existed: its name as the heading, "0 documents", an empty
              list, Edit, and who signs off there. A link to a folder that
              was since renamed or moved lands here, so say what happened. */}
          <div
            className={`binder-home${
              missingFolder ? " binder-home--missing" : ""
            }`}
          >
            {missingFolder ? (
              <div className="bs-empty">
                <p className="bs-empty-lead">This folder is not here.</p>
                <p>
                  {binderName} has no folder at this address
                  {onBranch ? " in what you are reading" : ""}. It may have been
                  renamed, moved or archived since the link was made.
                </p>
                <p>
                  <a
                    className="bs-btn bs-btn-secondary bs-btn--sm"
                    href={buildBinderUrl({ org, binder })}
                    onClick={(event) =>
                      followInApp(event, () =>
                        moveTo(buildBinderUrl({ org, binder })),
                      )
                    }
                  >
                    Back to {binderName}
                  </a>
                </p>
              </div>
            ) : null}
            {/* What happened last, above what is in it — GitLab's newest commit
              over the files. Not while editing: the draft bar is the news
              then, and the record has not moved. A folder's page is about the
              folder, so it goes there. */}
            {onFolderPage ? null : onBranch ? (
              <BinderBranchSummary
                org={org}
                binder={binder}
                branch={documentRefFromSearch!}
                changeHref={(change, compare) =>
                  buildBinderUrl({
                    org,
                    binder,
                    tab: "changes",
                    change,
                    view: compare ? "compare" : "discussion",
                  })
                }
                onOpenChange={(change, compare) =>
                  openChangeNumber(change, compare ? "compare" : "discussion")
                }
              />
            ) : editMode === "off" ? (
              <BinderLatestChange
                key={reloadKey}
                org={org}
                binder={binder}
                changeHref={(change) =>
                  buildBinderUrl({ org, binder, tab: "changes", change })
                }
                historyHref={buildBinderUrl({ org, binder, tab: "history" })}
                onOpenChange={openChangeNumber}
                onOpenHistory={() => goTo("history")}
              />
            ) : null}
            <BinderDocuments
              org={org}
              binder={binder}
              onOpenDocument={(slugPath) =>
                onBranch
                  ? moveTo(branchDocumentHref(slugPath))
                  : openDocument(slugPath)
              }
              documentHref={onBranch ? branchDocumentHref : documentHref}
              atRef={onBranch ? documentRefFromSearch : null}
              refPicker={
                editMode === "off" ? (
                  <BinderRefPicker
                    org={org}
                    binder={binder}
                    current={onBranch ? documentRefFromSearch : null}
                    onPick={(ref) =>
                      moveTo(buildBinderUrl({ org, binder, ref }))
                    }
                    /* A draft is a branch, read like the others: the same
                       page, its own documents and its own rules. */
                    onPickDraft={(branch) =>
                      moveTo(buildBinderUrl({ org, binder, ref: branch }))
                    }
                  />
                ) : null
              }
              activeDocument={documentPath ?? null}
              draft={editMode === "off" ? null : (draft?.draft?.branch ?? null)}
              draftActs={draft?.draft?.acts ?? []}
              reloadKey={reloadKey}
              onEdited={refreshDraft}
              onDraftLost={leaveEditMode}
              onOpenArchive={() => goToArchive(true)}
              onOpenChange={openChangeNumber}
              onAddPolicy={() => setAdding(true)}
              onNewFolder={() => setAddingFolder(true)}
              folder={onFolderPage ? folder : null}
              onFolderMissing={setFolderMissing}
              onOpenFolder={(path) =>
                moveTo(
                  buildBinderUrl({
                    org,
                    binder,
                    folder: path,
                    ref: onBranch ? documentRefFromSearch : null,
                  }),
                )
              }
              folderHref={(path) =>
                buildBinderUrl({
                  org,
                  binder,
                  folder: path,
                  ref: onBranch ? documentRefFromSearch : null,
                })
              }
            />
          </div>
          {editMode === "off" && !missingFolder ? (
            <aside className="doc-rail" aria-label="Who signs off">
              {/* On a branch too: a draft or a change's branch has its own
                  rules, read where its documents are. */}
              <SignOffRail
                org={org}
                binder={binder}
                binderName={binderName}
                place={
                  onFolderPage
                    ? { kind: "folder", path: folder! }
                    : { kind: "binder" }
                }
                at={{ ref: onBranch ? documentRefFromSearch : null }}
                onNavigate={(route) => moveTo(routeToPath(route))}
              />
            </aside>
          ) : null}
        </div>
      )}

      {/* Last in the page, and sticky to the bottom of the viewport: it is
          reachable at any scroll depth and never between you and the tree.
          Not on the propose screen — that step owns its own page, and a
          disabled Propose above a Propose button is two of one control with
          the nearer one dead. On a document read in the draft as well: Close
          in the editor lands there, and proposing what was just saved meant
          finding the binder's own page first. Not in the editor, which has
          its own Propose. */}
      {draft?.draft &&
      !archive &&
      homeDraftBranch !== null &&
      draft.draft.branch === homeDraftBranch &&
      openChange === null &&
      activeTab === "documents" ? (
        <BinderDraftBar
          name={draft.draft.name}
          acts={draft.draft.acts}
          others={draft.others.map((other) => other.owner)}
          busy={startingEdit}
          changeNumber={draft.draft.changeNumber}
          onPropose={() => goToEdit("proposing", draft.draft!.branch)}
          onDiscard={() => void discard()}
          onOpenChange={(changeNumber) => openChangeNumber(changeNumber)}
        />
      ) : null}

      {converting && convertingKind ? (
        <ConvertDocumentModal
          name={converting.name}
          kind={convertingKind}
          load={() => loadConversion(converting)}
          onConfirm={(converted) => confirmConversion(converting, converted)}
          onClose={() => setConverting(null)}
        />
      ) : null}

      {addingFolder ? (
        <NewFolderModal
          org={org}
          binder={binder}
          draft={draft?.draft?.branch}
          parent={addingIn ?? ""}
          onClose={() => {
            setAddingFolder(false);
            setAddingIn(null);
          }}
          onProposed={(changeNumber) => {
            setAddingFolder(false);
            setAddingIn(null);
            loadOverview();
            // Null means it went into the draft, where there is no change
            // request to send anybody to: the folder is in the tree already,
            // so stay on it and let the bar count one act more.
            if (changeNumber === null) {
              setReloadKey((key) => key + 1);
              refreshDraft();
            } else {
              openChangeNumber(changeNumber);
            }
          }}
        />
      ) : null}

      {adding ? (
        <AddPolicyModal
          org={org}
          binder={binder}
          currentUser={currentUser}
          draft={draft?.draft?.branch}
          {...(dropped ? { dropped } : {})}
          {...(addingIn !== null ? { initialFolder: addingIn } : {})}
          onClose={() => {
            setDropped(null);
            setAdding(false);
            setAddingIn(null);
          }}
          onWrite={(slugPath, branch) => {
            // Straight into the editor, in the draft it was started in.
            setDropped(null);
            setAdding(false);
            setAddingIn(null);
            loadOverview();
            setDraftBranch(branch);
            moveTo(
              buildDocumentEditUrl({
                org,
                binder,
                documentPath: slugPath,
                draft: branch,
              }),
            );
            setEditMode("writing");
          }}
          onAdded={(changeNumber) => {
            setDropped(null);
            setAdding(false);
            setAddingIn(null);
            loadOverview();
            // Into the draft: the policy is in the tree, nothing has been
            // proposed, and there is nowhere to navigate to.
            if (changeNumber === null) {
              setReloadKey((key) => key + 1);
              refreshDraft();
              return;
            }
            // **Straight to the change request, not to the document.** What
            // just happened is that a change request was opened — the policy
            // is not in the binder and the binder's own list says so by not
            // carrying it. Landing on the document made the act look finished;
            // this shows what happened and what has to happen next.
            openChangeNumber(changeNumber);
          }}
        />
      ) : null}
    </section>
  );
}
