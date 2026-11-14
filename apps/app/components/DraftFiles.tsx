import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { AppIcon, ICON, type IconGlyph } from "./AppIcon";

import type {
  BinderArchivePayload,
  WorkspaceDocumentListEntry,
} from "../../../packages/api-schema/schemas/workspaces";
import type { OutlineSlot } from "../../../packages/editor/DocumentEditor";
import { isEditorDocumentFile } from "../binderDocument";
import { convertibleKind } from "../convertToEditor";
import {
  buildBinderTree,
  folderPaths,
  type BinderTreeNode,
} from "../binderTree";
import {
  acceptsDrop,
  isManaged,
  planMove,
  type DragSubject,
} from "../binderMove";
import { formatDocumentName } from "../documentDisplay";
import { carriesFiles } from "../bulkUpload";
import {
  FILES_WIDTH_DEFAULT,
  FILES_WIDTH_MAX,
  FILES_WIDTH_MIN,
  clampFilesWidth,
  keyedFilesWidth,
  readFilesWidth,
  writeFilesWidth,
} from "../filesPanelWidth";
import { useOpenFolders } from "../useOpenFolders";
import { useRememberedToggle } from "../useRememberedToggle";
import { InlineRename } from "./BinderPage";
import { MoveToFolderModal } from "./MoveToFolderModal";

/**
 * The draft's files, inside the editor.
 *
 * **The editor is where a draft is written, so it is where the draft's files
 * are.** Leaving the editor to find the next policy, then pressing Edit on it,
 * made writing three policies six trips. Here a policy opens beside the one you
 * were in, in the same draft, and a new one starts from the same panel — Word's
 * Open and New, with GitLab's Web IDE's file tree as the shape.
 *
 * **And it is where the draft's files are organized.** Renaming a policy,
 * refiling it and making a folder meant Organize, which closed the editor and
 * opened the binder's tree — so renaming the policy you were writing was a
 * trip out and back, and a chance to leave words unsaved on the way. Here each
 * row renames in place (the pencil, a double-click, or F2, as in Explorer and
 * VS Code), moves by dragging onto a folder or by its Move button, and a
 * policy archives from its row. Every act goes into the same draft the words
 * do.
 *
 * The same tree the binder's own page and the file panel build, from the same
 * `buildBinderTree`, read at the draft: a policy added a minute ago is here,
 * and one the draft renamed is under its new name. A Word file or a PDF is
 * listed — it is in the binder — but drawn as a file, not a page, because the
 * editor cannot open it.
 */

const NOTHING: readonly string[] = [];

/** A row being acted on, by its address. */
export type DraftFileTarget =
  { kind: "folder"; path: string } | { kind: "document"; slugPath: string };

interface DraftFilesProps {
  org: string;
  binder: string;
  binderName: string;
  documents: readonly WorkspaceDocumentListEntry[];
  folders: readonly string[];
  /** The policy open in the editor, so its row is marked. */
  active: string;
  /** It has words not saved yet: its row says so, as a tab in an IDE does. */
  unsaved?: boolean;
  /**
   * Other open policies with words not saved, by address: their rows say so
   * too, since moving between policies keeps what was typed in each.
   */
  unsavedElsewhere?: ReadonlyMap<string, string>;
  onOpen: (slugPath: string) => void;
  /**
   * Put a folder on the desk: what clicking its name does. Without it the
   * name opens and shuts the folder, as the arrow does.
   */
  onOpenFolder?: (folder: string) => void;
  /** The folder on the desk, so its row is marked. */
  activeFolder?: string | null;
  /**
   * A policy row was pointed at or focused: the click that opens it is likely
   * next, and reading it now makes that open immediate.
   */
  onReadAhead?: (slugPath: string) => void;
  /** Start a new policy in this draft. Absent, and there is no New button. */
  /** In `folder`, when started from a folder's menu; else beside the open one. */
  onNew?: (folder?: string) => void;
  /** Make a folder in this draft. Absent, and there is no New folder button. */
  onNewFolder?: (parent?: string) => void;
  /**
   * Rename a row, in this draft. Absent, the tree only opens things — as it
   * does on a change request, which is revised here and not reshaped.
   */
  onRename?: (target: DraftFileTarget, name: string) => void;
  /** File a row somewhere else, `""` being the binder's top level. */
  onMove?: (subject: DragSubject, folder: string) => void;
  /**
   * Files dragged in from the computer, dropped into `folder`: a folder's
   * row or anything in it, or `""` below the rows for the top level.
   */
  onUploadDrop?: (data: DataTransfer, folder: string) => void;
  /**
   * Upload files into a folder — the head's Upload and a folder's "Upload
   * files here". Opens the add dialog; nothing is written until it is used.
   */
  onUpload?: (folder: string) => void;
  /** Take a policy off the record, in this draft. */
  onArchive?: (slugPath: string) => Promise<boolean>;
  /** Take a folder off the record — every policy in it — in this draft. */
  onArchiveFolder?: (folder: string) => Promise<boolean>;
  /**
   * What this binder has taken off the record, as the draft stands — the
   * count, the list when it is opened, and the way back. Restore goes into
   * the same draft, so an archiving done here a moment ago is undone by it.
   */
  archivedCount?: number;
  /** A copy of a policy, beside it in the same folder, opened. */
  onCopy?: (slugPath: string) => void;
  /**
   * Read a Word file or PDF into the editor's format, in this draft. Offered
   * on those rows only; absent where the tree cannot write.
   */
  onConvert?: (target: {
    slugPath: string;
    path: string;
    name: string;
  }) => void;
  onReadArchive?: () => Promise<BinderArchivePayload["documents"]>;
  onRestore?: (uid: string) => Promise<boolean>;
  /**
   * Told what was just archived or deleted here, for the page to offer back:
   * the panel's Undo, Ctrl+Z and the ribbon's Undo all take it back.
   */
  onArchived?: (record: ArchiveUndo) => void;
  /** The act to offer back under the tree, while it is "just now". */
  undo?: ArchiveUndo | null;
  /** Take back {@link undo}. */
  onUndo?: () => void;
  /** An act is being saved: nothing else starts until it lands. */
  busy?: boolean;
  /**
   * The files this draft has written — every act's paths. A row among them
   * carries a quiet mark, so what the draft has done is seen in the tree
   * rather than read in the draft bar, as an IDE marks a changed file.
   */
  touched?: readonly string[];
  /**
   * The open document's headings, from the editor. With them the panel has
   * two sides, Files and Outline, and View's Outline opens it on the second.
   */
  outline?: OutlineSlot;
}

