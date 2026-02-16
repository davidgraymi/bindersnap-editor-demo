import {
  Extension,
  isMarkActive,
  Mark,
  mergeAttributes,
  getMarkRange,
  getMarksBetween,
} from "@tiptap/core";
import { diffHtml } from "../utils/htmlDiff";
import type { CommandProps, Editor, MarkRange } from "@tiptap/core";

const LOG_ENABLED = true;

export const MARK_DELETION = "deletion";
export const MARK_INSERTION = "insertion";
export const MARK_FORMAT_CHANGE = "formatChange";
export const EXTENSION_NAME = "versionHistory";

// Merge operations
export const MERGE_COMMAND_OURS = "ours";
export const MERGE_COMMAND_OURS_ALL = "ours-all";
export const MERGE_COMMAND_THEIRS = "theirs";
export const MERGE_COMMAND_THEIRS_ALL = "theirs-all";

export type MERGE_COMMAND_TYPE = "ours" | "ours-all" | "theirs" | "theirs-all";

export type VERSION_CONTROL_TYPE = "none" | "compare" | "merge";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    versionHistory: {
      /**
       * Set the content of the editor
       * @param ours The content of the editor that is being merged into
       * @param theirs The content of the editor that is being merged from
       * @param base The content of the editor that is the common ancestor of ours and theirs
       * @returns
       */
      setDiffContent: (
        ours: string,
        theirs: string,
        base?: string,
      ) => ReturnType;
      /**
       * Set the version control mode
       * @param type 'none' | 'compare' | 'merge'
       * @returns
       */
      setVersionControl: (type: VERSION_CONTROL_TYPE) => ReturnType;
      /**
       * Get the version control mode
       * @param
       * @returns
       */
      isViewNone: () => ReturnType;
      isViewComparing: () => ReturnType;
      isViewMerging: () => ReturnType;
      acceptOurs: () => ReturnType;
      acceptTheirs: () => ReturnType;
      acceptOursAll: () => ReturnType;
      acceptTheirsAll: () => ReturnType;
    };
  }
}

export interface VersionHistoryOptions {
  view: VERSION_CONTROL_TYPE;
  onViewChange: (view: VERSION_CONTROL_TYPE) => void;
}

export interface VersionHistoryStorage {
  ours: string;
  theirs: string;
  base?: string;
}

