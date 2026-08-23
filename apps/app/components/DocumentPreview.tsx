import { useEffect, useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";

import { sanitizeHtml } from "../../../packages/utils/sanitizer";
import { downloadDocument } from "../api";
import {
  classifyDocumentFile,
  describeFileKind,
  formatFileSize,
} from "../documentFile";
import { markdownToHtml } from "../markdown";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

interface DocumentPreviewProps {
  owner: string;
  repo: string;
  /** Git ref to read: "main" for the current version, or a version tag. */
  gitRef: string;
  /** File name as stored in the repo, or null when it could not be resolved. */
  fileName: string | null;
  /**
   * Save the file. The preview hands back the bytes it already loaded so the
   * same version is never fetched twice for one click.
   */
  onDownload: (loaded: Blob | null) => void;
  downloading: boolean;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "text"; text: string; markdown: boolean; size: number }
  | { status: "object"; url: string; kind: "pdf" | "image"; size: number }
  | { status: "unsupported"; size: number | null }
  | { status: "error"; message: string };

/** Beyond this a text file is shown truncated — a browser is not a log viewer. */
const MAX_INLINE_TEXT_BYTES = 500_000;

/**
 * Gitea's word for "no file at that ref" is `not found`, which on a page about
 * documents reads like the document is gone. It is not; there is simply
 * nothing published at this ref yet.
 */
function describePreviewFailure(message: string): string {
  return /not found|404/i.test(message)
    ? "No file has been published at this version yet."
    : message;
}

/**
 * Renders the document itself.
 *
 * The whole point of the page is to answer "what does the approved version
 * actually say?" without a round trip through Word. Text, Markdown, PDFs and
 * images render inline; anything else says so plainly and offers the file.
 */
export function DocumentPreview({
  owner,
  repo,
  gitRef,
  fileName,
  onDownload,
  downloading,
}: DocumentPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  // Kept so the Download button can save what is already on screen.
  const [loadedBlob, setLoadedBlob] = useState<Blob | null>(null);
  const kind = classifyDocumentFile(fileName);

  useEffect(() => {
    setLoadedBlob(null);

    if (!fileName) {
      setState({ status: "unsupported", size: null });
      return;
    }

    if (kind === "unsupported") {
      setState({ status: "unsupported", size: null });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      setState({ status: "loading" });
      try {
        const blob = await downloadDocument(owner, repo, gitRef);
        if (cancelled) return;
        setLoadedBlob(blob);

        if (kind === "markdown" || kind === "text") {
          const slice =
            blob.size > MAX_INLINE_TEXT_BYTES
              ? blob.slice(0, MAX_INLINE_TEXT_BYTES)
              : blob;
          const text = await slice.text();
          if (cancelled) return;
          setState({
            status: "text",
            text,
            markdown: kind === "markdown",
            size: blob.size,
          });
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setState({
          status: "object",
          url: objectUrl,
          kind: kind === "pdf" ? "pdf" : "image",
          size: blob.size,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Unable to load this version of the document.",
        });
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [owner, repo, gitRef, fileName, kind]);

  const markdownHtml = useMemo(() => {
    if (state.status !== "text" || !state.markdown) return null;
    return sanitizeHtml(markdownToHtml(state.text));
  }, [state]);

  const truncated =
    state.status === "text" && state.size > MAX_INLINE_TEXT_BYTES;

  // Nothing to preview and nothing to download is not a preview — an empty
  // frame with a shrug in the middle of it just takes up the page. Say the one
  // true thing in one line and get out of the way.
  if (state.status === "unsupported" && !fileName) {
    return (
      <p className="doc-preview-absent">
        Nothing has been published yet. Once a version is approved it appears
        here as the official record.
      </p>
    );
  }

  // A file we cannot render is still a file: the row names it, says why it is
  // not on screen, and hands it over. No empty 320px box for a .docx — and no
  // bare "not found" floating in one either.
  if (state.status === "unsupported" || state.status === "error") {
    const failed = state.status === "error";
    return (
      <div
        className={`doc-preview-fallback${failed ? " doc-preview-fallback--error" : ""}`}
        role={failed ? "status" : undefined}
      >
        <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="doc-preview-fallback-main">
          <span className="doc-preview-fallback-name">
            {fileName ?? "This version"}
          </span>
          <span className="doc-preview-fallback-note">
            {failed
              ? describePreviewFailure(state.message)
              : `${describeFileKind(fileName)} — this file type doesn’t preview in the browser.`}
          </span>
        </span>
        <button
          className="bs-btn bs-btn-secondary doc-preview-download"
          type="button"
          disabled={downloading || !fileName}
          onClick={() => onDownload(loadedBlob)}
        >
          <Download size={14} strokeWidth={1.5} aria-hidden="true" />
          {downloading ? "Downloading…" : "Download"}
        </button>
      </div>
    );
  }

  return (
    <section className="doc-preview" aria-label="Document preview">
      <header className="doc-preview-toolbar">
        <span className="doc-preview-filename">
          <FileText size={14} strokeWidth={1.5} aria-hidden="true" />
          {fileName ?? "No file"}
        </span>
        <span className="doc-preview-toolbar-spacer" />
        {state.status === "text" || state.status === "object" ? (
          <span className="doc-preview-size">{formatFileSize(state.size)}</span>
        ) : null}
        <button
          className="bs-btn bs-btn-secondary doc-preview-download"
          type="button"
          disabled={downloading || !fileName}
          onClick={() => onDownload(loadedBlob)}
        >
          <Download size={14} strokeWidth={1.5} aria-hidden="true" />
          {downloading ? "Downloading…" : "Download"}
        </button>
      </header>

      <div className="doc-preview-body">
        {state.status === "loading" || state.status === "idle" ? (
          <SkeletonGroup
            label="Loading the document"
            className="doc-preview-sheet bs-skeleton-stack"
          >
            <SkeletonLine width="medium" heading />
            <SkeletonLine width="full" />
            <SkeletonLine width="full" />
            <SkeletonLine width="wide" />
            <SkeletonLine width="full" />
            <SkeletonLine width="medium" />
          </SkeletonGroup>
        ) : state.status === "object" && state.kind === "pdf" ? (
          <iframe
            className="doc-preview-frame"
            src={state.url}
            title={`${fileName ?? "Document"} preview`}
          />
        ) : state.status === "object" ? (
          <div className="doc-preview-image-wrap">
            <img
              className="doc-preview-image"
              src={state.url}
              alt={fileName ?? "Document"}
            />
          </div>
        ) : markdownHtml !== null ? (
          <article
            className="doc-preview-sheet doc-preview-prose"
            // Markdown is rendered by our own renderer, which escapes every
            // character of the source, and then sanitized before it lands here.
            dangerouslySetInnerHTML={{ __html: markdownHtml }}
          />
        ) : (
          <article className="doc-preview-sheet">
            <pre className="doc-preview-plain">{state.text}</pre>
          </article>
        )}

        {truncated ? (
          <p className="doc-preview-note">
            Showing the first {formatFileSize(MAX_INLINE_TEXT_BYTES)} of this
            file. Download it to read the whole thing.
          </p>
        ) : null}
      </div>
    </section>
  );
}
