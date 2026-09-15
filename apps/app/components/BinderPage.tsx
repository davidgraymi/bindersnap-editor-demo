import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useIsReadOnly } from "../readOnlyContext";

import {
  fetchBinderDocuments,
  renameBinderDocument,
  renameBinderFolder,
} from "../api";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
import { buildBinderTree, type BinderTreeNode } from "../binderTree";
import { formatDocumentName } from "../documentDisplay";
import { useCollapsedFolders } from "../useCollapsedFolders";
import { BinderTreeView } from "./BinderTree";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * ADR 0004's second and third levels made visible: a binder holds documents,
 * and folders are how you find them.
 */

interface BinderDocumentsProps {
  org: string;
  binder: string;
  onOpenDocument: (documentPath: string) => void;
  /** The document open under this binder, so the tree can mark where you are. */
  activeDocument?: string | null;
  /**
   * The draft this binder is being edited in, or null when it is not.
   *
   * Two things at once, and deliberately one prop. It is the branch every act
   * commits to, and it is the answer to "is this page editable" — a tree that
   * offered a pencil without somewhere to put the rename would be a button
   * that fails.
   */
  draft?: string | null;
  /** Bumped by the shell to re-read the binder — after a policy is added to the draft, say. */
  reloadKey?: number;
  /** An act landed in the draft, so whoever is counting them should recount. */
  onEdited?: () => void;
  /**
   * The draft named here is gone — discarded in another tab, or proposed.
   *
   * The shell drops out of edit mode on this rather than the page trying to
   * recover: what to do about it is a question about the whole binder, and
   * this list is not the thing that knows the answer.
   */
  onDraftLost?: () => void;
}

/** "Version 3 · 1 open change", or what is true of it so far. */
export function describeDocument(document: WorkspaceDocumentListEntry): string {
  const parts: string[] = [];

  // Every row here is on `main`, so there is no "waiting on a decision" case
  // left to word: a binder lists the record. A document on the record with no
  // tag is a real state — filed before versioning, or published by a change
  // that wrote none — and it is said plainly rather than guessed at.
  parts.push(
    document.latestVersion
      ? `Version ${document.latestVersion.version}`
      : "No published version",
  );

  if (document.openChangeCount > 0) {
    parts.push(
      document.openChangeCount === 1
        ? "1 open change"
        : `${document.openChangeCount} open changes`,
    );
  }

  return parts.join(" · ");
}

/**
 * Which row has turned into a text box. One at a time, the way Finder does it.
 *
 * `label` is the name **as the row shows it** — "Hand Hygiene", not
 * `hand-hygiene`. It is what the box starts with and what "did this actually
 * change" is measured against, and using the stored slug for either would put
 * the storage format in front of somebody and then treat every untouched
 * rename as a real one.
 */
type Renaming =
  | { kind: "folder"; path: string; label: string }
  | { kind: "document"; slugPath: string; label: string };

/**
 * The binder's documents: the tab a binder opens on, and its reason to exist.
 *
 * A tree rather than a flat list of headings, because folders nest and the
 * headings pretended they did not — `nursing/infection` sat beside `nursing`
 * with nothing saying one was inside the other. Nothing starts shut, for the
 * reason the old list gave and which still holds: a policy manual is read by
 * looking, not by navigating, and a surveyor asking for the infection control
 * policy should see it without opening anything.
 *
 * **In edit mode it is read from the draft, not from `main`.** Every act goes
 * to the branch, so a list read from the record would show the folder you have
 * not made and the name you have just changed away from — three renames in a
 * row would all appear to snap back.
 */
