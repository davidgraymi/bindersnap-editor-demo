import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FilePen,
  FileText,
  Folder,
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
import { currentRef, type ReadableRef } from "../documentRefs";
import { useOpenFolders } from "../useOpenFolders";
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
 *   departments is navigable rather than a wall. Shut is where a folder
 *   starts, open is remembered per binder, and the folders holding the policy
 *   on screen are opened for you — the same hook the binder's own tree uses.
 * - **Which version of the binder this is a view of**, at the top, where
 *   GitHub puts the same control. The rows below are addresses on one version
 *   — the record, or somebody's proposal — and a panel that does not say which
 *   is a panel you cannot trust. It replaced a warning strip over the page
 *   naming a branch, which said the same thing in git and offered no way out
 *   of it. See `documentRefs.ts`.
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
    isOpen,
    toggle: toggleFolder,
    open: openFolders,
    // The folders holding the policy on screen are open, whatever was shut:
    // a file explorer that does not contain the file you are reading is a
    // panel showing somebody else's binder.
  } = useOpenFolders(binder.org, binder.binder, contents.active);
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
          {/* **A folder looks like a folder.** Every row carried a glyph
              except this one, so a shut folder was a word with a triangle
              beside it and a policy was a word with a page beside it — the
              two kinds of row were told apart by a 13px triangle alone. The
              same icon the binder's own tree draws, because they are the same
              tree. */}
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

      {contents.reading && contents.reading.refs.length > 0 ? (
        <VersionPicker
          refs={contents.reading.refs}
          onPick={(picked) => {
            if (picked.current) return;
            onNavigate({
              kind: "binderDocument",
              org: binder.org,
              binder: binder.binder,
              // **By the address that carries the identity**, not the name on
              // screen. A change that renames this policy holds it under
              // another name, and a picker that could get you there but not
              // back is worse than no picker.
              documentPath: contents.reading!.address,
              ...(picked.ref ? { ref: picked.ref } : {}),
              ...(picked.change !== null ? { change: picked.change } : {}),
            });
          }}
        />
      ) : null}

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
            if (event.target.value.trim() !== "") openFolders(everyFolder);
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

/** How wide the menu is, and how much room it wants below its button. */
const MENU_WIDTH = 264;
const MENU_MAX_HEIGHT = 300;

/**
 * Which version of the binder the rows below are addresses on.
 *
 * **It floats rather than being laid out**, for the reason the draft picker
 * gives about panel corners: this panel scrolls, and a menu laid out inside a
 * scrolling box is a menu cut off at the fold.
 */
function VersionPicker({
  refs,
  onPick,
}: {
  refs: readonly ReadableRef[];
  onPick: (picked: ReadableRef) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const on = currentRef(refs);

  // Every other menu in the product closes on Escape and on a click
  // elsewhere, and one that only closes by its own button is a trap.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        boxRef.current &&
        !boxRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  /** Keep the menu on its button as the panel scrolls under it. */
  useEffect(() => {
    if (!open) return;

    const place = () => {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom;
      setAt({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top:
          below < MENU_MAX_HEIGHT && rect.top > below
            ? Math.max(8, rect.top - MENU_MAX_HEIGHT - 8)
            : rect.bottom + 6,
      });
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <div className="app-explorer-version" ref={boxRef}>
      <button
        type="button"
        ref={buttonRef}
        className="app-explorer-versionbtn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <RefIcon refOn={on} />
        <span className="app-explorer-versionname">{on.label}</span>
        <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {open && at ? (
        <div
          className="app-explorer-versionmenu"
          role="menu"
          style={{ left: at.left, top: at.top, width: MENU_WIDTH }}
        >
          {/* **Named for what it answers**, which is not "branch". A reader of
              a policy manual has no reason to know that a change request is a
              branch — that is a fact about where the record is kept. */}
          <p className="app-explorer-versionhead">What you are reading</p>
          {refs.map((entry) => (
            <button
              key={`${entry.change ?? "record"}:${entry.ref ?? ""}`}
              type="button"
              role="menuitem"
              className={`app-explorer-versionitem${
                entry.current ? " app-explorer-versionitem--on" : ""
              }`}
              onClick={() => {
                setOpen(false);
                onPick(entry);
              }}
            >
              <RefIcon refOn={entry} />
              <span className="app-explorer-versiontext">
                <span className="app-explorer-versionlabel">{entry.label}</span>
                <span className="app-explorer-versiondetail">
                  {entry.detail}
                </span>
              </span>
              {entry.current ? (
                <Check size={14} strokeWidth={2} aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The record, or a proposal — the two glyphs a change row already uses.
 *
 * Borrowed deliberately: somebody who has read the change list has been
 * taught that a tick is on the record and a document-with-a-pen is something
 * still being proposed, and teaching it twice with two sets of icons is how a
 * product stops meaning anything.
 */
function RefIcon({ refOn }: { refOn: ReadableRef }) {
  return refOn.ref === null && refOn.change === null ? (
    <CircleCheck
      className="app-explorer-versionicon app-explorer-versionicon--record"
      size={14}
      strokeWidth={1.6}
      aria-hidden="true"
    />
  ) : (
    <FilePen
      className="app-explorer-versionicon"
      size={14}
      strokeWidth={1.6}
      aria-hidden="true"
    />
  );
}
