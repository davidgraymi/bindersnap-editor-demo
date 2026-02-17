import React, { useCallback, useState, useRef, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import Color from "@tiptap/extension-color";
import {
  FontSize,
  LineHeight,
  TextStyle,
  FontFamily,
} from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import { Eye, EyeOff } from "lucide-react";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu";
import { VersionControlPanel } from "./VersionControl/VersionControlPanel";
import { VersionControl } from "../extensions/VersionControl";
import { gitService } from "../services/GitService";
import { RichTextToolbar } from "./RichTextToolbar";

interface EditorProps {
  initialContent?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  className?: string;
}

export const Editor = ({
  initialContent = "",
  onChange,
  placeholder = "Start typing your document...",
  className = "",
}: EditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
      }),
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true }),
      FontSize,
      FontFamily,
      TextStyle,
      LineHeight,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      VersionControl,
      BubbleMenuExtension.configure({
        pluginKey: "mergeBubbleMenu",
        shouldShow: ({ editor }) => {
          // Custom logic handled in component, but extension needs to be active
          return editor.isActive("insertion") || editor.isActive("deletion");
        },
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "editor-content-area",
      },
    },
  });

  // State
  const [showVcPanel, setShowVcPanel] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [originalContent, setOriginalContent] = useState("");

  // Resize Handlers
  const startResizing = useCallback((mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        // Calculate new width based on mouse position from right edge of container
        // Assuming the panel is on the right
        const editorRect = document
          .querySelector(".demo-editor")
          ?.getBoundingClientRect();
        if (editorRect) {
          const newWidth = editorRect.right - mouseMoveEvent.clientX;
          if (newWidth > 200 && newWidth < 800) {
            // Min/Max constraints
            setSidebarWidth(newWidth);
          }
        }
      }
    },
    [isResizing],
  );

  useEffect(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);

  // Update editor content if initialContent changes externally (e.g. branch switch)
  useEffect(() => {
    if (editor && !isPreviewMode && initialContent !== editor.getHTML()) {
      editor.commands.setContent(initialContent);
    }
  }, [initialContent, editor, isPreviewMode]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isPreviewMode);
    }
  }, [isPreviewMode, editor]);

  // Handle Keyboard Shortcuts (Ctrl+S / Cmd+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (editor && !isPreviewMode) {
          const content = editor.getHTML();
          const timestamp = new Date().toLocaleTimeString();
          gitService.commit(`Auto-save at ${timestamp}`, content);

          // Force panel refresh by dispatching a custom event or relying on prop updates
          // For this simple demo, we rely on the user opening/interacting with panel to see changes,
          // or we could expose a refresh trigger.
          // However, since VersionControlPanel is inside Editor, we can pass a refresh signal if we lift state,
          // but simpler is that gitService is shared.
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor, isPreviewMode]);

  const handlePreviewDiff = (ours: string, theirs: string) => {
    if (!editor) return;

    if (!isPreviewMode) {
      setOriginalContent(editor.getHTML());
    }

    // Use the extension command
    editor.commands.setDiffContent(ours, theirs);
    setIsPreviewMode(true);
  };

  const handleExitPreview = () => {
    if (!editor) return;
    editor.commands.setContent(originalContent);
    setIsPreviewMode(false);
    setOriginalContent("");
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  const toggleFullScreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleFullScreenChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullScreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullScreenChange);
  }, []);

  return (
    <div className={`demo-editor ${className}`} ref={containerRef}>
      {isPreviewMode && (
        <div
          style={{
            background: "#fff7ed",
            padding: "8px 16px",
            borderBottom: "1px solid #fed7aa",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "#c2410c",
            fontSize: "13px",
            fontWeight: 500,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Eye size={16} />
            Previewing Changes (Read Only)
          </span>
          <button
            onClick={handleExitPreview}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: "white",
              border: "1px solid #fdba74",
              padding: "4px 10px",
              borderRadius: "4px",
              cursor: "pointer",
              color: "#c2410c",
            }}
          >
            <EyeOff size={14} /> Exit Preview
          </button>
        </div>
      )}
      {!isPreviewMode && (
        <RichTextToolbar
          editor={editor}
          showVcPanel={showVcPanel}
          onToggleVcCtrl={() => setShowVcPanel(!showVcPanel)}
          isFullScreen={isFullScreen}
          onToggleFullScreen={toggleFullScreen}
        />
      )}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div className="editor-content-wrapper" style={{ flex: 1 }}>
          <EditorContent editor={editor} />
        </div>

        {showVcPanel && (
          <div
            style={{
              width: sidebarWidth,
              flexShrink: 0,
              height: "100%",
              position: "relative",
            }}
          >
            <div
              className={`resize-handle ${isResizing ? "resizing" : ""}`}
              onMouseDown={startResizing}
            />
            <VersionControlPanel
              getEditorContent={() =>
                isPreviewMode ? originalContent : editor?.getHTML() || ""
              }
              onContentChange={(content) => {
                editor?.commands.setContent(content);
              }}
              onPreviewDiff={handlePreviewDiff}
              isPreviewMode={isPreviewMode}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Editor;
