import { useEffect, useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";

import { sanitizeHtml } from "../../../packages/utils/sanitizer";
import { downloadDocument } from "../api";
import { blocksToHtml, blocksToText, htmlToText } from "../documentBlocks";
import type { ChangeScope } from "../changeScope";
import type {
  ComparisonBase,
  ComparisonSummary,
  DiffSegment,
} from "../documentComparison";
import {
  diffRenderedHtml,
  diffWords,
  summarizeSegments,
} from "../documentComparison";
import { classifyDocumentFile, describeFileKind } from "../documentFile";
import { docxToHtml } from "../docxHtml";
import { editorDocumentToHtml } from "../editorDocumentHtml";
import { markdownToHtml } from "../markdown";
import { extractPdfBlocks } from "../pdfText";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

interface DocumentComparisonProps {
  /** Which repository this change lives in — a document's, or a binder. */
  scope: ChangeScope;
  /** The version being compared against — the one this change replaces. */
  base: ComparisonBase;
  /** The ref holding the proposed file. */
  headRef: string;
  /** What to call the proposed side: "update 2 of 2", or just "this change". */
  headLabel: string;
  fileName: string | null;
  /** Save one side of the comparison. */
  onDownload: (gitRef: string) => void;
  /**
   * How two images are shown. The toggle lives in the file's bar with every
   * other control on it, so the page owns the choice and this only draws it.
   */
  imageMode?: ImageMode;
  /**
   * How much moved, reported upwards once both sides have been read.
   *
   * The all-documents screen puts these counts beside each document in its
   * rail and adds them into one line at the top, and only the comparison can
   * know them: the words are inside two files nobody has opened until it
   * opens them. Null for a file a browser cannot read inside, which is a
   * different thing from "nothing changed" and has to stay tellable apart.
   */
  onSummary?: (summary: ComparisonSummary | null) => void;
}

/** Same ceiling the single-file preview uses: a browser is not a log viewer. */
const MAX_INLINE_TEXT_BYTES = 500_000;

/**
 * Two images at once, so the eye can do the comparing.
 *
 * "Difference" stacks them and blends: every pixel that matches goes black and
 * everything that moved lights up. It is the only honest highlight for a
 * picture — there are no words in it to mark up.
 */
export type ImageMode = "side-by-side" | "difference";

type ComparisonState =
  | { status: "loading" }
  /**
   * The document, rendered, with the change marked inside it. Markdown, Word
   * files and PDFs all end up here — every one of them has headings and
   * paragraphs, and every one of them reads better as a document with the
   * edit marked in place than as two columns of source.
   */
  | {
      status: "rendered";
      html: string;
      segments: DiffSegment[];
      /** A scanned PDF has no text layer, so there is nothing to compare. */
      empty: boolean;
    }
  | { status: "text"; segments: DiffSegment[]; truncated: boolean }
  | { status: "image"; beforeUrl: string; afterUrl: string }
  | { status: "unsupported" }
  | { status: "error"; message: string };

function describeLoadFailure(message: string): string {
  return /not found|404/i.test(message)
    ? "One of these two versions has no file at that point in the record, so there is nothing to compare."
    : message;
}

async function readText(blob: Blob): Promise<{ text: string; cut: boolean }> {
  const cut = blob.size > MAX_INLINE_TEXT_BYTES;
  const text = await (cut ? blob.slice(0, MAX_INLINE_TEXT_BYTES) : blob).text();
  return { text, cut };
}

/**
 * The proposed file against the one it replaces, marked up.
 *
 * The point of the screen is that nobody downloads two files and reads them
 * with a ruler. Markdown, Word files and PDFs are all rendered as documents
 * and compared as markup, so the answer is one readable policy with the
 * change marked inside it. Plain text is compared word by word. Two images
 * are shown together, either beside each other or blended so the difference
 * is the only thing lit.
 */
export function DocumentComparison({
  scope,
  base,
  headRef,
  headLabel,
  fileName,
  onDownload,
  imageMode = "side-by-side",
  onSummary,
}: DocumentComparisonProps) {
  const [state, setState] = useState<ComparisonState>({ status: "loading" });
  const kind = classifyDocumentFile(fileName);

  useEffect(() => {
    if (kind === "unsupported") {
      setState({ status: "unsupported" });
      return;
    }

    let cancelled = false;
    const objectUrls: string[] = [];

    async function compare() {
      setState({ status: "loading" });
      try {
        const [before, after] = await Promise.all([
          downloadDocument(scope, base.ref),
          downloadDocument(scope, headRef),
        ]);
        if (cancelled) return;

        if (kind === "markdown") {
          const [left, right] = await Promise.all([
            readText(before),
            readText(after),
          ]);
          if (cancelled) return;
          setState({
            status: "rendered",
            html: sanitizeHtml(
              diffRenderedHtml(
                markdownToHtml(left.text),
                markdownToHtml(right.text),
              ),
            ),
            segments: diffWords(left.text, right.text),
            empty: false,
          });
          return;
        }

        if (kind === "text") {
          const [left, right] = await Promise.all([
            readText(before),
            readText(after),
          ]);
          if (cancelled) return;

          // Two versions of a policy written in the editor are compared as
          // the policy — rendered, then diffed as markup like a Word file —
          // rather than as two walls of JSON with the braces marked.
          const [leftHtml, rightHtml] =
            left.cut || right.cut
              ? [null, null]
              : await Promise.all([
                  editorDocumentToHtml(left.text),
                  editorDocumentToHtml(right.text),
                ]);
          if (cancelled) return;
          if (leftHtml !== null && rightHtml !== null) {
            setState({
              status: "rendered",
              html: sanitizeHtml(diffRenderedHtml(leftHtml, rightHtml)),
              segments: diffWords(htmlToText(leftHtml), htmlToText(rightHtml)),
              empty: false,
            });
            return;
          }

          setState({
            status: "text",
            segments: diffWords(left.text, right.text),
            truncated: left.cut || right.cut,
          });
          return;
        }

        if (kind === "word") {
          const [leftHtml, rightHtml] = await Promise.all([
            docxToHtml(before),
            docxToHtml(after),
          ]);
          if (cancelled) return;
          setState({
            status: "rendered",
            html: sanitizeHtml(diffRenderedHtml(leftHtml, rightHtml)),
            segments: diffWords(htmlToText(leftHtml), htmlToText(rightHtml)),
            empty: leftHtml.trim() === "" && rightHtml.trim() === "",
          });
          return;
        }

        if (kind === "pdf") {
          const [leftBlocks, rightBlocks] = await Promise.all([
            extractPdfBlocks(before),
            extractPdfBlocks(after),
          ]);
          if (cancelled) return;
          // **No object URLs for a PDF any more.** They existed to feed two
          // `<iframe>`s side by side, and two PDF viewers in half a column
          // each are two documents nobody can read.
          setState({
            status: "rendered",
            html: sanitizeHtml(
              diffRenderedHtml(
                blocksToHtml(leftBlocks),
                blocksToHtml(rightBlocks),
              ),
            ),
            segments: diffWords(
              blocksToText(leftBlocks),
              blocksToText(rightBlocks),
            ),
            empty: leftBlocks.length === 0 && rightBlocks.length === 0,
          });
          return;
        }

        const beforeUrl = URL.createObjectURL(before);
        const afterUrl = URL.createObjectURL(after);
        objectUrls.push(beforeUrl, afterUrl);
        setState({ status: "image", beforeUrl, afterUrl });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error
              ? err.message
              : "Unable to compare these two versions.",
        });
      }
    }

    void compare();

    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [scope, base.ref, headRef, kind]);

  // A scan has no words in it, so a word count would report "nothing changed"
  // about two files nobody has actually compared. It gets no summary and says
  // why instead.
  const summary = useMemo(() => {
    if (state.status === "text") return summarizeSegments(state.segments);
    if (state.status === "rendered" && !state.empty) {
      return summarizeSegments(state.segments);
    }
    return null;
  }, [state]);

  // Only once the comparison has settled. Reporting during `loading` would
  // have the page above announce "no wording changed" about two files it has
  // not finished reading, and then quietly correct itself.
  const settled = state.status !== "loading";
  useEffect(() => {
    if (!settled) return;
    onSummary?.(summary);
  }, [settled, summary, onSummary]);

  if (kind === "unsupported" || state.status === "unsupported") {
    return (
      <div className="doc-compare-fallback">
        <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="doc-compare-fallback-main">
          <span className="doc-compare-fallback-name">
            {fileName ?? "This file"}
          </span>
          <span className="doc-compare-fallback-note">
            {describeFileKind(fileName)} — a browser cannot read inside one, so
            there is nothing to mark up. Save both versions and compare them in
            the app that wrote them.
          </span>
        </span>
        <span className="doc-compare-fallback-actions">
          <button
            className="bs-btn bs-btn-secondary doc-preview-download"
            type="button"
            onClick={() => onDownload(base.ref)}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            {base.label}
          </button>
          <button
            className="bs-btn bs-btn-secondary doc-preview-download"
            type="button"
            onClick={() => onDownload(headRef)}
          >
            <Download size={14} strokeWidth={1.5} aria-hidden="true" />
            This change
          </button>
        </span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="doc-compare-fallback doc-compare-fallback--error"
        role="status"
      >
        <FileText size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="doc-compare-fallback-main">
          <span className="doc-compare-fallback-name">
            {fileName ?? "This file"}
          </span>
          <span className="doc-compare-fallback-note">
            {describeLoadFailure(state.message)}
          </span>
        </span>
      </div>
    );
  }

  /**
   * **Two versions that read the same draw nothing.** The file's bar already
   * says what happened — a rename shows the old path struck out beside the new
   * one — and a box announcing that nothing changed was a sentence to read
   * about the absence of anything to read.
   */
  if (summary?.identical) return null;

  /* No toolbar of its own: the versions, the counts and the image toggle all
     sit in the file's one bar above this, so every control on a comparison is
     in the same place. */
  return (
    <section
      className="doc-compare"
      aria-label={`${fileName ?? "Document"} compared with ${base.label}`}
    >
      <div className="doc-compare-body">
        {state.status === "loading" ? (
          <SkeletonGroup
            label="Comparing the two versions"
            className="doc-preview-sheet bs-skeleton-stack"
          >
            <SkeletonLine width="medium" heading />
            <SkeletonLine width="full" />
            <SkeletonLine width="wide" />
            <SkeletonLine width="full" />
            <SkeletonLine width="short" />
          </SkeletonGroup>
        ) : state.status === "rendered" && !state.empty ? (
          <article
            className="doc-preview-sheet doc-preview-prose doc-compare-prose"
            // Every side of this went through a renderer of ours that escapes
            // its input — our Markdown renderer, the block renderer, or
            // mammoth's own subset — and the whole result went through the
            // sanitizer before it landed here.
            dangerouslySetInnerHTML={{ __html: state.html }}
          />
        ) : state.status === "text" ? (
          <article className="doc-preview-sheet">
            <pre className="doc-preview-plain doc-compare-plain">
              {state.segments.map((segment, index) =>
                segment.kind === "added" ? (
                  <ins key={index} className="doc-compare-mark">
                    {segment.value}
                  </ins>
                ) : segment.kind === "removed" ? (
                  <del key={index} className="doc-compare-mark">
                    {segment.value}
                  </del>
                ) : (
                  <span key={index}>{segment.value}</span>
                ),
              )}
            </pre>
          </article>
        ) : state.status === "image" && imageMode === "difference" ? (
          <div className="doc-compare-blend">
            <img src={state.beforeUrl} alt={`${base.label} of ${fileName}`} />
            <img
              className="doc-compare-blend-top"
              src={state.afterUrl}
              alt={`This change to ${fileName}`}
            />
          </div>
        ) : state.status === "image" ? (
          <div className="doc-compare-columns">
            <figure>
              <figcaption>{base.label}</figcaption>
              <img src={state.beforeUrl} alt={`${base.label} of ${fileName}`} />
            </figure>
            <figure>
              <figcaption>{headLabel}</figcaption>
              <img src={state.afterUrl} alt={`This change to ${fileName}`} />
            </figure>
          </div>
        ) : null}

        {state.status === "rendered" && state.empty ? (
          <p className="doc-preview-note">
            {kind === "pdf"
              ? "Neither of these PDFs carries a text layer — they are scans of paper, so there are no words to mark up. Save them to read them."
              : "Neither version has any text in it to compare."}
          </p>
        ) : null}

        {state.status === "text" && state.truncated ? (
          <p className="doc-preview-note">
            These files are long, so the comparison covers their first 500 KB.
            Download the file to check the rest.
          </p>
        ) : null}
      </div>
    </section>
  );
}
