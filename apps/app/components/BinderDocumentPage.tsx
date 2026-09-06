import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceDocumentDetailPayload } from "../../../packages/api-schema/schemas/workspaces";
import { downloadBinderDocument, fetchBinderDocument } from "../api";
import {
  buildDocumentCrumbs,
  buildDocumentUrl,
  describeVersionState,
  downloadFileName,
  parseRequestedVersion,
  resolveDocumentRef,
} from "../binderDocument";
import {
  formatDocumentName,
  getApprovalStateLabel,
  parseChangeTitle,
} from "../documentDisplay";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";
import { DocumentPreview } from "./DocumentPreview";

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
  onOpenBinder: () => void;
  onOpenOrganization: () => void;
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
  onOpenBinder,
  onOpenOrganization,
  onOpenChange,
}: BinderDocumentPageProps) {
  const [detail, setDetail] = useState<WorkspaceDocumentDetailPayload | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

    fetchBinderDocument(org, binder, documentPath)
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
  }, [org, binder, documentPath]);

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

  const loadFile = useCallback(
    (gitRef: string) =>
      downloadBinderDocument(org, binder, resolvedPath, gitRef),
    [org, binder, resolvedPath],
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
      <section className="docw-page">
        <h1 className="doc-header-title">{documentPath}</h1>
        <p className="app-inline-error">{error}</p>
        <p>
          <button
            className="bs-btn bs-btn-secondary"
            type="button"
            onClick={onOpenBinder}
          >
            Back to {binder}
          </button>
        </p>
      </section>
    );
  }

  if (!detail) {
    return (
      <section className="docw-page">
        <SkeletonGroup label="Opening this document">
          <SkeletonLine width="medium" />
          <SkeletonLine width="short" />
        </SkeletonGroup>
      </section>
    );
  }

  const { document, versions, latestVersion, openChanges, state } = detail;
  const crumbs = buildDocumentCrumbs({ org, binder, document });
  const isViewingRecord = viewing.ref === detail.ref;
  // A proposed document has no published version, but it does have a file —
  // the one in the change. Showing the "nothing published" panel over it would
  // hide the very thing somebody came to look at.
  const nothingToShow = latestVersion === null && state === "published";

  return (
    <section className="docw-page">
      <header className="doc-header">
        {/* Where this document lives, and the way back out of it. The
            folders are steps without links: they are real directories, but
            they have no page of their own yet, and a link that goes nowhere
            is worse than plain text. */}
        <nav className="doc-crumbs" aria-label="Where this document lives">
          {crumbs.map((crumb, index) => (
            <span className="doc-crumb" key={`${crumb.label}-${index}`}>
              {index > 0 ? (
                <span className="app-breadcrumb-sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              {crumb.href === null ? (
                <span className="app-breadcrumb-current">{crumb.label}</span>
              ) : (
                <button
                  className="app-breadcrumb-back"
                  type="button"
                  onClick={index === 0 ? onOpenOrganization : onOpenBinder}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </nav>

        <div className="doc-header-top">
          <div className="doc-header-identity">
            <h1 className="doc-header-title">
              {formatDocumentName(document.name)}
            </h1>
            <div className="doc-header-facts">
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

              <span className="doc-header-fact doc-header-file">
                {document.path}
              </span>
            </div>
          </div>
        </div>
      </header>

      {state === "proposed" ? (
        <p className="vault-pr-notice" role="status">
          This policy is not in the binder yet. What you are reading is the file
          as submitted, waiting on a decision.
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

        <aside className="doc-rail" aria-label="Document summary">
          <section className="doc-rail-section">
            <h2 className="doc-rail-title">Waiting on a decision</h2>
            {openChanges.length === 0 ? (
              <p className="doc-rail-note">Nothing is in review.</p>
            ) : (
              <div className="doc-rail-card doc-rail-card--rows">
                {openChanges.map((change) => (
                  <button
                    className="doc-rail-row"
                    type="button"
                    key={change.number}
                    onClick={() => onOpenChange(change.number)}
                  >
                    <span className="doc-rail-row-date">
                      {parseChangeTitle(change.body, change.user?.login ?? "")}
                    </span>
                    <span className="doc-rail-row-note">
                      {getApprovalStateLabel(change.approvalState)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="doc-rail-section">
            <h2 className="doc-rail-title">Versions</h2>
            {versions.length === 0 ? (
              <p className="doc-rail-note">
                No version has been published yet.
              </p>
            ) : (
              <div className="doc-rail-card doc-rail-card--rows">
                {versions.map((version) => {
                  const isCurrent = version.version === latestVersion?.version;
                  const isViewing =
                    viewing.version?.version === version.version;
                  return (
                    <button
                      className={`doc-rail-row${isViewing && !isViewingRecord ? " doc-rail-row--viewing" : ""}`}
                      type="button"
                      key={version.tag}
                      // The rail says which version is on screen, not only
                      // which one is the record — reading v1 beside a row
                      // marked "Current" is exactly the confusion to avoid.
                      aria-current={isViewing}
                      onClick={() =>
                        selectVersion(isCurrent ? null : version.version)
                      }
                    >
                      <span
                        className={`doc-rail-version${isCurrent ? " doc-rail-version--current" : ""}`}
                      >
                        v{version.version}
                      </span>
                      {/* The commit the tag points at. There is no date on a
                          tag we can read without another call per version,
                          and the SHA is the coordinate the evidence is
                          actually keyed on. */}
                      <span className="doc-rail-row-date">
                        {version.commitSha.slice(0, 7)}
                      </span>
                      {isCurrent ? (
                        <span className="doc-rail-row-note">Current</span>
                      ) : isViewing ? (
                        <span className="doc-rail-row-note">Viewing</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
