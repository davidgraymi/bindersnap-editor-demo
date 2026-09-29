import "./assets/document-editor.css";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { FileText, Columns3, Minus, Plus } from "lucide-react";

import { sanitizeProseMirrorJson } from "../utils/sanitizer";
import { EMPTY_DOCUMENT, documentContentExtensions } from "./documentSchema";
import { countDocument, paginate } from "./documentStats";
import { EnterOverSelection } from "./extensions/EnterOverSelection";
import { PictureFiles } from "./extensions/PictureFiles";
import { PictureSize } from "./extensions/PictureSize";
import { FormatPainter } from "./extensions/FormatPainter";
import { preparePrintCopy, removePrintCopy } from "./printCopy";
import { SearchAndReplace } from "./extensions/SearchAndReplace";
import { WordKeymap } from "./extensions/WordKeymap";
import { ChangeCase } from "./extensions/ChangeCase";
import { AutoFormat } from "./extensions/AutoFormat";
import { NavigationPane } from "./NavigationPane";
import { DropButton, shortcutLabel } from "./ribbon/controls";
import { Ribbon, type ViewSettings } from "./ribbon/Ribbon";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom } from "./ribbon/options";

/**
 * The document editor: a word processor for policies.
 *
 * **Word's shape, because Word is what the people using it know.** A ribbon
 * of commands over the page, the page itself drawn as a sheet of paper on a
 * grey desk, the document's headings in a pane on the left and the page
 * count, word count and zoom in a bar along the bottom. A compliance manager
 * who has written policies in Word for a decade should find every command
 * where their hands expect it.
 *
 * **It edits; it does not save.** Where the words go is the app's question —
 * into a draft, as a commit, under the author's name — so this reports every
 * change through `onChange` and asks for a save through `onSave`, and the page
 * around it decides what those mean.
 */

export interface DocumentEditorProps {
  /** The document to start from. Sanitized before the editor sees it. */
  initialContent: JSONContent | null;
  /** Every change, as the JSON the file stores. */
  onChange?: (doc: JSONContent) => void;
  /** Ctrl+S. */
  onSave?: () => void;
  /** Told the editor once it exists, for the page to read the document. */
  onReady?: (editor: Editor) => void;
  placeholder?: string;
  /** The end of the ribbon's tab row: the page's own Save, in practice. */
  ribbonEnd?: ReactNode;
  /** The start of the status bar, before the page and word counts. */
  statusStart?: ReactNode;
  /** A name for the page, for screen readers and the print title. */
  label: string;
  /** Read-only: the page and the panes, no ribbon. */
  editable?: boolean;
  /** Put the cursor in the page on open: at its start, or at its end. */
  autoFocus?: "start" | "end" | false;
}

/** US Letter at 96 CSS pixels to the inch, less Word's one-inch margins. */
const PAGE_CONTENT_HEIGHT_IN = 9;

const VIEW_KEY = "bindersnap:editor-view";

function readSavedView(): ViewSettings {
  const fallback: ViewSettings = {
    layout: "print",
    zoom: "page-width",
    // Open where it leaves the page at full size beside the app's file panel,
    // and shut on a laptop or a tablet, where it would cost the page a
    // quarter of its width. Once somebody opens or shuts it, their choice is
    // what is remembered.
    navigationPane: window.innerWidth >= 1500,
  };
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ViewSettings>;
    return {
      layout: parsed.layout === "web" ? "web" : "print",
      zoom:
        parsed.zoom === undefined || parsed.zoom === "page-width"
          ? "page-width"
          : clampZoom(Number(parsed.zoom)),
      navigationPane: parsed.navigationPane !== false,
    };
  } catch {
    return fallback;
  }
}

/**
 * The view is the reader's, not the document's: zoom and the navigation pane
 * are remembered on this browser for next time, and never written to the
 * policy, which every reviewer opens at their own zoom.
 */
function saveView(view: ViewSettings): void {
  try {
    window.localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // Private mode or storage off: the view just is not remembered.
  }
}

