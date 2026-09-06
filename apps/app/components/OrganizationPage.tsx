import { useEffect, useState } from "react";
import { BookOpen, Plus } from "lucide-react";

import { createBinder, fetchOrganizationBinders } from "../api";
import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { OrganizationPeople } from "./OrganizationPeople";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/** The organization's tabs. Binders is the one it opens on. */
const ORG_TABS = ["binders", "people"] as const;
type OrgTab = (typeof ORG_TABS)[number];

function orgTabFromSearch(search: string): OrgTab {
  const raw = new URLSearchParams(search).get("tab");
  return ORG_TABS.find((tab) => tab === raw) ?? "binders";
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
  const [tab, setTab] = useState<OrgTab>(() =>
    orgTabFromSearch(window.location.search),
  );
  const [binders, setBinders] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  // Open, because the common case is a policy manual everybody must be able to
  // read in order to attest to it — and a product that makes the common case a
  // configuration step teaches customers that access is fiddly. A default, not
  // an assumption: the question is on the form.
  const [openToOrganization, setOpenToOrganization] = useState(true);
  const [createError, setCreateError] = useState<string | null>(null);

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
    const handler = () => setTab(orgTabFromSearch(window.location.search));
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
  };

  const header = (
    <header className="doc-header">
      <div className="doc-header-top">
        <div className="doc-header-identity">
          <div className="bs-eyebrow">Organization</div>
          <h1 className="doc-header-title">{org}</h1>
        </div>
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

      <form
        className="app-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const name = newName.trim();
          if (name === "" || isCreating) return;

          setIsCreating(true);
          setCreateError(null);
          try {
            const created = await createBinder(
              org,
              name,
              undefined,
              openToOrganization,
            );
            setBinders((rows) => [...(rows ?? []), created]);
            setNewName("");
          } catch (err) {
            setCreateError(
              err instanceof Error && err.message.trim() !== ""
                ? err.message
                : "Unable to create the binder.",
            );
          } finally {
            setIsCreating(false);
          }
        }}
      >
        <label className="app-field">
          <span className="bs-label">New binder</span>
          <input
            className="bs-input"
            name="binder-name"
            type="text"
            placeholder="Clinical policies"
            value={newName}
            maxLength={100}
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
        {/* Two questions, not one — and the second is the one a customer only
            knows the answer to right now. The moment somebody is naming a
            binder is the moment they know whether it is the staff handbook or
            HR investigations, and it is far cheaper to ask then than to
            discover the wrong answer a week later. One radio pair, and it
            never needs to be touched again. */}
        <fieldset className="org-group-levels">
          <legend className="bs-label">Who can see it?</legend>
          <label className="org-group-level-option">
            <input
              type="radio"
              name="binder-visibility"
              checked={openToOrganization}
              onChange={() => setOpenToOrganization(true)}
            />
            <span>
              <span className="docs-list-item-name">Everyone at {org}</span>
              <span className="docs-list-item-meta">
                They can read it and comment on changes. Reading is free.
              </span>
            </span>
          </label>
          <label className="org-group-level-option">
            <input
              type="radio"
              name="binder-visibility"
              checked={!openToOrganization}
              onChange={() => setOpenToOrganization(false)}
            />
            <span>
              <span className="docs-list-item-name">Only people I add</span>
              <span className="docs-list-item-meta">
                For a binder not everybody should see — an investigation, or
                board papers.
              </span>
            </span>
          </label>
        </fieldset>

        <button
          className="bs-btn bs-btn-primary app-submit"
          type="submit"
          disabled={newName.trim() === "" || isCreating}
        >
          <Plus size={14} strokeWidth={1.6} aria-hidden="true" />
          {isCreating ? "Creating…" : "Create binder"}
        </button>
      </form>

      {createError ? <p className="app-inline-error">{createError}</p> : null}

      {binders === null ? (
        <SkeletonGroup label={`Opening ${org}`}>
          {Array.from({ length: 3 }).map((_, index) => (
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
      ) : binders.length === 0 ? (
        <p style={{ color: "var(--bs-text-muted)" }}>
          No binders yet. A binder is a set of policies governed together — by
          the same people, under the same rules.
        </p>
      ) : (
        <div className="docs-list">
          {binders.map((binder) => (
            <button
              type="button"
              className="docs-list-item"
              key={binder.id}
              onClick={() => onOpenBinder(binder.name)}
            >
              <span className="docs-list-item-icon" aria-hidden="true">
                <BookOpen size={16} strokeWidth={1.4} />
              </span>
              <span className="docs-list-item-body">
                <span className="docs-list-item-name">{binder.name}</span>
                <span className="docs-list-item-meta">
                  {binder.description || "No description"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
