import { useCallback, useEffect, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";

import {
  discardBinderDraft,
  fetchBinder,
  fetchBinderDocuments,
  fetchBinderDraft,
  openBinderDraft,
  renameBinderDraft,
} from "../api";
import type {
  BinderDraftPayload,
  WorkspaceOverviewPayload,
} from "../../../packages/api-schema/schemas/workspaces";
import {
  archiveFromSearch,
  binderTabFromSearch,
  buildBinderUrl,
  changeViewFromSearch,
  draftFromSearch,
  editModeFromSearch,
  type BinderEditMode,
  type BinderTab,
} from "../binderShell";
import type { DocumentChangeView } from "../routes";
import { followInApp } from "../appLink";
import { parseRequestedChange } from "../binderChange";
import { buildDocumentUrl, parseRequestedRef } from "../binderDocument";
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
import { BinderDocuments } from "./BinderPage";
import type { SidebarBinder } from "./AppSidebar";
import type { DocumentRefView } from "../documentRefs";
import { SkeletonLine } from "./Skeleton";
import { PagePath } from "./LocationTrail";

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
 * rendering `/{org}/{binder}/{path}` while the address bar said
 * `/{org}/{binder}?tab=people`, and every tab in the binder stopped working
 * the moment somebody opened a document. Same shape as the library's own
 * navigation, for the same reason.
 */
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
  onOpenDocument,
  onOpenBinder,
}: BinderShellProps) {
  const isReadOnly = useIsReadOnly();
  const [overview, setOverview] = useState<WorkspaceOverviewPayload | null>(
    null,
  );
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
  const [addingFolder, setAddingFolder] = useState(false);

  // Back and forward are how somebody leaves a tab or a change, so the shell
  // follows the address bar rather than its own memory of what was clicked.
  const [tab, setTab] = useState<BinderTab>(() =>
    binderTabFromSearch(window.location.search),
  );
  const [openChange, setOpenChange] = useState<number | null>(() =>
    parseRequestedChange(window.location.search),
  );
  const [changeView, setChangeView] = useState<DocumentChangeView>(() =>
    changeViewFromSearch(window.location.search),
  );
  const [editMode, setEditMode] = useState<BinderEditMode>(() =>
    editModeFromSearch(window.location.search),
  );
  const [archive, setArchive] = useState(() =>
    archiveFromSearch(window.location.search),
  );
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
  /** The branch a document is being read on, from `?ref=`. */
  const [documentRefFromSearch, setDocumentRef] = useState<string | null>(() =>
    parseRequestedRef(window.location.search),
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
      setTab(binderTabFromSearch(window.location.search));
      setOpenChange(parseRequestedChange(window.location.search));
      setChangeView(changeViewFromSearch(window.location.search));
      setEditMode(editModeFromSearch(window.location.search));
      setDraftBranch(draftFromSearch(window.location.search));
      setDocumentRef(parseRequestedRef(window.location.search));
      setArchive(archiveFromSearch(window.location.search));
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
      moveTo(`/${org}/${binder}/${documentPath}?edit=1`);
      return;
    }
    onOpenDocument(documentPath, version);
  };

  /** Where {@link openDocument} goes, for the rows that are links to it. */
  const documentHref = (documentPath: string) =>
    editMode === "editing" && draft?.draft
      ? `/${org}/${binder}/${documentPath}?edit=1`
      : buildDocumentUrl({ org, binder, documentPath, version: null });

  /** A document on the branch the address names, with the way back. */
  const branchDocumentHref = (documentPath: string) =>
    buildDocumentUrl({
      org,
      binder,
      documentPath,
      version: null,
      change: openChange,
      ref: documentRefFromSearch,
    });

  const loadOverview = useCallback(() => {
    let cancelled = false;
    fetchBinder(org, binder)
      .then((payload) => {
        if (!cancelled) setOverview(payload);
      })
      // The header is context, not content: a binder whose counts cannot be
      // read still opens, and the tab that failed says so itself.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  useEffect(() => {
    setOverview(null);
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
  useEffect(() => {
    if (editMode === "off") {
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
  }, [org, binder, editMode, draftBranch]);

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
  ]);

  /**
   * The binder's own screens, for the strip a phone gets instead of a sidebar.
   *
   * Above 768px this is not rendered: the sidebar carries them, which is the
   * whole of D1. Below it the sidebar is `display: none`, so the strip is the
   * same shape the tab bar had — and that shape already worked.
   */
  const sections: Array<{ id: BinderTab; label: string; count?: number }> = [
    { id: "documents", label: binderName, count: overview?.documentCount },
    { id: "changes", label: "Changes", count: overview?.openChangeCount },
    { id: "history", label: "History" },
    { id: "settings", label: "Settings" },
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

  return (
    <section
      className={`docw-page${documentPath ? " docw-page--document" : ""}`}
    >
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
          {isReadOnly || activeTab !== "documents" ? null : (
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
                    onClick={() => setAdding(true)}
                  >
                    Add a document
                  </button>
                  <button
                    className="bs-btn bs-btn-primary"
                    type="button"
                    onClick={() => void startEditing()}
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

      {/* A phone has no sidebar, so the binder's screens are a strip under
          the page title — the shape the tab bar had, which already worked at
          that width. Above 768px it is not drawn at all. */}
      <nav className="binder-strip" aria-label="This binder">
        {sections.map((entry) => (
          <a
            key={entry.id}
            href={buildBinderUrl({ org, binder, tab: entry.id })}
            className={`binder-strip-item${
              activeTab === entry.id ? " binder-strip-item--active" : ""
            }`}
            aria-current={activeTab === entry.id ? "page" : undefined}
            onClick={(event) => followInApp(event, () => goTo(entry.id))}
          >
            {entry.label}
            {entry.count !== undefined && entry.count > 0 ? (
              <span className="binder-strip-count">{entry.count}</span>
            ) : null}
          </a>
        ))}
      </nav>

      {/* Where in the binder this page is. The binder itself is in the top
          bar; this is the part that changes as you move around inside it.
          After the strip, so a phone reads binder, then where in it, then the
          title. Only the screens that title themselves are deep enough to
          draw one, so on a wide screen it is always straight above a title. */}
      <PagePath
        route={
          documentPath
            ? { kind: "binderDocument", org, binder, documentPath }
            : { kind: "binder", org, binder }
        }
      />

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
      {documentPath ? (
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
          onBackToChange={openChangeNumber}
          onRefsChange={setReading}
          /* Opened from the tree while editing, so it is read where the name
             it was clicked under actually exists. */
          draft={editMode === "off" ? null : (draft?.draft?.branch ?? null)}
          onOpenBinder={onOpenBinder}
          onOpenChange={openChangeNumber}
        />
      ) : openChange !== null &&
        documentRefFromSearch !== null &&
        activeTab === "documents" ? (
        /* **The binder at a change's branch**, from the branch link under a
           comparison's title — the root of the branch, the way a code host
           opens one, rather than whichever file happened to be first. */
        <BinderDocuments
          org={org}
          binder={binder}
          onChange={{ number: openChange, branch: documentRefFromSearch }}
          onBackToChange={openChangeNumber}
          onOpenChange={openChangeNumber}
          onOpenDocument={(slugPath) => moveTo(branchDocumentHref(slugPath))}
          documentHref={branchDocumentHref}
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
          onOpenDocument={openDocument}
          /* The document's own address, on this change's branch — the binder
             at another ref rather than a panel inside the change. */
          /* **The branch, not the change.** A file lives on a branch, which
             is the address every code host gives it; the change rides along
             so the reader keeps the way back to where they came from. */
          onOpenOnBranch={(slugPath, branch) =>
            moveTo(
              buildDocumentUrl({
                org,
                binder,
                documentPath: slugPath,
                version: null,
                change: openChange,
                ref: branch,
              }),
            )
          }
          onOpenBranch={(branch) =>
            moveTo(
              buildBinderUrl({
                org,
                binder,
                ref: branch,
                change: openChange,
              }),
            )
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
          onCancel={() => goToEdit("editing")}
          onProposed={(changeNumber) => {
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
        <BinderDocuments
          org={org}
          binder={binder}
          onOpenDocument={openDocument}
          documentHref={documentHref}
          activeDocument={documentPath ?? null}
          draft={editMode === "off" ? null : (draft?.draft?.branch ?? null)}
          draftPicker={
            draft?.draft && editMode === "editing" ? (
              <BinderDraftPicker
                drafts={draft.drafts}
                others={draft.others}
                current={draft.draft.branch}
                busy={startingEdit}
                onSwitch={switchDraft}
                onStart={startAnother}
                onRename={renameDraft}
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
      )}

      {/* Last in the page, and sticky to the bottom of the viewport: it is
          reachable at any scroll depth and never between you and the tree.
          Not on the propose screen — that step owns its own page, and a
          disabled Propose above a Propose button is two of one control with
          the nearer one dead. */}
      {draft?.draft && editMode === "editing" && !documentPath && !archive ? (
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
          onClose={() => setAdding(false)}
          onAdded={(changeNumber) => {
            setAdding(false);
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
