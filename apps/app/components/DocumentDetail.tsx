import { ChevronDown, Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PullRequestWithApprovalState,
  DocTag,
  RepoBranchProtection,
  RepoCollaboratorPermissionSummary,
  ReviewSettings,
  UploadResult,
} from "../api";
import {
  downloadDocument,
  getClosedChanges,
  getDocumentDetail,
  listDocumentCollaborators,
} from "../api";
import type { DocumentChangeView, DocumentTab } from "../routes";
import { describeFileKind } from "../documentFile";
import type { ChangeRecord } from "../documentDisplay";
import {
  closedChangeToRecord,
  formatDocumentName,
  toChangeRecord,
} from "../documentDisplay";
import {
  buildDocumentHeaderFacts,
  buildPendingDecisionRows,
  buildTeamAvatars,
  buildVersionMenuOptions,
  buildVersionRailRows,
} from "../documentWorkspace";
import type { VersionMenuOption } from "../documentWorkspace";
import { resolveComparisonBase } from "../documentComparison";
import { DocumentAccess } from "./DocumentAccess";
import { DocumentChangeDetail } from "./DocumentChangeDetail";
import type { ChangeFilter } from "./DocumentChanges";
import { DocumentChanges } from "./DocumentChanges";
import { DocumentHistory } from "./DocumentHistory";
import { DocumentPreview } from "./DocumentPreview";
import { SkeletonGroup, SkeletonLine, SkeletonShape } from "./Skeleton";
import { UploadModal } from "./UploadModal";

interface DocumentDetailProps {
  owner: string;
  repo: string;
  uploaderSlug: string | null;
  activeView: DocumentTab;
  /** Which change has its own page open, or null for the change list. */
  activeChangeNumber: number | null;
  /** Which half of that change's page: the discussion or the file. */
  activeChangeView: DocumentChangeView;
  /**
   * Which published version the Document tab is showing, from the URL. Null
   * is the version on record.
   */
  activeVersion: number | null;
  onTabChange: (tab: DocumentTab) => void;
  /** Open a published version, or the record when given null. */
  onSelectVersion: (version: number | null) => void;
  onOpenChange: (pullNumber: number | null, view?: DocumentChangeView) => void;
}

