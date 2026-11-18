import { AppIcon, ICON } from "./AppIcon";

import { followInApp } from "../appLink";
import type { BinderTreeFolder, BinderTreeNode } from "../binderTree";
import { isEditorDocumentFile } from "../binderDocument";
import { formatDocumentName } from "../documentDisplay";
import { describeFileKind, fileExtension } from "../documentFile";

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
 * **Shut by default, and opening is remembered.** A binder of forty policies
 * in eight departments arrived as a wall of all forty when every folder
 * started open, which is not what a filing cabinet looks like. A reader opens
 * the drawer they want, and finds it open when they come back — and the
 * folders holding the policy on screen are opened for them, so the tree always
 * contains the thing being read. See `useOpenFolders`.
 *
 * Rendering only: which folders are open, and what a click means, belong to
 * whatever is showing the tree. That is what lets edit mode reuse this without
 * a second copy of the drawing.
 */

export interface BinderTreeViewProps {
  nodes: readonly BinderTreeNode[];
  /**
   * Whether a folder is open, asked per row.
   *
   * A question rather than a set, because a filtered tree answers "yes" to
   * every folder without having to name them: a filter that found a policy
   * inside a shut folder has found nothing anybody can see.
   */
  isFolderOpen: (path: string) => boolean;
  onToggleFolder: (path: string) => void;
  /**
   * Open a folder's page. With it, a folder row is two controls, as in
   * Explorer: the arrow opens and shuts it in place, the name opens its page.
   */
  onOpenFolder?: (path: string) => void;
  /** A folder's address, so its name is a real link. */
  folderHref?: (path: string) => string;
  onOpenDocument: (slugPath: string) => void;
  /**
   * A document's address, so its row is a link.
   *
   * Optional only so a tree drawn somewhere that has no address to give still
   * draws. Every tree that opens a page passes one: a policy manager comparing
   * two policies opens the second in a tab.
   */
  documentHref?: (slugPath: string) => string;
  /** Marked as where you are — the document open under this binder. */
  activeDocument?: string | null;
  /** Drawn on every row, to the right of the name. Edit mode fills this in. */
  renderRowActions?: (node: BinderTreeNode) => React.ReactNode;
  /**
   * Drawn instead of the row's name **and instead of its click target**, when
   * it answers with anything but null.
   *
   * Both, deliberately. Inline rename puts a text input where the name is, and
   * an input inside a button is a control you cannot click into — every
   * keystroke would open the document or shut the folder. So a row that
   * answers here stops being a button for as long as it does, and the caller
   * owns what happens in it. Same principle as {@link renderRowActions}: the
   * tree draws, and whoever is showing it decides what a row means.
   */
  renderRowLabel?: (node: BinderTreeNode) => React.ReactNode | null;
  /**
   * Extra attributes for a row's own box — `draggable`, the drag handlers, and
   * a class while it is a drop target.
   *
   * **The tree still does not know what a drag is**, which is the point. It
   * knows a row is a box that can carry attributes; whether dropping a policy
   * on a folder files it there, and whether this particular drop is allowed,
   * are questions about the binder and belong to whoever is showing the tree.
   * Same contract as the two slots above.
   */
  rowProps?: (node: BinderTreeNode) => BinderTreeRowProps | undefined;
  /**
   * What a document row says to the right of its name — the change that last
   * touched it, and when.
   *
   * **Beside the row's button, not inside it**, because it links somewhere
   * else: a link inside a button is a control that cannot be pressed on its
   * own.
   */
  renderDocumentAside?: (node: BinderTreeNode) => React.ReactNode;
}

/**
 * What a row will accept on its outer box.
 *
 * Narrow on purpose. A row is not an arbitrary element somebody can put
 * anything on: it is a tree row, and the only thing outside the tree that has
 * a legitimate opinion about it is what happens when something is dragged onto
 * it. `className` is appended to the row's own rather than replacing it.
 */
export interface BinderTreeRowProps {
  className?: string;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
}

/** How far one level is indented, in pixels. */
const INDENT = 20;