export function BinderDocuments({
  org,
  binder,
  onOpenDocument,
  activeDocument = null,
  draft = null,
  reloadKey = 0,
  onEdited,
  onDraftLost,
}: BinderDocumentsProps) {
  const isReadOnly = useIsReadOnly();
  const [documents, setDocuments] = useState<
    WorkspaceDocumentListEntry[] | null
  >(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const { collapsed, toggle } = useCollapsedFolders(org, binder);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);

    fetchBinderDocuments(org, binder, draft ?? undefined)
      .then((payload) => {
        if (cancelled) return;
        setDocuments(payload.documents);
        // **Folders from the binder, not from the documents.** A folder with
        // nothing filed in it holds a `.gitkeep` and no document, so deriving
        // the list from the rows would hide one somebody made, had approved
        // and had published.
        setFolders(payload.folders);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A draft that is not there any more — discarded in another tab, or
        // already proposed — is the one failure this page can do something
        // about, and what it does is stop pretending to be in edit mode.
        if (draft) {
          onDraftLost?.();
          return;
        }
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to open this binder.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder, draft, reloadKey, onDraftLost]);

  useEffect(() => {
    setDocuments(null);
    return load();
  }, [load]);

  // Leaving edit mode ends any rename in progress. The input has nowhere to
  // commit to once the draft is gone, and leaving it on screen would offer a
  // rename that silently does nothing.
  useEffect(() => {
    if (!draft) setRenaming(null);
  }, [draft]);

  const tree = useMemo(
    () => (documents ? buildBinderTree(documents, folders) : []),
    [documents, folders],
  );

  /**
   * Commit a rename into the draft, then re-read the binder from it.
   *
   * Continuous save: there is no Save button and the act is committed the
   * moment the input is left. The reload is not optional — the server
   * normalises what was typed into a path segment, and the row has to end up
   * saying what was actually written rather than what was asked for.
   */
  const commitRename = async (target: Renaming, typed: string) => {
    const next = typed.trim();
    setRenaming(null);
    if (!draft || next === "" || next === target.label) return;

    setCommitting(true);
    setActError(null);

    try {
      if (target.kind === "folder") {
        // A folder's new address is its parent plus the new name: renaming and
        // moving are one act on the server, and a rename is the case where the
        // parent does not change.
        const cut = target.path.lastIndexOf("/");
        const parent = cut === -1 ? "" : target.path.slice(0, cut);
        await renameBinderFolder(
          org,
          binder,
          target.path,
          parent === "" ? next : `${parent}/${next}`,
          { draft },
        );
      } else {
        await renameBinderDocument(
          org,
          binder,
          target.slugPath,
          { name: next },
          { draft },
        );
      }
      onEdited?.();
      load();
    } catch (err) {
      setActError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to rename that.",
      );
    } finally {
      setCommitting(false);
    }
  };

  if (error) {
    return <p className="app-inline-error">{error}</p>;
  }

  if (documents === null) {
    return (
      <div className="binder-pane">
        <SkeletonGroup label="Opening this binder">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              className="docs-list-item docs-list-item--skeleton"
              key={index}
            >
              <span className="docs-list-item-icon" />
              <span className="bs-skeleton-lines">
                <SkeletonLine width="medium" />
                <SkeletonLine width="short" />
              </span>
            </div>
          ))}
        </SkeletonGroup>
      </div>
    );
  }

  return (
    <div className="binder-pane">
      {actError ? (
        <p className="app-inline-error" role="alert">
          {actError}
        </p>
      ) : null}

      {tree.length === 0 ? (
        // Not an error, and not a failure of theirs: a binder somebody just
        // made is empty, which is the ordinary first state.
        //
        // A read-only organization is told what is here, not what to do next:
        // the sentence names an action whose control has just been taken
        // away, and pointing at a button that is not on the page is worse
        // than saying less.
        <p style={{ color: "var(--bs-text-muted)" }}>
          {isReadOnly
            ? "Nothing filed here yet."
            : draft
              ? "Nothing filed here yet. Make a folder or add a policy — it goes into your draft."
              : "Nothing filed here yet. A policy joins this binder once its change request is published."}
        </p>
      ) : (
        <BinderTreeView
          nodes={tree}
          collapsed={collapsed}
          onToggleFolder={toggle}
          onOpenDocument={onOpenDocument}
          activeDocument={activeDocument}
          describeDocument={describeTreeDocument}
          {...(draft
            ? {
                renderRowLabel: (node: BinderTreeNode) => {
                  if (!isRenaming(renaming, node)) return null;
                  const target = renaming!;
                  return (
                    <InlineRename
                      initial={target.label}
                      onCommit={(typed) => void commitRename(target, typed)}
                      onCancel={() => setRenaming(null)}
                    />
                  );
                },
                renderRowActions: (node: BinderTreeNode) =>
                  isRenaming(renaming, node) ? null : (
                    <button
                      type="button"
                      className="binder-tree-action"
                      // The name, so a screen reader hears which row's pencil
                      // this is rather than "Rename" eleven times.
                      aria-label={`Rename ${formatDocumentName(
                        node.kind === "folder" ? node.name : node.document.name,
                      )}`}
                      disabled={committing}
                      onClick={() =>
                        setRenaming(
                          node.kind === "folder"
                            ? {
                                kind: "folder",
                                path: node.path,
                                label: formatDocumentName(node.name),
                              }
                            : {
                                kind: "document",
                                slugPath: node.document.slugPath,
                                label: formatDocumentName(node.document.name),
                              },
                        )
                      }
                    >
                      <Pencil size={14} strokeWidth={1.6} aria-hidden="true" />
                    </button>
                  ),
              }
            : {})}
        />
      )}
    </div>
  );
}

/** Is this the row whose name has turned into a text box? */
function isRenaming(renaming: Renaming | null, node: BinderTreeNode): boolean {
  if (!renaming) return false;
  return node.kind === "folder"
    ? renaming.kind === "folder" && renaming.path === node.path
    : renaming.kind === "document" &&
        renaming.slugPath === node.document.slugPath;
}

/**
 * The name, as a text box, for as long as somebody is typing in it.
 *
 * **Blur commits.** That is what renaming in a file explorer does, and the
 * customer asked for renaming to be as simple as it is in Finder. Escape is
 * the way out, and it has to win the race: cancelling moves focus off the
 * input, which fires blur, which would otherwise commit the very edit that was
 * just abandoned. The ref is what makes "one of the two, once" true.
 */
function InlineRename({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);

  const settle = (run: () => void) => {
    if (settled.current) return;
    settled.current = true;
    run();
  };

  return (
    <input
      className="binder-tree-rename"
      type="text"
      value={value}
      autoFocus
      aria-label="New name"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => settle(() => onCommit(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          settle(() => onCommit(value));
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(onCancel);
        }
      }}
      // A click in the box is not a click on the row behind it.
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/** The tree asks about a node; this list only ever describes documents. */
function describeTreeDocument(node: BinderTreeNode): string {
  return node.kind === "document" ? describeDocument(node.document) : "";
}
