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
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { FileText, Columns3, Minus, Plus } from "lucide-react";

import { sanitizeProseMirrorJson } from "../utils/sanitizer";
import { EMPTY_DOCUMENT, documentContentExtensions } from "./documentSchema";
import { countDocument, countSelectedWords, paginate } from "./documentStats";
import { EnterOverSelection } from "./extensions/EnterOverSelection";
import { PictureFiles } from "./extensions/PictureFiles";
import { PICTURE_TYPES } from "./imageFiles";
import { PictureSize } from "./extensions/PictureSize";
import { FormatPainter } from "./extensions/FormatPainter";
import { preparePrintCopy, removePrintCopy } from "./printCopy";
import { SearchAndReplace } from "./extensions/SearchAndReplace";
import { WordKeymap } from "./extensions/WordKeymap";
import { ChangeCase } from "./extensions/ChangeCase";
import { AutoFormat } from "./extensions/AutoFormat";
import { DocumentOutline } from "./DocumentOutline";
import { FindBar } from "./FindBar";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { PageContextMenu, SelectionToolbar } from "./SelectionMenus";
import { DropButton, shortcutLabel } from "./ribbon/controls";
import { LinkForm, Ribbon, type ViewSettings } from "./ribbon/Ribbon";
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampZoom,
  pinchZoom,
  stepZoom,
  zoomKey,
} from "./ribbon/options";

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
  /**
   * What floats over the desk, under the ribbon: the page's file panel. As a
   * function it is handed the document's outline to show as well, and the
   * View tab's Outline asks it to — so the binder's files and this
   * document's headings share one panel. As a node, View offers no Outline.
   */
  aside?: ReactNode | ((outline: OutlineSlot) => ReactNode);
  /** A name for the page, for screen readers and the print title. */
  label: string;
  /**
   * Not a place to type, for now: the ribbon stays, its writing commands off
   * (`Ribbon`'s `locked`), and the selection toolbar goes.
   */
  editable?: boolean;
  /** Put the cursor in the page on open: at its start, or at its end. */
  autoFocus?: "start" | "end" | false;
  /**
   * Something done outside the page that Undo takes back — a file archived
   * from the file panel. Ctrl+Z and the ribbon's Undo take it back when it is
   * newer than the last edit to a page, or when the page has nothing to undo;
   * otherwise they undo the page, as always.
   */
  outsideUndo?: { at: number; run: () => void } | null;
  /**
   * Files from the computer dropped on the page or the desk around it, other
   * than pictures, which go into the page where they land. Answers whether it
   * took them; absent, a dropped file is refused with a note.
   */
  onDropFiles?: (data: DataTransfer) => boolean;
}

/**
 * The document's headings, for the page around the editor to place. View's
 * Outline asks for them to be shown or put away, and the page says whether
 * they are on screen, so the button can show it.
 */
export interface OutlineSlot {
  /** The headings, ready to place. */
  content: ReactNode;
  /** Every press of View's Outline: show them, or put them away. */
  request: { show: boolean; nonce: number };
  /** Whether they are on screen now. */
  onShown: (shown: boolean) => void;
}

/**
 * Whether a drop holds anything other than pictures: a Word file, a PDF, a
 * folder. Pictures alone are for the page.
 */
function droppedSomethingButPictures(data: DataTransfer): boolean {
  const items = Array.from(data.items ?? []).filter(
    (item) => item.kind === "file",
  );
  if (items.length === 0) return false;
  return items.some(
    (item) =>
      item.webkitGetAsEntry?.()?.isDirectory === true ||
      !(PICTURE_TYPES as readonly string[]).includes(item.type),
  );
}

/** US Letter at 96 CSS pixels to the inch, less Word's one-inch margins. */
const PAGE_CONTENT_HEIGHT_IN = 9;

const VIEW_KEY = "bindersnap:editor-view";

function readSavedView(): ViewSettings {
  const fallback: ViewSettings = {
    layout: "print",
    zoom: "page-width",
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
    };
  } catch {
    return fallback;
  }
}

