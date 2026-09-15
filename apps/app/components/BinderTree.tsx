import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";

import type { BinderTreeFolder, BinderTreeNode } from "../binderTree";
import { formatDocumentName } from "../documentDisplay";

/**
 * The binder's contents, drawn the way a file explorer draws a folder.
 *
 * **Why a tree and not headings.** Folders nest in a binder — a document's
 * address is a path and always has been — but the list grouped by folder and
 * printed the whole path as a heading, so `nursing/infection` sat beside
 * `nursing` with nothing saying one was inside the other. At two policies that
 * is a cosmetic complaint. At two hundred it is the difference between a
 * filing system and a list of strings.
 *
 * **Open by default, and collapsing is remembered.** The old comment on this
 * list was right about the reason — a policy manual is read by looking, and a
 * surveyor asking for the infection control policy should see it without
 * opening anything — so nothing starts shut. What changes is that a person
 * with twelve departments can now shut the eleven they are not working in, and
 * find them shut when they come back.
 *
 * Rendering only: which folders are open, and what a click means, belong to
 * whatever is showing the tree. That is what lets edit mode reuse this without
 * a second copy of the drawing.
 */

export interface BinderTreeViewProps {
  nodes: readonly BinderTreeNode[];
  /** Folder paths that are shut. Absent means open, so a new folder is open. */
  collapsed: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onOpenDocument: (slugPath: string) => void;
  /** Marked as where you are — the document open under this binder. */
  activeDocument?: string | null;
  /** Drawn on every row, to the right of the name. Edit mode fills this in. */
  renderRowActions?: (node: BinderTreeNode) => React.ReactNode;
  /** What a document row says under its name. */
  describeDocument: (node: BinderTreeNode) => string;
}

/** How far one level is indented, in pixels. */
const INDENT = 20;

export function BinderTreeView({
  nodes,
  collapsed,
  onToggleFolder,
  onOpenDocument,
  activeDocument = null,
  renderRowActions,
  describeDocument,
}: BinderTreeViewProps) {
  return (
    <div className="binder-tree">
      {nodes.map((node) => (
        <TreeRow
          key={node.kind === "folder" ? `f:${node.path}` : node.document.path}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggleFolder={onToggleFolder}
          onOpenDocument={onOpenDocument}
          activeDocument={activeDocument}
          renderRowActions={renderRowActions}
          describeDocument={describeDocument}
        />
      ))}
    </div>
  );
}

interface TreeRowProps extends Omit<BinderTreeViewProps, "nodes"> {
  node: BinderTreeNode;
  depth: number;
}

function TreeRow({ node, depth, ...rest }: TreeRowProps) {
  return node.kind === "folder" ? (
    <FolderRow folder={node} depth={depth} {...rest} />
  ) : (
    <DocumentRow node={node} depth={depth} {...rest} />
  );
}

function FolderRow({
  folder,
  depth,
  collapsed,
  onToggleFolder,
  renderRowActions,
  ...rest
}: Omit<TreeRowProps, "node"> & { folder: BinderTreeFolder }) {
  const isOpen = !collapsed.has(folder.path);

  return (
    <>
      <div
        className="binder-tree-row binder-tree-row--folder"
        style={{ paddingLeft: depth * INDENT }}
      >
        <button
          type="button"
          className="binder-tree-main"
          onClick={() => onToggleFolder(folder.path)}
          aria-expanded={isOpen}
        >
          <span className="binder-tree-twisty" aria-hidden="true">
            {isOpen ? (
              <ChevronDown size={14} strokeWidth={1.6} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.6} />
            )}
          </span>
          <span className="binder-tree-icon" aria-hidden="true">
            <Folder size={16} strokeWidth={1.4} />
          </span>
          {/* Titled the way a document is, not left as the slug the binder
              stores. Somebody typed "Estates and Facilities"; showing them
              `estates-and-facilities` is the storage format leaking into the
              page, and it reads as a different kind of thing from the
              documents underneath it. */}
          <span className="binder-tree-label">
            {formatDocumentName(folder.name)}
          </span>
          {/* What a shut folder is hiding, counted all the way down — a
              collapsed folder saying nothing is a folder nobody opens. */}
          <span className="binder-tree-count">
            {folder.documentCount === 1
              ? "1 policy"
              : `${folder.documentCount} policies`}
          </span>
        </button>

        {renderRowActions ? (
          <span className="binder-tree-actions">
            {renderRowActions(folder)}
          </span>
        ) : null}
      </div>

      {isOpen
        ? folder.children.map((child) => (
            <TreeRow
              key={
                child.kind === "folder"
                  ? `f:${child.path}`
                  : child.document.path
              }
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggleFolder={onToggleFolder}
              renderRowActions={renderRowActions}
              {...rest}
            />
          ))
        : null}
    </>
  );
}

function DocumentRow({
  node,
  depth,
  onOpenDocument,
  activeDocument,
  renderRowActions,
  describeDocument,
}: Omit<TreeRowProps, "node"> & { node: BinderTreeNode }) {
  if (node.kind !== "document") return null;
  const { document } = node;
  const isActive = activeDocument === document.slugPath;

  return (
    <div
      className={`binder-tree-row${isActive ? " binder-tree-row--active" : ""}`}
      style={{ paddingLeft: depth * INDENT }}
    >
      <button
        type="button"
        className="binder-tree-main"
        onClick={() => onOpenDocument(document.slugPath)}
        aria-current={isActive ? "page" : undefined}
      >
        {/* A document has nothing to twist open, but it lines up with the
            folders above it — a ragged left edge is what makes a tree read as
            a list of unrelated things. */}
        <span className="binder-tree-twisty" aria-hidden="true" />
        <span className="binder-tree-icon" aria-hidden="true">
          <FileText size={16} strokeWidth={1.4} />
        </span>
        <span className="binder-tree-label">
          {formatDocumentName(document.name)}
        </span>
        <span className="binder-tree-meta">{describeDocument(node)}</span>
      </button>

      {renderRowActions ? (
        <span className="binder-tree-actions">{renderRowActions(node)}</span>
      ) : null}
    </div>
  );
}
