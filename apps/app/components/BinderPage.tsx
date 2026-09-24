import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderInput,
  GitBranch,
  Pencil,
} from "lucide-react";
import { useIsReadOnly } from "../readOnlyContext";

import {
  archiveBinderDocument,
  fetchBinderArchive,
  fetchBinderDocuments,
  renameBinderDocument,
  renameBinderFolder,
  restoreBinderDocument,
} from "../api";
import type {
  BinderArchivePayload,
  DraftAct,
  WorkspaceDocumentListEntry,
} from "../../../packages/api-schema/schemas/workspaces";
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
import { formatAge, formatDocumentName } from "../documentDisplay";
import { buildBinderUrl } from "../binderShell";
import { useOpenFolders } from "../useOpenFolders";
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
  /**
   * The draft picker, rendered into the tree's own bar.
   *
   * Passed in rather than built here: which drafts you have and how to move
   * between them is the shell's state — it owns the address, and the address
   * is what carries which draft is being edited.
   */
  draftPicker?: ReactNode;
  /** Open the archive — what this binder has taken off the record. */
  onOpenArchive?: () => void;
  /** Open a change request — the one a row says last touched its policy. */
  onOpenChange?: (changeNumber: number) => void;
  /**
   * What is in the draft, so the tree can mark the rows you have touched.
   *
   * **Checking your work should be looking, not reading.** Which rows a draft
   * has changed existed only as a list of sentences in the bar, so the tree —
   * the thing that was actually rearranged — said nothing about it.
   */
  draftActs?: readonly DraftAct[];
  /** Add to the tree. In its own bar, beside the thing it adds to. */
  onAddPolicy?: () => void;
  onNewFolder?: () => void;
  /**
   * Read the binder as this change request would leave it, on its branch.
   *
   * Where a change's branch link lands: the whole binder at that branch, the
   * way a code host opens a branch at its root rather than on one file in it.
   * Read-only — a branch somebody has proposed is theirs, not a draft.
   */
  onChange?: { number: number; branch: string } | null;
  /** The way back to the change, from its branch. */
  onBackToChange?: (changeNumber: number) => void;
}

/**
 * What a policy's row says to the right of its name: the change that last
 * touched it, and how long ago.
 *
 * **Not a version and not a status pill.** Four rows each carrying a coloured
 * chip made a list of four policies look like a list of four problems, and
 * "1 open change" is not a property of a policy — it belongs to the change
 * request, which has its own list and its own count. What a file list is
 * opened to find out is what changed, and when; "3 weeks ago" rather than a
 * date, because the answer wanted is "recently" or "not recently".
 *
 * Null when there is nothing to say — a file published before versions
 * recorded their change, or one this product did not write.
 */
