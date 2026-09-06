import { useCallback, useEffect, useState } from "react";

import { fetchBinder } from "../api";
import type { WorkspaceOverviewPayload } from "../../../packages/api-schema/schemas/workspaces";
import {
  binderTabFromSearch,
  buildBinderUrl,
  type BinderTab,
} from "../binderShell";
import { parseRequestedChange } from "../binderChange";
import { AddPolicyModal } from "./AddPolicyModal";
import { BinderChangePage } from "./BinderChangePage";
import { BinderChanges } from "./BinderChanges";
import { BinderDocumentPage } from "./BinderDocumentPage";
import { BinderDocuments } from "./BinderPage";
import { SkeletonLine } from "./Skeleton";

/**
 * The binder, laid out the way a repository is.
 *
 * A binder *is* a Gitea repository (ADR 0004), and the shape people already
 * know for one is a name, a description, and a row of tabs: what is in it,
 * what is being changed, what happened, and who can do what. Following that
 * gives a customer a page they can read without being taught, and gives us a
 * baseline to pivot from rather than a layout invented per screen.
 *
 * One document is a file inside the binder, so it opens under the same header
 * with Documents still marked — you are still in the binder, further in.
 */

interface BinderShellProps {
  org: string;
  binder: string;
  /** Set when the address is `/{org}/{binder}/{path}` — a file in the binder. */
  documentPath?: string;
  currentUser: string;
  onOpenDocument: (documentPath: string) => void;
  onOpenBinder: () => void;
  onOpenOrganization: () => void;
}

export function BinderShell({
  org,
  binder,
  documentPath,
  currentUser,
  onOpenDocument,
  onOpenBinder,
  onOpenOrganization,
}: BinderShellProps) {
  const [overview, setOverview] = useState<WorkspaceOverviewPayload | null>(
    null,
  );
  const [adding, setAdding] = useState(false);

  // Back and forward are how somebody leaves a tab or a change, so the shell
  // follows the address bar rather than its own memory of what was clicked.
  const [tab, setTab] = useState<BinderTab>(() =>
    binderTabFromSearch(window.location.search),
  );
  const [openChange, setOpenChange] = useState<number | null>(() =>
    parseRequestedChange(window.location.search),
  );

  useEffect(() => {
    const handler = () => {
      setTab(binderTabFromSearch(window.location.search));
      setOpenChange(parseRequestedChange(window.location.search));
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const loadOverview = useCallback(() => {
    let cancelled = false;
    fetchBinder(org, binder)
      .then((payload) => {
        if (!cancelled) setOverview(payload);
      })
      // The header is context, not content: a binder whose counts cannot be
      // read still opens, and the tab that failed says so itself.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  useEffect(() => {
    setOverview(null);
    return loadOverview();
  }, [loadOverview]);

  const goTo = (next: BinderTab) => {
    window.history.pushState(
      {},
      "",
      buildBinderUrl({ org, binder, tab: next }),
    );
    setTab(next);
    setOpenChange(null);
  };

  const openChangeNumber = (changeNumber: number) => {
    window.history.pushState(
      {},
      "",
      buildBinderUrl({ org, binder, tab: "changes", change: changeNumber }),
    );
    setTab("changes");
    setOpenChange(changeNumber);
  };

  // A document is a file in the binder, so Documents stays the tab you are on.
  const activeTab: BinderTab = documentPath ? "documents" : tab;

  const tabs: Array<{ id: BinderTab; label: string; count?: number }> = [
    { id: "documents", label: "Documents", count: overview?.documentCount },
    {
      id: "changes",
      label: "Change requests",
      count: overview?.openChangeCount,
    },
  ];

  return (
    <section className="docw-page">
      <header className="doc-header">
        <div className="doc-header-top">
          <div className="doc-header-identity">
            <nav className="doc-crumbs" aria-label="Where this binder lives">
              <span className="doc-crumb">
                <button
                  className="app-breadcrumb-back"
                  type="button"
                  onClick={onOpenOrganization}
                >
                  {org}
                </button>
              </span>
            </nav>
            <h1 className="doc-header-title">{binder}</h1>
            {/* What the binder is for, in the customer's own words. Absent
                until they have written one — a placeholder sentence would be
                us talking, in the place their answer goes. */}
            {overview === null ? (
              <SkeletonLine width="medium" />
            ) : overview.workspace.description ? (
              <p className="doc-header-fact">
                {overview.workspace.description}
              </p>
            ) : null}
          </div>

          {/* The binder is where the work is, so the way to add to it is on
              the binder rather than in a menu somewhere else. */}
          <button
            className="doc-header-submit"
            type="button"
            onClick={() => setAdding(true)}
          >
            Add a policy
          </button>
        </div>

        <nav className="doc-tabs" role="tablist" aria-label="Binder">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              className={`doc-tab${activeTab === entry.id ? " doc-tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === entry.id}
              onClick={() => goTo(entry.id)}
            >
              {entry.label}
              {entry.count !== undefined && entry.count > 0 ? (
                <span className="doc-tab-count">{entry.count}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      {openChange !== null ? (
        <BinderChangePage
          org={org}
          binder={binder}
          changeNumber={openChange}
          currentUser={currentUser}
          onBackToBinder={() => goTo("changes")}
          onOpenDocument={onOpenDocument}
        />
      ) : documentPath ? (
        <BinderDocumentPage
          org={org}
          binder={binder}
          documentPath={documentPath}
          onOpenBinder={onOpenBinder}
          onOpenChange={openChangeNumber}
        />
      ) : activeTab === "changes" ? (
        <BinderChanges
          org={org}
          binder={binder}
          onOpenChange={openChangeNumber}
          onAddPolicy={() => setAdding(true)}
        />
      ) : (
        <BinderDocuments
          org={org}
          binder={binder}
          onOpenDocument={onOpenDocument}
        />
      )}

      {adding ? (
        <AddPolicyModal
          org={org}
          binder={binder}
          onClose={() => setAdding(false)}
          onAdded={(slugPath) => {
            setAdding(false);
            loadOverview();
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
