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
          <p className="doc-preview-note">Loading the document…</p>
        ) : state.status === "error" ? (
          <p className="doc-preview-note doc-preview-note--error" role="alert">
            {state.message}
          </p>
        ) : state.status === "unsupported" ? (
          <div className="doc-preview-placeholder">
            <FileText size={28} strokeWidth={1.25} aria-hidden="true" />
            <h3>
              {fileName ? describeFileKind(fileName) : "Nothing published yet"}
            </h3>
            <p>
              {fileName
                ? "This file type doesn't preview in the browser. Download it to read the approved version."
                : "Once a version is approved it appears here as the official record."}
            </p>
          </div>
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
