import { Fragment, Mark as PMMark, Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import {
  combineTransactionSteps,
  getChangedRanges,
  Mark,
  mergeAttributes,
} from "@tiptap/core";
import { v4 as uuidv4 } from "uuid";

export interface TrackedChangesOptions {
  author: string;
}

export interface TrackedMarkAttrs {
  author: string;
  timestamp: number;
  changeId: string;
}

export interface TrackedRange {
  from: number;
  to: number;
}

export type TrackedChangeKind = "insert" | "delete" | "replace";

export interface TrackedChangeRecord extends TrackedMarkAttrs {
  kind: TrackedChangeKind;
  insertedRange?: TrackedRange;
  deletedRange?: TrackedRange;
}

export interface TrackedChangesPluginState {
  trackChanges: boolean;
  changes: Map<string, TrackedChangeRecord>;
}

export interface TrackedChangesTransactionMeta {
  internal?: boolean;
  toggleTrackChanges?: boolean;
  additions?: TrackedChangeRecord[];
  resolvedChangeIds?: string[];
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trackedChanges: {
      acceptChange: (changeId: string) => ReturnType;
      rejectChange: (changeId: string) => ReturnType;
      acceptAllChanges: () => ReturnType;
      rejectAllChanges: () => ReturnType;
      toggleTrackChanges: () => ReturnType;
    };
  }
}

export const trackedChangesPluginKey =
  new PluginKey<TrackedChangesPluginState>("trackedChanges");

function trackedAttrsSpec() {
  return {
    author: {
      default: "",
      parseHTML: (element: HTMLElement) => element.getAttribute("data-author") ?? "",
      renderHTML: (attrs: TrackedMarkAttrs) =>
        attrs.author ? { "data-author": attrs.author } : {},
    },
    timestamp: {
      default: 0,
      parseHTML: (element: HTMLElement) =>
        Number(element.getAttribute("data-timestamp") ?? 0),
      renderHTML: (attrs: TrackedMarkAttrs) =>
        attrs.timestamp ? { "data-timestamp": String(attrs.timestamp) } : {},
    },
    changeId: {
      default: "",
      parseHTML: (element: HTMLElement) => element.getAttribute("data-change-id") ?? "",
      renderHTML: (attrs: TrackedMarkAttrs) =>
        attrs.changeId ? { "data-change-id": attrs.changeId } : {},
    },
  };
}

function readTrackedMeta(
  transaction: Transaction,
): TrackedChangesTransactionMeta | undefined {
  return transaction.getMeta(trackedChangesPluginKey) as
    | TrackedChangesTransactionMeta
    | undefined;
}

export function isTrackedChangesInternalTransaction(transaction: Transaction): boolean {
  const meta = readTrackedMeta(transaction);
  return Boolean(
    meta?.internal ||
      transaction.getMeta("trackedChangesInternal") ||
      transaction.getMeta("y-sync$") ||
      transaction.getMeta("yjs"),
  );
}

function isTrackedChangesContentTransaction(transaction: Transaction): boolean {
  return (
    transaction.steps.length > 0 &&
    transaction.steps.every((step) => step instanceof ReplaceStep)
  );
}

function mapTrackedRange(
  range: TrackedRange | undefined,
  transaction: Transaction,
): TrackedRange | undefined {
  if (!range) return undefined;
  return {
    from: transaction.mapping.map(range.from, -1),
    to: transaction.mapping.map(range.to, 1),
  };
}

function mapTrackedRecord(
  record: TrackedChangeRecord,
  transaction: Transaction,
): TrackedChangeRecord {
  return {
    ...record,
    insertedRange: mapTrackedRange(record.insertedRange, transaction),
    deletedRange: mapTrackedRange(record.deletedRange, transaction),
  };
}

function markFragment(fragment: Fragment, trackedMark: PMMark): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    nodes.push(markNode(node, trackedMark));
  });
  return Fragment.fromArray(nodes);
}

