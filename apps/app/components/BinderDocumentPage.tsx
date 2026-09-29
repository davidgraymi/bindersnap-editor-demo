import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceDocumentDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import { downloadBinderDocument, fetchBinderDocument } from "../api";
import { followInApp } from "../appLink";
import {
  buildDocumentCrumbs,
  buildDocumentUrl,
  describeVersionState,
  downloadFileName,
  parseRequestedVersion,
  resolveDocumentRef,
} from "../binderDocument";
import { buildBinderUrl } from "../binderShell";
import { buildReadableRefs, type DocumentRefView } from "../documentRefs";
import {
  formatDocumentName,
  formatShortDate,
  getApprovalStateLabel,
  parseChangeTitle,
} from "../documentDisplay";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";
import { DocumentPreview } from "./DocumentPreview";
import { ReviseDocumentModal } from "./ReviseDocumentModal";
import { RenameDocumentModal } from "./RenameDocumentModal";
import { useIsReadOnly } from "../readOnlyContext";

/**
 * One document inside a binder, at `/{org}/{binder}/{path}`.
 *
 * ADR 0004's fourth level. The old per-document workspace answered the same
 * questions from a repository of its own; this answers them from a path and a
 * set of version tags, which is what a document is now. It reads: the record
 * as published, every version behind it, and whatever is still waiting on a
 * decision.
 */

interface BinderDocumentPageProps {
  org: string;
  binder: string;
  /** From the URL. May carry the extension, or the identity without it. */
  documentPath: string;
  /**
   * The draft this was opened from, when the binder is being edited.
   *
   * A policy renamed a moment ago is at that name on the draft branch and
   * nowhere else, so a page opened from the tree in edit mode has to be read
   * where the name it was clicked under exists. Null on the record.
   */
  draft?: string | null;
  /**
   * The change request this document is being read on, from `?change=`.
   *
   * **A change request is a branch, and a document on it has an address.** The
   * proposed version used to be readable only inside the change's own page, in
   * a panel beside the discussion — half a column wide, headed by the change's
   * title rather than the document's, at a URL that said nothing about which
   * document it was. Here it is the document's own page, read at another ref,
   * which is what every other git front end does.
   */
  change?: number | null;
  /**
   * The branch this is being read on.
   *
   * **A file lives on a branch, and that is what the page reads at.** `change`
   * is not the ref — it is where the reader came from, and it buys the way
   * back and nothing else.
   */
  /**
   * The branch this is being read on. Named `documentRef` in the component
   * because `ref` is React's own prop and cannot be one of ours.
   */
  documentRef?: string | null;
  /**
   * Which versions of this document exist, for the file panel's own control.
   *
   * **Reported rather than drawn here.** It was a warning strip over the page
   * reading "You are reading the branch draft/alice/…", which named a git
   * object at a reader of a policy manual and offered no way anywhere. The
   * panel beside the page is a view of one version of the binder, so the
   * thing naming that version belongs at the top of it — the customer, of
   * GitHub: *"a branch selector in the file explorer so that it's clear what
   * branch the user is viewing. We should do the same."*
   */
  onRefsChange?: (view: DocumentRefView | null) => void;
  onOpenBinder: () => void;
  /** Open one of this document's open changes, on the binder. */
  onOpenChange: (changeNumber: number) => void;
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

export function BinderDocumentPage({
  org,
  binder,
  documentPath,
  draft = null,
  change = null,
  documentRef = null,
  onRefsChange,
  onOpenBinder,
  onOpenChange,
}: BinderDocumentPageProps) {
  const [detail, setDetail] = useState<WorkspaceDocumentDetailPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const isReadOnly = useIsReadOnly();

  // Back and forward are how a reader leaves an earlier version, so the page
  // follows the address bar rather than its own memory of what was clicked.
  const [requestedVersion, setRequestedVersion] = useState<number | null>(() =>
    parseRequestedVersion(window.location.search),
  );

  useEffect(() => {
    const handler = () =>
      setRequestedVersion(parseRequestedVersion(window.location.search));
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);

    fetchBinderDocument(
      org,
      binder,
      documentPath,
      draft ?? undefined,
      change ?? undefined,
      documentRef ?? undefined,
    )
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to open this document.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder, documentPath, draft, change, documentRef]);

  const viewing = useMemo(
    () =>
      resolveDocumentRef({
        versions: detail?.versions ?? [],
        requestedVersion,
        recordRef: detail?.ref ?? "main",
      }),
    [detail, requestedVersion],
  );

  // The document's own path, not the one the URL happened to carry: a link may
  // address it by identity, and the file is fetched by whichever the server
  // resolved.
  const resolvedPath = detail?.document.slugPath ?? documentPath;

  // By the path the server resolved, which carries the identity — so a ref
  // that knows this document under another name still finds the file.
  const fileAddress = detail?.document.path ?? resolvedPath;

