import { useCallback, useEffect, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";

import {
  discardBinderDraft,
  fetchBinder,
  fetchBinderDraft,
  openBinderDraft,
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
  editModeFromSearch,
  type BinderEditMode,
  type BinderTab,
} from "../binderShell";
import type { DocumentChangeView } from "../routes";
import { parseRequestedChange } from "../binderChange";
import { formatDocumentName } from "../documentDisplay";
import { AddPolicyModal } from "./AddPolicyModal";
import { NewFolderModal } from "./NewFolderModal";
import { BinderArchive } from "./BinderArchive";
import { BinderDraftBar } from "./BinderDraftBar";
import { ProposeChangePage } from "./ProposeChangePage";
import { BinderChangePage } from "./BinderChangePage";
import { BinderChanges } from "./BinderChanges";
import { BinderHistory } from "./BinderHistory";
import { BinderPeople } from "./BinderPeople";
import { BinderSettings } from "./BinderSettings";
import { BinderSignOff } from "./BinderSignOff";
import { BinderDocumentPage } from "./BinderDocumentPage";
import { BinderDocuments } from "./BinderPage";
import { SkeletonLine } from "./Skeleton";

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
  onOpenDocument: (documentPath: string) => void;
  onOpenBinder: () => void;
  onOpenOrganization: () => void;
}