export function BinderTreeView({
  nodes,
  isFolderOpen,
  onToggleFolder,
  onOpenFolder,
  folderHref,
  onOpenDocument,
  documentHref,
  activeDocument = null,
  renderRowActions,
  renderRowLabel,
  rowProps,
  renderDocumentAside,
}: BinderTreeViewProps) {
  return (
    <div className="binder-tree">
      {nodes.map((node) => (
        <TreeRow
          key={node.kind === "folder" ? `f:${node.path}` : node.document.path}
          node={node}
          depth={0}
          isFolderOpen={isFolderOpen}
          onToggleFolder={onToggleFolder}
          onOpenFolder={onOpenFolder}
          folderHref={folderHref}
          onOpenDocument={onOpenDocument}
          documentHref={documentHref}
          activeDocument={activeDocument}
          renderRowActions={renderRowActions}
          renderRowLabel={renderRowLabel}
          rowProps={rowProps}
          renderDocumentAside={renderDocumentAside}
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
  isFolderOpen,
  onToggleFolder,
  onOpenFolder,
  folderHref,
  renderRowActions,
  renderRowLabel,
  rowProps,
  ...rest
}: Omit<TreeRowProps, "node"> & { folder: BinderTreeFolder }) {
  const isOpen = isFolderOpen(folder.path);
  const instead = renderRowLabel?.(folder) ?? null;
  const { className: extra, ...dragProps } = rowProps?.(folder) ?? {};

  const icon = (
    <span className="binder-tree-icon" aria-hidden="true">
      <AppIcon icon={ICON.folder} size="md" />
    </span>
  );

  return (
    <>
      <div
        className={`binder-tree-row binder-tree-row--folder${
          extra ? ` ${extra}` : ""
        }`}
        style={{ paddingLeft: depth * INDENT }}
        {...dragProps}
      >
        {instead ? (
          <div className="binder-tree-main binder-tree-main--inert">
            {/* The twisty goes while a name is being typed: collapsing is not
                what the triangle means to somebody mid-rename, and the blank
                keeps the left edge straight. */}
            <span className="binder-tree-twisty" aria-hidden="true" />
            {icon}
            {instead}
          </div>
        ) : onOpenFolder ? (
          <div className="binder-tree-main binder-tree-main--split">
            <button
              type="button"
              className="binder-tree-twisty binder-tree-twistybtn"
              onClick={() => onToggleFolder(folder.path)}
              aria-expanded={isOpen}
              aria-label={
                isOpen
                  ? `Shut ${formatDocumentName(folder.name)}`
                  : `Open ${formatDocumentName(folder.name)} here`
              }
            >
              {isOpen ? (
                <AppIcon icon={ICON.chevronDown} size="sm" />
              ) : (
                <AppIcon icon={ICON.chevronRight} size="sm" />
              )}
            </button>
            <a
              className="binder-tree-folderlink"
              href={folderHref?.(folder.path) ?? "#"}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey
                ) {
                  return;
                }
                event.preventDefault();
                onOpenFolder(folder.path);
              }}
            >
              {icon}
              <span className="binder-tree-label">
                {formatDocumentName(folder.name)}
              </span>
              <span className="binder-tree-count">
                {folder.documentCount === 1
                  ? "1 document"
                  : `${folder.documentCount} documents`}
              </span>
            </a>
          </div>
        ) : (
          <button
            type="button"
            className="binder-tree-main"
            onClick={() => onToggleFolder(folder.path)}
            aria-expanded={isOpen}
          >
            <span className="binder-tree-twisty" aria-hidden="true">
              {isOpen ? (
                <AppIcon icon={ICON.chevronDown} size="sm" />
              ) : (
                <AppIcon icon={ICON.chevronRight} size="sm" />
              )}
            </span>
            {icon}
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
                ? "1 document"
                : `${folder.documentCount} documents`}
            </span>
          </button>
        )}

        {renderRowActions ? (
          <span className="bs-rowacts binder-tree-actions">
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
              isFolderOpen={isFolderOpen}
              onToggleFolder={onToggleFolder}
              onOpenFolder={onOpenFolder}
              folderHref={folderHref}
              renderRowActions={renderRowActions}
              renderRowLabel={renderRowLabel}
              rowProps={rowProps}
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
  documentHref,
  activeDocument,
  renderRowActions,
  renderRowLabel,
  rowProps,
  renderDocumentAside,
}: Omit<TreeRowProps, "node"> & { node: BinderTreeNode }) {
  if (node.kind !== "document") return null;
  const { document } = node;
  const isActive = activeDocument === document.slugPath;
  const instead = renderRowLabel?.(node) ?? null;
  const { className: extra, ...dragProps } = rowProps?.(node) ?? {};
  const written = isEditorDocumentFile(document.path);

  /* A document has nothing to twist open, but it lines up with the folders
     above it — a ragged left edge is what makes a tree read as a list of
     unrelated things. */
  const lead = (
    <>
      <span className="binder-tree-twisty" aria-hidden="true" />
      <span className="binder-tree-icon" aria-hidden="true">
        <AppIcon icon={written ? ICON.document : ICON.uploadedFile} size="md" />
      </span>
    </>
  );
  /* **A file says what it is.** One written here opens in the editor; a Word
     file or a PDF opens in the program that made it, and "PDF" tells this
     reader that faster than any picture can. It is kept out of the row's
     accessible name, which stays the document's name alone. */
  const format = written ? null : (
    <span
      className="binder-tree-format"
      title={describeFileKind(document.path)}
      aria-hidden="true"
    >
      {fileExtension(document.path).toUpperCase() || "FILE"}
    </span>
  );

  return (
    <div
      className={`binder-tree-row${isActive ? " binder-tree-row--active" : ""}${
        extra ? ` ${extra}` : ""
      }`}
      style={{ paddingLeft: depth * INDENT }}
      {...dragProps}
    >
      {instead ? (
        <div className="binder-tree-main binder-tree-main--inert">
          {lead}
          {instead}
        </div>
      ) : documentHref ? (
        <a
          className="binder-tree-main"
          href={documentHref(document.slugPath)}
          onClick={(event) =>
            followInApp(event, () => onOpenDocument(document.slugPath))
          }
          aria-current={isActive ? "page" : undefined}
          // **The row drags, not the link.** In edit mode the row is what is
          // picked up and dropped on a folder; a link left draggable would
          // start a drag of its own URL instead.
          draggable={dragProps.draggable ? false : undefined}
        >
          {lead}
          <span className="binder-tree-label">
            {formatDocumentName(document.name)}
          </span>
          {format}
        </a>
      ) : (
        <button
          type="button"
          className="binder-tree-main"
          onClick={() => onOpenDocument(document.slugPath)}
          aria-current={isActive ? "page" : undefined}
        >
          {lead}
          <span className="binder-tree-label">
            {formatDocumentName(document.name)}
          </span>
          {format}
        </button>
      )}

      {instead || !renderDocumentAside ? null : renderDocumentAside(node)}

      {renderRowActions ? (
        <span className="bs-rowacts binder-tree-actions">
          {renderRowActions(node)}
        </span>
      ) : null}
    </div>
  );
}
