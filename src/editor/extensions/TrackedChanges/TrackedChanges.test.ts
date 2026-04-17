import { Editor, type CommandProps } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, test } from "bun:test";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { EditorState as PMEditorState } from "@tiptap/pm/state";

import { createTrackedChangesCommands, TrackedChanges, trackedChangesPluginKey } from "./index";

type TextNodeInfo = {
  text: string;
  marks: string[];
  attrs: Record<string, unknown>;
};

type Harness = {
  editor: Editor;
  getState: () => EditorState;
  dispatch: (transaction: Transaction) => void;
  destroy: () => void;
};

const INITIAL_CONTENT = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "hello",
        },
      ],
    },
  ],
};

function createHarness(content = INITIAL_CONTENT): Harness {
  const editor = new Editor({
    element: null,
    injectCSS: false,
    content,
    extensions: [
      StarterKit,
      TrackedChanges.configure({
        author: "Reviewer",
      }),
    ],
  });

  let state = PMEditorState.create({
    doc: editor.state.doc,
    schema: editor.extensionManager.schema,
    plugins: editor.extensionManager.plugins,
  });

  const dispatch = (transaction: Transaction) => {
    state = state.applyTransaction(transaction).state;
  };

  return {
    editor,
    getState: () => state,
    dispatch,
    destroy: () => editor.destroy(),
  };
}

function createCommandProps(harness: Harness): CommandProps {
  const state = harness.getState();

  return {
    editor: harness.editor as unknown as CommandProps["editor"],
    tr: state.tr,
    commands: {} as CommandProps["commands"],
    can: (() => ({} as never)) as CommandProps["can"],
    chain: (() => ({} as never)) as CommandProps["chain"],
    state,
    view: undefined as unknown as CommandProps["view"],
    dispatch: (transaction?: Transaction) => {
      if (transaction) {
        harness.dispatch(transaction);
      }
    },
  } as unknown as CommandProps;
}

function getTextNodes(harness: Harness): TextNodeInfo[] {
  const nodes: TextNodeInfo[] = [];

  harness.getState().doc.descendants((node) => {
    if (!node.isText || !node.text) {
      return;
    }

    nodes.push({
      text: node.text,
      marks: node.marks.map((mark) => mark.type.name),
      attrs: Object.fromEntries(
        node.marks.map((mark) => [mark.type.name, mark.attrs]),
      ),
    });
  });

  return nodes;
}

function getTrackedState(harness: Harness) {
  return trackedChangesPluginKey.getState(harness.getState());
}

function enableTrackChanges(harness: Harness) {
  const commands = createTrackedChangesCommands();
  expect(commands.toggleTrackChanges()(createCommandProps(harness))).toBe(true);
  expect(getTrackedState(harness)?.trackChanges).toBe(true);
}

function selectRange(harness: Harness, from: number, to: number) {
  const transaction = harness.getState().tr.setSelection(
    TextSelection.create(harness.getState().doc, from, to),
  );
  harness.dispatch(transaction);
}

function insertText(harness: Harness, position: number, text: string) {
  selectRange(harness, position, position);
  harness.dispatch(harness.getState().tr.insertText(text));
}

function deleteRange(harness: Harness, from: number, to: number) {
  selectRange(harness, from, to);
  harness.dispatch(harness.getState().tr.deleteSelection());
}

function replaceRange(harness: Harness, from: number, to: number, text: string) {
  selectRange(harness, from, to);
  harness.dispatch(harness.getState().tr.insertText(text));
}

