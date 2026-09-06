import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Folder } from "lucide-react";

import { fetchBinderDocuments } from "../api";
import type { WorkspaceDocumentListEntry } from "../../../packages/api-schema/schemas/workspaces";
import { formatDocumentName } from "../documentDisplay";
import { AddPolicyModal } from "./AddPolicyModal";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";
import { StatusChip } from "./StatusChip";

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

/** "Version 3 · 1 open change", or what is true of it so far. */
export function describeDocument(document: WorkspaceDocumentListEntry): string {
  const parts: string[] = [];

  // A document nobody has approved yet is not "no published version" — that
  // reads like something is wrong with it. It is waiting, and saying so is
  // both kinder and more accurate.
  if (document.state === "proposed") {
    parts.push("Not published yet");
  } else {
    parts.push(
      document.latestVersion
        ? `Version ${document.latestVersion.version}`
        : "No published version",
    );
  }

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
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
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

  useEffect(() => {
    setDocuments(null);
    return load();
  }, [load]);

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
      <div className="binder-page-head">
        <div>
          <div className="bs-eyebrow">{org}</div>
          <h1>{binder}</h1>
        </div>
        {/* The binder is where the work is, so the way to add to it is on the
            binder rather than in a menu somewhere else. */}
        <button
          className="bs-btn bs-btn-primary"
          type="button"
          onClick={() => setAdding(true)}
        >
          Add a policy
        </button>
      </div>

      {documents.length === 0 ? (
        // Not an error, and not a failure of theirs: a binder somebody just
        // made is empty, which is the ordinary first state.
        <p style={{ color: "var(--bs-text-muted)" }}>
          Nothing filed here yet. Add a policy and it joins the binder once the
          change is approved.
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
                    <span className="docs-list-item-name">
                      {formatDocumentName(document.name)}
                    </span>
                    <span className="docs-list-item-meta">
                      {describeDocument(document)}
                    </span>
                  </span>
                  {document.state === "proposed" ? (
                    <StatusChip tone="review" size="sm">
                      In review
                    </StatusChip>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {adding ? (
        <AddPolicyModal
          org={org}
          binder={binder}
          onClose={() => setAdding(false)}
          onAdded={(slugPath) => {
            setAdding(false);
            // Straight to the policy they just added. It is not on `main` yet,
            // so its page reads the change's own branch — which is the whole
            // reason the binder shows proposed documents at all.
            onOpenDocument(slugPath);
          }}
        />
      ) : null}
    </section>
  );
}
