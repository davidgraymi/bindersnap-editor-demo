import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import type { AppRoute } from "../routes";
import {
  buildBinderTree,
  folderPaths,
  type BinderTreeNode,
} from "../binderTree";
import { formatDocumentName } from "../documentDisplay";
import { useCollapsedFolders } from "../useCollapsedFolders";
import { useRememberedToggle } from "../useRememberedToggle";
import type { SidebarBinder, SidebarBinderContents } from "./AppSidebar";

/**
 * The binder's files, in a panel of their own beside what you are reading.
 *
 * **It was inside the product's navigation and should not have been.** The
 * customer: *"Move the file explorer out of the side navigation bar into its
 * own side navigation bar exactly like GitHub's."* They are two different
 * questions — the map of the product barely changes, and a binder's contents
 * change every time you open a different binder — and one panel answering both
 * made the map look unstable and the contents look like navigation chrome.
 *
 * Four things make it a file explorer rather than a list, and all four come
 * from the reference the customer pointed at:
 *
 * - **Folders open and shut**, so a binder with forty policies in eight
 *   departments is navigable rather than a wall. Shut is remembered per
 *   binder, by the same hook the binder's own tree uses.
 * - **A filter**, because past a certain size finding a policy by eye is
 *   slower than typing three letters of its name.
 * - **The panel itself shuts**, for the reader who wants the page and not the
 *   map — and leaves a rail behind, because a panel that vanishes completely
 *   is a feature nobody finds again.
 * - **The same tree the binder's own page builds**, via `buildBinderTree`.
 *   Two tree builders would disagree about nesting within a month.
 */

interface BinderExplorerProps {
  binder: SidebarBinder & { contents: SidebarBinderContents };
  onNavigate: (route: AppRoute) => void;
}

const STORAGE_KEY = "bindersnap.explorer.collapsed";

export function BinderExplorer({ binder, onNavigate }: BinderExplorerProps) {
  const { contents } = binder;
  const { on: shut, toggle } = useRememberedToggle(STORAGE_KEY);
  const {
    collapsed,
    toggle: toggleFolder,
    reveal,
  } = useCollapsedFolders(binder.org, binder.binder);
  const [filter, setFilter] = useState("");

  const tree = useMemo(
    () => buildBinderTree(contents.documents, [...contents.folders]),
    [contents.documents, contents.folders],
  );

  /**
   * The tree, cut to the policies whose names match.
   *
   * Built from the matches alone, so a folder with nothing matching in it is
   * not drawn — and every folder on the way to a match is open, whatever was
   * shut, because a filter that finds a policy inside a shut folder has found
   * nothing anybody can see.
   */
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (needle === "") return tree;
    return buildBinderTree(
      contents.documents.filter((document) =>
        formatDocumentName(document.name).toLowerCase().includes(needle),
      ),
      [],
    );
  }, [contents.documents, needle, tree]);

  const everyFolder = useMemo(() => folderPaths(shown), [shown]);

  if (shut) {
    // A rail rather than nothing: a panel that disappears completely is a
    // feature nobody finds again.
    return (
      <div className="app-explorer app-explorer--shut">
        <button
          type="button"
          className="app-explorer-toggle"
          aria-expanded={false}
          aria-label="Show the files"
          title="Show the files"
          onClick={toggle}
        >
          <PanelLeftOpen size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const openDocument = (slugPath: string) =>
    onNavigate({
      kind: "binderDocument",
      org: binder.org,
      binder: binder.binder,
      documentPath: slugPath,
      // Clicking through a branch's tree stays on that branch: these
      // addresses are the branch's, and following one to `main` would be
      // following a policy to a name it does not have there.
      ...(contents.ref ? { ref: contents.ref } : {}),
      ...(contents.change ? { change: contents.change } : {}),
    });

  const renderNode = (node: BinderTreeNode, depth: number) => {
    if (node.kind === "document") {
      const on = node.document.slugPath === contents.active;
      const label = formatDocumentName(node.document.name);

      return (
        <button
          key={node.document.slugPath}
          type="button"
          className={`app-explorer-item${on ? " app-explorer-item--active" : ""}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          aria-current={on ? "page" : undefined}
          title={label}
          onClick={() => openDocument(node.document.slugPath)}
        >
          <FileText size={14} strokeWidth={1.6} aria-hidden="true" />
          <span className="app-explorer-name">{label}</span>
        </button>
      );
    }

    // A filter that found something inside a shut folder has found nothing
    // anybody can see, so a filtered tree is open whatever was shut.
    const open = needle !== "" || !collapsed.has(node.path);

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
          {formatDocumentName(node.name)}
        </button>
        {open
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  return (
    <aside className="app-explorer" aria-label={`Files in ${binder.name}`}>
      <div className="app-explorer-head">
        <span className="app-explorer-heading">Files</span>
        <button
          type="button"
          className="app-explorer-toggle"
          aria-expanded
          aria-label="Hide the files"
          title="Hide the files"
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
          aria-label={`Find a policy in ${binder.name}`}
          onChange={(event) => {
            setFilter(event.target.value);
            // Opening the folders a match is in survives clearing the filter,
            // which is what somebody who just found a policy wants.
            if (event.target.value.trim() !== "") reveal(everyFolder);
          }}
        />
      </div>

      <div className="app-explorer-tree">
        {shown.length === 0 ? (
          <p className="app-explorer-empty">
            {needle === "" ? "Nothing filed yet." : "No policy matches that."}
          </p>
        ) : (
          shown.map((node) => renderNode(node, 0))
        )}
      </div>
    </aside>
  );
}
