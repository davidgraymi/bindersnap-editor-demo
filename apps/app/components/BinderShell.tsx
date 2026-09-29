import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Settings, type LucideIcon } from "lucide-react";
import { useIsReadOnly } from "../readOnlyContext";
import { ApiRequestError } from "../../../packages/api-client/mutator";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";
import { routeToPath } from "../routes";

import {
  discardBinderDraft,
  fetchBinder,
  fetchBinderDocuments,
  fetchBinderChange,
  fetchBinderDraft,
  openBinderDraft,
  renameBinderDraft,
} from "../api";
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
import { AddPolicyModal } from "./AddPolicyModal";
import { NewFolderModal } from "./NewFolderModal";
import { BinderArchive } from "./BinderArchive";
import { BinderDraftBar } from "./BinderDraftBar";
import { BinderDraftPicker } from "./BinderDraftPicker";
import { ProposeChangePage } from "./ProposeChangePage";
import { BinderChangePage } from "./BinderChangePage";
import { BinderChanges } from "./BinderChanges";
import { BinderHistory } from "./BinderHistory";
import { BinderSettings } from "./BinderSettings";
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
function readRef(): string | null {
  const { ref } = currentBinderAddress();
  return ref === DEFAULT_REF ? null : ref;
}

function moveTo(url: string): void {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

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
  const [overview, setOverview] = useState<WorkspaceOverviewPayload | null>(
    null,
  );
  /**
   * The binder is not there — or not there for you, which Gitea answers the
   * same way on purpose, so a private binder's name does not leak.
   */
  const [missing, setMissing] = useState(false);
  /**
   * The binder's contents, for the navigation beside an open policy.
   *
   * **Read only while one is open.** Every other binder screen draws the tree
   * itself, so asking for it there would be a second read of what is already
   * on the page — and two trees on one page is one too many.
   */
  const [contents, setContents] = useState<SidebarBinder["contents"] | null>(
    null,
  );
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
  const [addingFromEditor, setAddingFromEditor] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);

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

  const loadOverview = useCallback(() => {
    let cancelled = false;
    fetchBinder(org, binder)
      .then((payload) => {
        if (!cancelled) setOverview(payload);
      })
      // The header is context, not content: a binder whose counts cannot be
      // read still opens, and the tab that failed says so itself. The one
      // exception is a binder that is not there at all.
      .catch((err: unknown) => {
        if (
          !cancelled &&
          err instanceof ApiRequestError &&
          err.status === 404
        ) {
          setMissing(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  useEffect(() => {
    setOverview(null);
    setMissing(false);
    return loadOverview();
  }, [loadOverview]);

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
  const [changeTarget, setChangeTarget] = useState<{
    number: number;
    branch: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (writingChange === null) {
      setChangeTarget(null);
      return;
    }
    let cancelled = false;
    fetchBinderChange(org, binder, writingChange)
      .then((detail) => {
        if (cancelled) return;
        // Decided, or its branch pruned: nothing to save into, so the change
        // itself, which says what became of it.
        if (detail.change.state !== "open" || detail.change.branchName === "") {
          openChangeNumber(writingChange);
          return;
        }
        setChangeTarget({
          number: writingChange,
          branch: detail.change.branchName,
          title: detail.change.title,
        });
      })
      .catch(() => {
        if (!cancelled) openChangeNumber(writingChange);
      });
    return () => {
      cancelled = true;
    };
    // `openChangeNumber` closes over org and binder, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, binder, writingChange]);

  useEffect(() => {
    // Writing on a change request is not being in a draft: asking for one
    // would find none on that branch and leave edit mode.
    if (editMode === "off" || writingChange !== null) {
      setDraft(null);
      return;
    }

    let cancelled = false;
    fetchBinderDraft(org, binder, draftBranch ?? undefined)
      .then((payload) => {
        if (cancelled) return;
        if (payload.draft) setDraft(payload);
        else leaveEditMode();
      })
      .catch(() => {
        if (!cancelled) leaveEditMode();
      });

    return () => {
      cancelled = true;
    };
    // `leaveEditMode` is stable for the life of a binder: it closes over org,
    // binder and the setters, all of which are in this list already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, binder, editMode, draftBranch, writingChange]);

  /**
   * Your drafts while reading, so the binder's page and a document's can offer
   * the way into one. A read, never a start: looking at the record must not
   * make a draft.
   */
  const [readingDrafts, setReadingDrafts] = useState<BinderDraftPayload | null>(
    null,
  );
  useEffect(() => {
    if (editMode !== "off") return;
    let cancelled = false;
    fetchBinderDraft(org, binder)
      .then((payload) => {
        if (!cancelled) setReadingDrafts(payload);
      })
      .catch(() => {
        if (!cancelled) setReadingDrafts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [org, binder, editMode, reloadKey]);
  /** Your drafts, whichever of the two reads has them. */
  const knownDrafts = draft ?? readingDrafts;
  const draftChoices = useMemo(
    () =>
      (knownDrafts?.drafts ?? []).map(({ branch, name }) => ({
        branch,
        name,
      })),
    [knownDrafts],
  );

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

  const leaveEditMode = () => {
    setDraft(null);
    setDraftError(null);
    goToEdit("off");
  };

  /**
   * Start editing, or carry on where you were.
   *
   * Idempotent on the server, which is what lets this be an ordinary button:
   * the second press resumes rather than forks, so nothing here has to ask
   * first whether a draft already exists.
   */
  const startEditing = async () => {
    setStartingEdit(true);
    setDraftError(null);
    try {
      const payload = await openBinderDraft(org, binder);
      setDraft(payload);
      goToEdit("editing", payload.draft?.branch ?? null);
    } catch (err) {
      setDraftError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to start editing this binder.",
      );
    } finally {
      setStartingEdit(false);
    }
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
   */
  const startWriting = async () => {
    setStartingEdit(true);
    setDraftError(null);
    try {
      const payload = await openBinderDraft(org, binder);
      const branch = payload.draft?.branch ?? null;
      setDraft(payload);
      const listing = branch
        ? await fetchBinderDocuments(org, binder, branch)
        : null;
      const target = listing
        ? pickPolicyToWrite(listing.documents, payload.draft?.acts ?? [])
        : null;
      if (!target) {
        goToEdit("editing", branch);
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
   * Start another draft, called something.
   *
   * A deliberate fork, and the name is what makes it one: a second draft with
   * no name is the state this whole change exists to avoid, because "resume
   * the one from Tuesday" has no answer when both are dates.
   */
  const startAnother = async (name: string) => {
    setStartingEdit(true);
    setDraftError(null);
    try {
      const payload = await openBinderDraft(org, binder, name);
      setDraft(payload);
      goToEdit("editing", payload.draft?.branch ?? null);
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

  /**
   * Open a document in the editor, in your draft.
   *
   * **Edit is the same act on a policy as on the binder**: it opens your draft
   * (or resumes it — the server is idempotent) and the editor saves into it.
   * Already editing, it stays in the draft you are in rather than asking the
   * server for the newest, which might be a different one.
   */
  const writeDocument = async (slugPath: string) => {
    const open = editMode !== "off" ? draft?.draft?.branch : undefined;
    if (open) {
      moveTo(
        buildDocumentEditUrl({
          org,
          binder,
          documentPath: slugPath,
          draft: open,
        }),
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
    if (!documentPath) return;
    const branch = draft?.draft?.branch ?? draftBranch;
    const query = new URLSearchParams({ edit: "1" });
    if (branch) query.set("draft", branch);
    moveTo(
      `${buildDocumentUrl({ org, binder, documentPath, version: null })}?${query.toString()}`,
    );
    setEditMode("editing");
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

  /** Move to another of your drafts. The address is what carries it. */
  const switchDraft = (branch: string) => {
    setDraft(null);
    goToEdit("editing", branch);
  };

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
      const left = (draft?.drafts ?? []).filter(
        (entry) => entry.branch !== gone,
      );
      if (left.length > 0) switchDraft(left[0]!.branch);
      else leaveEditMode();
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

  /** Re-read the draft, so the bar counts the act that just landed. */
  const refreshDraft = () => {
    fetchBinderDraft(org, binder, draft?.draft?.branch ?? undefined)
      .then((payload) => {
        if (payload.draft) setDraft(payload);
        else leaveEditMode();
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
  // People and Sign-off rules were tabs of their own and are sections of
  // Settings now; their addresses still resolve, to the section.
  const activeTab: BinderTab = documentPath
    ? "documents"
    : tab === "people" || tab === "sign-off"
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

  useEffect(() => {
    if (!documentPath) {
      setContents(null);
      setReading(null);
      return;
    }

    let cancelled = false;
    fetchBinderDocuments(
      org,
      binder,
      draftForContents ?? undefined,
      openChange ?? undefined,
    )
      .then((payload) => {
        if (cancelled) return;
        setContents({
          documents: payload.documents,
          folders: payload.folders,
          active: null,
          change: openChange,
        });
      })
      // Navigation beside the page, not the page: a binder whose contents
      // cannot be read still shows the policy somebody opened.
      .catch(() => {
        if (!cancelled) setContents(null);
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder, documentPath, draftForContents, openChange, reloadKey]);

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
      section: activeTab,
      openChangeCount: overview?.openChangeCount ?? null,
      // The active row is the address, not what the read happened to return:
      // the read is slower than the click, and a tree that marks the row a
      // moment late reads as a tree that marks the wrong one.
      contents: contents
        ? {
            ...contents,
            active: documentPath ?? null,
            // Clicking through the explorer stays on the branch being read.
            ref: documentRefFromSearch,
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
    overview?.openChangeCount,
    contents,
    reading,
    documentPath,
    documentRefFromSearch,
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
    icon?: LucideIcon;
  }> = [
    { id: "documents", label: binderName, count: overview?.documentCount },
    { id: "changes", label: "Changes", count: overview?.openChangeCount },
    { id: "history", label: "History", icon: History },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  /**
   * The page's one title, and it names the subject.
   *
   * Null on the screens that title themselves — a policy, a change request,
   * the propose step, the archive. That is the point of D1: with the binder
   * named in the sidebar, the page's `h1` belongs to whatever the page is
   * about, and there is exactly one of them.
   */
  const head: { title: string; subtitle?: string } | null = documentPath
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
                  "Nothing joins this binder except a change that has been approved and published.",
              }
            : activeTab === "history"
              ? {
                  title: "History",
                  subtitle:
                    "Every change this binder has published, and what each one did.",
                }
              : activeTab === "settings"
                ? { title: "Settings" }
                : {
                    title: binderName,
                    ...(editMode === "editing"
                      ? {
                          subtitle:
                            "Rename in place, drag to refile, make a folder. Everything you do is saved to your draft, and nobody is asked to look until you propose it.",
                        }
                      : overview?.workspace.description
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
  const editBinder = useWriteAction(() => void startWriting());
  const organizeBinder = useWriteAction(() => void startEditing());
  const editDocument = useWriteAction(
    (slugPath: string) => void writeDocument(slugPath),
  );

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
        documentPath && editMode === "writing" ? " docw-page--writing" : ""
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
                <entry.icon size={15} strokeWidth={1.75} aria-hidden="true" />
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
          {activeTab !== "documents" || onBranch ? null : (
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
                <>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={addDocument}
                  >
                    Add a document
                  </button>
                  {/* Rename, refile and make folders: the tree, in your
                      draft. Edit is for the words. */}
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={organizeBinder}
                    disabled={startingEdit}
                  >
                    Organize
                  </button>
                  <button
                    className="bs-btn bs-btn-primary"
                    type="button"
                    onClick={editBinder}
                    disabled={startingEdit}
                  >
                    {startingEdit ? "Opening your draft…" : "Edit"}
                  </button>
                </>
              ) : editMode === "editing" ? (
                <button
                  className="bs-btn bs-btn-secondary"
                  type="button"
                  onClick={leaveEditMode}
                >
                  Done
                </button>
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
      {documentPath && editMode === "writing" ? null : (
        <PagePath
          route={
            documentPath
              ? { kind: "binderDocument", org, binder, documentPath }
              : { kind: "binder", org, binder }
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
      {documentPath && editMode === "writing" ? (
        <DocumentEditorPage
          org={org}
          binder={binder}
          documentPath={documentPath}
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
              ? { documents: contents.documents, folders: contents.folders }
              : null
          }
          onOpenDocument={(slugPath) => void writeDocument(slugPath)}
          onNewDocument={() => {
            setAddingFromEditor(true);
            setAdding(true);
          }}
          drafts={draft}
          draftBusy={startingEdit}
          onSwitchDraft={writeInDraft}
          onStartDraft={startDraftInEditor}
          onRenameDraft={renameDraft}
          onPropose={proposeFromEditor}
          onOrganize={() =>
            goToEdit("editing", draft?.draft?.branch ?? draftBranch)
          }
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
          draftName={editMode === "off" ? null : (draft?.draft?.name ?? null)}
          drafts={draftChoices}
          onEditDocument={editDocument}
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
          onOpenSignOffRules={() => goTo("sign-off")}
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
          onOpenBranch={(branch) =>
            moveTo(buildBinderUrl({ org, binder, ref: branch }))
          }
          onChanged={loadOverview}
        />
      ) : activeTab === "changes" ? (
        <BinderChanges
          org={org}
          binder={binder}
          onOpenChange={openChangeNumber}
        />
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
          focus={tab === "people" || tab === "sign-off" ? tab : undefined}
          onOpenChange={openChangeNumber}
          onDescribed={loadOverview}
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
              goToEdit("editing");
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
        <div className="binder-home">
          {/* What happened last, above what is in it — GitLab's newest commit
              over the files. Not while editing: the draft bar is the news
              then, and the record has not moved. */}
          {onBranch ? (
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
                  onPick={(ref) => moveTo(buildBinderUrl({ org, binder, ref }))}
                  onPickDraft={(branch) => goToEdit("editing", branch)}
                />
              ) : null
            }
            activeDocument={documentPath ?? null}
            draft={editMode === "off" ? null : (draft?.draft?.branch ?? null)}
            draftPicker={
              draft?.draft && editMode === "editing" ? (
                <BinderDraftPicker
                  org={org}
                  drafts={draft.drafts}
                  others={draft.others}
                  current={draft.draft.branch}
                  busy={startingEdit}
                  onSwitch={switchDraft}
                  onStart={startAnother}
                  onRename={renameDraft}
                  onRecord={leaveEditMode}
                />
              ) : null
            }
            draftActs={draft?.draft?.acts ?? []}
            reloadKey={reloadKey}
            onEdited={refreshDraft}
            onDraftLost={leaveEditMode}
            onOpenArchive={() => goToArchive(true)}
            onOpenChange={openChangeNumber}
            onAddPolicy={() => setAdding(true)}
            onNewFolder={() => setAddingFolder(true)}
          />
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
      {draft?.draft && editMode === "editing" && !archive ? (
        <BinderDraftBar
          name={draft.draft.name}
          acts={draft.draft.acts}
          others={draft.others.map((other) => other.owner)}
          busy={startingEdit}
          onPropose={() => goToEdit("proposing")}
          onDiscard={() => void discard()}
        />
      ) : null}

      {addingFolder ? (
        <NewFolderModal
          org={org}
          binder={binder}
          draft={draft?.draft?.branch}
          onClose={() => setAddingFolder(false)}
          onProposed={(changeNumber) => {
            setAddingFolder(false);
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
          draft={draft?.draft?.branch}
          {...(addingFromEditor
            ? {
                initialMode: "write" as const,
                initialFolder: documentPath?.includes("/")
                  ? documentPath.slice(0, documentPath.lastIndexOf("/"))
                  : "",
              }
            : {})}
          onClose={() => {
            setAdding(false);
            setAddingFromEditor(false);
          }}
          onWrite={(slugPath, branch) => {
            // Straight into the editor, in the draft it was started in.
            setAdding(false);
            setAddingFromEditor(false);
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
            setAdding(false);
            setAddingFromEditor(false);
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