export function DocumentEditor({
  initialContent,
  onChange,
  onSave,
  onReady,
  placeholder = "Start writing your policy…",
  ribbonEnd,
  statusStart,
  label,
  editable = true,
  autoFocus = false,
}: DocumentEditorProps) {
  const content = useMemo(
    () =>
      initialContent
        ? sanitizeProseMirrorJson(initialContent)
        : (EMPTY_DOCUMENT as unknown as JSONContent),
    [initialContent],
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Why a picture did not go in, said over the page for a few seconds.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef(setNotice);
  noticeRef.current = setNotice;
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const editor = useEditor({
    extensions: [
      ...documentContentExtensions(),
      Placeholder.configure({ placeholder }),
      SearchAndReplace,
      WordKeymap,
      EnterOverSelection,
      PictureFiles.configure({
        onError: (message) => noticeRef.current(message),
      }),
      PictureSize,
      FormatPainter,
      ChangeCase,
      AutoFormat,
    ],
    content,
    editable,
    autofocus: autoFocus,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "bs-doc-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: current }) => {
      onChangeRef.current?.(current.getJSON());
    },
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
    // Once per editor; the page holds on to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);

  const [view, setViewState] = useState<ViewSettings>(readSavedView);
  const setView = useCallback((next: ViewSettings) => {
    setViewState(next);
    saveView(next);
  }, []);

  const [paneMode, setPaneMode] = useState<{
    view: "headings" | "search";
    replace: boolean;
    nonce: number;
  }>({ view: "headings", replace: false, nonce: 0 });

  const openFind = useCallback(
    (replace: boolean) => {
      setPaneMode((was) => ({
        view: "search",
        replace,
        nonce: was.nonce + 1,
      }));
      setView({ ...view, navigationPane: true });
    },
    [setView, view],
  );

  const rootRef = useRef<HTMLDivElement>(null);

  // Save, Find and Replace, from anywhere in the editor — the ribbon and the
  // pane as well as the page, as in Word.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        onSaveRef.current?.();
      } else if (key === "f" && !event.shiftKey) {
        event.preventDefault();
        openFind(false);
      } else if (key === "h" && !event.shiftKey) {
        event.preventDefault();
        openFind(true);
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
    // `editor`: the root is only drawn once there is one, and a listener
    // attached before then was attached to nothing.
  }, [openFind, editor]);

  // Printing prints the policy, not the app around it — from Print on the
  // View tab and from the browser's own Ctrl+P alike. See `printCopy.ts`.
  useEffect(() => {
    if (!editor) return;
    const before = () => {
      if (!editor.isDestroyed) preparePrintCopy(editor.getHTML(), label);
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", removePrintCopy);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", removePrintCopy);
      removePrintCopy();
    };
  }, [editor, label]);

  const print = useCallback(() => window.print(), []);

  const deskRef = useRef<HTMLDivElement>(null);
  const deskWidth = useElementWidth(deskRef, editor);
  const zoom =
    view.layout === "web"
      ? 100
      : view.zoom === "page-width"
        ? pageWidthZoom(deskWidth)
        : view.zoom;
  const pages = usePagination(editor, view, zoom);

  if (!editor) return null;

  return (
    <div
      ref={rootRef}
      className={`bs-doc-editor bs-doc-editor--${view.layout}${
        editable ? "" : " bs-doc-editor--readonly"
      }`}
    >
      {editable ? (
        <Ribbon
          editor={editor}
          view={view}
          zoom={zoom}
          onViewChange={setView}
          onFind={openFind}
          onPrint={print}
          end={ribbonEnd}
        />
      ) : null}

      {notice ? (
        <div className="bs-doc-notice" role="alert">
          <span>{notice}</span>
          <button
            type="button"
            className="bs-doc-notice-close"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="bs-doc-body">
        {view.navigationPane ? (
          <NavigationPane
            editor={editor}
            mode={paneMode}
            onClose={() => setView({ ...view, navigationPane: false })}
          />
        ) : null}

        <div className="bs-doc-desk" ref={deskRef}>
          <div className="bs-doc-sheetwrap" ref={pages.wrapRef}>
            <div
              className="bs-doc-page"
              ref={pages.pageRef}
              style={{ zoom: zoom / 100 }}
              onMouseDown={(event) => {
                // A click in the margin puts the cursor in the text, as it
                // does on paper-shaped editors everywhere.
                if (event.target === event.currentTarget) {
                  event.preventDefault();
                  editor.commands.focus("end");
                }
              }}
            >
              <div
                className="bs-doc-page-probe"
                ref={pages.probeRef}
                aria-hidden="true"
                style={{ height: `${PAGE_CONTENT_HEIGHT_IN}in` }}
              />
              <EditorContent editor={editor} />
            </div>
            {view.layout === "print"
              ? pages.markers.map((marker) => (
                  <div
                    key={marker.page}
                    className="bs-doc-pagemark"
                    style={{ top: marker.top }}
                    aria-hidden="true"
                  >
                    <span>Page {marker.page}</span>
                  </div>
                ))
              : null}
          </div>
        </div>
      </div>

      <StatusBar
        editor={editor}
        zoom={zoom}
        pages={pages.count}
        currentPage={pages.current}
        view={view}
        onViewChange={setView}
        start={statusStart}
      />
    </div>
  );
}

/** A sheet of Letter at 100%, and the room around it on the desk. */
const PAGE_WIDTH_PX = 8.5 * 96;
const DESK_ROOM_PX = 48 + 72;

/**
 * Word's Page Width: the largest zoom that fits the sheet on the desk — with
 * room for the page numbers in its margin — and never larger than life.
 * Before the desk has been measured, 100%.
 */
export function pageWidthZoom(deskWidth: number): number {
  if (deskWidth <= 0) return 100;
  const fit = Math.floor(((deskWidth - DESK_ROOM_PX) / PAGE_WIDTH_PX) * 100);
  return clampZoom(Math.min(100, fit));
}

/**
 * An element's width, kept current as it resizes. `mounted` is whatever
 * decides whether the element is drawn yet, so it is measured once it is.
 */
function useElementWidth(
  ref: React.RefObject<HTMLElement | null>,
  mounted: unknown,
): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
}