export function describeLastChange(
  document: WorkspaceDocumentListEntry,
  now: number = Date.now(),
): { number: number; subject: string; when: string } | null {
  const last = document.lastChange;
  if (!last) return null;
  return {
    number: last.number,
    subject: last.title.trim() === "" ? `Change ${last.number}` : last.title,
    when: formatAge(last.publishedAt, now),
  };
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
  draftPicker = null,
  reloadKey = 0,
  onEdited,
  onDraftLost,
  onOpenArchive,
  onOpenChange,
  draftActs = [],
  onAddPolicy,
  onNewFolder,
  onChange = null,
  onBackToChange,
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
  const { isOpen, toggle } = useOpenFolders(org, binder, activeDocument);
  /** What the bar's filter holds. Empty is the whole binder. */
  const [filter, setFilter] = useState("");
  /** The archive, once somebody has opened it in the tree. */
  const [archived, setArchived] = useState<
    BinderArchivePayload["documents"] | null
  >(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);

    fetchBinderDocuments(
      org,
      binder,
      draft ?? undefined,
      onChange?.number ?? undefined,
    )
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
  }, [org, binder, draft, onChange?.number, reloadKey, onDraftLost]);

  useEffect(() => {
    setDocuments(null);
    return load();
  }, [load]);

  /**
   * The archive, read when it is opened rather than with the tree.
   *
   * It is a section somebody opens on purpose, and most edits never touch it,
   * so the binder does not pay for the read on every visit.
   */
  useEffect(() => {
    if (!archiveOpen || archived !== null) return;

    let cancelled = false;
    // **At the draft's ref while editing**, because that is where the count
    // beside this section was counted. A policy archived a moment ago is off
    // the draft's tree and still on `main`, so reading from `main` listed
    // nothing under a heading that said one thing was in there.
    fetchBinderArchive(org, binder, draft ?? undefined)
      .then((payload) => {
        if (!cancelled) setArchived(payload.documents);
      })
      // The tree is the page; failing to read the archive closes the section
      // rather than taking the binder down with it.
      .catch(() => {
        if (!cancelled) {
          setArchiveOpen(false);
          setActError("Unable to read the archive.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [archiveOpen, archived, org, binder, draft]);

  // Leaving edit mode ends any rename in progress. The input has nowhere to
  // commit to once the draft is gone, and leaving it on screen would offer a
  // rename that silently does nothing.
  useEffect(() => {
    if (draft) return;
    setRenaming(null);
    setDragging(null);
    setOver(null);
    setMoving(null);
    setArchiveOpen(false);
  }, [draft]);

  const tree = useMemo(
    () => (documents ? buildBinderTree(documents, folders) : []),
    [documents, folders],
  );

  /**
   * The tree, cut down to the policies whose names match the filter.
   *
   * Built from the matches alone, so a folder with nothing matching in it is
   * not drawn — and every folder on the way to a match is open, whatever was
   * shut, because a filter that finds a policy inside a shut folder has found
   * nothing anybody can see.
   */
  const needle = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!documents || needle === "") return tree;
    return buildBinderTree(
      documents.filter((document) =>
        formatDocumentName(document.name).toLowerCase().includes(needle),
      ),
      [],
    );
  }, [documents, needle, tree]);

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
      // Every act can move the archive — archiving puts a policy in it and
      // restoring takes one out — and the section is read once and kept. Drop
      // what was read so an open archive re-reads with the rest of the tree,
      // rather than showing the answer from before the act.
      setArchived(null);
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

  /**
   * Bring a policy back, into the draft in hand.
   *
   * **An ordinary change, not an undo.** It returns at the filename it left
   * with, so it keeps its identity and rejoins as its next version rather
   * than as a new policy at v1 — which is what the button says, because the
   * effect on the history is the question somebody hesitating here has.
   */
  const restoreDocument = async (uid: string) => {
    if (!draft) return;
    setRestoring(uid);
    try {
      // `runAct` drops what was read from the archive already — every act can
      // move it, not only this one.
      await runAct(
        () => restoreBinderDocument(org, binder, uid, { draft }),
        "Unable to restore that document.",
      );
    } finally {
      setRestoring(null);
    }
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
        // A row you have moved, renamed or added in this draft. Quiet: it
        // marks the work, it does not celebrate it.
        isTouched(node) ? "binder-tree-row--dirty" : "",
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

  const policyCount = documents?.length ?? 0;
  const folderCount = everyFolder.length;

  /**
   * The rows this draft has touched.
   *
   * Every act carries the files it wrote, which is exactly what a row needs to
   * know whether it is one of them. A folder counts as touched when the act
   * made it — its `.gitkeep` — rather than when anything inside it changed,
   * because "somewhere under here" is not a fact worth a mark on every
   * ancestor of every edit.
   */
  const touched = useMemo(() => {
    const paths = new Set<string>();
    for (const act of draftActs) {
      for (const path of act.paths) paths.add(path);
    }
    return paths;
  }, [draftActs]);

  const isTouched = (node: BinderTreeNode): boolean => {
    if (!draft) return false;
    if (node.kind === "document") return touched.has(node.document.path);

    // A folder is touched when something landed in it or left it — which is
    // what renaming one looks like from the commit's side, because every file
    // it holds is written at its new address. Only its own children count:
    // "something changed somewhere under here" would put a dot on every
    // ancestor of every edit, which marks the tree rather than the work.
    const prefix = `${node.path}/`;
    for (const path of touched) {
      if (!path.startsWith(prefix)) continue;
      if (!path.slice(prefix.length).includes("/")) return true;
    }
    return false;
  };

  const renderAside = (node: BinderTreeNode) => {
    // **Nothing but your own work, while you are rearranging.** Versions and
    // change subjects are what a reader wants; an editor has to read past
    // them to find the row they just moved.
    if (draft) return null;
    if (node.kind !== "document") return null;
    const last = describeLastChange(node.document);
    if (!last) return null;
    return (
      <>
        <span className="bs-row-subject binder-tree-subject">
          <a
            href={buildBinderUrl({
              org,
              binder,
              tab: "changes",
              change: last.number,
            })}
            title={last.subject}
            onClick={(event) => {
              if (!onOpenChange) return;
              event.preventDefault();
              onOpenChange(last.number);
            }}
          >
            {last.subject}
          </a>
        </span>
        <span className="bs-row-when">{last.when}</span>
      </>
    );
  };

  return (
    <div className="binder-pane">
      {/* The same way back a document read on a change's branch offers: the
          reader came here from the change, and came to decide on it. */}
      {onChange && onBackToChange ? (
        <div className="doc-on-change" role="status">
          <button
            type="button"
            className="bs-btn bs-btn--sm bs-btn-secondary"
            onClick={() => onBackToChange(onChange.number)}
          >
            Back to change {onChange.number}
          </button>
        </div>
      ) : null}

      {actError ? (
        <p className="bs-note bs-note--danger" role="alert">
          {actError}
        </p>
      ) : null}

      <div className="bs-panel">
        {/* The controls that act on the list live in the list's own bar. */}
        <div className="bs-panel-bar">
          {draft ? (
            <>
              {/* **Which of your drafts this is**, and the way to the others.
                  In the list's own bar because it is a fact about the tree
                  below it, not about the binder. */}
              {draftPicker}
              {/* Beside the tree they add to, and in the same two slots
                  whichever you press first. */}
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn-secondary"
                onClick={onNewFolder}
                disabled={committing || !onNewFolder}
              >
                New folder
              </button>
              <button
                type="button"
                className="bs-btn bs-btn--sm bs-btn-secondary"
                onClick={onAddPolicy}
                disabled={committing || !onAddPolicy}
              >
                Add a document
              </button>
              <span className="bs-panel-bar-spacer" />
              {/* Continuous save, said where the eye already is. */}
              <span className="bs-saved">
                <Check size={13} strokeWidth={2} aria-hidden="true" />
                {committing ? "Saving…" : "Saved"}
              </span>
            </>
          ) : (
            <>
              {/* Which branch this is, in the tree's own bar — the list reads
                  like the record otherwise, and is not it. */}
              {onChange ? (
                <span className="cmp-branch" title="The branch being read">
                  <GitBranch size={12} strokeWidth={1.75} aria-hidden="true" />
                  {onChange.branch}
                </span>
              ) : null}
              <input
                className="bs-input bs-input--sm binder-filter"
                type="search"
                value={filter}
                placeholder="Filter this binder…"
                aria-label="Filter this binder"
                disabled={documents === null || policyCount === 0}
                onChange={(event) => setFilter(event.target.value)}
              />
              <span className="bs-panel-bar-spacer" />
              {documents === null ? null : (
                <span className="binder-count">
                  {policyCount === 1
                    ? "1 document"
                    : `${policyCount} documents`}
                  {folderCount === 0
                    ? ""
                    : folderCount === 1
                      ? " in 1 folder"
                      : ` in ${folderCount} folders`}
                </span>
              )}
            </>
          )}
        </div>

        {documents === null ? (
          <SkeletonGroup label="Opening this binder">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="bs-row" key={index}>
                <span className="bs-skeleton-lines">
                  <SkeletonLine width="medium" />
                </span>
              </div>
            ))}
          </SkeletonGroup>
        ) : tree.length === 0 ? (
          // Not an error, and not a failure of theirs: a binder somebody just
          // made is empty, which is the ordinary first state.
          //
          // A read-only organization is told what is here, not what to do
          // next: pointing at a button that is not on the page is worse than
          // saying less.
          <div className="bs-empty">
            <p className="bs-empty-lead">Nothing filed here yet.</p>
            {isReadOnly ? null : (
              <p>
                {draft
                  ? "Make a folder or add a document — it goes into your draft."
                  : "A document joins this binder once its change request is published."}
              </p>
            )}
          </div>
        ) : shown.length === 0 ? (
          <div className="bs-empty">
            <p>Nothing in this binder is called that.</p>
          </div>
        ) : (
          <BinderTreeView
            nodes={shown}
            isFolderOpen={needle === "" ? isOpen : EVERYTHING_OPEN}
            onToggleFolder={toggle}
            onOpenDocument={onOpenDocument}
            activeDocument={activeDocument}
            renderDocumentAside={renderAside}
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
                          className="bs-rowact"
                          aria-label={`Rename ${label}`}
                          title="Rename"
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
                          className="bs-rowact"
                          aria-label={`Move ${label}`}
                          title="Move"
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
                            className="bs-rowact bs-rowact--danger"
                            aria-label={`Archive ${label}`}
                            title="Archive"
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

        {/* **The archive, in the tree.** It was a page of its own reachable
            only from the reading view, so edit mode — the one place somebody
            can act on what they find — had no way in and no way back. */}
        {draft && archivedCount > 0 ? (
          <div className="bs-archived">
            <button
              type="button"
              className="bs-disclose"
              aria-expanded={archiveOpen}
              onClick={() => setArchiveOpen((open) => !open)}
            >
              {archiveOpen ? (
                <ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" />
              ) : (
                <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" />
              )}
              <Archive size={14} strokeWidth={1.5} aria-hidden="true" />
              {archivedCount === 1
                ? "Archived · 1 document"
                : `Archived · ${archivedCount} documents`}
            </button>

            {archiveOpen && archived === null ? (
              <p className="bs-empty">Reading the archive…</p>
            ) : null}

            {archiveOpen && archived
              ? archived.map((entry) => (
                  <div className="binder-tree-row" key={entry.uid}>
                    <span className="binder-tree-main binder-tree-main--inert">
                      <span className="binder-tree-twisty" aria-hidden="true" />
                      <span className="binder-tree-icon" aria-hidden="true">
                        <FileText size={16} strokeWidth={1.4} />
                      </span>
                      <span className="binder-tree-label">{entry.title}</span>
                    </span>
                    <span className="bs-row-when">
                      {entry.slugPath
                        ? `Was filed at ${entry.slugPath}`
                        : "Its folder is gone"}
                    </span>
                    {/* Never hover-revealed: hover-reveal is for the
                        secondary acts on a row you are reading, never for the
                        only one. */}
                    <span className="bs-rowacts bs-rowacts--always binder-tree-actions">
                      <button
                        type="button"
                        className="bs-btn bs-btn--sm bs-btn-secondary"
                        disabled={committing || restoring !== null}
                        onClick={() => void restoreDocument(entry.uid)}
                      >
                        {restoring === entry.uid
                          ? "Restoring…"
                          : `Restore as v${entry.lastVersion + 1}`}
                      </button>
                    </span>
                  </div>
                ))
              : null}
          </div>
        ) : null}

        {/* The way into the archive, and gone when there is nothing in it: a
            binder that has never archived anything should not carry a link to
            an empty page. The panel's own foot rather than the header, because
            it is about what this binder *held* — a question somebody asks
            after failing to find something, not before. */}
        {archivedCount > 0 && onOpenArchive && !draft && !onChange ? (
          <div className="bs-panel-foot">
            <button
              type="button"
              className="bs-btn bs-btn--sm bs-btn--quiet binder-archive-link"
              onClick={onOpenArchive}
            >
              <Archive size={14} strokeWidth={1.5} aria-hidden="true" />
              {archivedCount === 1
                ? "1 archived document"
                : `${archivedCount} archived documents`}
            </button>
          </div>
        ) : null}
      </div>

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

/** Nothing shut: a filter opens every folder on the way to a match. */
const EVERYTHING_OPEN = () => true;

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