// Insert mark
export const Insertion = Mark.create({
  name: MARK_INSERTION,

  parseHTML() {
    return [{ tag: "insert" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "insert",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});

// Delete mark
export const Deletion = Mark.create({
  name: MARK_DELETION,

  parseHTML() {
    return [{ tag: "delete" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "delete",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});

export const FormatChange = Mark.create({
  name: MARK_FORMAT_CHANGE,

  parseHTML() {
    return [{ tag: "format-change" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "format-change",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});

const getSelfExt = (editor: Editor) =>
  editor.extensionManager.extensions.find(
    (item) => item.type === "extension" && item.name === EXTENSION_NAME,
  ) as Extension;

/**
 * Apply a merge operation
 * @param opType operation to apply 'ours' | 'ours-all' | 'theirs' | 'theirs-all'
 * @param param a command props, so we can get the editor, tr prop
 * @returns boolean
 */
const applyMergeOperation = (
  opType: MERGE_COMMAND_TYPE,
  param: CommandProps,
): boolean => {
  /**
   * get the range to deal, use selection default
   */
  const from = param.editor.state.selection.from;
  const to = param.editor.state.selection.to;
  /**
   * find all the mark ranges to deal and remove mark or remove content according by opType
   * if got accept all or reject all, just set 'from' to 0 and 'to' to content size
   * if got just a part range,
   */
  let markRanges: Array<MarkRange> = [];
  /**
   * deal a part and no selection contents, need to recognize the left mark near by cursor
   */
  if (
    (opType === MERGE_COMMAND_THEIRS || opType === MERGE_COMMAND_OURS) &&
    from === to
  ) {
    // detect left mark
    const isInsertBeforeCursor = isMarkActive(
      param.editor.state,
      MARK_INSERTION,
    );
    const isDeleteBeforeCursor = isMarkActive(
      param.editor.state,
      MARK_DELETION,
    );
    let leftRange;
    if (isInsertBeforeCursor) {
      leftRange = getMarkRange(
        param.editor.state.selection.$from,
        param.editor.state.doc.type.schema.marks.insertion,
      );
    } else if (isDeleteBeforeCursor) {
      leftRange = getMarkRange(
        param.editor.state.selection.$from,
        param.editor.state.doc.type.schema.marks.deletion,
      );
    }
    if (leftRange) {
      markRanges = getMarksBetween(
        leftRange.from,
        leftRange.to,
        param.editor.state.doc,
      );
    }
  } else if (
    opType === MERGE_COMMAND_THEIRS_ALL ||
    opType === MERGE_COMMAND_OURS_ALL
  ) {
    // all editor content
    markRanges = getMarksBetween(
      0,
      param.editor.state.doc.content.size,
      param.editor.state.doc,
    );
    // change the opType to normal
    opType =
      opType === MERGE_COMMAND_THEIRS_ALL
        ? MERGE_COMMAND_THEIRS
        : MERGE_COMMAND_OURS;
  } else {
    // just the selection
    markRanges = getMarksBetween(from, to, param.editor.state.doc);
  }
  // just deal the track change nodes
  markRanges = markRanges.filter(
    (markRange) =>
      markRange.mark.type.name === MARK_DELETION ||
      markRange.mark.type.name === MARK_INSERTION,
  );
  if (!markRanges.length) {
    return false;
  }

  const currentTr = param.tr;
  /**
   * mark type and opType compose:
   * 1. accept with insert mark: remove insert mark
   * 2. accept with delete mark: remove content
   * 3. reject with insert mark: remove content
   * 4. reject with delete mark: remove delete mark
   * so
   * 1 and 4 need to remove mark
   * 2 and 3 need to remove content
   */
  // record offset when delete some content to find the correct pos for next range
  let offset = 0;
  const removeInsertMark =
    param.editor.state.doc.type.schema.marks.insertion.create();
  const removeDeleteMark =
    param.editor.state.doc.type.schema.marks.deletion.create();
  markRanges.forEach((markRange) => {
    const isAcceptInsert =
      opType === MERGE_COMMAND_THEIRS &&
      markRange.mark.type.name === MARK_INSERTION;
    const isRejectDelete =
      opType === MERGE_COMMAND_OURS &&
      markRange.mark.type.name === MARK_DELETION;
    if (isAcceptInsert || isRejectDelete) {
      // 1 and 4: remove mark
      currentTr.removeMark(
        markRange.from - offset,
        markRange.to - offset,
        removeInsertMark.type,
      );
      currentTr.removeMark(
        markRange.from - offset,
        markRange.to - offset,
        removeDeleteMark.type,
      );
    } else {
      // 2 and 3 remove content
      currentTr.deleteRange(markRange.from - offset, markRange.to - offset);
      // change the offset
      offset += markRange.to - markRange.from;
    }
  });
  if (currentTr.steps.length) {
    // set a custom meta to tail Our TrackChangeExtension to ignore this change
    // TODO: is there any official field to do this?
    currentTr.setMeta("trackManualChanged", true);
    // apply to current editor state and get a new state
    const newState = param.editor.state.apply(currentTr);
    // update the new state to editor to render new content
    param.editor.view.updateState(newState);
  }
  return false;
};

export const VersionHistory = Extension.create<
  VersionHistoryOptions,
  VersionHistoryStorage
>({
  name: EXTENSION_NAME,

  onCreate() {
    if (this.options.onViewChange) {
      this.options.onViewChange(this.options.view);
    }
  },

  addExtensions() {
    return [Insertion, Deletion, FormatChange];
  },

  addOptions() {
    return {
      view: "none",
      onViewChange: () => {},
    };
  },

  addStorage() {
    return {
      ours: "",
      theirs: "",
      base: undefined,
    };
  },

  addCommands() {
    return {
      setDiffContent:
        (ours: string, theirs: string, base?: string) =>
        ({ commands }) => {
          // TODO: handle base
          const html = diffHtml(ours, theirs);
          return commands.setContent(html);
        },
      setVersionControl: (view: VERSION_CONTROL_TYPE) => () => {
        this.options.view = view;
        if (this.options.onViewChange) {
          this.options.onViewChange(this.options.view);
        }
        return false;
      },
      isViewNone: () => () => {
        return this.options.view === "none";
      },
      isViewComparing: () => () => {
        return this.options.view === "compare";
      },
      isViewMerging: () => () => {
        return this.options.view === "merge";
      },
      acceptOurs: () => (param: CommandProps) => {
        if (this.options.view === "merge") {
          applyMergeOperation(MERGE_COMMAND_OURS, param);
        }
        return false;
      },
      acceptTheirs: () => (param: CommandProps) => {
        if (this.options.view === "merge") {
          applyMergeOperation(MERGE_COMMAND_THEIRS, param);
        }
        return false;
      },
      acceptOursAll: () => (param: CommandProps) => {
        if (this.options.view === "merge") {
          applyMergeOperation(MERGE_COMMAND_OURS_ALL, param);
        }
        return false;
      },
      acceptTheirsAll: () => (param: CommandProps) => {
        if (this.options.view === "merge") {
          applyMergeOperation(MERGE_COMMAND_THEIRS_ALL, param);
        }
        return false;
      },
    };
  },

  // @ts-ignore
  onSelectionUpdate(p) {
    // log the status for debug
    LOG_ENABLED &&
      console.log(
        "selection and input status",
        p.transaction.selection.from,
        p.transaction.selection.to,
        p.editor.view.composing,
      );
  },
});
