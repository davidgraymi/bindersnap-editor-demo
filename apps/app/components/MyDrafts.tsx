import { useQuery } from "@tanstack/react-query";
import { AppIcon, ICON } from "./AppIcon";

import type { MyDraft } from "../../../packages/api-schema/schemas/workspaces";
import { followInApp, navigateToHref } from "../appLink";
import { buildBinderUrl } from "../binderShell";
import { myDraftsQuery } from "../data/queries";
import { formatAge, formatDocumentName } from "../documentDisplay";
import { SkeletonPanel } from "./Skeleton";

/**
 * **Your drafts, in one list** — under Your work every binder's, under an
 * organization its binders', under a binder its own.
 *
 * A draft is saved work nobody has been asked to review. Left in a binder you
 * moved on from, it is easy to forget, and a change you meant to send for
 * approval sits there unsent: that is what this page is for. So it says
 * plainly which are not proposed yet, and puts them first. Only your own —
 * a draft is private until it is proposed.
 */
export function MyDrafts({
  org,
  binder,
}: {
  /** One organization's drafts; absent, every one you are in. */
  org?: string;
  /** One binder's, in `org`. */
  binder?: string;
}) {
  const query = useQuery(
    myDraftsQuery({
      ...(org ? { org } : {}),
      ...(org && binder ? { binder } : {}),
    }),
  );

  if (query.error) {
    return (
      <p className="bs-note bs-note--danger" role="alert">
        {query.error.message || "Unable to list your drafts."}
      </p>
    );
  }
  if (!query.data) {
    return <SkeletonPanel label="Gathering your drafts" rows={3} bar right />;
  }

  const drafts = query.data.drafts;
  const waiting = drafts.filter((draft) => draft.changeNumber === null);
  const proposed = drafts.filter((draft) => draft.changeNumber !== null);
  // The binder is said on each row only where the list spans binders.
  const spans = !binder;

  if (drafts.length === 0) {
    return (
      <section className="bs-panel" aria-label="Your drafts">
        <div className="bs-empty">
          <p className="bs-empty-lead">You have no drafts here.</p>
          <p>
            When you edit a document, your changes are saved in a draft. Nobody
            is asked to review them until you propose the draft.
          </p>
        </div>
      </section>
    );
  }

  const row = (draft: MyDraft) => {
    const proposedIn = draft.changeNumber;
    const href =
      proposedIn !== null
        ? buildBinderUrl({
            org: draft.organization,
            binder: draft.workspace,
            tab: "changes",
            change: proposedIn,
          })
        : buildBinderUrl({
            org: draft.organization,
            binder: draft.workspace,
            edit: "editing",
            draft: draft.branch,
          });
    const changed =
      draft.documentCount === 0
        ? "Nothing changed yet"
        : draft.documentCount === 1
          ? "1 document changed"
          : `${draft.documentCount} documents changed`;
    const age = draft.updatedAt ? formatAge(draft.updatedAt) : "";
    return (
      <li
        className="bs-row change-row"
        key={`${draft.organization}/${draft.workspace}/${draft.branch}`}
      >
        <span className="bs-row-icon">
          <AppIcon
            icon={ICON.draft}
            size="md"
            className="change-row-icon change-row-icon--open"
          />
        </span>
        <a
          className="bs-row-body change-row-open"
          href={href}
          onClick={(event) => followInApp(event, () => navigateToHref(href))}
        >
          <span className="bs-row-name change-row-title">{draft.name}</span>
          <span className="bs-row-meta">
            {spans ? (
              <span className="change-row-context">
                {formatDocumentName(draft.workspace)} ·{" "}
              </span>
            ) : null}
            {changed}
            {age ? ` · edited ${age}` : ""}
          </span>
        </a>
        <span className="bs-row-right change-row-right">
          <span
            className={`change-standing change-standing--${
              proposedIn !== null ? "awaiting" : "changes"
            }`}
          >
            <span className="change-standing-dot" aria-hidden="true" />
            {proposedIn !== null ? `Proposed · #${proposedIn}` : "Not proposed"}
          </span>
        </span>
      </li>
    );
  };

  return (
    <>
      {waiting.length > 0 ? (
        <section className="bs-panel" aria-labelledby="drafts-waiting">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title" id="drafts-waiting">
              Not proposed yet
            </h2>
            <span className="bs-section-count">{waiting.length}</span>
          </div>
          <p className="drafts-lede">
            Saved, but nobody has been asked to review them. Propose a draft
            when it is ready.
          </p>
          <ul className="bs-row-list">{waiting.map(row)}</ul>
        </section>
      ) : null}
      {proposed.length > 0 ? (
        <section className="bs-panel" aria-labelledby="drafts-proposed">
          <div className="bs-panel-bar">
            <h2 className="bs-panel-bar-title" id="drafts-proposed">
              Proposed
            </h2>
            <span className="bs-section-count">{proposed.length}</span>
          </div>
          <ul className="bs-row-list">{proposed.map(row)}</ul>
        </section>
      ) : null}
    </>
  );
}