  // **Told to the panel, not drawn here.** The list of versions is something
  // only this read knows — the open changes touching a document come back with
  // it — and the control that offers them belongs at the top of the file
  // panel, where the rows it governs are.
  useEffect(() => {
    if (!onRefsChange) return;
    if (!detail) {
      onRefsChange(null);
      return;
    }
    onRefsChange({
      refs: buildReadableRefs({
        openChanges: detail.openChanges,
        ref: documentRef,
        change,
      }),
      address: detail.document.path,
    });
  }, [detail, documentRef, change, onRefsChange]);

  const loadFile = useCallback(
    (gitRef: string) =>
      downloadBinderDocument(org, binder, fileAddress, gitRef),
    [org, binder, fileAddress],
  );

  const selectVersion = (version: number | null) => {
    window.history.pushState(
      {},
      "",
      buildDocumentUrl({ org, binder, documentPath: resolvedPath, version }),
    );
    setRequestedVersion(version);
  };

  const handleDownload = async (loaded: Blob | null) => {
    if (!detail) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = loaded ?? (await loadFile(viewing.ref));
      triggerBrowserDownload(blob, downloadFileName(detail.document));
    } catch (err) {
      setDownloadError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to download this document.",
      );
    } finally {
      setDownloading(false);
    }
  };

  if (error) {
    return (
      <div className="binder-pane">
        <h1 className="bs-title">{documentPath}</h1>
        <p className="bs-note bs-note--danger" role="alert">
          {error}
        </p>
        <p>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={onOpenBinder}
          >
            Back to {binder}
          </button>
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Opening this document">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </div>
    );
  }

  const { document, versions, latestVersion, openChanges, state } = detail;
  const crumbs = buildDocumentCrumbs(document);
  const isViewingRecord = viewing.ref === detail.ref;
  // A proposed document has no published version, but it does have a file —
  // the one in the change. Showing the "nothing published" panel over it would
  // hide the very thing somebody came to look at.
  const nothingToShow = latestVersion === null && state === "published";

  return (
    <div className="binder-pane">
      <header className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">{formatDocumentName(document.name)}</h1>
          <div className="bs-facts">
            <span
              className={`doc-version-pill ${
                latestVersion === null
                  ? "doc-version-pill--none"
                  : isViewingRecord
                    ? "doc-version-pill--current"
                    : "doc-version-pill--past"
              }`}
            >
              {isViewingRecord
                ? describeVersionState(latestVersion, state)
                : `Version ${viewing.version?.version} — an earlier version`}
            </span>

            {!isViewingRecord ? (
              <button
                className="doc-header-latest"
                type="button"
                onClick={() => selectVersion(null)}
              >
                Back to current
              </button>
            ) : null}

            {/* The file as a person would name it. The identity segment in
                  the real filename is how a rename does not lose the version
                  history (ADR 0005); it is 26 characters of machinery and has
                  no business on a page somebody reads. */}
            <span className="bs-filename">{downloadFileName(document)}</span>
          </div>
        </div>

        {/* **The act that was missing.** Revising a policy used to mean
              filing a new one and getting the name character-for-character
              right, or ending up with two policies instead of two versions.
              Only offered on the record: revising an earlier version would
              silently discard everything published since. */}
        {!isReadOnly && isViewingRecord && state !== "proposed" ? (
          <div className="bs-pagehead-actions">
            <button
              type="button"
              className="bs-btn bs-btn-secondary"
              onClick={() => setRenaming(true)}
            >
              Rename or move
            </button>
            <button
              type="button"
              className="bs-btn bs-btn-primary"
              onClick={() => setRevising(true)}
            >
              {/* **What it asks of you.** "New version" read as though it
                  made one; what it does is take a file and propose it. */}
              Upload new version
            </button>
          </div>
        ) : null}
      </header>

      {renaming ? (
        <RenameDocumentModal
          org={org}
          binder={binder}
          slugPath={document.slugPath}
          name={document.name}
          folder={document.folder}
          folders={detail.folders}
          onClose={() => setRenaming(false)}
          onProposed={(changeNumber) => {
            setRenaming(false);
            onOpenChange(changeNumber);
          }}
        />
      ) : null}

      {revising ? (
        <ReviseDocumentModal
          org={org}
          binder={binder}
          slugPath={document.slugPath}
          name={document.name}
          currentVersion={latestVersion?.version ?? null}
          onClose={() => setRevising(false)}
          onProposed={(changeNumber) => {
            setRevising(false);
            onOpenChange(changeNumber);
          }}
        />
      ) : null}

      {state === "proposed" ? (
        <p className="vault-pr-notice" role="status">
          This document is not in the binder yet. What you are reading is the
          file as submitted, waiting on a decision.
        </p>
      ) : null}

      {viewing.missing ? (
        <p className="vault-pr-notice" role="status">
          This document has no v{requestedVersion}. Showing the version on
          record instead.
        </p>
      ) : null}

      {downloadError ? (
        <p className="vault-pr-error" role="alert">
          {downloadError}
        </p>
      ) : null}

      <div className="doc-workspace">
        <div className="doc-workspace-main">
          {/* Nothing has been approved, so there is no official version to
              read. Fetching one anyway just to render "not found" in an empty
              frame is the page failing at a question it already knows the
              answer to. */}
          {nothingToShow && isViewingRecord ? (
            <div className="doc-nothing-published">
              <h2 className="doc-nothing-published-title">
                No official version yet
              </h2>
              <p className="doc-nothing-published-note">
                {openChanges.length > 0
                  ? "A version is waiting on a decision. Once it is approved and published it appears here as the official record."
                  : "This document is filed here but nothing has been approved yet."}
              </p>
            </div>
          ) : (
            <DocumentPreview
              loadFile={loadFile}
              gitRef={viewing.ref}
              fileName={downloadFileName(document)}
              downloading={downloading}
              onDownload={(loaded) => void handleDownload(loaded)}
            />
          )}
        </div>

        {/* **Two panels, the way GitLab's merge request sidebar stacks its
            blocks** — a bar that names the block and counts it, then rows
            that go somewhere. These were uppercase, letter-spaced labels over
            cards of their own shape: the only lists in the app drawn that
            way, and the loudest type on a page whose subject is a policy. */}
        <aside className="doc-rail" aria-label="Document summary">
          <section className="bs-panel" aria-labelledby="doc-rail-open">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title" id="doc-rail-open">
                Waiting on a decision
              </h2>
              {openChanges.length > 0 ? (
                <span className="bs-section-count bs-section-count--attention">
                  {openChanges.length}
                </span>
              ) : null}
            </div>
            {openChanges.length === 0 ? (
              <p className="doc-rail-empty">Nothing is in review.</p>
            ) : (
              <ul className="bs-row-list">
                {openChanges.map((change) => (
                  <li key={change.number}>
                    <a
                      className="bs-row bs-row--tall"
                      href={buildBinderUrl({
                        org,
                        binder,
                        tab: "changes",
                        change: change.number,
                      })}
                      onClick={(event) =>
                        followInApp(event, () => onOpenChange(change.number))
                      }
                    >
                      <span className="bs-row-body">
                        <span className="bs-row-name bs-row-name--wrap">
                          {parseChangeTitle(
                            change.body,
                            change.user?.login ?? "",
                          )}
                        </span>
                        <span className="bs-row-meta">
                          #{change.number} ·{" "}
                          {getApprovalStateLabel(change.approvalState)}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bs-panel" aria-labelledby="doc-rail-versions">
            <div className="bs-panel-bar">
              <h2 className="bs-panel-bar-title" id="doc-rail-versions">
                Versions
              </h2>
              {versions.length > 0 ? (
                <span className="bs-section-count">{versions.length}</span>
              ) : null}
            </div>
            {versions.length === 0 ? (
              <p className="doc-rail-empty">
                No version has been published yet.
              </p>
            ) : (
              <ul className="bs-row-list">
                {versions.map((version) => {
                  const isCurrent = version.version === latestVersion?.version;
                  const isViewing =
                    viewing.version?.version === version.version;
                  const target = isCurrent ? null : version.version;
                  return (
                    <li key={version.tag}>
                      <a
                        className={`bs-row${isViewing && !isViewingRecord ? " bs-row--on" : ""}`}
                        href={buildDocumentUrl({
                          org,
                          binder,
                          documentPath: resolvedPath,
                          version: target,
                        })}
                        // The rail says which version is on screen, not only
                        // which one is the record — reading v1 beside a row
                        // marked "Current" is exactly the confusion to avoid.
                        aria-current={isViewing ? "page" : undefined}
                        onClick={(event) =>
                          followInApp(event, () => selectVersion(target))
                        }
                      >
                        <span
                          className={`doc-rail-version${isCurrent ? " doc-rail-version--current" : ""}`}
                        >
                          v{version.version}
                        </span>
                        {/* When this version was published. The tag's commit
                            carries the date in the same call, so nothing
                            extra is fetched to say it.

                            This used to print the commit SHA. The SHA is the
                            coordinate the evidence is keyed on, but it is not
                            a fact about the policy that a compliance manager
                            can use — on a page whose job is to be trustworthy
                            it reads as an error code. It stays in the tag, the
                            audit export and the API, where a surveyor can ask
                            for it. Empty when Gitea did not give us a date:
                            "v1 · Current" says more than a date we invented. */}
                        <span className="bs-row-body">
                          {formatShortDate(version.publishedAt)}
                        </span>
                        {isCurrent ? (
                          <span className="bs-row-right">Current</span>
                        ) : isViewing ? (
                          <span className="bs-row-right">Viewing</span>
                        ) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
