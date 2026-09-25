import { useEffect, useState } from "react";
import { useIsReadOnly } from "../readOnlyContext";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";
import { BookOpen, FilePen } from "lucide-react";

import { fetchOrganizationBinders } from "../api";
import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { followInApp } from "../appLink";
import { buildBinderUrl } from "../binderShell";
import { formatAge, formatDocumentName } from "../documentDisplay";
import { NewBinderPage } from "./NewBinderPage";
import { OrganizationPeople } from "./OrganizationPeople";
import { SkeletonPanel } from "./Skeleton";

/** The organization's tabs. Binders is the one it opens on. */
const ORG_TABS = ["binders", "people"] as const;
type OrgTab = (typeof ORG_TABS)[number];

function orgTabFromSearch(search: string): OrgTab {
  const raw = new URLSearchParams(search).get("tab");
  return ORG_TABS.find((tab) => tab === raw) ?? "binders";
}

/** `?new=binder`: the new-binder form, as an address of its own. */
function isCreatingFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("new") === "binder";
}

/**
 * An organization, at `/{org}`: what it owns.
 *
 * The counterpart to the personal views. Home answers "what is waiting on me",
 * across every organization I belong to, because that is the question somebody
 * opens the app with. This answers "what does this organization have", which
 * is a different question and needs its own page — you cannot manage a
 * customer's binders from a list that is sorted by what you personally owe.
 *
 * Laid out like the binder, and for the same reason: an organization is a
 * Gitea organization, its page is a name and a row of tabs, and following the
 * shape people already know beats inventing one per screen.
 */

interface OrganizationPageProps {
  org: string;
  onOpenBinder: (binder: string) => void;
}