const STORAGE_KEY = "bindersnap.editor.files.collapsed";

type PanelTab = "files" | "outline";
const PANEL_TABS: readonly { id: PanelTab; label: string }[] = [
  { id: "files", label: "Files" },
  { id: "outline", label: "Outline" },
];
/** Which side of the panel was up last, per browser: a habit. */
const TAB_KEY = "bindersnap.editor.files.tab";

function readPanelTab(): PanelTab {
  try {
    return window.localStorage.getItem(TAB_KEY) === "outline"
      ? "outline"
      : "files";
  } catch {
    return "files";
  }
}

function writePanelTab(tab: PanelTab): void {
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Private mode or storage off: the tab just is not remembered.
  }
}

/**
 * Narrower than this, a tree beside the page leaves the page too small to
 * read: at 768px it drew the text at half size. So the panel starts shut
 * there, whatever was remembered from a wider window, and opens over the page
 * rather than beside it — Word's navigation pane on a tablet.
 */
const NARROW = "(max-width: 1099px)";

function subscribeNarrow(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isNarrow(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia
    ? window.matchMedia(NARROW).matches
    : false;
}

/**
 * An act on the draft's files the page can take back: the policy or folder
 * just archived, or the policy just deleted.
 */
export type ArchiveUndo =
  | {
      kind: "document";
      uid: string;
      /** Where it was: how one never published is found again. */
      path: string;
      label: string;
      /** Never published, so deleted from the draft rather than archived. */
      deleted: boolean;
    }
  | {
      kind: "folder";
      /** Its folders, made again before anything is restored into them. */
      folders: string[];
      documents: { uid: string; path: string }[];
      label: string;
    };

/** Whether a policy has ever been published: it is on the record if so. */
function isPublished(document: WorkspaceDocumentListEntry): boolean {
  return document.latestVersion !== null;
}

/**
 * The binder's top level, as a folder: what a right-click on the empty part
 * of the panel opens a menu for, as on the empty part of a file explorer.
 */
const TOP_LEVEL: BinderTreeNode = {
  kind: "folder",
  path: "",
  name: "",
  children: [],
  documentCount: 0,
};

/** The first document in the tree's order, folders first as drawn. */
function firstDocument(
  nodes: readonly BinderTreeNode[],
): WorkspaceDocumentListEntry | null {
  for (const node of nodes) {
    if (node.kind === "document") return node.document;
    const inside = firstDocument(node.children);
    if (inside) return inside;
  }
  return null;
}

/** A row as something that can be picked up and dropped. */
function subjectOf(node: BinderTreeNode): DragSubject {
  return node.kind === "folder"
    ? { kind: "folder", path: node.path }
    : {
        kind: "document",
        slugPath: node.document.slugPath,
        folder: node.document.folder,
      };
}

function targetOf(node: BinderTreeNode): DraftFileTarget {
  return node.kind === "folder"
    ? { kind: "folder", path: node.path }
    : { kind: "document", slugPath: node.document.slugPath };
}

function keyOf(node: BinderTreeNode): string {
  return node.kind === "folder"
    ? `folder:${node.path}`
    : `document:${node.document.slugPath}`;
}

export function DraftFiles({
  org,
  binder,
  binderName,
  documents,
  folders,
  active,
  unsaved = false,
  unsavedElsewhere,
  onReadAhead,
  onOpen,
  onOpenFolder,
  activeFolder = null,
  onNew,
  onNewFolder,
  onRename,
  onMove,
  onUploadDrop,
  onUpload,
  onArchive,
  onArchiveFolder,
  archivedCount = 0,
  onCopy,
  onConvert,
  onReadArchive,
  onRestore,
  onArchived,
  undo = null,
  onUndo,
  busy = false,
  touched = NOTHING,
  outline,
}: DraftFilesProps) {
  const remembered = useRememberedToggle(STORAGE_KEY);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const [floating, setFloating] = useState(false);
  /** Beside the page, as wide as its edge was last dragged. */
  const [width, setWidth] = useState(readFilesWidth);
  const [resizing, setResizing] = useState(false);
  const resizeFrom = useRef<{ x: number; width: number } | null>(null);
  const resizeTo = (next: number) => {
    setWidth(next);
    writeFilesWidth(next);
  };
  const floatRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLButtonElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  /** The row whose name is a text box, by {@link keyOf}. One at a time. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The row whose Move was pressed: the keyboard's way to refile. */
  const [moving, setMoving] = useState<{
    subject: DragSubject;
    label: string;
  } | null>(null);
  const [dragging, setDragging] = useState<DragSubject | null>(null);
  /** A row's menu, from a right-click or the keyboard's menu key. */
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archived, setArchived] = useState<
    BinderArchivePayload["documents"] | null
  >(null);
  const [archiveError, setArchiveError] = useState(false);
  // Read when opened, and again whenever the count moves: an archiving or a
  // restore changes what is in it.
  useEffect(() => {
    if (!archiveOpen || !onReadArchive) return;
    let cancelled = false;
    setArchiveError(false);
    onReadArchive()
      .then((entries) => {
        if (!cancelled) setArchived(entries);
      })
      .catch(() => {
        if (!cancelled) setArchiveError(true);
      });
    return () => {
      cancelled = true;
    };
    // `onReadArchive` is made afresh each render; the count is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveOpen, archivedCount]);
  const [menu, setMenu] = useState<{
    node: BinderTreeNode;
    x: number;
    y: number;
    /** Where focus goes back to when it closes without acting. */
    from: HTMLElement | null;
  } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  useEffect(() => {
    if (!narrow) setFloating(false);
  }, [narrow]);
  // Over the page, it goes as a menu does: Escape, or a press elsewhere. Not
  // while a name is being typed or a folder picked: Escape is theirs then.
  useEffect(() => {
    if (!floating || renaming !== null || moving !== null || menu !== null) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFloating(false);
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (floatRef.current?.contains(target)) return;
      if (railRef.current?.contains(target)) return;
      setFloating(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [floating, renaming, moving, menu]);
  const shut = narrow ? !floating : remembered.on;
  const toggle = narrow ? () => setFloating((was) => !was) : remembered.toggle;

  /** Which side of the panel is up: the binder's files, or the outline. */
  const [tab, setTab] = useState<PanelTab>(readPanelTab);
  const chooseTab = (next: PanelTab) => {
    setTab(next);
    writePanelTab(next);
  };
  const onOutline = outline !== undefined && tab === "outline";
  const setOpen = (open: boolean) => {
    if (narrow) setFloating(open);
    else if (remembered.on === open) remembered.toggle();
  };
  // View's Outline: open the panel on the headings, or put it away. Each
  // press is new; the one the panel was drawn with is not a press.
  const outlineRequest = outline?.request;
  const answered = useRef(outlineRequest?.nonce ?? 0);
  useEffect(() => {
    if (!outlineRequest || outlineRequest.nonce === answered.current) return;
    answered.current = outlineRequest.nonce;
    if (outlineRequest.show) {
      chooseTab("outline");
      setOpen(true);
    } else {
      setOpen(false);
    }
    // Only a new press acts; the rest is read as it stands at that press.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineRequest]);
  // Tell View whether the headings are on screen, so Outline shows it.
  const onOutlineShown = outline?.onShown;
  const outlineOnScreen = !shut && onOutline;
  useEffect(() => {
    onOutlineShown?.(outlineOnScreen);
  }, [onOutlineShown, outlineOnScreen]);
  const openPolicy = (slugPath: string) => {
    setFloating(false);
    onOpen(slugPath);
  };
  /**
   * The folder you are in: the one on the desk, else the open document's.
   * New document and New folder at the top of the panel make things there,
   * not at the binder's top.
   */
  const here =
    activeFolder ??
    (active.includes("/") ? active.slice(0, active.lastIndexOf("/")) : "");
  const startNew = onNew
    ? () => {
        setFloating(false);
        onNew(here || undefined);
      }
    : undefined;
  const {
    isOpen,
    toggle: toggleFolder,
    open: openFolders,
  } = useOpenFolders(org, binder, active);
  const [filter, setFilter] = useState("");

  const tree = useMemo(
    () => buildBinderTree(documents, [...folders]),
    [documents, folders],
  );
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (needle === "") return tree;
    return buildBinderTree(
      documents.filter((document) =>
        formatDocumentName(document.name).toLowerCase().includes(needle),
      ),
      [],
    );
  }, [documents, needle, tree]);
  const everyFolder = useMemo(() => folderPaths(shown), [shown]);
  // Every folder in the binder, not only the ones a filter left on screen:
  // the move picker offers where a policy can go, not where it can be seen.
  const allFolders = useMemo(() => folderPaths(tree), [tree]);

  const organizing = !!(onRename || onMove || onArchive || onArchiveFolder);

  /**
   * Archive a row, and offer it back. **No "are you sure"**, as on the
   * binder's tree: it goes into the draft, which is undoable as a whole — and
   * here, straight away, by Undo.
   */
  const archiveRow = async (node: BinderTreeNode) => {
    if (!onArchive || node.kind !== "document") return;
    const done = await onArchive(node.document.slugPath);
    if (done && node.document.uid) {
      onArchived?.({
        kind: "document",
        uid: node.document.uid,
        path: node.document.path,
        label: labelOf(node),
        deleted: !isPublished(node.document),
      });
    }
  };

  /**
   * Archive a folder and everything in it, as one act, and offer it back:
   * Undo makes its folders again and restores every policy into them.
   */
  const archiveFolder = async (node: BinderTreeNode) => {
    if (!onArchiveFolder || node.kind !== "folder") return;
    const prefix = `${node.path}/`;
    const inside = documents.filter((entry) =>
      `${entry.folder}/`.startsWith(prefix),
    );
    const folders = [
      node.path,
      ...allFolders.filter((path) => path.startsWith(prefix)),
    ];
    const done = await onArchiveFolder(node.path);
    if (done) {
      onArchived?.({
        kind: "folder",
        folders,
        documents: inside.flatMap((entry) =>
          entry.uid ? [{ uid: entry.uid, path: entry.path }] : [],
        ),
        label: labelOf(node),
      });
    }
  };

  const restore = async (uid: string) => {
    if (!onRestore) return;
    await onRestore(uid);
  };

  const touchedPaths = useMemo(() => new Set(touched), [touched]);
  /**
   * Whether the draft changed this row. A folder counts when something was
   * written directly in it — made, moved in, renamed — not anywhere below
   * it, which would mark every ancestor of every edit (the binder tree's rule).
   */
  const isTouched = (node: BinderTreeNode): boolean => {
    if (node.kind === "document") return touchedPaths.has(node.document.path);
    const prefix = `${node.path}/`;
    for (const path of touchedPaths) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
        return true;
      }
    }
    return false;
  };

  // Shut, the panel is one small button floating at the desk's corner.
  const rail = (
    <div className="doc-files-anchor">
      <button
        type="button"
        ref={railRef}
        className="doc-files-launcher"
        aria-expanded={false}
        aria-label="Show file explorer"
        title="Show file explorer"
        onClick={toggle}
      >
        <AppIcon icon={ICON.showPanel} size="md" />
      </button>
    </div>
  );
  if (shut) return rail;

  const labelOf = (node: BinderTreeNode) =>
    formatDocumentName(node.kind === "folder" ? node.name : node.document.name);

  const commitRename = (node: BinderTreeNode, typed: string) => {
    setRenaming(null);
    const next = typed.trim();
    if (!onRename || next === "" || next === labelOf(node)) return;
    onRename(targetOf(node), next);
  };

  const canAct = (node: BinderTreeNode) =>
    organizing && isManaged(node) && !busy;

  /** F2 renames the row with focus, as Explorer and VS Code do. */
  /**
   * The arrow keys walk the tree, as they do in Explorer and in VS Code's:
   * Up and Down move between rows, Right opens a folder (or steps into it),
   * Left closes it (or steps out to the folder a row is in), Home and End go
   * to the ends. Not in a text box: a name being typed keeps its arrows.
   */
  const onTreeKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const target = event.target as HTMLElement;
    if (
      !target.matches("button.app-explorer-item, button.app-explorer-folder")
    ) {
      return;
    }
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        "button.app-explorer-item, button.app-explorer-folder",
      ),
    );
    const at = rows.indexOf(target);
    if (at === -1) return;
    const focusRow = (index: number) => {
      event.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, index))]?.focus();
    };
    const folder = target.dataset.folder;
    const open = target.getAttribute("aria-expanded") === "true";
    switch (event.key) {
      case "ArrowDown":
        focusRow(at + 1);
        break;
      case "ArrowUp":
        // From the first row, back up into Go to file.
        if (at === 0) {
          event.preventDefault();
          filterRef.current?.focus();
        } else focusRow(at - 1);
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      case "ArrowRight":
        if (folder === undefined) return;
        event.preventDefault();
        if (open) focusRow(at + 1);
        else toggleFolder(folder);
        break;
      case "ArrowLeft": {
        event.preventDefault();
        if (folder !== undefined && open) {
          toggleFolder(folder);
          return;
        }
        const parent = target.dataset.parent;
        if (!parent) return;
        rows.find((row) => row.dataset.folder === parent)?.focus();
        break;
      }
    }
  };

  const onRowKey = (event: ReactKeyboardEvent, node: BinderTreeNode) => {
    // The keyboard's menu key, or Shift+F10: the row's menu, under the row.
    if (
      event.key === "ContextMenu" ||
      (event.key === "F10" && event.shiftKey)
    ) {
      const row = event.currentTarget as HTMLElement;
      const box = row.getBoundingClientRect();
      event.preventDefault();
      openMenu(node, box.left + 24, box.bottom, row);
      return;
    }
    if (event.key !== "F2" || !onRename || !canAct(node)) return;
    event.preventDefault();
    setRenaming(keyOf(node));
  };

  const openMenu = (
    node: BinderTreeNode,
    x: number,
    y: number,
    from: HTMLElement | null,
  ) => {
    if (renaming === keyOf(node) || menuItems(node).length === 0) return;
    setMenu({ node, x, y, from });
  };

  /** Right-click: the row's menu at the pointer, as a file explorer's is. */
  const onRowMenu = (event: MouseEvent<HTMLElement>, node: BinderTreeNode) => {
    if (renaming === keyOf(node)) return;
    event.preventDefault();
    // A folder's row sits inside its group, which holds its children's rows.
    event.stopPropagation();
    const row = event.currentTarget.querySelector<HTMLElement>(
      "button.app-explorer-item, button.app-explorer-folder",
    );
    openMenu(node, event.clientX, event.clientY, row);
  };

  /** What a row's menu offers: its acts, and for a folder, what goes in it. */
  const menuItems = (node: BinderTreeNode): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    const acts = canAct(node);
    const label = labelOf(node);
    if (node.kind === "document") {
      if (node.document.slugPath !== active) {
        items.push({
          label: "Open",
          icon: ICON.document,
          run: () => openPolicy(node.document.slugPath),
        });
      }
    } else {
      if (onNew) {
        items.push({
          label: "New document here",
          icon: ICON.newDocument,
          run: () => {
            setFloating(false);
            onNew(node.path);
          },
        });
      }
      if (onUpload) {
        items.push({
          label: "Upload files here",
          icon: ICON.upload,
          disabled: busy,
          run: () => {
            setFloating(false);
            onUpload(node.path);
          },
        });
      }
      if (onNewFolder) {
        items.push({
          label: "New folder here",
          icon: ICON.newFolder,
          disabled: busy,
          run: () => {
            setFloating(false);
            onNewFolder(node.path);
          },
        });
      }
    }
    // The top level makes things in it; it is not itself renamed or moved.
    if (node.kind === "folder" && node.path === "") return items;
    if (onRename && isManaged(node)) {
      items.push({
        label: "Rename",
        hint: "F2",
        icon: ICON.edit,
        disabled: !acts,
        separated: items.length > 0,
        run: () => setRenaming(keyOf(node)),
      });
    }
    if (
      onCopy &&
      node.kind === "document" &&
      isEditorDocumentFile(node.document.path)
    ) {
      items.push({
        label: "Make a copy",
        icon: ICON.copy,
        disabled: busy,
        run: () => {
          setFloating(false);
          onCopy(node.document.slugPath);
        },
      });
    }
    if (
      onConvert &&
      node.kind === "document" &&
      convertibleKind(node.document.path) !== null
    ) {
      items.push({
        label: "Edit in Bindersnap",
        icon: ICON.document,
        disabled: busy,
        run: () => {
          setFloating(false);
          onConvert({
            slugPath: node.document.slugPath,
            path: node.document.path,
            name: label,
          });
        },
      });
    }
    if (onMove && isManaged(node)) {
      items.push({
        label: "Move to…",
        icon: ICON.moveToFolder,
        disabled: !acts,
        run: () => setMoving({ subject: subjectOf(node), label }),
      });
    }
    if (onArchive && node.kind === "document" && isManaged(node)) {
      const published = isPublished(node.document);
      items.push({
        // Never published, it is only in this draft: there is no record to
        // archive it from, so it is deleted.
        label: published ? "Archive" : "Delete",
        icon: published ? ICON.archive : ICON.delete,
        danger: true,
        disabled: !acts,
        separated: true,
        run: () => void archiveRow(node),
      });
    }
    if (onArchiveFolder && node.kind === "folder") {
      items.push({
        label: "Archive folder",
        icon: ICON.archive,
        danger: true,
        disabled: !acts,
        separated: true,
        run: () => void archiveFolder(node),
      });
    }
    return items;
  };

  /**
   * The drag attributes for a row. Only a folder takes a drop — there is no
   * "inside" a policy — and the top level has its own zone below the tree.
   */
  /**
   * The drag attributes for a row: a row moved within the panel, and files
   * from the computer dropped on it — into the folder it is, or is in.
   */
  const dragProps = (node: BinderTreeNode) => {
    const moving = moveProps(node);
    if (!onUploadDrop) return moving;
    const into = node.kind === "folder" ? node.path : node.document.folder;
    return {
      ...moving,
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (dragging === null && carriesFiles(event.dataTransfer)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          setOver(into);
          return;
        }
        moving.onDragOver?.(event);
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (dragging === null && carriesFiles(event.dataTransfer)) {
          event.preventDefault();
          event.stopPropagation();
          setOver(null);
          onUploadDrop(event.dataTransfer, into);
          return;
        }
        moving.onDrop?.(event);
      },
    };
  };

  const moveProps = (node: BinderTreeNode) => {
    if (!onMove || !canAct(node) || renaming === keyOf(node)) return {};
    const folder = node.kind === "folder" ? node.path : null;
    const willTake =
      folder !== null && dragging !== null && acceptsDrop(dragging, folder);
    return {
      draggable: true,
      onDragStart: (event: DragEvent<HTMLDivElement>) => {
        // A folder row holds its children's rows: the drag is the innermost.
        event.stopPropagation();
        const subject = subjectOf(node);
        setDragging(subject);
        event.dataTransfer.effectAllowed = "move";
        // Firefox starts no drag without data.
        event.dataTransfer.setData(
          "text/plain",
          subject.kind === "folder" ? subject.path : subject.slugPath,
        );
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (!willTake) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setOver(folder);
      },
      onDragLeave: () => {
        if (over === folder) setOver(null);
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!willTake || dragging === null || folder === null) return;
        event.preventDefault();
        event.stopPropagation();
        drop(dragging, folder);
      },
    };
  };

  const drop = (subject: DragSubject, folder: string) => {
    setDragging(null);
    setOver(null);
    setMoving(null);
    const plan = planMove(subject, folder);
    if (plan === null || plan.kind === "refused" || !onMove) return;
    onMove(subject, folder);
  };

  /**
   * Rename and Archive, on the row they act on. Moving is a drag onto a
   * folder; the row's menu keeps "Move to…" for the keyboard.
   */
  const rowActions = (node: BinderTreeNode) => {
    if (!organizing || !isManaged(node) || renaming === keyOf(node)) {
      return null;
    }
    const label = labelOf(node);
    return (
      <span className="doc-files-acts">
        {onRename ? (
          <button
            type="button"
            className="bs-rowact"
            aria-label={`Rename ${label}`}
            title="Rename (F2)"
            disabled={busy}
            onClick={() => setRenaming(keyOf(node))}
          >
            <AppIcon icon={ICON.edit} size="sm" />
          </button>
        ) : null}
        {/* A folder's Archive is in its menu: it takes everything in it. */}
        {onArchive && node.kind === "document" ? (
          isPublished(node.document) ? (
            <button
              type="button"
              className="bs-rowact bs-rowact--danger"
              aria-label={`Archive ${label}`}
              title="Archive — it leaves the binder when this draft is published"
              disabled={busy}
              onClick={() => void archiveRow(node)}
            >
              <AppIcon icon={ICON.archive} size="sm" />
            </button>
          ) : (
            <button
              type="button"
              className="bs-rowact bs-rowact--danger"
              aria-label={`Delete ${label}`}
              title="Delete — it was never published, so it is only in this draft"
              disabled={busy}
              onClick={() => void archiveRow(node)}
            >
              <AppIcon icon={ICON.delete} size="sm" />
            </button>
          )
        ) : null}
      </span>
    );
  };

  const renderNode = (node: BinderTreeNode, depth: number) => {
    const indent = { paddingLeft: `${8 + depth * 14}px` };
    const key = keyOf(node);
    const isRenaming = renaming === key;

    if (node.kind === "document") {
      const { slugPath, path } = node.document;
      const on = slugPath === active;
      const label = labelOf(node);
      const writable = isEditorDocumentFile(path);
      const changed = isTouched(node);
      const icon = writable ? (
        <AppIcon icon={ICON.document} size="sm" />
      ) : (
        <AppIcon icon={ICON.uploadedFile} size="sm" />
      );
      return (
        <div
          key={key}
          className={`doc-files-row${
            dragging &&
            dragging.kind === "document" &&
            dragging.slugPath === slugPath
              ? " doc-files-row--dragging"
              : ""
          }${menu && keyOf(menu.node) === key ? " doc-files-row--menu" : ""}`}
          {...dragProps(node)}
          onContextMenu={(event) => onRowMenu(event, node)}
        >
          {isRenaming ? (
            <span
              className="app-explorer-item doc-files-item doc-files-item--renaming"
              style={indent}
            >
              {icon}
              <InlineRename
                className="doc-files-rename"
                initial={label}
                onCommit={(typed) => commitRename(node, typed)}
                onCancel={() => setRenaming(null)}
              />
            </span>
          ) : (
            <button
              type="button"
              className={`app-explorer-item doc-files-item${
                on ? " app-explorer-item--active" : ""
              }${writable ? "" : " doc-files-item--file"}`}
              style={indent}
              aria-current={on ? "page" : undefined}
              data-parent={node.document.folder}
              title={`${
                writable
                  ? label
                  : `${label} — uploaded as a file, so it is edited in the program that made it`
              }${changed ? " · changed in this draft" : ""}`}
              onClick={(event) => {
                // Only a plain click opens a policy. A Mac's Control-click is
                // a right-click, and some browsers send it as a click too:
                // it opens the row's menu, never the policy under it.
                if (event.button !== 0 || event.ctrlKey) return;
                if (!on) openPolicy(slugPath);
                else setFloating(false);
              }}
              onDoubleClick={() => {
                // The open one: a second click names it, as in a file list.
                if (on && onRename && canAct(node)) setRenaming(key);
              }}
              onKeyDown={(event) => onRowKey(event, node)}
              onPointerEnter={
                writable && !on ? () => onReadAhead?.(slugPath) : undefined
              }
              onFocus={
                writable && !on ? () => onReadAhead?.(slugPath) : undefined
              }
            >
              {icon}
              <span className="app-explorer-name">{label}</span>
              {changed ? (
                <span className="doc-files-changed" aria-hidden="true" />
              ) : null}
              {(on && unsaved) || unsavedElsewhere?.has(slugPath) ? (
                <span
                  className="doc-files-unsaved"
                  role="img"
                  aria-label="Unsaved changes"
                  title="Unsaved changes"
                />
              ) : null}
            </button>
          )}
          {rowActions(node)}
        </div>
      );
    }

    const open = needle !== "" || isOpen(node.path);
    const label = labelOf(node);
    return (
      <div
        className={`app-explorer-group${
          over === node.path ? " doc-files-group--drop" : ""
        }`}
        key={key}
        {...dragProps(node)}
      >
        <div
          className={`doc-files-row${
            menu && keyOf(menu.node) === key ? " doc-files-row--menu" : ""
          }`}
          onContextMenu={(event) => onRowMenu(event, node)}
        >
          {isRenaming ? (
            <span
              className="app-explorer-folder doc-files-item--renaming"
              style={indent}
            >
              <AppIcon icon={ICON.folder} size="sm" />
              <InlineRename
                className="doc-files-rename"
                initial={label}
                onCommit={(typed) => commitRename(node, typed)}
                onCancel={() => setRenaming(null)}
              />
            </span>
          ) : (
            // **Explorer's left pane**: the arrow opens and shuts the folder
            // in place, the name opens it on the desk. The arrow is out of the
            // tab order — Right and Left do the same from the row.
            <span
              className={`doc-files-folderrow${
                node.path === activeFolder ? " doc-files-folderrow--active" : ""
              }`}
              style={indent}
            >
              <button
                type="button"
                className="app-explorer-chevron"
                tabIndex={-1}
                aria-label={open ? `Shut ${label}` : `Open ${label} here`}
                title={open ? `Shut ${label}` : `Open ${label} here`}
                onClick={() => toggleFolder(node.path)}
              >
                {open ? (
                  <AppIcon icon={ICON.chevronDown} size="sm" />
                ) : (
                  <AppIcon icon={ICON.chevronRight} size="sm" />
                )}
              </button>
              <button
                type="button"
                className="app-explorer-folder"
                aria-expanded={open}
                aria-current={node.path === activeFolder ? "page" : undefined}
                data-folder={node.path}
                data-parent={
                  node.path.includes("/")
                    ? node.path.slice(0, node.path.lastIndexOf("/"))
                    : ""
                }
                title={
                  isTouched(node)
                    ? `${label} · changed in this draft`
                    : undefined
                }
                onClick={(event) => {
                  if (event.button !== 0 || event.ctrlKey) return;
                  if (onOpenFolder) {
                    setFloating(false);
                    if (!open) toggleFolder(node.path);
                    onOpenFolder(node.path);
                  } else {
                    toggleFolder(node.path);
                  }
                }}
                onKeyDown={(event) => onRowKey(event, node)}
              >
                <AppIcon icon={ICON.folder} size="sm" />
                <span className="app-explorer-name">{label}</span>
                {isTouched(node) ? (
                  <span className="doc-files-changed" aria-hidden="true" />
                ) : null}
              </button>
            </span>
          )}
          {rowActions(node)}
        </div>
        {open
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  // The panel's right edge is a handle, as an IDE's sidebar is: drag it,
  // step it with the arrows, or double-click it back to where it began.
  const resizeHandle = (
    <div
      className={`doc-files-resize${resizing ? " doc-files-resize--active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the files panel"
      aria-valuenow={width}
      aria-valuemin={FILES_WIDTH_MIN}
      aria-valuemax={FILES_WIDTH_MAX}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeFrom.current = { x: event.clientX, width };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const from = resizeFrom.current;
        if (!from) return;
        setWidth(clampFilesWidth(from.width + event.clientX - from.x));
      }}
      onPointerUp={(event) => {
        if (!resizeFrom.current) return;
        resizeFrom.current = null;
        setResizing(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
        writeFilesWidth(width);
      }}
      onPointerCancel={() => {
        resizeFrom.current = null;
        setResizing(false);
        writeFilesWidth(width);
      }}
      onDoubleClick={() => resizeTo(FILES_WIDTH_DEFAULT)}
      onKeyDown={(event) => {
        const next = keyedFilesWidth(event.key, width);
        if (next === null) return;
        event.preventDefault();
        resizeTo(next);
      }}
    />
  );

  // Open, it floats over the desk as a card, clear of the ribbon above and
  // the status bar below, so the page keeps the whole width behind it.
  const panel = (
    <aside
      className="doc-files"
      aria-label={`Files in ${binderName}`}
      aria-busy={busy || undefined}
    >
      <div className="app-explorer-head">
        {outline ? (
          <div
            className="doc-files-tabs"
            role="tablist"
            aria-label="Show in the panel"
            onKeyDown={(event) => {
              // The arrows move between the two, as between any tabs.
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
                return;
              }
              event.preventDefault();
              const next = onOutline ? "files" : "outline";
              chooseTab(next);
              document.getElementById(`doc-files-tab-${next}`)?.focus();
            }}
          >
            {PANEL_TABS.map((each) => (
              <button
                key={each.id}
                type="button"
                role="tab"
                id={`doc-files-tab-${each.id}`}
                aria-selected={(each.id === "outline") === onOutline}
                aria-controls={`doc-files-panel-${each.id}`}
                tabIndex={(each.id === "outline") === onOutline ? 0 : -1}
                className={`doc-files-tab${
                  (each.id === "outline") === onOutline ? " is-on" : ""
                }`}
                onClick={() => chooseTab(each.id)}
              >
                {each.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="app-explorer-heading">Files</span>
        )}
        {startNew && !onOutline ? (
          <button
            type="button"
            className="app-explorer-toggle"
            aria-label="New document"
            title="New document"
            onClick={startNew}
          >
            <AppIcon icon={ICON.newDocument} size="md" />
          </button>
        ) : null}
        {onUpload && !onOutline ? (
          <button
            type="button"
            className="app-explorer-toggle"
            aria-label="Upload files"
            title="Upload files"
            disabled={busy}
            onClick={() => {
              setFloating(false);
              onUpload(here);
            }}
          >
            <AppIcon icon={ICON.upload} size="md" />
          </button>
        ) : null}
        {onNewFolder && !onOutline ? (
          <button
            type="button"
            className="app-explorer-toggle"
            aria-label="New folder"
            title="New folder"
            disabled={busy}
            onClick={() => {
              setFloating(false);
              onNewFolder(here || undefined);
            }}
          >
            <AppIcon icon={ICON.newFolder} size="md" />
          </button>
        ) : null}
        <button
          type="button"
          className="app-explorer-toggle"
          aria-expanded
          aria-label="Hide file explorer"
          title="Hide file explorer"
          onClick={toggle}
        >
          <AppIcon icon={ICON.hidePanel} size="md" />
        </button>
      </div>

      {onOutline && outline ? (
        <div
          className="doc-files-outline"
          role="tabpanel"
          id="doc-files-panel-outline"
          aria-labelledby="doc-files-tab-outline"
        >
          {outline.content}
        </div>
      ) : (
        <>
          <div className="app-explorer-filter">
            <input
              className="bs-input bs-input--sm"
              ref={filterRef}
              type="search"
              value={filter}
              placeholder="Go to file"
              aria-label={`Find a document in ${binderName}`}
              onChange={(event) => {
                setFilter(event.target.value);
                if (event.target.value.trim() !== "") openFolders(everyFolder);
              }}
              onKeyDown={(event) => {
                // VS Code's Go to File: Enter opens the first match, Down steps
                // into the matches, Escape clears what was typed.
                if (event.key === "Enter" && needle !== "") {
                  const first = firstDocument(shown);
                  if (!first) return;
                  event.preventDefault();
                  setFilter("");
                  if (first.slugPath !== active) openPolicy(first.slugPath);
                } else if (event.key === "ArrowDown") {
                  const row = treeRef.current?.querySelector<HTMLElement>(
                    "button.app-explorer-item, button.app-explorer-folder",
                  );
                  if (!row) return;
                  event.preventDefault();
                  row.focus();
                } else if (event.key === "Escape" && filter !== "") {
                  event.preventDefault();
                  event.stopPropagation();
                  setFilter("");
                }
              }}
            />
          </div>

          <div
            className={`app-explorer-tree${
              dragging === null && over === "" ? " doc-files-tree--drop" : ""
            }`}
            ref={treeRef}
            onKeyDown={onTreeKey}
            // Files from the computer dropped below the rows: the top level.
            onDragOver={(event) => {
              if (!onUploadDrop || dragging !== null) return;
              if (!carriesFiles(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setOver("");
            }}
            onDragLeave={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && event.currentTarget.contains(next)) {
                return;
              }
              if (dragging === null) setOver(null);
            }}
            onDrop={(event) => {
              if (!onUploadDrop || dragging !== null) return;
              if (!carriesFiles(event.dataTransfer)) return;
              event.preventDefault();
              setOver(null);
              onUploadDrop(event.dataTransfer, "");
            }}
            // Below the rows: the top level's menu. A row's own menu stops here.
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(TOP_LEVEL, event.clientX, event.clientY, null);
            }}
          >
            {shown.length === 0 ? (
              <p className="app-explorer-empty">
                {needle === ""
                  ? "Nothing filed yet."
                  : "No document matches that."}
              </p>
            ) : (
              shown.map((node) => renderNode(node, 0))
            )}

            {/* Out of a folder: the top level is otherwise no target at all. Only
            while something is in the air. */}
            {dragging !== null && acceptsDrop(dragging, "") ? (
              <div
                className={`doc-files-root-drop${
                  over === "" ? " doc-files-root-drop--over" : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOver("");
                }}
                onDragLeave={() => {
                  if (over === "") setOver(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragging) drop(dragging, "");
                }}
              >
                Drop here for the top level
              </div>
            ) : null}
          </div>

          {undo ? (
            <div className="doc-files-undo" role="status">
              <span>
                <strong>{undo.label}</strong>{" "}
                {undo.kind === "document" && undo.deleted
                  ? "deleted from this draft."
                  : "archived in this draft."}
              </span>
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn--quiet"
                disabled={busy}
                onClick={() => onUndo?.()}
              >
                Undo
              </button>
            </div>
          ) : null}

          {/* **The archive, at the foot of the files**, as on the binder's tree:
          what the draft or the record has taken off, and Restore — into this
          draft, as the binder's next version of it rather than a new v1. */}
          {archivedCount > 0 && onReadArchive ? (
            <div className="doc-files-archive">
              <button
                type="button"
                className="app-explorer-folder"
                aria-expanded={archiveOpen}
                onClick={() => setArchiveOpen((was) => !was)}
              >
                {archiveOpen ? (
                  <AppIcon icon={ICON.chevronDown} size="sm" />
                ) : (
                  <AppIcon icon={ICON.chevronRight} size="sm" />
                )}
                <AppIcon icon={ICON.archive} size="sm" />
                <span className="app-explorer-name">Archived</span>
                <span className="doc-files-archive-count">{archivedCount}</span>
              </button>
              {archiveOpen ? (
                archiveError ? (
                  <p className="app-explorer-empty">
                    Unable to read the archive.
                  </p>
                ) : archived === null ? (
                  <p className="app-explorer-empty">Reading the archive…</p>
                ) : (
                  archived.map((entry) => (
                    <div className="doc-files-row" key={entry.uid}>
                      <span
                        className="app-explorer-item doc-files-item doc-files-item--archived"
                        style={{ paddingLeft: "22px" }}
                        title={
                          entry.slugPath
                            ? `Was filed at ${entry.slugPath}`
                            : "Its folder is gone"
                        }
                      >
                        <AppIcon icon={ICON.document} size="sm" />
                        <span className="app-explorer-name">{entry.title}</span>
                      </span>
                      {onRestore ? (
                        <button
                          type="button"
                          className="bs-btn bs-btn--sm bs-btn--quiet doc-files-restore"
                          aria-label={`Restore ${entry.title}`}
                          title={`Restore as v${entry.lastVersion + 1}, in this draft`}
                          disabled={busy}
                          onClick={() => void restore(entry.uid)}
                        >
                          Restore
                        </button>
                      ) : null}
                    </div>
                  ))
                )
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {menu ? (
        <RowMenu
          x={menu.x}
          y={menu.y}
          label={`${
            menu.node.kind === "folder" && menu.node.path === ""
              ? binderName
              : labelOf(menu.node)
          }: actions`}
          items={menuItems(menu.node)}
          onClose={(acted) => {
            const from = menu.from;
            setMenu(null);
            if (!acted) from?.focus();
          }}
        />
      ) : null}

      {moving ? (
        <MoveToFolderModal
          subject={moving.subject}
          label={moving.label}
          folders={allFolders}
          onClose={() => setMoving(null)}
          onMove={(folder) => drop(moving.subject, folder)}
        />
      ) : null}
    </aside>
  );

  return (
    <div className="doc-files-anchor">
      <div className="doc-files-float" ref={floatRef} style={{ width }}>
        {panel}
        {resizeHandle}
      </div>
    </div>
  );
}

interface RowMenuItem {
  label: string;
  icon: IconGlyph;
  run: () => void;
  /** The key that does it without the menu, said at the end of the line. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  /** A rule above it, between one kind of act and the next. */
  separated?: boolean;
}

/**
 * A row's menu, where the pointer was — or under the row, from the keyboard.
 *
 * **The way a file explorer answers a right-click**, so the acts on a row are
 * where people look for them first, rather than only in icons that appear on
 * hover. Arrow keys move through it, Enter acts, Escape and a press anywhere
 * else close it, and it keeps inside the window.
 */
function RowMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: readonly RowMenuItem[];
  onClose: (acted: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  /**
   * Whether a press began on this menu since it opened. The menu opens under
   * the pointer, so the release of the button that opened it lands on an
   * item; some browsers send that release as a click, which would pick the
   * item — Open, switching policies — without anyone choosing it. An item
   * runs from a press of its own, or from the keyboard.
   */
  const pressed = useRef(false);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const margin = 8;
    setAt({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
    box
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return;
      }
      onClose(true);
    };
    // Only a scroll that carries the row away: the page beside the panel
    // scrolling (the editor bringing its cursor into view as it loses focus)
    // leaves the row, and the menu, where they were.
    const onScroll = (event: Event) => {
      const scrolled = event.target;
      const menu = ref.current;
      if (
        menu &&
        (scrolled === document ||
          (scrolled instanceof Node && scrolled.contains(menu)))
      ) {
        onClose(true);
      }
    };
    const onResize = () => onClose(true);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      onClose(false);
    }
  };

  return (
    <div
      ref={ref}
      className="doc-files-menu"
      role="menu"
      aria-label={label}
      style={{ left: at.left, top: at.top }}
      onPointerDown={(event) => {
        if (event.button === 0 && !event.ctrlKey) pressed.current = true;
      }}
      onKeyDown={onKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.label} role="none">
          {item.separated ? (
            <div className="doc-files-menu-sep" role="separator" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={`doc-files-menu-item${
              item.danger ? " doc-files-menu-item--danger" : ""
            }`}
            disabled={item.disabled}
            onClick={(event) => {
              // `detail` is 0 for Enter or Space: the keyboard's choice.
              if (event.detail !== 0 && !pressed.current) return;
              onClose(true);
              item.run();
            }}
          >
            <AppIcon icon={item.icon} size="sm" />
            <span>{item.label}</span>
            {item.hint ? (
              <kbd className="doc-files-menu-hint">{item.hint}</kbd>
            ) : null}
          </button>
        </div>
      ))}
    </div>
  );
}