function markNode(node: PMNode, trackedMark: PMMark): PMNode {
  if (node.isText) {
    return trackedMark.isInSet(node.marks) ? node : node.mark(trackedMark.addToSet(node.marks));
  }

  if (node.isLeaf) {
    return node;
  }

  return node.copy(markFragment(node.content, trackedMark));
}

function sortTrackedChanges(records: TrackedChangeRecord[]): TrackedChangeRecord[] {
  return [...records].sort((left, right) => {
    const leftPosition = left.deletedRange?.from ?? left.insertedRange?.from ?? 0;
    const rightPosition = right.deletedRange?.from ?? right.insertedRange?.from ?? 0;

    if (leftPosition !== rightPosition) {
      return rightPosition - leftPosition;
    }

    const leftPriority = left.kind === "insert" ? 0 : 1;
    const rightPriority = right.kind === "insert" ? 0 : 1;
    return rightPriority - leftPriority;
  });
}

interface TrackedChangeWorkItem {
  record: TrackedChangeRecord;
  insertedContent: Fragment;
  deletedContent: Fragment;
}

function buildChangeRecords(
  oldState: EditorState,
  newState: EditorState,
  transactions: readonly Transaction[],
  author: string,
): { transaction: Transaction; records: TrackedChangeRecord[] } | null {
  const contentTransactions = transactions.filter((transaction) => transaction.steps.length > 0);
  if (!contentTransactions.length) {
    return null;
  }

  if (!contentTransactions.every(isTrackedChangesContentTransaction)) {
    return null;
  }

  const combined = combineTransactionSteps(oldState.doc, [...contentTransactions]);
  const changes = getChangedRanges(combined);
  if (!changes.length) {
    return null;
  }

  const transaction = newState.tr;
  const trackedInsert = newState.schema.marks.trackedInsert;
  const trackedDelete = newState.schema.marks.trackedDelete;
  const timestamp = Date.now();
  const records: TrackedChangeRecord[] = [];

  const workItems: TrackedChangeWorkItem[] = [];

  for (const { oldRange, newRange } of changes) {
    const changeId = uuidv4();
    const insertedContent =
      newRange.from === newRange.to
        ? Fragment.empty
        : newState.doc.slice(newRange.from, newRange.to).content;
    const deletedContent =
      oldRange.from === oldRange.to
        ? Fragment.empty
        : oldState.doc.slice(oldRange.from, oldRange.to).content;

    if (oldRange.from === oldRange.to && newRange.from !== newRange.to) {
      workItems.push({
        record: {
          changeId,
          author,
          timestamp,
          kind: "insert",
          insertedRange: {
            from: newRange.from,
            to: newRange.to,
          },
        },
        insertedContent,
        deletedContent,
      });
      continue;
    }

    if (newRange.from === newRange.to && oldRange.from !== oldRange.to) {
      const deletedLength = deletedContent.size;
      workItems.push({
        record: {
          changeId,
          author,
          timestamp,
          kind: "delete",
          deletedRange: {
            from: newRange.from,
            to: newRange.from + deletedLength,
          },
        },
        insertedContent,
        deletedContent,
      });
      continue;
    }

    const deletedLength = deletedContent.size;
    const insertedLength = insertedContent.size;
    workItems.push({
      record: {
        changeId,
        author,
        timestamp,
        kind: "replace",
        deletedRange: {
          from: newRange.from,
          to: newRange.from + deletedLength,
        },
        insertedRange: {
          from: newRange.from + deletedLength,
          to: newRange.from + deletedLength + insertedLength,
        },
      },
      insertedContent,
      deletedContent,
    });
  }

  const workItemsById = new Map<string, TrackedChangeWorkItem>();
  for (const item of workItems) {
    workItemsById.set(item.record.changeId, item);
  }

  for (const record of sortTrackedChanges(workItems.map((item) => item.record))) {
    const change = workItemsById.get(record.changeId);
    if (!change) {
      throw new Error("Tracked change work item was not found");
    }

    const { record: changeRecord, insertedContent, deletedContent } = change;
    const insertMarkAttrs = {
      author: changeRecord.author,
      timestamp: changeRecord.timestamp,
      changeId: changeRecord.changeId,
    };
    const deleteMarkAttrs = {
      author: changeRecord.author,
      timestamp: changeRecord.timestamp,
      changeId: changeRecord.changeId,
    };

    switch (changeRecord.kind) {
      case "insert": {
        if (changeRecord.insertedRange) {
          transaction.addMark(
            changeRecord.insertedRange.from,
            changeRecord.insertedRange.to,
            trackedInsert.create(insertMarkAttrs),
          );
        }
        break;
      }
      case "delete": {
        if (changeRecord.deletedRange && deletedContent.size > 0) {
          transaction.insert(
            changeRecord.deletedRange.from,
            markFragment(deletedContent, trackedDelete.create(deleteMarkAttrs)),
          );
        }
        break;
      }
      case "replace": {
        if (changeRecord.deletedRange && deletedContent.size > 0) {
          transaction.insert(
            changeRecord.deletedRange.from,
            markFragment(deletedContent, trackedDelete.create(deleteMarkAttrs)),
          );
        }

        if (changeRecord.insertedRange && insertedContent.size > 0) {
          transaction.addMark(
            changeRecord.insertedRange.from,
            changeRecord.insertedRange.to,
            trackedInsert.create(insertMarkAttrs),
          );
        }
        break;
      }
    }

    records.push(changeRecord);
  }

  transaction.setMeta(trackedChangesPluginKey, {
    internal: true,
    additions: records,
  });
  transaction.setMeta("addToHistory", false);

  return { transaction, records };
}