describe("TrackedChanges", () => {
  test("tracks insertions with trackedInsert marks", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      insertText(harness, 6, "!");

      const nodes = getTextNodes(harness);
      const inserted = nodes.find((node) => node.text === "!");

      expect(harness.getState().doc.textContent).toBe("hello!");
      expect(inserted?.marks).toContain("trackedInsert");

      const trackedState = getTrackedState(harness);
      expect(trackedState?.changes.size).toBe(1);
      const record = trackedState && [...trackedState.changes.values()][0];
      expect(record?.kind).toBe("insert");
      expect(record?.insertedRange).toBeTruthy();
    } finally {
      harness.destroy();
    }
  });

  test("tracks deletions with trackedDelete marks and keeps text visible", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      deleteRange(harness, 1, 3);

      const nodes = getTextNodes(harness);
      const deleted = nodes.find((node) => node.text === "he");

      expect(harness.getState().doc.textContent).toBe("hello");
      expect(deleted?.marks).toContain("trackedDelete");

      const trackedState = getTrackedState(harness);
      expect(trackedState?.changes.size).toBe(1);
      const record = trackedState && [...trackedState.changes.values()][0];
      expect(record?.kind).toBe("delete");
      expect(record?.deletedRange).toBeTruthy();
    } finally {
      harness.destroy();
    }
  });

  test("tracks replacements as a delete plus insert pair", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      replaceRange(harness, 2, 4, "ip");

      const nodes = getTextNodes(harness);
      const deleted = nodes.find((node) => node.text === "el");
      const inserted = nodes.find((node) => node.text === "ip");

      expect(harness.getState().doc.textContent).toBe("heliplo");
      expect(deleted?.marks).toContain("trackedDelete");
      expect(inserted?.marks).toContain("trackedInsert");

      const trackedState = getTrackedState(harness);
      expect(trackedState?.changes.size).toBe(1);
      const record = trackedState && [...trackedState.changes.values()][0];
      expect(record?.kind).toBe("replace");
      expect(record?.deletedRange).toBeTruthy();
      expect(record?.insertedRange).toBeTruthy();
    } finally {
      harness.destroy();
    }
  });

  test("acceptChange commits insertions cleanly", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      insertText(harness, 6, "!");

      const trackedState = getTrackedState(harness);
      const changeId = [...(trackedState?.changes.values() ?? [])][0]?.changeId;

      expect(changeId).toBeTruthy();
      const commands = createTrackedChangesCommands();
      expect(commands.acceptChange(changeId as string)(createCommandProps(harness))).toBe(true);

      expect(harness.getState().doc.textContent).toBe("hello!");
      expect(getTextNodes(harness).some((node) => node.marks.includes("trackedInsert"))).toBe(
        false,
      );
      expect(getTrackedState(harness)?.changes.size).toBe(0);
    } finally {
      harness.destroy();
    }
  });

  test("rejectChange restores deletions to their pre-change state", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      deleteRange(harness, 1, 3);

      const trackedState = getTrackedState(harness);
      const changeId = [...(trackedState?.changes.values() ?? [])][0]?.changeId;

      expect(changeId).toBeTruthy();
      const commands = createTrackedChangesCommands();
      expect(commands.rejectChange(changeId as string)(createCommandProps(harness))).toBe(true);

      expect(harness.getState().doc.textContent).toBe("hello");
      expect(getTextNodes(harness).some((node) => node.marks.includes("trackedDelete"))).toBe(
        false,
      );
      expect(getTrackedState(harness)?.changes.size).toBe(0);
    } finally {
      harness.destroy();
    }
  });

  test("acceptAllChanges commits mixed tracked changes", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      insertText(harness, 6, "!");
      deleteRange(harness, 1, 3);

      expect(getTrackedState(harness)?.changes.size).toBe(2);
      const commands = createTrackedChangesCommands();
      expect(commands.acceptAllChanges()(createCommandProps(harness))).toBe(true);

      expect(harness.getState().doc.textContent).toBe("llo!");
      expect(getTextNodes(harness).some((node) => node.marks.includes("trackedInsert"))).toBe(
        false,
      );
      expect(getTextNodes(harness).some((node) => node.marks.includes("trackedDelete"))).toBe(
        false,
      );
      expect(getTrackedState(harness)?.changes.size).toBe(0);
    } finally {
      harness.destroy();
    }
  });

  test("rejectAllChanges restores mixed tracked changes to the original document", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      insertText(harness, 6, "!");
      deleteRange(harness, 1, 3);

      expect(getTrackedState(harness)?.changes.size).toBe(2);
      const commands = createTrackedChangesCommands();
      expect(commands.rejectAllChanges()(createCommandProps(harness))).toBe(true);

      expect(harness.getState().doc.textContent).toBe("hello");
      expect(getTextNodes(harness).some((node) => node.marks.includes("trackedInsert"))).toBe(
        false,
      );
      expect(getTextNodes(harness).some((node) => node.marks.includes("trackedDelete"))).toBe(
        false,
      );
      expect(getTrackedState(harness)?.changes.size).toBe(0);
    } finally {
      harness.destroy();
    }
  });

  test("skips yjs sync transactions", () => {
    const harness = createHarness();

    try {
      enableTrackChanges(harness);
      selectRange(harness, 6, 6);

      const transaction = harness.getState().tr.insertText("!");
      transaction.setMeta("y-sync$", true);
      harness.dispatch(transaction);

      expect(harness.getState().doc.textContent).toBe("hello!");
      expect(getTextNodes(harness).some((node) => node.marks.includes("trackedInsert"))).toBe(
        false,
      );
      expect(getTrackedState(harness)?.changes.size).toBe(0);
    } finally {
      harness.destroy();
    }
  });
});
