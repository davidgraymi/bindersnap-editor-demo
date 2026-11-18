import { useQuery } from "@tanstack/react-query";
import { AppIcon, ICON } from "./AppIcon";
import { useMemo, useState } from "react";

import type { WorkspaceSummary } from "../../../packages/api-schema/schemas/workspaces";
import { followInApp } from "../appLink";
import { buildBinderUrl } from "../binderShell";
import {
  BINDER_SORTS,
  describeBinderAccess,
  filterBindersByText,
  groupBindersByOrganization,
  sortBinders,
  type BinderSort,
} from "../bindersList";
import { bindersQuery } from "../data/queries";
import { formatAge, formatDocumentName } from "../documentDisplay";
import { useOrganizationDisplayName } from "../useOrganizationDisplayName";
import { SkeletonPanel } from "./Skeleton";

interface BindersPageProps {
  onOpenBinder: (org: string, binder: string) => void;
  /** Where a person with no binder yet goes to make an organization. */
  onCreateOrganization: () => void;
}

/**
 * Every binder you can open, across every organization you are in, as tiles.
 *
 * It was "Documents", a list of every file in every binder, which GitHub and
 * GitLab never draw: a repository is one scope, with its own rules and its
 * own people, and so is a binder. This is GitHub's list of your repositories
 * instead — each binder with what it is for, what you may do in it, and how
 * busy it is — ordered by what is yours, by what is busy, or by name, and
 * grouped under each organization only when there is more than one.
 */
export function BindersPage({
  onOpenBinder,
  onCreateOrganization,
}: BindersPageProps) {
  const read = useQuery(bindersQuery());
  const [sort, setSort] = useState<BinderSort>("relevant");
  const [filter, setFilter] = useState("");

  const groups = useMemo(
    () =>
      read.data
        ? groupBindersByOrganization(
            sortBinders(filterBindersByText(read.data, filter), sort),
          )
        : [],
    [read.data, filter, sort],
  );
  const total = read.data?.length ?? 0;

  return (
    <div className="docw-page binders-page">
      <div className="bs-pagehead">
        <div className="bs-pagehead-body">
          <h1 className="bs-title">Binders</h1>
          <p className="bs-subtitle">
            {read.isPending
              ? "Finding your binders…"
              : total === 0
                ? "You are not in a binder yet."
                : total === 1
                  ? "The one binder you can open."
                  : `The ${total} binders you can open.`}
          </p>
        </div>
      </div>

      {read.error ? (
        <p className="app-inline-error">
          {read.error.message || "Unable to list your binders."}
        </p>
      ) : read.isPending ? (
        <SkeletonPanel label="Finding your binders" rows={3} />
      ) : total === 0 ? (
        <section className="bs-panel">
          <div className="home-empty">
            <p>
              A binder is where an organization keeps one set of documents,
              under one set of rules. Make an organization and its first binder
              comes with it — or ask somebody to add you to theirs.
            </p>
            <button
              type="button"
              className="bs-btn bs-btn-secondary bs-btn--sm"
              onClick={onCreateOrganization}
            >
              New organization
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="binders-bar">
            <input
              type="search"
              className="bs-input bs-input--sm binders-filter"
              placeholder="Filter binders…"
              aria-label="Filter binders"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div
              className="bs-segmented"
              role="group"
              aria-label="Order binders by"
            >
              {BINDER_SORTS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="bs-seg"
                  aria-pressed={sort === entry.id}
                  onClick={() => setSort(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          {groups.every((group) => group.binders.length === 0) ? (
            <p className="queue-section-empty">
              No binder is called anything like “{filter.trim()}”.
            </p>
          ) : (
            groups.map((group) => (
              <BinderGroupView
                key={group.org ?? "all"}
                org={group.org}
                binders={group.binders}
                onOpenBinder={onOpenBinder}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}

function BinderGroupView({
  org,
  binders,
  onOpenBinder,
}: {
  org: string | null;
  binders: WorkspaceSummary[];
  onOpenBinder: (org: string, binder: string) => void;
}) {
  const name = useOrganizationDisplayName(org ?? "");
  const tiles = (
    <ul className="binders-grid">
      {binders.map((binder) => (
        <BinderTile key={binder.id} binder={binder} onOpen={onOpenBinder} />
      ))}
    </ul>
  );
  if (org === null) return tiles;
  return (
    <section className="binders-group" aria-label={name || org}>
      <h2 className="binders-group-title">{name || org}</h2>
      {tiles}
    </section>
  );
}

/** One binder: what it is for, what you may do in it, and how busy it is. */
function BinderTile({
  binder,
  onOpen,
}: {
  binder: WorkspaceSummary;
  onOpen: (org: string, binder: string) => void;
}) {
  const open = binder.openChangeCount;
  return (
    <li className="binders-tile-item">
      <a
        className="binders-tile"
        href={buildBinderUrl({ org: binder.owner, binder: binder.name })}
        onClick={(event) =>
          followInApp(event, () => onOpen(binder.owner, binder.name))
        }
      >
        <span className="binders-tile-head">
          <span className="binders-tile-mark" aria-hidden="true">
            <AppIcon icon={ICON.binder} size="md" />
          </span>
          <span className="binders-tile-name">
            {formatDocumentName(binder.name)}
          </span>
          <span className="binders-tile-access">
            {describeBinderAccess(binder)}
          </span>
        </span>
        <span className="binders-tile-description">
          {binder.description.trim() || "No description yet."}
        </span>
        <span className="binders-tile-facts">
          <span className="binders-tile-changes">
            <AppIcon icon={ICON.changeRequest} size="sm" />
            {open === 0
              ? "No open change requests"
              : open === 1
                ? "1 open change request"
                : `${open} open change requests`}
          </span>
          {binder.updatedAt ? (
            <span>Updated {formatAge(binder.updatedAt)}</span>
          ) : null}
        </span>
      </a>
    </li>
  );
}
