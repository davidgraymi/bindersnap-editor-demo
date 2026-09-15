import { useCallback, useEffect, useMemo, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";

import { fetchBinderDocuments } from "../api";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
import { buildBinderTree, type BinderTreeNode } from "../binderTree";
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
 * The binder's documents: the tab a binder opens on, and its reason to exist.
 *
 * A tree rather than a flat list of headings, because folders nest and the
 * headings pretended they did not — `nursing/infection` sat beside `nursing`
 * with nothing saying one was inside the other. Nothing starts shut, for the
 * reason the old list gave and which still holds: a policy manual is read by
 * looking, not by navigating, and a surveyor asking for the infection control
 * policy should see it without opening anything.
 */
export function BinderDocuments({
  org,
  binder,
  onOpenDocument,
  activeDocument = null,
}: BinderDocumentsProps) {
  const isReadOnly = useIsReadOnly();
  const [documents, setDocuments] = useState<
    WorkspaceDocumentListEntry[] | null
  >(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { collapsed, toggle } = useCollapsedFolders(org, binder);

  const load = useCallback(() => {
    let cancelled = false;
    setError(null);

    fetchBinderDocuments(org, binder)
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
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to open this binder.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  useEffect(() => {
    setDocuments(null);
    return load();
  }, [load]);

  const tree = useMemo(
    () => (documents ? buildBinderTree(documents, folders) : []),
    [documents, folders],
  );

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
        />
      )}
    </div>
  );
}

/** The tree asks about a node; this list only ever describes documents. */
function describeTreeDocument(node: BinderTreeNode): string {
  return node.kind === "document" ? describeDocument(node.document) : "";
}
