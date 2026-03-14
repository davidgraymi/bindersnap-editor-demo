/**
 * BindersnapEditor.tsx
 * ─────────────────────────────────────────────────────────────
 * Self-contained Tiptap editor component for Bindersnap.
 *
 * Imports bindersnap-editor.css directly so styling is always
 * co-located with the component — drop it anywhere, it looks right.
 *
 * Usage:
 *   import { BindersnapEditor } from '@/components/editor/BindersnapEditor'
 *
 *   <BindersnapEditor
 *     content="<p>Hello world</p>"
 *     onUpdate={(html) => console.log(html)}
 *   />
 *
 * Props:
 *   content         — Initial HTML string
 *   onUpdate        — Called with new HTML on every change
 *   placeholder     — Placeholder text when editor is empty
 *   editable        — Whether the editor is read/write (default: true)
 *   showToolbar     — Whether to show the toolbar (default: true)
 *   showStatusBar   — Whether to show the status bar (default: true)
 *   showChangeBar   — Highlight paragraphs containing tracked changes (default: false)
 *   diffMode        — 'none' | 'unified' — activates diff view styles
 *   approvalStatus  — 'none' | 'pending' | 'approved' | 'rejected'
 *   saveStatus      — 'saved' | 'saving' | 'error' | 'readonly'
 *   wordCount       — Controlled word count (if undefined, computed internally)
 *   className       — Extra classes for the outer wrapper
 * ───────────────────────────────────────────────────────────── */

import "./bindersnap-editor.css";

import React, { useCallback, useEffect, useMemo } from "react";
import { useEditor, EditorContent, Editor, BubbleMenu } from "@tiptap/react";

// Core extensions
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import Typography from "@tiptap/extension-typography";
import CharacterCount from "@tiptap/extension-character-count";
import { Color } from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";

// ─────────────────────────────────────
// Types
// ─────────────────────────────────────

export type DiffMode = "none" | "unified";
export type ApprovalStatus = "none" | "pending" | "approved" | "rejected";
export type SaveStatus = "saved" | "saving" | "error" | "readonly";

export interface BindersnapEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  showToolbar?: boolean;
  showStatusBar?: boolean;
  showChangeBar?: boolean;
  diffMode?: DiffMode;
  approvalStatus?: ApprovalStatus;
  saveStatus?: SaveStatus;
  wordCount?: number;
  className?: string;
}

// ─────────────────────────────────────
// Toolbar
// ─────────────────────────────────────

interface ToolbarProps {
  editor: Editor;
}