export function BinderShell({
  org,
  binder,
  documentPath,
  currentUser,
  onOpenDocument,
  onOpenBinder,
  onOpenOrganization,
}: BinderShellProps) {
  const isReadOnly = useIsReadOnly();
  const orgDisplayName = useOrganizationDisplayName(org);
  const [overview, setOverview] = useState<WorkspaceOverviewPayload | null>(
    null,
  );
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
      setArchive(archiveFromSearch(window.location.search));
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

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
    fetchBinderDraft(org, binder)
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
  }, [org, binder, editMode]);

  const goToEdit = (next: BinderEditMode) => {
    moveTo(buildBinderUrl({ org, binder, edit: next }));
    setEditMode(next);
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
      setDraft(await openBinderDraft(org, binder));
      goToEdit("editing");
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

  const discard = async () => {
    setStartingEdit(true);
    try {
      await discardBinderDraft(org, binder);
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

  /** Re-read the draft, so the bar counts the act that just landed. */
  const refreshDraft = () => {
    fetchBinderDraft(org, binder)
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
  const activeTab: BinderTab = documentPath ? "documents" : tab;

  const tabs: Array<{ id: BinderTab; label: string; count?: number }> = [
    { id: "documents", label: "Documents", count: overview?.documentCount },
    {
      id: "changes",
      label: "Change requests",
      count: overview?.openChangeCount,
    },
    // No counts on these three. The two that carry one are counts of things to
    // deal with; a number of people, of published versions, or of rules is not
    // — and a people count would cost the header a walk of every team on every
    // tab, to say a number nobody is waiting on.
    { id: "people", label: "People" },
    { id: "sign-off", label: "Sign-off rules" },
    { id: "history", label: "History" },
    { id: "settings", label: "Settings" },
  ];

  return (
    <section className="docw-page">
      <header className="doc-header">
        <div className="doc-header-top">
          <div className="doc-header-identity">
            <nav className="doc-crumbs" aria-label="Where this binder lives">
              <span className="doc-crumb">
                <button
                  className="app-breadcrumb-back"
                  type="button"
                  onClick={onOpenOrganization}
                >
                  {orgDisplayName}
                </button>
              </span>
            </nav>
            {/* The binder titled the way a person would write it, not the
                way the repository is addressed. A binder carries no display
                name of its own yet — only the slug — so this derives one.
                When binders get a real title field, read it here and keep
                this as the fallback. */}
            <h1 className="doc-header-title">{formatDocumentName(binder)}</h1>
            {/* What the binder is for, in the customer's own words. Absent
                until they have written one — a placeholder sentence would be
                us talking, in the place their answer goes. */}
            {overview === null ? (
              <SkeletonLine width="medium" />
            ) : overview.workspace.description ? (
              <p className="doc-header-fact">
                {overview.workspace.description}
              </p>
            ) : null}
          </div>

          {/* The binder is where the work is, so the way to add to it is on
              the binder rather than in a menu somewhere else. Gone rather
              than disabled while the organization is read-only: the banner
              above says why once, and a row of dead buttons says it badly.

              Documents only. This is the header's one filled button, which
              makes it the most emphatic thing on whatever page it sits above —
              and on five of the six tabs the answer to "what is this page for"
              is not "add a policy". On a change awaiting your decision it was
              actively competing with Approve. Each tab that has a primary
              action of its own already puts it in the body, next to the thing
              it acts on. */}
          {/* And not while a document is open, which is the Documents tab but
              not the documents *list*. That page has a primary act of its own —
              "New version" — and two filled buttons on one screen is two
              answers to "what is this page for". */}
          {isReadOnly ||
          activeTab !== "documents" ||
          documentPath ||
          archive ? null : (
            <div className="doc-header-actions">
              {/* **Edit is the filled button when you are not editing.** The
                  customer asked for one: "an edit button that puts the user in
                  edit mode and then allows all these edits to happen on a
                  branch". Rearranging a binder — renaming, refiling, making
                  folders — is the work this page is for, and adding one policy
                  is the narrower act. While editing it is gone: the draft bar
                  below carries Propose, which is the only thing left that
                  finishes anything, and two filled buttons are two answers to
                  "what is this page for". */}
              {editMode === "off" ? (
                <>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => setAdding(true)}
                  >
                    Add a policy
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
                <>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => setAddingFolder(true)}
                  >
                    New folder
                  </button>
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => setAdding(true)}
                  >
                    Add a policy
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>

        <nav className="doc-tabs" role="tablist" aria-label="Binder">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              className={`doc-tab${activeTab === entry.id ? " doc-tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === entry.id}
              onClick={() => goTo(entry.id)}
            >
              {entry.label}
              {entry.count !== undefined && entry.count > 0 ? (
                <span className="doc-tab-count">{entry.count}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      {/* Between the header and whatever is under it, because it is about the
          binder rather than about the list: the propose screen replaces the
          tree and the bar stays put above it, which is what makes "you are
          editing" a state rather than a property of one pane. */}
      {draftError ? (
        <p className="app-inline-error" role="alert">
          {draftError}
        </p>
      ) : null}

      {draft?.draft && editMode !== "off" && !documentPath && !archive ? (
        <BinderDraftBar
          acts={draft.draft.acts}
          others={draft.others.map((other) => other.owner)}
          busy={startingEdit}
          onPropose={() => goToEdit("proposing")}
          onDiscard={() => void discard()}
        />
      ) : null}

      {openChange !== null ? (
        <BinderChangePage
          org={org}
          binder={binder}
          changeNumber={openChange}
          currentUser={currentUser}
          view={changeView}
          onViewChange={(next) => openChangeNumber(openChange, next)}
          onBackToChanges={() => goTo("changes")}
          onOpenDocument={onOpenDocument}
          onChanged={loadOverview}
        />
      ) : documentPath ? (
        <BinderDocumentPage
          org={org}
          binder={binder}
          documentPath={documentPath}
          onOpenBinder={onOpenBinder}
          onOpenChange={openChangeNumber}
        />
      ) : activeTab === "changes" ? (
        <BinderChanges
          org={org}
          binder={binder}
          onOpenChange={openChangeNumber}
          onAddPolicy={() => setAdding(true)}
        />
      ) : activeTab === "people" ? (
        <BinderPeople org={org} binder={binder} />
      ) : activeTab === "sign-off" ? (
        <BinderSignOff
          org={org}
          binder={binder}
          onOpenChange={openChangeNumber}
        />
      ) : activeTab === "history" ? (
        <BinderHistory
          org={org}
          binder={binder}
          onOpenDocument={onOpenDocument}
          onOpenChange={openChangeNumber}
        />
      ) : activeTab === "settings" ? (
        <BinderSettings
          org={org}
          binder={binder}
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
          onOpenDocument={onOpenDocument}
          activeDocument={documentPath ?? null}
          draft={editMode === "off" ? null : (draft?.draft?.branch ?? null)}
          reloadKey={reloadKey}
          onEdited={refreshDraft}
          onDraftLost={leaveEditMode}
          onOpenArchive={() => goToArchive(true)}
        />
      )}

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