interface CanonicalFileInfo {
  storedFileName: string;
  downloadFileName: string;
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * The document workspace.
 *
 * One document, four views: what it says now, what is waiting on a decision,
 * how it got here, and who can approve it. The header names the document and
 * the version on record, and holds still at the same width on every tab — it
 * is a page, not a stack of boxes that resize under you.
 */
export function DocumentDetail({
  owner,
  repo,
  uploaderSlug,
  activeView,
  activeChangeNumber,
  activeChangeView,
  activeVersion,
  onTabChange,
  onSelectVersion,
  onOpenChange,
}: DocumentDetailProps) {
  const [tags, setTags] = useState<DocTag[]>([]);
  const [openPRs, setOpenPRs] = useState<PullRequestWithApprovalState[]>([]);
  const [branchProtection, setBranchProtection] =
    useState<RepoBranchProtection | null>(null);
  const [canonicalFileInfo, setCanonicalFileInfo] =
    useState<CanonicalFileInfo | null>(null);
  const [reviewSettings, setReviewSettings] = useState<ReviewSettings | null>(
    null,
  );
  const [currentUserPermission, setCurrentUserPermission] =
    useState<RepoCollaboratorPermissionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [downloadState, setDownloadState] = useState<{
    ref: string | null;
    error: string | null;
  }>({ ref: null, error: null });
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("open");
  // Null until something asks for the closed list — it costs a review lookup
  // per closed change, and opening a document should not pay that.
  const [closedChanges, setClosedChanges] = useState<ChangeRecord[] | null>(
    null,
  );
  const [closedState, setClosedState] = useState<{
    loading: boolean;
    error: string | null;
  }>({ loading: false, error: null });
  // Faces for the rail. Purely presentational, so a refusal costs nothing but
  // an empty row — the Access & approvals tab is where this is really asked.
  const [collaborators, setCollaborators] = useState<
    RepoCollaboratorPermissionSummary[]
  >([]);

  const loadDocumentData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const detail = await getDocumentDetail(owner, repo);

      setTags(detail.tags);
      setOpenPRs(detail.openPullRequests);
      setBranchProtection(detail.branchProtection);
      setReviewSettings(detail.reviewSettings ?? null);
      setCurrentUserPermission(detail.currentUserPermission);
      setCanonicalFileInfo(detail.canonicalFile);
      // Whatever just happened may have closed a change. Drop the cached
      // closed list rather than showing a record that is one publish stale;
      // it is refetched only if something asks for it again.
      setClosedChanges(null);
      setClosedState({ loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to load document details.";
      setError(message);
      setTags([]);
      setOpenPRs([]);
      setCurrentUserPermission(null);
      setCanonicalFileInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [owner, repo]);

  const loadClosedChanges = useCallback(async () => {
    setClosedState({ loading: true, error: null });
    try {
      const payload = await getClosedChanges(owner, repo);
      setClosedChanges(payload.changes.map(closedChangeToRecord));
      setClosedState({ loading: false, error: null });
    } catch (err) {
      setClosedState({
        loading: false,
        error:
          err instanceof Error
            ? err.message
            : "Unable to load the closed changes.",
      });
    }
  }, [owner, repo]);

  useEffect(() => {
    void loadDocumentData();
    setChangeFilter("open");
  }, [loadDocumentData]);

  useEffect(() => {
    if (uploaderSlug === null) return;

    let cancelled = false;
    listDocumentCollaborators(owner, repo, 1, 12)
      .then((payload) => {
        if (!cancelled) setCollaborators(payload.collaborators);
      })
      .catch(() => {
        if (!cancelled) setCollaborators([]);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo, uploaderSlug]);

  const isAnonymous = uploaderSlug === null;
  const currentUser = uploaderSlug ?? "";
  const documentName = formatDocumentName(repo);
  const latestTag = tags[0] ?? null;
  const nextVersion = (latestTag?.version ?? 0) + 1;

  // Assigning a change is a write to the pull request, so it takes the same
  // access Gitea would demand for one. The owner always has it; Gitea's own
  // check is still the one that decides, this only keeps the buttons honest.
  const permissionAccess = currentUserPermission?.access ?? null;
  const canManageAssignments =
    !isAnonymous &&
    (currentUser === owner ||
      permissionAccess === "write" ||
      permissionAccess === "admin");

  const openChanges = openPRs.map(toChangeRecord);
  const activeChange =
    activeChangeNumber === null
      ? null
      : (openChanges.find((change) => change.number === activeChangeNumber) ??
        closedChanges?.find((change) => change.number === activeChangeNumber) ??
        null);

  // A link to a closed change is the normal way back into the record, so the
  // closed list is fetched on demand rather than only when the filter is used.
  const needsClosedChanges =
    activeView === "changes" &&
    !isLoading &&
    (changeFilter === "closed" ||
      (activeChangeNumber !== null && activeChange === null));

  useEffect(() => {
    if (!needsClosedChanges) return;
    if (closedChanges !== null || closedState.loading || closedState.error) {
      return;
    }
    void loadClosedChanges();
  }, [
    needsClosedChanges,
    closedChanges,
    closedState.loading,
    closedState.error,
    loadClosedChanges,
  ]);

  /**
   * Save a version to disk. `loaded` lets a caller that already holds the
   * bytes — the preview, which just rendered them — skip a second fetch of
   * the same file.
   */
  async function handleDownload(gitRef: string, loaded?: Blob | null) {
    if (!canonicalFileInfo) {
      setDownloadState({
        ref: null,
        error: "Unable to determine which file to download for this document.",
      });
      return;
    }

    if (loaded) {
      triggerBrowserDownload(loaded, canonicalFileInfo.downloadFileName);
      return;
    }

    setDownloadState({ ref: gitRef, error: null });

    try {
      const blob = await downloadDocument(owner, repo, gitRef);
      triggerBrowserDownload(blob, canonicalFileInfo.downloadFileName);
      setDownloadState({ ref: null, error: null });
    } catch (err) {
      setDownloadState({
        ref: null,
        error:
          err instanceof Error ? err.message : "Unable to download document.",
      });
    }
  }

  // Stable so the preview loads the file once per ref rather than per render,
  // and above the early returns below so it runs on every render.
  const loadFile = useCallback(
    (gitRef: string) => downloadDocument(owner, repo, gitRef),
    [owner, repo],
  );

  const handleUploadSuccess = (_result: UploadResult) => {
    setShowUploadModal(false);
    onTabChange("changes");
    void loadDocumentData();
  };

  if (isLoading) {
    return (
      <SkeletonGroup label="Loading document" className="docw-page">
        <header className="doc-header">
          <div className="doc-header-top">
            <div className="doc-header-identity">
              <SkeletonLine width="medium" heading />
              <div className="doc-header-facts">
                <SkeletonShape variant="badge" />
                <SkeletonLine width="short" />
              </div>
            </div>
          </div>
          <div className="doc-tabs">
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonShape key={index} variant="pill" />
            ))}
          </div>
        </header>
        <div className="doc-panel bs-skeleton-stack">
          <SkeletonLine width="medium" heading />
          <SkeletonLine width="full" />
          <SkeletonLine width="full" />
          <SkeletonLine width="wide" />
          <SkeletonLine width="full" />
          <SkeletonLine width="medium" />
        </div>
      </SkeletonGroup>
    );
  }

  if (error) {
    return (
      <div className="docw-page">
        <div className="doc-panel vault-error-state">
          <h2>Unable to load document</h2>
          <p>{error}</p>
          <button
            className="bs-btn bs-btn-primary"
            type="button"
            onClick={() => void loadDocumentData()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // The URL carries a version number; the tag list is what turns it into a
  // git ref. An unknown number resolves to nothing, and the page says so
  // rather than quietly showing the record under the wrong heading.
  const viewedTag =
    activeVersion === null
      ? null
      : (tags.find((tag) => tag.version === activeVersion) ?? null);
  const isViewingLatest =
    activeVersion === null || latestTag?.version === activeVersion;
  const viewingRef = isViewingLatest ? "main" : (viewedTag?.name ?? "main");
  const missingVersion = activeVersion !== null && viewedTag === null;

  // History carries no count on purpose: a version count is not a number of
  // things to deal with, and a bubble beside it reads like one.
  const tabs: { id: DocumentTab; label: string; count?: number }[] = [
    { id: "overview", label: "Document" },
    { id: "changes", label: "Changes", count: openPRs.length },
    { id: "history", label: "History" },
    ...(isAnonymous
      ? []
      : ([{ id: "access", label: "Access & approvals" }] as const)),
  ];

  const headerFacts = buildDocumentHeaderFacts({
    latestTag,
    fileName: canonicalFileInfo?.downloadFileName ?? null,
    viewedTag,
  });
  const versionOptions = buildVersionMenuOptions(tags, activeVersion);
  const pendingRows = buildPendingDecisionRows(openPRs);
  const versionRows = buildVersionRailRows(tags);
  const teamAvatars = buildTeamAvatars(collaborators, owner);

  return (
    <div className="docw-page">
      <header className="doc-header">
        <div className="doc-header-top">
          <div className="doc-header-identity">
            {/* No owner/repo path. Nobody thinks of their contract as
                "alice / vendor-agreement" — it is the Vendor Agreement. */}
            <h1 className="doc-header-title">{documentName}</h1>
            <div className="doc-header-facts">
              {/* The official version, not a status. A document can have v3
                  published and v4 in review at the same time, so a single
                  status word here was always going to be a lie. It is also
                  the way back to every earlier version — the pill names what
                  you are reading, so it is where you go to read another. */}
              <VersionMenu
                label={headerFacts.versionLabel}
                tone={headerFacts.tone}
                options={versionOptions}
                open={versionMenuOpen}
                onToggle={() => setVersionMenuOpen((wasOpen) => !wasOpen)}
                onClose={() => setVersionMenuOpen(false)}
                onSelect={(version) => {
                  setVersionMenuOpen(false);
                  // `onSelectVersion` lands on the Document tab itself, so
                  // asking for the tab as well would only race it.
                  onSelectVersion(version);
                }}
              />
              <span className="doc-header-fact">
                {headerFacts.approvedLine}
              </span>
              {/* The banner this replaces sat on top of the document itself.
                  The way out of an earlier version belongs beside the pill
                  that says you are in one. */}
              {!isViewingLatest ? (
                <button
                  className="doc-header-latest"
                  type="button"
                  onClick={() => onSelectVersion(null)}
                >
                  Back to current
                </button>
              ) : null}
              {headerFacts.fileName ? (
                <span
                  className="doc-header-fact doc-header-file"
                  title={describeFileKind(headerFacts.fileName)}
                >
                  {headerFacts.fileName}
                </span>
              ) : null}
            </div>
          </div>

          {!isAnonymous ? (
            <button
              className="doc-header-submit"
              type="button"
              onClick={() => setShowUploadModal(true)}
            >
              Submit new version
            </button>
          ) : null}
        </div>

        <nav
          className="doc-tabs"
          role="tablist"
          aria-label="Document workspace"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`doc-tab${activeView === tab.id ? " doc-tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeView === tab.id}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 ? (
                <span className="doc-tab-count">{tab.count}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      {downloadState.error ? (
        <p className="vault-pr-error" role="alert">
          {downloadState.error}
        </p>
      ) : null}

      {activeView === "access" && !isAnonymous ? (
        <div className="document-detail-tab-panel">
          <DocumentAccess
            owner={owner}
            repo={repo}
            currentUsername={currentUser}
          />
        </div>
      ) : activeView === "changes" && activeChange ? (
        <div className="document-detail-tab-panel">
          <DocumentChangeDetail
            owner={owner}
            repo={repo}
            currentUser={currentUser}
            isAnonymous={isAnonymous}
            change={activeChange}
            view={activeChangeView}
            branchProtection={branchProtection}
            blockOnUnresolvedThreads={
              reviewSettings?.blockOnUnresolvedThreads ?? false
            }
            canManageAssignments={canManageAssignments}
            nextVersion={nextVersion}
            documentName={documentName}
            fileName={canonicalFileInfo?.downloadFileName ?? null}
            comparisonBase={resolveComparisonBase({
              open: activeChange.open,
              publishedVersion: activeChange.publishedVersion,
              tags,
            })}
            downloading={downloadState.ref === activeChange.branchName}
            onDownload={(gitRef, loaded) => void handleDownload(gitRef, loaded)}
            onChanged={loadDocumentData}
            onViewChange={(view) => onOpenChange(activeChange.number, view)}
            onBackToList={() => onOpenChange(null)}
          />
        </div>
      ) : activeView === "changes" &&
        activeChangeNumber !== null &&
        (closedState.loading ||
          (closedChanges === null && closedState.error === null)) ? (
        <div className="document-detail-tab-panel">
          {/* The change is not open, so it is somewhere in the closed list —
              which is only fetched when something actually needs it. */}
          <p className="vault-pr-notice">
            Loading change #{activeChangeNumber}…
          </p>
        </div>
      ) : activeView === "changes" ? (
        <div className="document-detail-tab-panel">
          {activeChangeNumber !== null ? (
            <p className="vault-pr-notice">
              Change #{activeChangeNumber} is not on this document.
            </p>
          ) : null}
          <DocumentChanges
            isAnonymous={isAnonymous}
            filter={changeFilter}
            openChanges={openChanges}
            closedChanges={closedChanges}
            closedLoading={closedState.loading}
            closedError={closedState.error}
            nextVersion={nextVersion}
            onFilterChange={setChangeFilter}
            onOpenChange={onOpenChange}
            onRetryClosed={() => void loadClosedChanges()}
            onSubmitVersion={() => setShowUploadModal(true)}
          />
        </div>
      ) : activeView === "history" ? (
        <div className="document-detail-tab-panel">
          <DocumentHistory
            owner={owner}
            repo={repo}
            viewingVersion={isViewingLatest ? null : activeVersion}
            hasCanonicalFile={canonicalFileInfo !== null}
            downloadingRef={downloadState.ref}
            onDownloadVersion={(tagName) => void handleDownload(tagName)}
            onViewVersion={(tagName, version) => {
              onSelectVersion(latestTag?.name === tagName ? null : version);
            }}
            onOpenChange={(changeNumber) => onOpenChange(changeNumber)}
          />
        </div>
      ) : (
        <div className="doc-workspace">
          <div className="doc-workspace-main">
            {missingVersion ? (
              <p className="vault-pr-notice" role="status">
                This document has no v{activeVersion}. Showing the version on
                record instead.
              </p>
            ) : null}

            {/* Nothing has been approved, so there is no official version to
                read. Asking for one anyway just to render "not found" in an
                empty frame is the app failing at a question it already knows
                the answer to. */}
            {latestTag === null && isViewingLatest ? (
              <div className="doc-nothing-published">
                <h2 className="doc-nothing-published-title">
                  No official version yet
                </h2>
                <p className="doc-nothing-published-note">
                  {openChanges.length > 0
                    ? "A version is waiting on a decision. Once it is approved and published it appears here as the official record."
                    : "Submit a document for review. Once it is approved it appears here as the official record."}
                </p>
                {openChanges.length > 0 ? (
                  <button
                    className="bs-btn bs-btn-secondary"
                    type="button"
                    onClick={() => onTabChange("changes")}
                  >
                    Review {openChanges.length} change
                    {openChanges.length === 1 ? "" : "s"}
                  </button>
                ) : null}
              </div>
            ) : (
              <DocumentPreview
                loadFile={loadFile}
                gitRef={viewingRef}
                fileName={canonicalFileInfo?.downloadFileName ?? null}
                downloading={downloadState.ref === viewingRef}
                onDownload={(loaded) => void handleDownload(viewingRef, loaded)}
              />
            )}
          </div>

          <aside className="doc-rail" aria-label="Document summary">
            {/* The one coral thing on the page: what somebody still has to
                decide. Everything below it is reference. */}
            <section className="doc-rail-section">
              <h2 className="doc-rail-title doc-rail-title--urgent">
                Waiting on a decision
              </h2>
              {pendingRows.length === 0 ? (
                <div className="doc-rail-card doc-rail-card--quiet">
                  <p className="doc-rail-note">
                    Nothing is pending. The version above is the record.
                  </p>
                </div>
              ) : (
                pendingRows.map((row) => (
                  <div className="doc-rail-card" key={row.key}>
                    <p className="doc-rail-card-title">{row.title}</p>
                    <p className="doc-rail-card-meta">{row.meta}</p>
                    <button
                      className="doc-rail-card-link"
                      type="button"
                      onClick={() => onOpenChange(row.number)}
                    >
                      Review →
                    </button>
                  </div>
                ))
              )}
            </section>

            <section className="doc-rail-section">
              <h2 className="doc-rail-title">Versions</h2>
              {versionRows.length === 0 ? (
                <div className="doc-rail-card doc-rail-card--quiet">
                  <p className="doc-rail-note">Nothing published yet.</p>
                </div>
              ) : (
                <div className="doc-rail-card doc-rail-card--rows">
                  {versionRows.map((row) => (
                    <button
                      className={`doc-rail-row${row.version === activeVersion ? " doc-rail-row--viewing" : ""}`}
                      type="button"
                      key={row.key}
                      // The rail says which version is on screen, not only
                      // which one is the record — reading v1 beside a row
                      // marked "Current" is exactly the confusion to avoid.
                      aria-current={row.version === activeVersion}
                      onClick={() =>
                        onSelectVersion(row.current ? null : row.version)
                      }
                    >
                      <span
                        className={`doc-rail-version${row.current ? " doc-rail-version--current" : ""}`}
                      >
                        {row.label}
                      </span>
                      <span className="doc-rail-row-date">{row.date}</span>
                      {row.current ? (
                        <span className="doc-rail-row-note">Current</span>
                      ) : row.version === activeVersion ? (
                        <span className="doc-rail-row-note">Viewing</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
              {tags.length > versionRows.length ? (
                <button
                  className="doc-rail-more"
                  type="button"
                  onClick={() => onTabChange("history")}
                >
                  Full history →
                </button>
              ) : null}
            </section>

            {!isAnonymous ? (
              <section className="doc-rail-section">
                <h2 className="doc-rail-title">Team</h2>
                <div className="doc-team">
                  {teamAvatars.slice(0, 5).map((person) => (
                    <span
                      className="doc-team-avatar"
                      key={person.key}
                      title={person.name}
                    >
                      {person.initials}
                    </span>
                  ))}
                  {teamAvatars.length > 5 ? (
                    <span className="doc-team-avatar doc-team-avatar--more">
                      +{teamAvatars.length - 5}
                    </span>
                  ) : null}
                  <button
                    className="doc-team-manage"
                    type="button"
                    onClick={() => onTabChange("access")}
                  >
                    Manage
                  </button>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      )}

      {showUploadModal && !isAnonymous ? (
        <UploadModal
          owner={owner}
          repo={repo}
          docSlug={repo}
          uploaderSlug={currentUser}
          nextVersion={nextVersion}
          canonicalFileName={canonicalFileInfo?.storedFileName ?? null}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
        />
      ) : null}
    </div>
  );
}

/**
 * The version pill, which is also the way to every earlier version.
 *
 * A document's history is the reason the record can be trusted, so reaching
 * an older version should not mean finding the History tab first. The pill
 * already names what is on screen; opening it names everything else.
 */
function VersionMenu({
  label,
  tone,
  options,
  open,
  onToggle,
  onClose,
  onSelect,
}: {
  label: string;
  tone: "current" | "past" | "none";
  options: VersionMenuOption[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (version: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  // Nothing published: the pill is a statement of fact, not a control.
  if (options.length === 0) {
    return (
      <span className={`doc-version-pill doc-version-pill--${tone}`}>
        {label}
      </span>
    );
  }

  return (
    <div className="doc-version-picker" ref={ref}>
      <button
        className={`doc-version-pill doc-version-pill--${tone} doc-version-pill--button`}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${label}. Choose a version`}
        onClick={onToggle}
      >
        {label}
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>

      {open ? (
        <div className="doc-version-menu" role="menu">
          {options.map((option) => (
            <button
              className={`doc-version-menu-item${option.selected ? " doc-version-menu-item--selected" : ""}`}
              type="button"
              role="menuitemradio"
              aria-checked={option.selected}
              key={option.key}
              onClick={() => onSelect(option.current ? null : option.version)}
            >
              <span className="doc-version-menu-check" aria-hidden="true">
                {option.selected ? <Check size={12} strokeWidth={2} /> : null}
              </span>
              <span className="doc-version-menu-label">{option.label}</span>
              <span className="doc-version-menu-date">{option.date}</span>
              {option.current ? (
                <span className="doc-version-menu-note">Current</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
