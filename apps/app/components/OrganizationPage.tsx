import { useEffect, useState } from "react";
import { BookOpen, Plus } from "lucide-react";

import { createBinder, fetchOrganizationBinders } from "../api";
import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { SkeletonGroup, SkeletonLine } from "./Skeleton";

/**
 * An organization, at `/{org}`: what it owns.
 *
 * The counterpart to the personal views. Home answers "what is waiting on me",
 * across every organization I belong to, because that is the question somebody
 * opens the app with. This answers "what does this organization have", which
 * is a different question and needs its own page — you cannot manage a
 * customer's binders from a list that is sorted by what you personally owe.
 *
 * Membership and teams belong here too. They are Gitea's, and the binder's
 * three role teams already carry them; surfacing them is the next step rather
 * than this one, so this page says so instead of pretending the tab is coming.
 */

interface OrganizationPageProps {
  org: string;
  onOpenBinder: (binder: string) => void;
}

export function OrganizationPage({ org, onOpenBinder }: OrganizationPageProps) {
  const [binders, setBinders] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
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

  if (error) {
    return (
      <section className="docs-page">
        <h1>{org}</h1>
        <p className="app-inline-error">{error}</p>
      </section>
    );
  }

  return (
    <section className="docs-page">
      <div className="bs-eyebrow">Organization</div>
      <h1>{org}</h1>

      <form
        className="app-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const name = newName.trim();
          if (name === "" || isCreating) return;

          setIsCreating(true);
          setCreateError(null);
          try {
            const created = await createBinder(org, name);
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
