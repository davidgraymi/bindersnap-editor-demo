import { useCallback, useEffect, useState } from "react";

import { fetchBinderChanges } from "../api";
import type { WorkspaceChangeSummary } from "../../../packages/api-schema/schemas/workspaces";
import {
  describeChangeDocuments,
  workspaceChangeToRecord,
} from "../binderChange";
import type { ChangeFilter } from "./DocumentChanges";
import { DocumentChanges } from "./DocumentChanges";

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
  onAddPolicy: () => void;
}

export function BinderChanges({
  org,
  binder,
  onOpenChange,
  onAddPolicy,
}: BinderChangesProps) {
  const [filter, setFilter] = useState<ChangeFilter>("open");
  const [open, setOpen] = useState<WorkspaceChangeSummary[] | null>(null);
  // Null until the closed list has been asked for: most visits never open it,
  // and a binder's closed changes are its whole history.
  const [closed, setClosed] = useState<WorkspaceChangeSummary[] | null>(null);
  const [closedLoading, setClosedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closedError, setClosedError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOpen(null);
    setClosed(null);
    setError(null);

    fetchBinderChanges(org, binder, "open")
      .then((payload) => {
        if (!cancelled) setOpen(payload.changes);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof Error && err.message.trim() !== ""
            ? err.message
            : "Unable to list this binder's changes.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [org, binder]);

  const loadClosed = useCallback(async () => {
    setClosedLoading(true);
    setClosedError(null);
    try {
      const payload = await fetchBinderChanges(org, binder, "closed");
      setClosed(payload.changes);
    } catch (err) {
      setClosedError(
        err instanceof Error && err.message.trim() !== ""
          ? err.message
          : "Unable to load the decided changes.",
      );
    } finally {
      setClosedLoading(false);
    }
  }, [org, binder]);

  if (error) {
    return <p className="app-inline-error">{error}</p>;
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
            void loadClosed();
          }
        }}
        onOpenChange={onOpenChange}
        onRetryClosed={() => void loadClosed()}
        onSubmitVersion={onAddPolicy}
      />
    </div>
  );
}