/**
 * Pages, measured from the page as drawn.
 *
 * The page is one continuous sheet — true pagination would mean laying the
 * document out twice — and this works out where each page would begin, marks
 * it in the margin, and says which page the cursor is on. See {@link paginate}
 * for the one liberty it takes.
 */
function usePagination(
  editor: Editor | null,
  view: ViewSettings,
  zoom: number,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    starts: number[];
    count: number;
    markers: Array<{ page: number; top: number }>;
  }>({ starts: [], count: 1, markers: [] });

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const probe = probeRef.current;
    if (!editor || editor.isDestroyed || !wrap || !probe) return;
    const root = editor.view.dom;
    const blocks = Array.from(root.children) as HTMLElement[];
    const pageHeight = probe.getBoundingClientRect().height;
    if (pageHeight <= 0) return;

    const rootRect = root.getBoundingClientRect();
    const rects = blocks.map((block) => block.getBoundingClientRect());
    const heights = rects.map((rect, index) => {
      const next = rects[index + 1];
      return (next ? next.top : rootRect.bottom) - rect.top;
    });
    const { starts, pages } = paginate(
      blocks.map((block, index) => ({
        height: Math.max(0, heights[index] ?? 0),
        pageBreak: block.classList.contains("bs-page-break"),
      })),
      pageHeight,
    );

    const wrapTop = wrap.getBoundingClientRect().top;
    const markers = starts.map((index, at) => ({
      page: at + 2,
      top: Math.round((rects[index]?.top ?? 0) - wrapTop),
    }));

    setLayout((was) =>
      was.count === pages &&
      was.markers.length === markers.length &&
      was.markers.every((marker, index) => marker.top === markers[index]?.top)
        ? was
        : { starts, count: pages, markers },
    );
  }, [editor]);

  // After every change, once the browser has laid it out — a frame later,
  // and at most once a frame however fast somebody types.
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    schedule();
    editor.on("update", schedule);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    if (observer && wrapRef.current) observer.observe(wrapRef.current);
    return () => {
      cancelAnimationFrame(frame);
      editor.off("update", schedule);
      observer?.disconnect();
    };
  }, [editor, measure]);

  useLayoutEffect(measure, [measure, zoom, view.layout, view.navigationPane]);

  const current = useEditorState({
    editor,
    selector: ({ editor: now }) => {
      if (!now || now.isDestroyed) return 0;
      const index = now.state.doc.resolve(now.state.selection.head).index(0);
      return index;
    },
  });

  const block = current ?? 0;
  const page = 1 + layout.starts.filter((start) => start <= block).length;

  return {
    wrapRef,
    pageRef,
    probeRef,
    count: layout.count,
    current: Math.min(page, layout.count),
    markers: layout.markers,
  };
}