function Toolbar({ editor }: ToolbarProps) {
  return (
    <div
      className="bs-editor__toolbar"
      role="toolbar"
      aria-label="Editor toolbar"
    >
      {/* Text style */}
      <div className="bs-editor__toolbar-group">
        <select
          className="bs-editor__heading-select"
          aria-label="Text style"
          value={
            editor.isActive("heading", { level: 1 })
              ? "1"
              : editor.isActive("heading", { level: 2 })
                ? "2"
                : editor.isActive("heading", { level: 3 })
                  ? "3"
                  : "0"
          }
          onChange={(e) => {
            const val = Number(e.target.value);
            if (val === 0) editor.chain().focus().setParagraph().run();
            else
              editor
                .chain()
                .focus()
                .toggleHeading({ level: val as 1 | 2 | 3 })
                .run();
          }}
        >
          <option value="0">Paragraph</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
      </div>

      <div className="bs-editor__toolbar-divider" />

      {/* Inline marks */}
      <div className="bs-editor__toolbar-group">
        <ToolbarBtn
          label="Bold"
          active={editor.isActive("bold")}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <IconBold />
        </ToolbarBtn>
        <ToolbarBtn
          label="Italic"
          active={editor.isActive("italic")}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <IconItalic />
        </ToolbarBtn>
        <ToolbarBtn
          label="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <IconUnderline />
        </ToolbarBtn>
        <ToolbarBtn
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <IconStrike />
        </ToolbarBtn>
        <ToolbarBtn
          label="Inline code"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <IconCode />
        </ToolbarBtn>
        <ToolbarBtn
          label="Highlight"
          active={editor.isActive("highlight")}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <IconHighlight />
        </ToolbarBtn>
      </div>

      <div className="bs-editor__toolbar-divider" />

      {/* Lists */}
      <div className="bs-editor__toolbar-group">
        <ToolbarBtn
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <IconBulletList />
        </ToolbarBtn>
        <ToolbarBtn
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <IconOrderedList />
        </ToolbarBtn>
        <ToolbarBtn
          label="Task list"
          active={editor.isActive("taskList")}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <IconTaskList />
        </ToolbarBtn>
      </div>

      <div className="bs-editor__toolbar-divider" />

      {/* Block elements */}
      <div className="bs-editor__toolbar-group bs-editor__toolbar-group--secondary">
        <ToolbarBtn
          label="Blockquote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <IconBlockquote />
        </ToolbarBtn>
        <ToolbarBtn
          label="Code block"
          active={editor.isActive("codeBlock")}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <IconCodeBlock />
        </ToolbarBtn>
        <ToolbarBtn
          label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <IconHr />
        </ToolbarBtn>
      </div>

      <div className="bs-editor__toolbar-divider bs-editor__toolbar-group--secondary" />

      {/* History */}
      <div className="bs-editor__toolbar-group">
        <ToolbarBtn
          label="Undo"
          disabled={!editor.can().chain().focus().undo().run()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <IconUndo />
        </ToolbarBtn>
        <ToolbarBtn
          label="Redo"
          disabled={!editor.can().chain().focus().redo().run()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <IconRedo />
        </ToolbarBtn>
      </div>
    </div>
  );
}

interface ToolbarBtnProps {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolbarBtn({
  children,
  label,
  active,
  disabled,
  onClick,
}: ToolbarBtnProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={`bs-editor__btn${active ? " is-active" : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────
// Status bar
// ─────────────────────────────────────

interface StatusBarProps {
  editor: Editor;
  approvalStatus: ApprovalStatus;
  saveStatus: SaveStatus;
  wordCount?: number;
}

function StatusBar({
  editor,
  approvalStatus,
  saveStatus,
  wordCount,
}: StatusBarProps) {
  const count = wordCount ?? editor.storage.characterCount?.words() ?? 0;

  const saveLabel: Record<SaveStatus, string> = {
    saved: "Saved",
    saving: "Saving…",
    error: "Save failed",
    readonly: "Read only",
  };

  const approvalLabel: Record<ApprovalStatus, string | null> = {
    none: null,
    pending: "Pending review",
    approved: "Approved",
    rejected: "Changes requested",
  };

  return (
    <div className="bs-editor__statusbar">
      <div className="bs-editor__statusbar-left">
        <span className="bs-editor__status-item">
          {count} {count === 1 ? "word" : "words"}
        </span>
        {approvalStatus !== "none" && approvalLabel[approvalStatus] && (
          <span className="bs-editor__status-item">
            <span
              className={`bs-editor__status-dot bs-editor__status-dot--${approvalStatus === "approved" ? "saved" : approvalStatus === "rejected" ? "error" : "saving"}`}
            />
            {approvalLabel[approvalStatus]}
          </span>
        )}
      </div>
      <div className="bs-editor__statusbar-right">
        <span className="bs-editor__status-item">
          <span
            className={`bs-editor__status-dot bs-editor__status-dot--${saveStatus}`}
          />
          {saveLabel[saveStatus]}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────
// Main component
// ─────────────────────────────────────

export function BindersnapEditor({
  content = "",
  onUpdate,
  placeholder = "Start writing…",
  editable = true,
  showToolbar = true,
  showStatusBar = true,
  showChangeBar = false,
  diffMode = "none",
  approvalStatus = "none",
  saveStatus = "saved",
  wordCount,
  className = "",
}: BindersnapEditorProps) {
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: { HTMLAttributes: { class: "language-" } },
        bulletList: {},
        orderedList: {},
        blockquote: {},
        horizontalRule: {},
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Underline,
      Typography,
      CharacterCount,
      TextStyle,
      Color,
    ],
    [placeholder],
  );

  const editor = useEditor({
    extensions,
    content,
    editable,
    onUpdate: ({ editor }) => {
      onUpdate?.(editor.getHTML());
    },
  });

  // Sync editable prop changes
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Sync content changes from outside
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;

  // Build class list for the wrapper
  const wrapperClasses = [
    "bs-editor",
    !editable && "bs-editor--readonly",
    diffMode === "unified" && "bs-editor--diff-unified",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // Add show-change-bar class to ProseMirror root via editor props
  const editorProps = useCallback(
    () => ({
      attributes: {
        class: showChangeBar ? "show-change-bar" : "",
      },
    }),
    [showChangeBar],
  );

  editor.setOptions({ editorProps: editorProps() });

  return (
    <div className={wrapperClasses}>
      {showToolbar && editable && <Toolbar editor={editor} />}

      {/* Floating bubble menu for quick inline formatting */}
      {editable && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100, placement: "top" }}
          className="bs-editor__bubble"
        >
          {/* Rendered by host app — provide via portal or children */}
        </BubbleMenu>
      )}

      <div className="bs-editor__scroll">
        <EditorContent editor={editor} />
      </div>

      {showStatusBar && (
        <StatusBar
          editor={editor}
          approvalStatus={approvalStatus}
          saveStatus={saveStatus}
          wordCount={wordCount}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────
// SVG Icons
// All icons are 16×16, stroke-based.
// ─────────────────────────────────────

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 16,
  height: 16,
};

const IconBold = () => (
  <svg {...iconProps}>
    <path d="M4 8h5a2.5 2.5 0 0 0 0-5H4v5zm0 0h5.5a2.5 2.5 0 0 1 0 5H4V8z" />
  </svg>
);
const IconItalic = () => (
  <svg {...iconProps}>
    <line x1="10" y1="3" x2="6" y2="13" />
    <line x1="6" y1="3" x2="10" y2="3" />
    <line x1="6" y1="13" x2="10" y2="13" />
  </svg>
);
const IconUnderline = () => (
  <svg {...iconProps}>
    <path d="M4 3v5a4 4 0 0 0 8 0V3" />
    <line x1="3" y1="14" x2="13" y2="14" />
  </svg>
);
const IconStrike = () => (
  <svg {...iconProps}>
    <line x1="3" y1="8" x2="13" y2="8" />
    <path d="M5 5a3 3 0 0 1 6 0v1H5V5z" />
    <path d="M5 11v1a3 3 0 0 0 6 0v-1" />
  </svg>
);
const IconCode = () => (
  <svg {...iconProps}>
    <polyline points="10 4 13 8 10 12" />
    <polyline points="6 4 3 8 6 12" />
  </svg>
);
const IconHighlight = () => (
  <svg {...iconProps}>
    <path d="M9.5 3 13 6.5l-6 6H3.5V9L9.5 3z" />
    <path d="M3 13h10" />
  </svg>
);
const IconBulletList = () => (
  <svg {...iconProps}>
    <circle cx="3.5" cy="5" r="1" fill="currentColor" />
    <circle cx="3.5" cy="8" r="1" fill="currentColor" />
    <circle cx="3.5" cy="11" r="1" fill="currentColor" />
    <line x1="6" y1="5" x2="13" y2="5" />
    <line x1="6" y1="8" x2="13" y2="8" />
    <line x1="6" y1="11" x2="13" y2="11" />
  </svg>
);
const IconOrderedList = () => (
  <svg {...iconProps}>
    <line x1="6" y1="5" x2="13" y2="5" />
    <line x1="6" y1="8" x2="13" y2="8" />
    <line x1="6" y1="11" x2="13" y2="11" />
    <path d="M3 4h1v3H3M3 9.5c0-.8 1.5-1 1.5 0s-1.5 1-1.5 1.5H5M3 13.5l1.5-1.5L3 12" />
  </svg>
);
const IconTaskList = () => (
  <svg {...iconProps}>
    <rect x="3" y="4" width="3" height="3" rx="0.5" />
    <polyline points="3.75 5.5 4.5 6.25 5.5 4.5" />
    <line x1="8" y1="5.5" x2="13" y2="5.5" />
    <rect x="3" y="10" width="3" height="3" rx="0.5" />
    <line x1="8" y1="11.5" x2="13" y2="11.5" />
  </svg>
);
const IconBlockquote = () => (
  <svg {...iconProps}>
    <path
      d="M4 10a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 0v2m4-6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 4v2"
      strokeWidth={1.5}
    />
  </svg>
);
const IconCodeBlock = () => (
  <svg {...iconProps}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <polyline points="6 7 4 9 6 11" />
    <polyline points="10 7 12 9 10 11" />
  </svg>
);
const IconHr = () => (
  <svg {...iconProps}>
    <line x1="2" y1="8" x2="14" y2="8" />
    <line x1="2" y1="4" x2="14" y2="4" />
    <line x1="2" y1="12" x2="14" y2="12" />
  </svg>
);
const IconUndo = () => (
  <svg {...iconProps}>
    <path d="M3 7h7a3 3 0 0 1 0 6H7" />
    <polyline points="3 4 3 7 6 7" />
  </svg>
);
const IconRedo = () => (
  <svg {...iconProps}>
    <path d="M13 7H6a3 3 0 0 0 0 6h3" />
    <polyline points="13 4 13 7 10 7" />
  </svg>
);

export default BindersnapEditor;