export function createTrackedChangesPlugin(author: string) {
  return new Plugin<TrackedChangesPluginState>({
    key: trackedChangesPluginKey,
    state: {
      init: () => ({
        trackChanges: false,
        changes: new Map(),
      }),
      apply: (transaction, value) => {
        const meta = readTrackedMeta(transaction);
        const nextTrackChanges = meta?.toggleTrackChanges ? !value.trackChanges : value.trackChanges;
        const resolvedChangeIds = meta?.resolvedChangeIds ? new Set(meta.resolvedChangeIds) : null;
        const additions = meta?.additions ?? [];

        const mappedChanges = new Map<string, TrackedChangeRecord>();
        for (const [changeId, record] of value.changes) {
          if (resolvedChangeIds?.has(changeId)) {
            continue;
          }
          mappedChanges.set(changeId, mapTrackedRecord(record, transaction));
        }

        for (const record of additions) {
          mappedChanges.set(record.changeId, record);
        }

        return {
          trackChanges: nextTrackChanges,
          changes: mappedChanges,
        };
      },
    },
    appendTransaction: (transactions, oldState, newState) => {
      if (transactions.some(isTrackedChangesInternalTransaction)) {
        return null;
      }

      const trackedState = trackedChangesPluginKey.getState(newState);
      if (!trackedState?.trackChanges) {
        return null;
      }

      return buildChangeRecords(oldState, newState, transactions, author)?.transaction ?? null;
    },
  });
}

export const TrackedInsert = Mark.create({
  name: "trackedInsert",
  inclusive: false,
  addAttributes() {
    return trackedAttrsSpec();
  },
  parseHTML() {
    return [{ tag: "span.bs-insert" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "bs-insert" }), 0];
  },
});

export const TrackedDelete = Mark.create({
  name: "trackedDelete",
  excludes: "_",
  inclusive: false,
  addAttributes() {
    return trackedAttrsSpec();
  },
  parseHTML() {
    return [{ tag: "span.bs-delete" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "bs-delete" }), 0];
  },
});
