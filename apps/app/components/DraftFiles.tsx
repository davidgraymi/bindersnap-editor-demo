import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  type LucideIcon,
} from "lucide-react";

import type {
  BinderArchivePayload,
  WorkspaceDocumentListEntry,
} from "../../../packages/api-schema/schemas/workspaces";
import { isEditorDocumentFile } from "../binderDocument";
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
  onOpen: (slugPath: string) => void;
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
  /** Take a policy off the record, in this draft. */
  onArchive?: (slugPath: string) => Promise<boolean>;
  /**
   * What this binder has taken off the record, as the draft stands — the
   * count, the list when it is opened, and the way back. Restore goes into
   * the same draft, so an archiving done here a moment ago is undone by it.
   */
  archivedCount?: number;
  onReadArchive?: () => Promise<BinderArchivePayload["documents"]>;
  onRestore?: (uid: string) => Promise<boolean>;
  /** An act is being saved: nothing else starts until it lands. */
  busy?: boolean;
  /**
   * The files this draft has written — every act's paths. A row among them
   * carries a quiet mark, so what the draft has done is seen in the tree
   * rather than read in the draft bar, as an IDE marks a changed file.
   */
  touched?: readonly string[];
}

const STORAGE_KEY = "bindersnap.editor.files.collapsed";

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
  onOpen,
  onNew,
  onNewFolder,
  onRename,
  onMove,
  onArchive,
  archivedCount = 0,
  onReadArchive,
  onRestore,
  busy = false,
  touched = NOTHING,
}: DraftFilesProps) {
  const remembered = useRememberedToggle(STORAGE_KEY);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const [floating, setFloating] = useState(false);
  const floatRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  /** The row whose name is a text box, by {@link keyOf}. One at a time. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The row whose Move was pressed: the keyboard's way to refile. */
  const [moving, setMoving] = useState<{
    subject: DragSubject;
    label: string;
  } | null>(null);
  const [dragging, setDragging] = useState<DragSubject | null>(null);
  /** A row's menu, from a right-click or the keyboard's menu key. */
  /** The policy just archived here, and the way to take it back. */
  const [undo, setUndo] = useState<{ uid: string; label: string } | null>(null);
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
  // The Undo is for the act just done; a later act is a new "just now".
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [undo]);
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
  const openPolicy = (slugPath: string) => {
    setFloating(false);
    onOpen(slugPath);
  };
  const startNew = onNew
    ? () => {
        setFloating(false);
        onNew();
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

  const organizing = !!(onRename || onMove || onArchive);

  /**
   * Archive a row, and offer it back. **No "are you sure"**, as on the
   * binder's tree: it goes into the draft, which is undoable as a whole — and
   * here, straight away, by Undo.
   */
  const archiveRow = async (node: BinderTreeNode) => {
    if (!onArchive || node.kind !== "document") return;
    setUndo(null);
    const done = await onArchive(node.document.slugPath);
    if (done && node.document.uid && onRestore) {
      setUndo({ uid: node.document.uid, label: labelOf(node) });
    }
  };

  const restore = async (uid: string) => {
    if (!onRestore) return;
    setUndo(null);
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

  const rail = (
    <div className="doc-files doc-files--shut" ref={railRef}>
      <button
        type="button"
        className="app-explorer-toggle"
        aria-expanded={false}
        aria-label="Show the draft's files"
        title="Show the draft's files"
        onClick={toggle}
      >
        <PanelLeftOpen size={15} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {startNew ? (
        <button
          type="button"
          className="app-explorer-toggle"
          aria-label="New document"
          title="New document"
          onClick={startNew}
        >
          <FilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
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
          icon: FileText,
          run: () => openPolicy(node.document.slugPath),
        });
      }
    } else {
      if (onNew) {
        items.push({
          label: "New document here",
          icon: FilePlus,
          run: () => {
            setFloating(false);
            onNew(node.path);
          },
        });
      }
      if (onNewFolder) {
        items.push({
          label: "New folder here",
          icon: FolderPlus,
          disabled: busy,
          run: () => {
            setFloating(false);
            onNewFolder(node.path);
          },
        });
      }
    }
    if (onRename && isManaged(node)) {
      items.push({
        label: "Rename",
        hint: "F2",
        icon: Pencil,
        disabled: !acts,
        separated: items.length > 0,
        run: () => setRenaming(keyOf(node)),
      });
    }
    if (onMove && isManaged(node)) {
      items.push({
        label: "Move to…",
        icon: FolderInput,
        disabled: !acts,
        run: () => setMoving({ subject: subjectOf(node), label }),
      });
    }
    if (onArchive && node.kind === "document" && isManaged(node)) {
      items.push({
        label: "Archive",
        icon: Archive,
        danger: true,
        disabled: !acts,
        separated: true,
        run: () => void archiveRow(node),
      });
    }
    return items;
  };

  /**
   * The drag attributes for a row. Only a folder takes a drop — there is no
   * "inside" a policy — and the top level has its own zone below the tree.
   */
  const dragProps = (node: BinderTreeNode) => {
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

  /** Rename, Move and Archive, on the row they act on. */
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
            <Pencil size={13} strokeWidth={1.6} aria-hidden="true" />
          </button>
        ) : null}
        {onMove ? (
          <button
            type="button"
            className="bs-rowact"
            aria-label={`Move ${label}`}
            title="Move to a folder"
            disabled={busy}
            onClick={() => setMoving({ subject: subjectOf(node), label })}
          >
            <FolderInput size={13} strokeWidth={1.6} aria-hidden="true" />
          </button>
        ) : null}
        {/* A folder is emptied by moving what is in it, not archived whole. */}
        {onArchive && node.kind === "document" ? (
          <button
            type="button"
            className="bs-rowact bs-rowact--danger"
            aria-label={`Archive ${label}`}
            title="Archive — it leaves the binder when this draft is published"
            disabled={busy}
            onClick={() => void archiveRow(node)}
          >
            <Archive size={13} strokeWidth={1.6} aria-hidden="true" />
          </button>
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
        <FileText size={14} strokeWidth={1.6} aria-hidden="true" />
      ) : (
        <File size={14} strokeWidth={1.6} aria-hidden="true" />
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
              title={`${
                writable
                  ? label
                  : `${label} — uploaded as a file, so it is edited in the program that made it`
              }${changed ? " · changed in this draft" : ""}`}
              onClick={() => {
                if (!on) openPolicy(slugPath);
                else setFloating(false);
              }}
              onDoubleClick={() => {
                // The open one: a second click names it, as in a file list.
                if (on && onRename && canAct(node)) setRenaming(key);
              }}
              onKeyDown={(event) => onRowKey(event, node)}
            >
              {icon}
              <span className="app-explorer-name">{label}</span>
              {changed ? (
                <span className="doc-files-changed" aria-hidden="true" />
              ) : null}
              {on && unsaved ? (
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
              <Folder size={14} strokeWidth={1.6} aria-hidden="true" />
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
              className="app-explorer-folder"
              style={indent}
              aria-expanded={open}
              title={
                isTouched(node) ? `${label} · changed in this draft` : undefined
              }
              onClick={() => toggleFolder(node.path)}
              onKeyDown={(event) => onRowKey(event, node)}
            >
              {open ? (
                <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
              )}
              <Folder size={14} strokeWidth={1.6} aria-hidden="true" />
              <span className="app-explorer-name">{label}</span>
              {isTouched(node) ? (
                <span className="doc-files-changed" aria-hidden="true" />
              ) : null}
            </button>
          )}
          {rowActions(node)}
        </div>
        {open
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  const panel = (
    <aside
      ref={floatRef}
      className={`doc-files${narrow ? " doc-files--floating" : ""}`}
      aria-label={`Files in ${binderName}`}
      aria-busy={busy || undefined}
    >
      <div className="app-explorer-head">
        <span className="app-explorer-heading">
          {busy ? "Saving…" : "Files"}
        </span>
        {startNew ? (
          <button
            type="button"
            className="app-explorer-toggle"
            aria-label="New document"
            title="New document"
            onClick={startNew}
          >
            <FilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        {onNewFolder ? (
          <button
            type="button"
            className="app-explorer-toggle"
            aria-label="New folder"
            title="New folder"
            disabled={busy}
            onClick={() => {
              setFloating(false);
              onNewFolder();
            }}
          >
            <FolderPlus size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="app-explorer-toggle"
          aria-expanded
          aria-label="Hide the draft's files"
          title="Hide the draft's files"
          onClick={toggle}
        >
          <PanelLeftClose size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="app-explorer-filter">
        <input
          className="bs-input bs-input--sm"
          type="search"
          value={filter}
          placeholder="Go to file"
          aria-label={`Find a document in ${binderName}`}
          onChange={(event) => {
            setFilter(event.target.value);
            if (event.target.value.trim() !== "") openFolders(everyFolder);
          }}
        />
      </div>

      <div className="app-explorer-tree">
        {shown.length === 0 ? (
          <p className="app-explorer-empty">
            {needle === "" ? "Nothing filed yet." : "No document matches that."}
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
            <strong>{undo.label}</strong> archived in this draft.
          </span>
          <button
            type="button"
            className="bs-btn bs-btn--sm bs-btn--quiet"
            disabled={busy}
            onClick={() => void restore(undo.uid)}
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
              <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
            )}
            <Archive size={14} strokeWidth={1.6} aria-hidden="true" />
            <span className="app-explorer-name">Archived</span>
            <span className="doc-files-archive-count">{archivedCount}</span>
          </button>
          {archiveOpen ? (
            archiveError ? (
              <p className="app-explorer-empty">Unable to read the archive.</p>
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
                    <FileText size={14} strokeWidth={1.6} aria-hidden="true" />
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

      {menu ? (
        <RowMenu
          x={menu.x}
          y={menu.y}
          label={`${labelOf(menu.node)}: actions`}
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

  // Over the page, the rail stays where it was so the page does not move.
  if (narrow) {
    return (
      <>
        {rail}
        {panel}
      </>
    );
  }
  return panel;
}

interface RowMenuItem {
  label: string;
  icon: LucideIcon;
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

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const margin = 8;
    setAt({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
    box.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) {
        return;
      }
      onClose(true);
    };
    const onScroll = () => onClose(true);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
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
            onClick={() => {
              onClose(true);
              item.run();
            }}
          >
            <item.icon size={14} strokeWidth={1.6} aria-hidden="true" />
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
