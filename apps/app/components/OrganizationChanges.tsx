import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { workspaceChangeToRecord } from "../binderChange";
import { buildBinderUrl } from "../binderShell";
import { organizationChangesQuery } from "../data/queries";
import type { ChangeRecord } from "../documentDisplay";
import { DocumentChanges } from "./DocumentChanges";
import { SkeletonPanel } from "./Skeleton";

type ChangeFilter = "open" | "published" | "closed";

/** A row of the organization's list knows which binder it is in. */
type OrganizationChangeRecord = ChangeRecord & { binder: string };

/**
 * Every change request in an organization's binders.
 *
 * **A binder's own Change requests list, one level up**, the way a GitLab
 * group lists the merge requests of every project in it: the same panel, the
 * same Open, Published and Closed, the same row — each row leading with its binder,
 * because this list spans them. The organization's sidebar is scoped to it, so
 * the work in flight across its binders is one click from anywhere in it.
 */
export function OrganizationChanges({
  org,
  onOpenChange,
}: {
  org: string;
  onOpenChange: (binder: string, changeNumber: number) => void;
}) {
  const [filter, setFilter] = useState<ChangeFilter>("open");
  const openQuery = useQuery(organizationChangesQuery(org, "open"));
  // Not asked for until Published or Closed is: every binder's closed changes are the
  // organization's whole history.
  const [wantClosed, setWantClosed] = useState(false);
  const closedQuery = useQuery({
    ...organizationChangesQuery(org, "closed"),
    enabled: wantClosed,
  });

  const toRecords = (
    changes: Array<
      Parameters<typeof workspaceChangeToRecord>[0] & {
        binder: string;
      }
    >,
  ): OrganizationChangeRecord[] =>
    changes.map((change) => ({
      ...workspaceChangeToRecord(change),
      binder: change.binder,
    }));

  const open = openQuery.data ? toRecords(openQuery.data.changes) : null;
  const closed = closedQuery.data ? toRecords(closedQuery.data.changes) : null;
  const closedLoading = closedQuery.isFetching && !closedQuery.data;

  const loadClosed = () => {
    if (wantClosed) void closedQuery.refetch();
    else setWantClosed(true);
  };

  if (openQuery.error) {
    return (
      <p className="bs-note bs-note--danger" role="alert">
        {openQuery.error.message ||
          "Unable to list this organization's changes."}
      </p>
    );
  }

  if (open === null) {
    return (
      <SkeletonPanel label="Gathering the change requests" rows={3} bar right />
    );
  }

  return (
    <DocumentChanges
      isAnonymous={false}
      filter={filter}
      openChanges={open}
      closedChanges={closed}
      closedLoading={closedLoading}
      closedError={
        closedQuery.error
          ? closedQuery.error.message || "Unable to load the decided changes."
          : null
      }
      binderOf={(change) =>
        (change as Partial<OrganizationChangeRecord>).binder ?? null
      }
      onFilterChange={(next) => {
        setFilter(next);
        if (next !== "open" && closed === null && !closedLoading) {
          loadClosed();
        }
      }}
      onOpenChange={(number, binder) => {
        if (binder) onOpenChange(binder, number);
      }}
      changeHref={(number, binder) =>
        buildBinderUrl({
          org,
          binder: binder ?? "",
          tab: "changes",
          change: number,
        })
      }
      onRetryClosed={loadClosed}
      org={org}
    />
  );
}
