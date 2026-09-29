import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  FileText,
  Folder,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
import { isEditorDocumentFile } from "../binderDocument";
import {
  buildBinderTree,
  folderPaths,
  type BinderTreeNode,
} from "../binderTree";
import { formatDocumentName } from "../documentDisplay";
import { useOpenFolders } from "../useOpenFolders";
import { useRememberedToggle } from "../useRememberedToggle";

/**
 * The draft's files, inside the editor.
 *
 * **The editor is where a draft is written, so it is where the draft's files
 * are.** Leaving the editor to find the next policy, then pressing Edit on it,
 * made writing three policies six trips. Here a policy opens beside the one you
 * were in, in the same draft, and a new one starts from the same panel — Word's
 * Open and New, with GitLab's Web IDE's file tree as the shape.
 *
 * The same tree the binder's own page and the file panel build, from the same
 * `buildBinderTree`, read at the draft: a policy added a minute ago is here,
 * and one the draft renamed is under its new name. A Word file or a PDF is
 * listed — it is in the binder — but drawn as a file, not a page, because the
 * editor cannot open it.
 */

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
  onNew?: () => void;
}

const STORAGE_KEY = "bindersnap.editor.files.collapsed";

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
}: DraftFilesProps) {
  const { on: shut, toggle } = useRememberedToggle(STORAGE_KEY);
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

  if (shut) {
    return (
      <div className="doc-files doc-files--shut">
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
        {onNew ? (
          <button
            type="button"
            className="app-explorer-toggle"
            aria-label="New document"
            title="New document"
            onClick={onNew}
          >
            <FilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  const renderNode = (node: BinderTreeNode, depth: number) => {
    if (node.kind === "document") {
      const { slugPath, path, name } = node.document;
      const on = slugPath === active;
      const label = formatDocumentName(name);
      const writable = isEditorDocumentFile(path);
      return (
        <button
          key={slugPath}
          type="button"
          className={`app-explorer-item doc-files-item${
            on ? " app-explorer-item--active" : ""
          }${writable ? "" : " doc-files-item--file"}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          aria-current={on ? "page" : undefined}
          title={
            writable
              ? label
              : `${label} — uploaded as a file, so it is edited in the program that made it`
          }
          onClick={() => {
            if (!on) onOpen(slugPath);
          }}
        >
          {writable ? (
            <FileText size={14} strokeWidth={1.6} aria-hidden="true" />
          ) : (
            <File size={14} strokeWidth={1.6} aria-hidden="true" />
          )}
          <span className="app-explorer-name">{label}</span>
          {on && unsaved ? (
            <span
              className="doc-files-unsaved"
              role="img"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            />
          ) : null}
        </button>
      );
    }

    const open = needle !== "" || isOpen(node.path);
    return (
      <div className="app-explorer-group" key={`folder:${node.path}`}>
        <button
          type="button"
          className="app-explorer-folder"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          aria-expanded={open}
          onClick={() => toggleFolder(node.path)}
        >
          {open ? (
            <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
          )}
          <Folder size={14} strokeWidth={1.6} aria-hidden="true" />
          <span className="app-explorer-name">
            {formatDocumentName(node.name)}
          </span>
        </button>
        {open
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  return (
    <aside className="doc-files" aria-label={`Files in ${binderName}`}>
      <div className="app-explorer-head">
        <span className="app-explorer-heading">Files</span>
        {onNew ? (
          <button
            type="button"
            className="app-explorer-toggle"
            aria-label="New document"
            title="New document"
            onClick={onNew}
          >
            <FilePlus size={15} strokeWidth={1.75} aria-hidden="true" />
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
      </div>
    </aside>
  );
}
