import type { CommandProps } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import {
  trackedChangesPluginKey,
  type TrackedChangeRecord,
} from "./plugin";

type ResolutionMode = "accept" | "reject";

function getRecordPosition(record: TrackedChangeRecord): number {
  return record.deletedRange?.from ?? record.insertedRange?.from ?? 0;
}

function getResolutionOrderedRecords(records: TrackedChangeRecord[]): TrackedChangeRecord[] {
  return [...records].sort((left, right) => {
    const leftPosition = getRecordPosition(left);
    const rightPosition = getRecordPosition(right);

    if (leftPosition !== rightPosition) {
      return rightPosition - leftPosition;
    }

    const leftPriority = left.kind === "insert" ? 0 : 1;
    const rightPriority = right.kind === "insert" ? 0 : 1;
    return rightPriority - leftPriority;
  });
}

function resolveTrackedChange(
  transaction: Transaction,
  state: EditorState,
  record: TrackedChangeRecord,
  mode: ResolutionMode,
) {
  const trackedInsert = state.schema.marks.trackedInsert;
  const trackedDelete = state.schema.marks.trackedDelete;

  switch (record.kind) {
    case "insert": {
      if (!record.insertedRange) {
        return;
      }

      if (mode === "accept") {
        transaction.removeMark(record.insertedRange.from, record.insertedRange.to, trackedInsert);
      } else {
        transaction.delete(record.insertedRange.from, record.insertedRange.to);
      }
      break;
    }
    case "delete": {
      if (!record.deletedRange) {
        return;
      }

      if (mode === "accept") {
        transaction.delete(record.deletedRange.from, record.deletedRange.to);
      } else {
        transaction.removeMark(record.deletedRange.from, record.deletedRange.to, trackedDelete);
      }
      break;
    }
    case "replace": {
      if (!record.deletedRange || !record.insertedRange) {
        return;
      }

      if (mode === "accept") {
        transaction.delete(record.deletedRange.from, record.deletedRange.to);
        const mappedInsertedFrom = transaction.mapping.map(record.insertedRange.from, -1);
        const mappedInsertedTo = transaction.mapping.map(record.insertedRange.to, 1);
        transaction.removeMark(mappedInsertedFrom, mappedInsertedTo, trackedInsert);
      } else {
        transaction.delete(record.insertedRange.from, record.insertedRange.to);
        transaction.removeMark(record.deletedRange.from, record.deletedRange.to, trackedDelete);
      }
      break;
    }
  }
}

function resolveTrackedChanges(
  transaction: Transaction,
  state: EditorState,
  records: TrackedChangeRecord[],
  mode: ResolutionMode,
) {
  for (const record of getResolutionOrderedRecords(records)) {
    resolveTrackedChange(transaction, state, record, mode);
  }
}

function dispatchResolution(
  context: Pick<CommandProps, "state" | "dispatch">,
  mode: ResolutionMode,
  changeId?: string,
): boolean {
  const trackedState = trackedChangesPluginKey.getState(context.state);
  if (!trackedState) {
    return false;
  }

  const records =
    changeId !== undefined
      ? trackedState.changes.has(changeId)
        ? [trackedState.changes.get(changeId)!]
        : []
      : [...trackedState.changes.values()];

  if (!records.length) {
    return false;
  }

  if (!context.dispatch) {
    return true;
  }

  const transaction = context.state.tr;
  if (changeId !== undefined) {
    resolveTrackedChange(transaction, context.state, records[0], mode);
  } else {
    resolveTrackedChanges(transaction, context.state, records, mode);
  }

  transaction.setMeta(trackedChangesPluginKey, {
    internal: true,
    resolvedChangeIds: records.map((record) => record.changeId),
  });

  context.dispatch(transaction);
  return true;
}

export function createTrackedChangesCommands() {
  return {
    acceptChange:
      (changeId: string) =>
      (context: CommandProps) =>
        dispatchResolution(context, "accept", changeId),

    rejectChange:
      (changeId: string) =>
      (context: CommandProps) =>
        dispatchResolution(context, "reject", changeId),

    acceptAllChanges:
      () =>
      (context: CommandProps) =>
        dispatchResolution(context, "accept"),

    rejectAllChanges:
      () =>
      (context: CommandProps) =>
        dispatchResolution(context, "reject"),

    toggleTrackChanges:
      () =>
      ({ state, dispatch }: CommandProps) => {
        if (!dispatch) {
          return true;
        }

        const transaction = state.tr;
        transaction.setMeta(trackedChangesPluginKey, {
          toggleTrackChanges: true,
        });
        dispatch(transaction);
        return true;
      },
  };
}