export function OrganizationPage({ org, onOpenBinder }: OrganizationPageProps) {
  const isReadOnly = useIsReadOnly();
  const displayName = useOrganizationDisplayName(org);
  const [tab, setTab] = useState<OrgTab>(() =>
    orgTabFromSearch(window.location.search),
  );
  const [binders, setBinders] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Behind the header's "New binder", at an address of its own rather than a
  // drawer over the list: it can be sent, reloaded and left with Back.
  const [creating, setCreating] = useState(() =>
    isCreatingFromSearch(window.location.search),
  );

  useEffect(() => {
    let cancelled = false;
    setBinders(null);
    setError(null);

    fetchOrganizationBinders(org)
      .then((rows) => {
        if (!cancelled) setBinders(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to open this organization.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org]);

  // Back and forward are how somebody leaves a tab, so the page follows the
  // address bar rather than its own memory of what was clicked.
  useEffect(() => {
    const handler = () => {
      setTab(orgTabFromSearch(window.location.search));
      setCreating(isCreatingFromSearch(window.location.search));
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const goTo = (next: OrgTab) => {
    window.history.pushState(
      {},
      "",
      next === "binders" ? `/${org}` : `/${org}?tab=${next}`,
    );
    setTab(next);
    setCreating(false);
  };

  const newBinderHref = `/${org}?new=binder`;
  const openNewBinder = () => {
    window.history.pushState({}, "", newBinderHref);
    setTab("binders");
    setCreating(true);
  };

  const header = (
    <header className="doc-header">
      <div className="doc-header-top">
        <div className="doc-header-identity">
          <h1 className="doc-header-title">{displayName}</h1>
        </div>

        {/* The one coral element on this page, and the same place the binder
            puts "Add a policy". The form it opens used to sit above the list
            permanently, which made the page read as a settings screen for
            something that has not started yet — the list is the answer to
            "is my organization in good shape", so the list comes first. */}
        {tab === "binders" && !isReadOnly ? (
          <a
            className="bs-btn bs-btn-primary"
            href={newBinderHref}
            onClick={(event) => followInApp(event, openNewBinder)}
          >
            New binder
          </a>
        ) : null}
      </div>

      <nav className="doc-tabs" role="tablist" aria-label="Organization">
        {ORG_TABS.map((entry) => (
          <button
            key={entry}
            className={`doc-tab${tab === entry ? " doc-tab--active" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            onClick={() => goTo(entry)}
          >
            {entry === "binders" ? "Binders" : "People"}
            {entry === "binders" && binders !== null && binders.length > 0 ? (
              <span className="doc-tab-count">{binders.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
    </header>
  );

  if (error) {
    return (
      <section className="docw-page">
        {header}
        <p className="app-inline-error">{error}</p>
      </section>
    );
  }

  if (creating && !isReadOnly) {
    return (
      <NewBinderPage
        org={org}
        orgDisplayName={displayName}
        existing={binders}
        cancelHref={`/${org}`}
        onCancel={() => goTo("binders")}
        onCreated={(created) => onOpenBinder(created.name)}
      />
    );
  }

  if (tab === "people") {
    return (
      <section className="docw-page">
        {header}
        <OrganizationPeople org={org} />
      </section>
    );
  }

  return (
    <section className="docw-page">
      {header}

      {binders === null ? (
        <SkeletonPanel label={`Opening ${org}`} rows={3} />
      ) : binders.length === 0 ? (
        <div className="bs-panel">
          <div className="bs-empty">
            <p className="bs-empty-lead">No binders yet.</p>
            <p>
              A binder is a set of documents governed together — by the same
              people, under the same rules.
            </p>
            {isReadOnly ? null : (
              <a
                className="bs-btn bs-btn-primary"
                href={newBinderHref}
                onClick={(event) => followInApp(event, openNewBinder)}
              >
                New binder
              </a>
            )}
          </div>
        </div>
      ) : (
        /* The panel and row every other list uses — Home, the change
           requests, a binder's own documents — so an organization's binders
           read as a list of the same kind as everything inside them. */
        <section className="bs-panel" aria-label="Binders">
          <ul className="bs-row-list">
            {binders.map((binder) => (
              <li key={binder.id}>
                <a
                  className="bs-row bs-row--tall"
                  href={buildBinderUrl({ org, binder: binder.name })}
                  onClick={(event) =>
                    followInApp(event, () => onOpenBinder(binder.name))
                  }
                >
                  <span className="bs-row-icon">
                    <BookOpen size={16} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <span className="bs-row-body">
                    <span className="bs-row-name">
                      {formatDocumentName(binder.name)}
                    </span>
                    <span className="bs-row-meta">
                      {binder.description || "No description"}
                    </span>
                  </span>
                  <BinderFacts binder={binder} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/**
 * What a binder is doing, on the right of its row: how many changes are open
 * in it and when anything last moved.
 *
 * **GitLab's project list, for a binder.** The list said what each binder was
 * *for* and nothing about what was happening in it, so finding the one with
 * work waiting meant opening them in turn. Both facts come on the repository
 * Gitea already returns — no request per row.
 *
 * The count's slot is always there, empty when nothing is open, so "Updated"
 * lines up down the list rather than stepping sideways on the rows that have
 * work in them — the same rule the change rows' comment count follows.
 */
function BinderFacts({ binder }: { binder: WorkspaceSummary }) {
  const open = binder.openChangeCount;
  const updated = formatAge(binder.updatedAt);
  const openLabel =
    open === 1 ? "1 open change request" : `${open} open change requests`;

  return (
    <span className="bs-row-right org-binder-facts">
      <span
        className="org-binder-changes"
        {...(open > 0 ? { title: openLabel } : { "aria-hidden": true })}
      >
        {open > 0 ? (
          <>
            <FilePen size={13} strokeWidth={1.75} aria-hidden="true" />
            <span aria-hidden="true">{open}</span>
            <span className="sr-only">{openLabel}</span>
          </>
        ) : null}
      </span>
      {updated ? (
        <span className="org-binder-updated">Updated {updated}</span>
      ) : null}
    </span>
  );
}
