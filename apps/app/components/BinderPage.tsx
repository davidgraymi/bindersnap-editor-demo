import { useEffect, useMemo, useState } from "react";
import { FileText, Folder } from "lucide-react";

import { fetchBinderDocuments } from "../api";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * One binder's documents, at `/{org}/{binder}`.
 *
 * ADR 0004's second and third levels made visible: a binder holds documents,
 * and folders are how you find them. The folder is a heading rather than a
 * tree you have to expand — a policy manual is read by looking, not by
 * navigating, and a surveyor asking for the infection control policy should
 * see it without opening anything.
 */

interface BinderPageProps {
  org: string;
  binder: string;
  onOpenDocument: (documentPath: string) => void;
}

interface FolderGroup {
  folder: string;
  documents: WorkspaceDocumentListEntry[];
}

/**
 * Group by folder, root first, then alphabetically.
 *
 * Root-level documents lead because a binder that has not been filed yet is
 * the ordinary starting state, and burying those under an empty heading would
 * make a new binder look broken.
 */
export function groupByFolder(
  documents: WorkspaceDocumentListEntry[],
): FolderGroup[] {
  const byFolder = new Map<string, WorkspaceDocumentListEntry[]>();

  for (const document of documents) {
    const existing = byFolder.get(document.folder);
    if (existing) {
      existing.push(document);
    } else {
      byFolder.set(document.folder, [document]);
    }
  }

  return [...byFolder.entries()]
    .sort(([a], [b]) => {
      if (a === "") return -1;
      if (b === "") return 1;
      return a.localeCompare(b);
    })
    .map(([folder, group]) => ({ folder, documents: group }));
}

/** "3 versions · 1 open change", or what is true of it so far. */
export function describeDocument(document: WorkspaceDocumentListEntry): string {
  const parts: string[] = [];

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

export function BinderPage({ org, binder, onOpenDocument }: BinderPageProps) {
  const [documents, setDocuments] = useState<
    WorkspaceDocumentListEntry[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDocuments(null);
    setError(null);

    fetchBinderDocuments(org, binder)
      .then((payload) => {
        if (!cancelled) setDocuments(payload.documents);
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

  const groups = useMemo(
    () => (documents ? groupByFolder(documents) : []),
    [documents],
  );

  if (error) {
    return (
      <section className="docs-page">
        <h1>{binder}</h1>
        <p className="app-inline-error">{error}</p>
      </section>
    );
  }

  if (documents === null) {
    return (
      <section className="docs-page">
        <h1>{binder}</h1>
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
      </section>
    );
  }

  return (
    <section className="docs-page">
      <div className="bs-eyebrow">{org}</div>
      <h1>{binder}</h1>

      {documents.length === 0 ? (
        // Not an error, and not a failure of theirs: a binder somebody just
        // made is empty, which is the ordinary first state.
        <p style={{ color: "var(--bs-text-muted)" }}>
          Nothing filed here yet. A document reaches this binder by being
          published.
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.folder || "__root"}>
            {group.folder ? (
              <h2 className="docs-count">
                <Folder size={14} strokeWidth={1.4} aria-hidden="true" />{" "}
                {group.folder}
              </h2>
            ) : null}

            <div className="docs-list">
              {group.documents.map((document) => (
                <button
                  type="button"
                  className="docs-list-item"
                  key={document.slugPath}
                  onClick={() => onOpenDocument(document.slugPath)}
                >
                  <span className="docs-list-item-icon" aria-hidden="true">
                    <FileText size={16} strokeWidth={1.4} />
                  </span>
                  <span className="docs-list-item-body">
                    <span className="docs-list-item-name">{document.name}</span>
                    <span className="docs-list-item-meta">
                      {describeDocument(document)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
