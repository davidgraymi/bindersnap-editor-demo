import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, FolderInput, Pencil } from "lucide-react";
import { useIsReadOnly } from "../readOnlyContext";

import {
  archiveBinderDocument,
  fetchBinderDocuments,
  renameBinderDocument,
  renameBinderFolder,
} from "../api";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
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
  type MovePlan,
} from "../binderMove";
import { formatDocumentName } from "../documentDisplay";
import { useCollapsedFolders } from "../useCollapsedFolders";
import { BinderTreeView } from "./BinderTree";
import { MoveToFolderModal } from "./MoveToFolderModal";
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
  /** Open the archive — what this binder has taken off the record. */
  onOpenArchive?: () => void;
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
  onOpenArchive,
}: BinderDocumentsProps) {
  const isReadOnly = useIsReadOnly();
  const [documents, setDocuments] = useState<
    WorkspaceDocumentListEntry[] | null
  >(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [archivedCount, setArchivedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  /** What is under the pointer mid-drag, and where it would land. */
  const [dragging, setDragging] = useState<DragSubject | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /** The row whose "Move" button was pressed — the keyboard path. */
  const [moving, setMoving] = useState<{
    subject: DragSubject;
    label: string;
  } | null>(null);
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
        setArchivedCount(payload.archivedCount ?? 0);
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
    if (draft) return;
    setRenaming(null);
    setDragging(null);
    setOver(null);
    setMoving(null);
  }, [draft]);

  const tree = useMemo(
    () => (documents ? buildBinderTree(documents, folders) : []),
    [documents, folders],
  );

  // Read off the tree rather than off `folders`, so the picker offers the
  // intermediate levels the tree inferred — a folder holding only other
  // folders is never named by the tree read and is a real destination.
  const everyFolder = useMemo(() => folderPaths(tree), [tree]);

  /**
   * Do one act against the draft, then re-read the binder from it.
   *
   * Continuous save: there is no Save button, and the act is committed the
   * moment the input is left or the row is dropped. The reload is not
   * optional — the server normalises what was typed into a path segment and
   * refuses collisions this side cannot see, so the tree has to end up saying
   * what was actually written rather than what was asked for.
   */
  const runAct = async (act: () => Promise<unknown>, failed: string) => {
    setCommitting(true);
    setActError(null);
    try {
      await act();
      onEdited?.();
      load();
    } catch (err) {
      setActError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : failed,
      );
    } finally {
      setCommitting(false);
    }
  };

  const commitRename = async (target: Renaming, typed: string) => {
    const next = typed.trim();
    setRenaming(null);
    if (!draft || next === "" || next === target.label) return;

    await runAct(() => {
      if (target.kind === "folder") {
        // A folder's new address is its parent plus the new name: renaming and
        // moving are one act on the server, and a rename is the case where the
        // parent does not change.
        const cut = target.path.lastIndexOf("/");
        const parent = cut === -1 ? "" : target.path.slice(0, cut);
        return renameBinderFolder(
          org,
          binder,
          target.path,
          parent === "" ? next : `${parent}/${next}`,
          { draft },
        );
      }
      return renameBinderDocument(
        org,
        binder,
        target.slugPath,
        { name: next },
        { draft },
      );
    }, "Unable to rename that.");
  };

  /**
   * Land a drop, or a pick from the move screen — they are the same act.
   *
   * A plan of `null` is the ordinary answer and says nothing: dropping a policy
   * back in the folder it came from is a drag somebody thought better of, and
   * it should not cost a commit or a line in the change request saying a policy
   * moved to where it already was.
   */
  const commitMove = async (plan: MovePlan) => {
    setDragging(null);
    setOver(null);
    setMoving(null);
    if (!draft || plan === null) return;

    if (plan.kind === "refused") {
      setActError(plan.why);
      return;
    }

    await runAct(
      () =>
        plan.kind === "folder"
          ? renameBinderFolder(org, binder, plan.from, plan.to, { draft })
          : renameBinderDocument(
              org,
              binder,
              plan.slugPath,
              { folder: plan.folder },
              { draft },
            ),
      "Unable to move that.",
    );
  };

  /**
   * Take a policy off the record.
   *
   * No confirmation dialog, deliberately. The act goes into the draft like
   * every other act, the bar names it, and Discard undoes the lot — the draft
   * *is* the undo, and a modal asking "are you sure" in front of something
   * already reversible is ceremony that teaches people to click through
   * warnings.
   */
  const archiveDocument = async (node: BinderTreeNode) => {
    if (!draft || node.kind !== "document") return;
    await runAct(
      () =>
        archiveBinderDocument(org, binder, node.document.slugPath, { draft }),
      "Unable to archive that.",
    );
  };

  /** What a row is, as something that can be picked up. */
  const subjectOf = (node: BinderTreeNode): DragSubject =>
    node.kind === "folder"
      ? { kind: "folder", path: node.path }
      : {
          kind: "document",
          slugPath: node.document.slugPath,
          folder: node.document.folder,
        };

  /**
   * The drag attributes for one row.
   *
   * **Only folders take a drop**, and the root zone below the tree. Dropping a
   * policy onto another policy has no meaning in a file explorer — there is no
   * "inside" a file to be — and a row that lights up for a drop it cannot
   * honour is worse than one that never lights up.
   */
  const dragPropsFor = (node: BinderTreeNode) => {
    const folder = node.kind === "folder" ? node.path : null;
    const willTake =
      folder !== null && dragging !== null && acceptsDrop(dragging, folder);

    return {
      // Not while a name is being typed in it: the row is a text box then, and
      // selecting a word in it would start a drag instead.
      draggable: isManaged(node) && !isRenaming(renaming, node) && !committing,
      className: [
        willTake && over === folder ? "binder-tree-row--drop" : "",
        dragging !== null && sameNode(dragging, subjectOf(node))
          ? "binder-tree-row--dragging"
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
        const subject = subjectOf(node);
        setDragging(subject);
        event.dataTransfer.effectAllowed = "move";
        // Something has to be set or Firefox refuses to start the drag at all.
        // The address, so a drop into another window is at worst a paste of
        // where the thing lives rather than a crash.
        event.dataTransfer.setData(
          "text/plain",
          subject.kind === "folder" ? subject.path : subject.slugPath,
        );
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
        if (!willTake) return;
        // `preventDefault` is what makes an element a drop target at all —
        // without it the browser refuses the drop and the cursor says so.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(folder);
      },
      onDragLeave: () => {
        if (over === folder) setOver(null);
      },
      onDrop: (event: React.DragEvent<HTMLDivElement>) => {
        if (!willTake || dragging === null) return;
        event.preventDefault();
        // A row inside a folder is inside that folder's box as well, so a drop
        // on a nested row would otherwise land twice — once where it was aimed
        // and once in the folder containing it.
        event.stopPropagation();
        void commitMove(planMove(dragging, folder));
      },
    };
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
                rowProps: dragPropsFor,
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
                renderRowActions: (node: BinderTreeNode) => {
                  if (isRenaming(renaming, node) || !isManaged(node)) {
                    return null;
                  }
                  // The name on every label, so a screen reader hears which
                  // row's button this is rather than "Rename" eleven times.
                  const label = formatDocumentName(
                    node.kind === "folder" ? node.name : node.document.name,
                  );
                  return (
                    <>
                      <button
                        type="button"
                        className="binder-tree-action"
                        aria-label={`Rename ${label}`}
                        disabled={committing}
                        onClick={() =>
                          setRenaming(
                            node.kind === "folder"
                              ? {
                                  kind: "folder",
                                  path: node.path,
                                  label,
                                }
                              : {
                                  kind: "document",
                                  slugPath: node.document.slugPath,
                                  label,
                                },
                          )
                        }
                      >
                        <Pencil
                          size={14}
                          strokeWidth={1.6}
                          aria-hidden="true"
                        />
                      </button>
                      {/* **Dragging is the fast path, not the only one.** It
                          needs a pointer, both ends of the move on screen at
                          once, and it is unreachable from a keyboard. A binder
                          with forty folders and a scrollbar is the ordinary
                          case. */}
                      <button
                        type="button"
                        className="binder-tree-action"
                        aria-label={`Move ${label}`}
                        disabled={committing}
                        onClick={() =>
                          setMoving({ subject: subjectOf(node), label })
                        }
                      >
                        <FolderInput
                          size={14}
                          strokeWidth={1.6}
                          aria-hidden="true"
                        />
                      </button>
                      {/* **Documents only.** Archiving a folder would mean
                          archiving everything in it, which is a different and
                          much larger act than the one this button looks like
                          — and not one anybody has asked for. A folder is
                          emptied by moving what is in it, and then it is a
                          folder somebody can rename or leave. */}
                      {node.kind === "document" ? (
                        <button
                          type="button"
                          className="binder-tree-action"
                          aria-label={`Archive ${label}`}
                          disabled={committing}
                          onClick={() => void archiveDocument(node)}
                        >
                          <Archive
                            size={14}
                            strokeWidth={1.6}
                            aria-hidden="true"
                          />
                        </button>
                      ) : null}
                    </>
                  );
                },
              }
            : {})}
        />
      )}

      {/* **Where you drop something to take it out of a folder.** Without it
          the top level is only reachable by dropping on empty space, which is
          not a target anybody can see or aim at — and in a full binder there
          is no empty space. Only while something is being dragged: a permanent
          strip under every binder would be furniture explaining a gesture
          nobody is making. */}
      {draft && dragging !== null && acceptsDrop(dragging, "") ? (
        <div
          className={`binder-tree-root-drop${
            over === "" ? " binder-tree-root-drop--over" : ""
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
            if (dragging) void commitMove(planMove(dragging, ""));
          }}
        >
          Drop here to move it to the binder’s top level
        </div>
      ) : null}

      {/* The way into the archive, and gone when there is nothing in it: a
          binder that has never archived anything should not carry a link to an
          empty page. Under the tree rather than in the header, because it is
          about what this binder *held* — a question somebody asks after
          failing to find something, not before. */}
      {archivedCount > 0 && onOpenArchive ? (
        <button
          type="button"
          className="binder-archive-link"
          onClick={onOpenArchive}
        >
          <Archive size={14} strokeWidth={1.5} aria-hidden="true" />
          {archivedCount === 1
            ? "1 archived policy"
            : `${archivedCount} archived policies`}
        </button>
      ) : null}

      {moving ? (
        <MoveToFolderModal
          subject={moving.subject}
          label={moving.label}
          folders={everyFolder}
          onClose={() => setMoving(null)}
          onMove={(folder) => void commitMove(planMove(moving.subject, folder))}
        />
      ) : null}
    </div>
  );
}

/** The same row, for marking what is currently in the air. */
function sameNode(left: DragSubject, right: DragSubject): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "folder"
    ? left.path === (right as { path: string }).path
    : left.slugPath === (right as { slugPath: string }).slugPath;
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