/**
 * The view is the reader's, not the document's: the zoom and the layout are
 * remembered on this browser for next time, and never written to the
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
  aside,
  label,
  editable = true,
  autoFocus = false,
  outsideUndo = null,
  onDropFiles,
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
  const onDropFilesRef = useRef(onDropFiles);
  onDropFilesRef.current = onDropFiles;
  const outsideUndoRef = useRef(outsideUndo);
  outsideUndoRef.current = outsideUndo;
  /** When a page last changed by an edit: Undo's way to tell what came last. */
  const lastEditAt = useRef(0);
  /** Undo what was done outside the page, if that is what came last. */
  const undoOutsideRef = useRef<() => boolean>(() => false);
  /** The page's right-click menu, where it was opened. */
  const [pageMenuAt, setPageMenuAt] = useState<{ x: number; y: number } | null>(
    null,
  );

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
      handleDOMEvents: {
        // The page's own menu, not the browser's. Right-clicked outside the
        // selection, the cursor goes where the click was first, as in Word.
        // Shift keeps the browser's, with its spelling suggestions.
        contextmenu: (view, event) => {
          if (event.shiftKey || !view.editable) return false;
          event.preventDefault();
          const { from, to } = view.state.selection;
          const hit = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (hit && (hit.pos < from || hit.pos > to)) {
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, hit.pos),
              ),
            );
          }
          setPageMenuAt({ x: event.clientX, y: event.clientY });
          return true;
        },
      },
      // Before the picture handling: a document dropped on the page is one to
      // add to the binder. Pictures alone fall through, into the page.
      handleDrop: (_view, event, _slice, moved) => {
        const data = event.dataTransfer;
        if (moved || !data || !onDropFilesRef.current) return false;
        if (!droppedSomethingButPictures(data)) return false;
        if (!onDropFilesRef.current(data)) return false;
        event.preventDefault();
        return true;
      },
      // Before the keymap, so Ctrl+Z reaches an act outside the page first.
      handleKeyDown: (_view, event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (!mod || event.shiftKey || event.altKey) return false;
        if (event.key.toLowerCase() !== "z") return false;
        return undoOutsideRef.current();
      },
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

  undoOutsideRef.current = () => {
    const outside = outsideUndoRef.current;
    if (!outside || !editor) return false;
    if (outside.at <= lastEditAt.current && editor.can().undo()) return false;
    outside.run();
    return true;
  };
  useEffect(() => {
    if (!editor) return;
    const onTransaction = ({
      transaction,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (transaction.docChanged) lastEditAt.current = Date.now();
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor]);

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

  /** The find bar, while it is open: Ctrl+F, or Ctrl+H for Replace. */
  const [find, setFind] = useState<{
    replace: boolean;
    nonce: number;
  } | null>(null);
  const openFind = useCallback((replace: boolean) => {
    setFind((was) => ({ replace, nonce: (was?.nonce ?? 0) + 1 }));
  }, []);
  const closeFind = useCallback(() => setFind(null), []);

  /** View's Outline: asks the page's panel to show the headings, or not. */
  const [outlineShown, setOutlineShown] = useState(false);
  const [outlineRequest, setOutlineRequest] = useState({
    show: false,
    nonce: 0,
  });
  const toggleOutline = useCallback(() => {
    setOutlineRequest((was) => ({ show: !outlineShown, nonce: was.nonce + 1 }));
  }, [outlineShown]);

  const rootRef = useRef<HTMLDivElement>(null);
  const [shortcuts, setShortcuts] = useState(false);
  /** Ctrl+K's link form, where the cursor is. */
  const [linkAt, setLinkAt] = useState<{ left: number; top: number } | null>(
    null,
  );
  const openLink = useCallback(() => {
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    const at = editor.view.coordsAtPos(editor.state.selection.from);
    setLinkAt({ left: at.left, top: at.bottom + 6 });
  }, [editor]);
  const closeLink = useCallback(() => {
    setLinkAt(null);
    editor?.commands.focus();
  }, [editor]);
  const closePageMenu = useCallback(() => setPageMenuAt(null), []);
  const closeShortcuts = useCallback(() => {
    setShortcuts(false);
    editor?.commands.focus();
  }, [editor]);

  // Save, Find and Replace, from anywhere in the editor — the ribbon and the
  // pane as well as the page, as in Word.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (event: KeyboardEvent) => {
      // The page's zoom, not the browser's, while you are in the editor — as
      // in Google Docs and Word for the web. Outside it, and from the
      // browser's own menu, the browser still zooms everything.
      const zooming = zoomKey(event);
      if (zooming && zoomByKeyRef.current(zooming)) {
        event.preventDefault();
        return;
      }
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
      } else if (key === "k" && !event.shiftKey) {
        // Word's Insert Hyperlink, from anywhere, and not the browser's
        // search box.
        event.preventDefault();
        openLink();
      } else if (key === "/" || event.code === "Slash") {
        event.preventDefault();
        setShortcuts(true);
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
    // `editor`: the root is only drawn once there is one, and a listener
    // attached before then was attached to nothing.
  }, [openFind, openLink, editor]);

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

  // Read by listeners attached once, so they always see the zoom as it is.
  // Web layout has no zoom of its own, so there the browser's is left alone.
  const zoomByKeyRef = useRef<(how: "in" | "out" | "reset") => boolean>(
    () => false,
  );
  zoomByKeyRef.current = (how) => {
    if (view.layout === "web") return false;
    setView({ ...view, zoom: how === "reset" ? 100 : stepZoom(zoom, how) });
    return true;
  };
  const pinchRef = useRef({ zoom, exact: zoom });
  if (Math.round(pinchRef.current.exact) !== zoom) {
    pinchRef.current = { zoom, exact: zoom };
  }
  const pinchToRef = useRef<(exact: number) => void>(() => {});
  pinchToRef.current = (exact) => {
    pinchRef.current = { zoom: clampZoom(exact), exact };
    if (clampZoom(exact) !== zoom) {
      setView({ ...view, zoom: clampZoom(exact) });
    }
  };

  // A pinch on a trackpad, or Ctrl and the wheel, over the page zooms the
  // page: a browser reports a pinch as a wheel with Ctrl held. Not in Web
  // layout, which has no zoom.
  useEffect(() => {
    const desk = deskRef.current;
    if (!desk || view.layout === "web") return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      pinchToRef.current(pinchZoom(pinchRef.current.exact, event.deltaY));
    };
    desk.addEventListener("wheel", onWheel, { passive: false });
    return () => desk.removeEventListener("wheel", onWheel);
  }, [editor, view.layout]);

  if (!editor) return null;

  return (
    <div
      ref={rootRef}
      className={`bs-doc-editor bs-doc-editor--${view.layout}${
        editable ? "" : " bs-doc-editor--readonly"
      }`}
    >
      <Ribbon
        editor={editor}
        locked={!editable}
        view={view}
        zoom={zoom}
        onViewChange={setView}
        onFind={openFind}
        onPrint={print}
        onShortcuts={() => setShortcuts(true)}
        end={ribbonEnd}
        onUndo={() => undoOutsideRef.current()}
        outsideUndo={outsideUndo !== null}
        {...(typeof aside === "function"
          ? { outline: { shown: outlineShown, onToggle: toggleOutline } }
          : {})}
      />

      {shortcuts ? <ShortcutsDialog onClose={closeShortcuts} /> : null}
      {editable ? (
        <SelectionToolbar
          editor={editor}
          onLink={openLink}
          hidden={pageMenuAt !== null || linkAt !== null || find !== null}
        />
      ) : null}
      {pageMenuAt ? (
        <PageContextMenu
          editor={editor}
          at={pageMenuAt}
          onLink={openLink}
          onClose={closePageMenu}
        />
      ) : null}
      {linkAt && editor ? (
        <LinkPopover at={linkAt} onClose={closeLink}>
          <LinkForm editor={editor} onDone={closeLink} />
        </LinkPopover>
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
        {typeof aside === "function"
          ? aside({
              content: <DocumentOutline editor={editor} />,
              request: outlineRequest,
              onShown: setOutlineShown,
            })
          : aside}
        {find ? (
          <FindBar editor={editor} request={find} onClose={closeFind} />
        ) : null}

        <div
          className="bs-doc-desk"
          ref={deskRef}
          // The desk around the page takes a dropped file too, so a file
          // dropped just off the page is not opened by the browser instead.
          onDragOver={(event) => {
            if (!onDropFiles || event.defaultPrevented) return;
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            if (!onDropFiles || event.defaultPrevented) return;
            if (!Array.from(event.dataTransfer.types).includes("Files")) return;
            event.preventDefault();
            onDropFiles(event.dataTransfer);
          }}
        >
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

  useLayoutEffect(measure, [measure, zoom, view.layout]);

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
  const selected = useEditorState({
    editor,
    selector: ({ editor: now }) =>
      now.isDestroyed
        ? null
        : countSelectedWords(
            now.state.doc,
            now.state.selection.from,
            now.state.selection.to,
          ),
  });
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
          {selected === null || selected === undefined
            ? `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`
            : `${selected.toLocaleString()} of ${words.toLocaleString()} ${
                words === 1 ? "word" : "words"
              }`}
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
            title={`Zoom out (${shortcutLabel("Ctrl+-")})`}
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
            title={`Zoom in (${shortcutLabel("Ctrl+=")})`}
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

/**
 * The link form, under the cursor: Ctrl+K from anywhere, as Word's Insert
 * Hyperlink is — not only from the Insert tab. Kept inside the window, first
 * field focused, and gone on Escape or a press outside.
 */
function LinkPopover({
  at,
  onClose,
  children,
}: {
  at: { left: number; top: number };
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    setPlace({
      left: Math.max(8, Math.min(at.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(at.top, window.innerHeight - height - 8)),
    });
    box.querySelector<HTMLInputElement>("input")?.focus();
  }, [at]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="bs-rpanel bs-rpanel--form"
      role="dialog"
      aria-label="Link"
      style={{ left: place.left, top: place.top }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}