function StatusBar({
  editor,
  zoom,
  pages,
  currentPage,
  view,
  onViewChange,
  start,
}: {
  editor: Editor;
  zoom: number;
  pages: number;
  currentPage: number;
  view: ViewSettings;
  onViewChange: (next: ViewSettings) => void;
  start?: ReactNode;
}) {
  const counts = useEditorState({
    editor,
    selector: ({ editor: now }) =>
      now.isDestroyed
        ? { words: 0, characters: 0, paragraphs: 0 }
        : countDocument(now.state.doc),
    equalityFn: (a, b) =>
      a?.words === b?.words &&
      a?.characters === b?.characters &&
      a?.paragraphs === b?.paragraphs,
  });
  const words = counts?.words ?? 0;
  const zoomTo = (next: number) =>
    onViewChange({ ...view, zoom: clampZoom(next) });

  return (
    <footer className="bs-doc-status" aria-label="Document status">
      <div className="bs-doc-status-start">
        {view.layout === "print" ? (
          <span className="bs-doc-status-item">
            Page {currentPage} of {pages}
          </span>
        ) : null}
        <DropButton
          label="Word count"
          className="bs-doc-status-item bs-doc-status-button"
          role="dialog"
          panelClassName="bs-rpanel--form"
          panel={() => (
            <dl className="bs-wordcount">
              <dt>Pages</dt>
              <dd>{pages.toLocaleString()}</dd>
              <dt>Words</dt>
              <dd>{words.toLocaleString()}</dd>
              <dt>Characters (with spaces)</dt>
              <dd>{(counts?.characters ?? 0).toLocaleString()}</dd>
              <dt>Paragraphs</dt>
              <dd>{(counts?.paragraphs ?? 0).toLocaleString()}</dd>
            </dl>
          )}
        >
          {words.toLocaleString()} {words === 1 ? "word" : "words"}
        </DropButton>
        {start}
      </div>

      <div className="bs-doc-status-end">
        <div className="bs-doc-status-views" role="group" aria-label="Layout">
          <button
            type="button"
            className={`bs-doc-status-icon${view.layout === "print" ? " is-on" : ""}`}
            aria-label="Print layout"
            aria-pressed={view.layout === "print"}
            title="Print layout"
            onClick={() => onViewChange({ ...view, layout: "print" })}
          >
            <FileText size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`bs-doc-status-icon${view.layout === "web" ? " is-on" : ""}`}
            aria-label="Web layout"
            aria-pressed={view.layout === "web"}
            title="Web layout"
            onClick={() => onViewChange({ ...view, layout: "web" })}
          >
            <Columns3 size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="bs-doc-zoom">
          <button
            type="button"
            className="bs-doc-status-icon"
            aria-label="Zoom out"
            title={`Zoom out (${shortcutLabel("Ctrl+-")} zooms the browser)`}
            disabled={zoom <= ZOOM_MIN}
            onClick={() => zoomTo(zoom - ZOOM_STEP)}
          >
            <Minus size={12} strokeWidth={2} aria-hidden="true" />
          </button>
          <input
            type="range"
            className="bs-doc-zoom-slider"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={zoom}
            aria-label="Zoom"
            aria-valuetext={`${zoom}%`}
            onChange={(event) => zoomTo(Number(event.target.value))}
          />
          <button
            type="button"
            className="bs-doc-status-icon"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={zoom >= ZOOM_MAX}
            onClick={() => zoomTo(zoom + ZOOM_STEP)}
          >
            <Plus size={12} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="bs-doc-zoom-value"
            title={
              view.zoom === "page-width"
                ? "Page width — click for 100%"
                : "Back to 100%"
            }
            onClick={() => zoomTo(100)}
          >
            {zoom}%
          </button>
        </div>
      </div>
    </footer>
  );
}
