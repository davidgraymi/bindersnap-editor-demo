import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { binderChangesQuery } from "../data/queries";
import type { WorkspaceChangeSummary } from "../../../packages/api-schema/schemas/workspaces";
import {
  describeChangeDocuments,
  workspaceChangeToRecord,
} from "../binderChange";
import type { ChangeFilter } from "./DocumentChanges";
import { DocumentChanges } from "./DocumentChanges";
import { buildBinderUrl } from "../binderShell";

/**
 * The binder's change requests — every revision in flight, and the record of
 * every one that has been decided.
 *
 * The list itself is `DocumentChanges`, unchanged: a change request reads the
 * same whether the thing it revises is a repository or a file in a binder, and
 * a second list would be a second set of status words to keep in step. Only
 * the line under the title differs, because a binder change can touch several
 * documents and the old wording named one version.
 */

interface BinderChangesProps {
  org: string;
  binder: string;
  onOpenChange: (changeNumber: number) => void;
}

export function BinderChanges({
  org,
  binder,
  onOpenChange,
}: BinderChangesProps) {
  const [filter, setFilter] = useState<ChangeFilter>("open");
  const openQuery = useQuery(binderChangesQuery(org, binder, "open"));
  // Not asked for until the Closed filter is: most visits never open it, and
  // a binder's closed changes are its whole history.
  const [wantClosed, setWantClosed] = useState(false);
  const closedQuery = useQuery({
    ...binderChangesQuery(org, binder, "closed"),
    enabled: wantClosed,
  });

  const open: WorkspaceChangeSummary[] | null = openQuery.data?.changes ?? null;
  const closed: WorkspaceChangeSummary[] | null =
    closedQuery.data?.changes ?? null;
  const closedLoading = closedQuery.isFetching && !closedQuery.data;
  const error = openQuery.error
    ? openQuery.error.message || "Unable to list this binder's changes."
    : null;
  const closedError = closedQuery.error
    ? closedQuery.error.message || "Unable to load the decided changes."
    : null;

  const loadClosed = () => {
    if (wantClosed) void closedQuery.refetch();
    else setWantClosed(true);
  };

  if (error) {
    return (
      <p className="bs-note bs-note--danger" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="binder-pane">
      <DocumentChanges
        isAnonymous={false}
        filter={filter}
        openChanges={(open ?? []).map(workspaceChangeToRecord)}
        closedChanges={closed ? closed.map(workspaceChangeToRecord) : null}
        closedLoading={closedLoading}
        closedError={closedError}
        describeSubject={(number) =>
          describeChangeDocuments(
            [...(open ?? []), ...(closed ?? [])].find(
              (change) => change.number === number,
            ) ?? { documents: [] },
          )
        }
        onFilterChange={(next) => {
          setFilter(next);
          if (next === "closed" && closed === null && !closedLoading) {
            loadClosed();
          }
        }}
        onOpenChange={onOpenChange}
        changeHref={(change) =>
          buildBinderUrl({ org, binder, tab: "changes", change })
        }
        onRetryClosed={loadClosed}
        org={org}
      />
    </div>
  );
}
