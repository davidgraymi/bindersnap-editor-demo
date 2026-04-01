/**
 * BindersnapEditor.tsx
 * ─────────────────────────────────────────────────────────────
 * Self-contained Tiptap editor component for Bindersnap.
 *
 * Imports bindersnap-editor.css directly so styling is always
 * co-located with the component — drop it anywhere, it looks right.
 */

import "./assets/bindersnap-editor.css";

import React, {
  useCallback,
  useState,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import type { Content } from "@tiptap/react";
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
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Code,
  Copy,
  ClipboardPaste,
  List,
  ListOrdered,
  CheckSquare,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Undo,
  Redo,
  Link as LinkIcon,
  Image as ImageIcon,
  Highlighter,
  Minus,
  Eraser,
  Quote,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Indent,
  Outdent,
  Table as TableIcon,
  ChevronDown,
  Type,
  GitGraph,
  GitMergeConflict,
  MessageSquare,
  Eye,
  EyeOff,
  Maximize,
  Minimize,
} from "lucide-react";

import { VersionControlPanel } from "./components/VersionControl/VersionControlPanel";
import { CommentSidebar, type CommentThread } from "./sidebar/CommentSidebar";
import { ApprovalStatusBanner } from "./extensions/ApprovalStatus";
import {
  CommentAnchor,
  getCommentAnchorState,
} from "./extensions/CommentAnchor";
import { VersionHistory } from "./extensions/VersionHistory";
import { Conflict } from "./extensions/conflict";
import { gitService } from "./services/GitService";
import { sanitizeHtml, sanitizeProseMirrorJson } from "../services/sanitizer";
import type { ApprovalState } from "../services/gitea/pullRequests";

// --- Types ---
interface ToolbarProps {
  editor: Editor | null;
  showVcPanel: boolean;
  showCommentsPanel: boolean;
  hasComments: boolean;
  onToggleVcCtrl: () => void;
  onToggleCommentsPanel: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
}

interface EditorProps {
  initialContent?: Content;
  onChange?: (content: Content) => void;
  placeholder?: string;
  className?: string;
  comments?: CommentThread[];
  approvalState?: ApprovalState;
  prUrl?: string;
  onSubmitForReview?: () => void;
  onApprove?: () => void;
  onRequestChanges?: () => void;
  /** Optional Gitea-backed panel to replace the in-memory VC panel. */
  giteaHistoryPanel?: React.ReactNode;
}

const sanitizeContentForEditor = (content: Content): Content => {
  if (typeof content === "string") {
    return sanitizeHtml(content);
  }

  if (Array.isArray(content)) {
    return sanitizeProseMirrorJson({
      type: "doc",
      content,
    });
  }

  if (content && typeof content === "object") {
    return sanitizeProseMirrorJson(content);
  }

  return content;
};

const resolveCommentAnchor = (comment: CommentThread) => comment.anchor ?? null;

const readCssLengthPx = (element: HTMLElement, propertyName: string) => {
  const styles = getComputedStyle(element);
  const raw = styles.getPropertyValue(propertyName).trim();

  if (!raw) {
    return null;
  }

  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = raw;
  element.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();

  return Number.isFinite(width) && width > 0 ? width : null;
};

// --- Font Options ---
const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Arial", value: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  {
    label: "Arial Black",
    value: '"Arial Black", "Arial Bold", Gadget, sans-serif',
  },
  {
    label: "Bodoni",
    value: '"Bodoni 72", "Bodoni MT", Bodoni, "Huppert", serif',
  },
  {
    label: "Book Antiqua",
    value:
      '"Book Antiqua", Palatino, "Palatino Linotype", "Palatino LT STD", "Georgia", serif',
  },
  {
    label: "Bradley Hand",
    value: '"Bradley Hand", "Bradley Hand ITC", cursive',
  },
  {
    label: "Brush Script MT",
    value: '"Brush Script MT", "Brush Script Std", cursive',
  },
  {
    label: "Calibri",
    value: 'Calibri, Candara, Segoe, "Segoe UI", Optima, Arial, sans-serif',
  },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Candara", value: "Candara, sans-serif" },
  {
    label: "Century Gothic",
    value: '"Century Gothic", CenturyGothic, AppleGothic, sans-serif',
  },
  { label: "Comic Sans MS", value: '"Comic Sans MS", cursive, sans-serif' },
  { label: "Consolas", value: "Consolas, monaco, monospace" },
  {
    label: "Copperplate",
    value: 'Copperplate, "Copperplate Gothic Light", sans-serif',
  },
  {
    label: "Courier New",
    value:
      '"Courier New", Courier, "Lucida Sans Typewriter", "Lucida Typewriter", monospace',
  },
  {
    label: "Didot",
    value:
      'Didot, "Didot LT STD", "Hoefler Text", Garamond, "Times New Roman", serif',
  },
  {
    label: "Franklin Gothic",
    value:
      '"Franklin Gothic Medium", "Franklin Gothic", "ITC Franklin Gothic", Arial, sans-serif',
  },
  {
    label: "Garamond",
    value:
      '"EB Garamond", Garamond, "Baskerville", "Baskerville Old Face", "Hoefler Text", "Times New Roman", serif',
  },
  { label: "Geist", value: "var(--brand-font-sans)" },
  { label: "Geist Mono", value: "var(--brand-font-mono)" },
  { label: "Georgia", value: 'Georgia, Times, "Times New Roman", serif' },
  {
    label: "Helvetica",
    value: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  {
    label: "Impact",
    value:
      'Impact, Haettenschweiler, "Franklin Gothic Bold", Charcoal, "Helvetica Inserat", "Bitstream Vera Sans Bold", "Arial Black", sans-serif',
  },
  { label: "Inter", value: '"Inter", sans-serif' },
  { label: "Lato", value: '"Lato", sans-serif' },
  { label: "Lora", value: "var(--brand-font-serif)" },
  {
    label: "Lucida Console",
    value:
      '"Lucida Console", "Lucida Sans Typewriter", "Monaco", "Bitstream Vera Sans Mono", monospace',
  },
  {
    label: "Lucida Sans Unicode",
    value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif',
  },
  { label: "Merriweather", value: '"Merriweather", serif' },
  {
    label: "Monaco",
    value:
      'Monaco, "Bitstream Vera Sans Mono", "Lucida Console", Terminal, monospace',
  },
  { label: "Montserrat", value: '"Montserrat", sans-serif' },
  { label: "Open Sans", value: '"Open Sans", sans-serif' },
  { label: "Oswald", value: '"Oswald", sans-serif' },
  {
    label: "Palatino",
    value:
      'Palatino, "Palatino Linotype", "Palatino LT STD", "Book Antiqua", Georgia, serif',
  },
  { label: "Papyrus", value: "Papyrus, fantasy" },
  {
    label: "Perpetua",
    value:
      'Perpetua, Baskerville, "Big Caslon", "Palatino Linotype", Palatino, "URW Palladio L", "Nimbus Roman No9 L", serif',
  },
  { label: "Playfair Display", value: '"Playfair Display", serif' },
  { label: "Roboto", value: '"Roboto", sans-serif' },
  {
    label: "Rockwell",
    value:
      'Rockwell, "Courier Bold", Courier, Georgia, Times, "Times New Roman", serif',
  },
  {
    label: "Segoe UI",
    value: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  { label: "Source Sans Pro", value: '"Source Sans Pro", sans-serif' },
  { label: "Tahoma", value: "Tahoma, Verdana, Segoe, sans-serif" },
  {
    label: "Times New Roman",
    value: '"Times New Roman", Times, Baskerville, Georgia, serif',
  },
  {
    label: "Trebuchet MS",
    value:
      '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", "Lucida Sans", Tahoma, sans-serif',
  },
  { label: "Ubuntu", value: '"Ubuntu", sans-serif' },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
];

const FONT_SIZES = [
  { label: "8", value: "8px" },
  { label: "10", value: "10px" },
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "24", value: "24px" },
  { label: "30", value: "30px" },
  { label: "36", value: "36px" },
  { label: "48", value: "48px" },
  { label: "72", value: "72px" },
];

const HEADING_OPTIONS = [
  { label: "Normal", value: 0 },
  { label: "Heading 1", value: 1 },
  { label: "Heading 2", value: 2 },
  { label: "Heading 3", value: 3 },
  { label: "Heading 4", value: 4 },
  { label: "Heading 5", value: 5 },
  { label: "Heading 6", value: 6 },
];

// --- Dropdown Component ---
interface DropdownProps {
  label: string;
  value: string;
  options: { label: string; value: string | number }[];
  onChange: (value: string | number) => void;
  width?: string;
}

const Dropdown = ({
  label,
  value,
  options,
  onChange,
  width = "var(--brand-space-20)",
}: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        !(menuRef.current && menuRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 48rem)").matches;
    if (!isMobile || !triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(rect.width, 220);
    const left = Math.min(
      Math.max(rect.left, 12),
      window.innerWidth - width - 12,
    );
    const bottom = window.innerHeight - rect.top + 8;

    setMenuStyle({
      position: "fixed",
      left,
      bottom,
      width,
      maxHeight: "45vh",
    });
  }, [isOpen]);

  const selectedLabel =
    options.find((o) => String(o.value) === String(value))?.label || label;

  const renderMenu = (floating = false) => (
    <>
      {floating && (
        <div
          className="bs-editor__dropdown-backdrop"
          onClick={() => setIsOpen(false)}
        />
      )}
      <div
        className="bs-editor__dropdown-menu bs-editor__dropdown-menu--floating"
        style={menuStyle}
        ref={menuRef}
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            className={`bs-editor__dropdown-item ${String(option.value) === String(value) ? "is-active" : ""}`}
            onClick={() => {
              onChange(option.value);
              setIsOpen(false);
            }}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="bs-editor__dropdown" ref={ref} style={{ width }}>
      <button
        className="bs-editor__dropdown-trigger"
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="bs-editor__dropdown-label">{selectedLabel}</span>
        <ChevronDown size={14} />
      </button>
      {isOpen &&
        (typeof document !== "undefined" &&
        window.matchMedia("(max-width: 48rem)").matches
          ? createPortal(renderMenu(true), document.body)
          : renderMenu())}
    </div>
  );
};

// --- Color Picker Component ---
interface ColorPickerProps {
  icon: React.ReactNode;
  color: string;
  onChange: (color: string) => void;
  title: string;
  fallbackColor?: string;
}

const ColorPicker = ({
  icon,
  color,
  onChange,
  title,
  fallbackColor,
}: ColorPickerProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedFallback = fallbackColor || "black";

  return (
    <div className="bs-editor__color-picker" title={title}>
      <button
        className="bs-editor__btn"
        onClick={() => inputRef.current?.click()}
        type="button"
        aria-label={title}
      >
        {icon}
        <div
          className="bs-editor__color-indicator"
          style={{
            backgroundColor: color || resolvedFallback || "currentColor",
          }}
        />
      </button>
      <input
        ref={inputRef}
        type="color"
        value={color || resolvedFallback}
        onChange={(e) => onChange(e.target.value)}
        className="bs-editor__color-input"
        aria-label={title}
      />
    </div>
  );
};

// --- Menu Button Component ---
interface MenuButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
  isLabel?: boolean;
}

const MenuButton = ({
  onClick,
  isActive,
  disabled,
  children,
  title,
  isLabel,
}: MenuButtonProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    type="button"
    className={`bs-editor__btn${isActive ? " is-active" : ""}${isLabel ? " bs-editor__btn--label" : ""}`}
  >
    {children}
  </button>
);

// --- Divider Component ---
const Divider = () => <div className="bs-editor__toolbar-divider" />;

// --- Toolbar Component ---
const Toolbar = ({
  editor,
  showVcPanel,
  showCommentsPanel,
  hasComments,
  onToggleVcCtrl,
  onToggleCommentsPanel,
  isFullScreen,
  onToggleFullScreen,
}: ToolbarProps) => {
  const readCssVar = (name: string) => {
    if (typeof window === "undefined") return "";
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  };

  const [defaultTextColor, setDefaultTextColor] = useState(() =>
    readCssVar("--bs-text-primary"),
  );
  const [defaultHighlightColor, setDefaultHighlightColor] = useState(() =>
    readCssVar("--brand-coral"),
  );
  const [textColor, setTextColor] = useState(defaultTextColor);
  const [highlightColor, setHighlightColor] = useState(defaultHighlightColor);
  const [, forceUpdate] = useState({});

  // Force re-render when selection or content changes so dropdowns reflect current text state
  useEffect(() => {
    if (!editor) return;

    const updateHandler = () => {
      queueMicrotask(() => {
        forceUpdate({});
      });
    };
    editor.on("selectionUpdate", updateHandler);
    editor.on("transaction", updateHandler);

    return () => {
      editor.off("selectionUpdate", updateHandler);
      editor.off("transaction", updateHandler);
    };
  }, [editor]);

  useEffect(() => {
    if (defaultTextColor && defaultHighlightColor) return;

    const resolvedText = readCssVar("--bs-text-primary");
    const resolvedHighlight = readCssVar("--brand-coral");

    if (resolvedText && !defaultTextColor) {
      setDefaultTextColor(resolvedText);
      if (!textColor) setTextColor(resolvedText);
    }

    if (resolvedHighlight && !defaultHighlightColor) {
      setDefaultHighlightColor(resolvedHighlight);
      if (!highlightColor) setHighlightColor(resolvedHighlight);
    }
  }, [defaultTextColor, defaultHighlightColor, highlightColor, textColor]);

  if (!editor) return null;

  const addImage = useCallback(() => {
    const url = window.prompt("Enter image URL:");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("Enter URL:", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const insertTable = useCallback(() => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  }, [editor]);

  const storage = editor.storage as any;
  const resolvedCount = storage.conflict?.resolved ?? 0;
  const totalCount = storage.conflict?.total ?? 0;

  // Helper to get consistent style value across selection, returns sentinel if mixed
  const getSelectionFontFamily = (): string => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      // Cursor position, no selection
      return editor.getAttributes("textStyle").fontFamily || "";
    }

    let fontFamily: string | null = null;
    let hasMixed = false;

    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const textStyleMark = node.marks.find(
          (m) => m.type.name === "textStyle",
        );
        const currentFont = textStyleMark?.attrs?.fontFamily || "";

        if (fontFamily === null) {
          fontFamily = currentFont;
        } else if (fontFamily !== currentFont) {
          hasMixed = true;
        }
      }
    });

    // Return sentinel that won't match any option when mixed
    return hasMixed ? "__mixed__" : fontFamily || "";
  };

  const getSelectionFontSize = (): string => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      // Cursor position, no selection
      return (
        editor.getAttributes("textStyle").fontSize || "var(--brand-text-body)"
      );
    }

    let fontSize: string | null = null;
    let hasMixed = false;

    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const textStyleMark = node.marks.find(
          (m) => m.type.name === "textStyle",
        );
        const currentSize =
          textStyleMark?.attrs?.fontSize || "var(--brand-text-body)";

        if (fontSize === null) {
          fontSize = currentSize;
        } else if (fontSize !== currentSize) {
          hasMixed = true;
        }
      }
    });
    // Return sentinel that won't match any option when mixed
    return hasMixed ? "__mixed__" : fontSize || "var(--brand-text-body)";
  };

  const getCurrentHeading = (): number => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      // Cursor position, check active heading
      for (let i = 1; i <= 6; i++) {
        if (editor.isActive("heading", { level: i })) return i;
      }
      return 0;
    }

    // Check if selection spans multiple block types
    let headingLevel: number | null = null;
    let hasMixed = false;

    editor.state.doc.nodesBetween(from, to, (node) => {
      if (
        node.isBlock &&
        (node.type.name === "heading" || node.type.name === "paragraph")
      ) {
        const currentLevel =
          node.type.name === "heading" ? (node.attrs.level as number) : 0;

        if (headingLevel === null) {
          headingLevel = currentLevel;
        } else if (headingLevel !== currentLevel) {
          hasMixed = true;
        }
      }
    });

    return hasMixed ? -1 : (headingLevel ?? 0);
  };

  const handleHeadingChange = (level: string | number) => {
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor
        .chain()
        .focus()
        .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
        .run();
    }
  };

  const handleFontFamilyChange = (family: string | number) => {
    if (family === "") {
      editor.chain().focus().unsetFontFamily().run();
    } else {
      editor
        .chain()
        .focus()
        .setFontFamily(family as string)
        .run();
    }
  };

  const handleFontSizeChange = (size: string | number) => {
    editor
      .chain()
      .focus()
      .setFontSize(size as string)
      .run();
  };

  const handleTextColorChange = (color: string) => {
    setTextColor(color);
    editor.chain().focus().setColor(color).run();
  };

  const handleHighlightChange = (color: string) => {
    setHighlightColor(color);
    editor.chain().focus().toggleHighlight({ color }).run();
  };

  return (
    <div className="bs-editor__toolbar bs-editor__toolbar--stacked">
      {/* Row 1: History, Font Family, Font Size, Heading */}
      <div className="bs-editor__toolbar-row">
        <MenuButton
          onClick={() => editor.chain().focus().undo().run()}
          title="Undo"
          disabled={!editor.can().undo()}
        >
          <Undo size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().redo().run()}
          title="Redo"
          disabled={!editor.can().redo()}
        >
          <Redo size={16} />
        </MenuButton>

        <Divider />

        <Dropdown
          label="Font"
          value={getSelectionFontFamily()}
          options={FONT_FAMILIES}
          onChange={handleFontFamilyChange}
          width="calc(var(--brand-space-16) * 2)"
        />

        <Dropdown
          label="Size"
          value={getSelectionFontSize()}
          options={FONT_SIZES}
          onChange={handleFontSizeChange}
          width="calc(var(--brand-space-8) * 2)"
        />

        <Divider />

        <Dropdown
          label="Style"
          value={String(getCurrentHeading())}
          options={HEADING_OPTIONS}
          onChange={handleHeadingChange}
          width="var(--brand-space-24)"
        />

        <div className="bs-editor__toolbar-spacer">
          <MenuButton
            onClick={onToggleFullScreen}
            title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
            isActive={isFullScreen}
          >
            {isFullScreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </MenuButton>
        </div>
      </div>

      {/* Row 2: Formatting, Colors, Alignment, Lists, Blocks, Insert */}
      <div className="bs-editor__toolbar-row">
        {/* Text Formatting */}
        <MenuButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <Bold size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <Italic size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive("underline")}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          title="Strikethrough"
        >
          <Strikethrough size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleSubscript().run()}
          isActive={editor.isActive("subscript")}
          title="Subscript"
        >
          <SubscriptIcon size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
          isActive={editor.isActive("superscript")}
          title="Superscript"
        >
          <SuperscriptIcon size={16} />
        </MenuButton>

        <Divider />

        {/* Colors */}
        <ColorPicker
          icon={<Type size={16} />}
          color={textColor}
          onChange={handleTextColorChange}
          title="Text Color"
          fallbackColor={defaultTextColor}
        />
        <ColorPicker
          icon={<Highlighter size={16} />}
          color={highlightColor}
          onChange={handleHighlightChange}
          title="Highlight Color"
          fallbackColor={defaultHighlightColor}
        />

        <Divider />

        {/* Alignment */}
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          isActive={editor.isActive({ textAlign: "left" })}
          title="Align Left"
        >
          <AlignLeft size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          isActive={editor.isActive({ textAlign: "center" })}
          title="Align Center"
        >
          <AlignCenter size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          isActive={editor.isActive({ textAlign: "right" })}
          title="Align Right"
        >
          <AlignRight size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          isActive={editor.isActive({ textAlign: "justify" })}
          title="Justify"
        >
          <AlignJustify size={16} />
        </MenuButton>

        <Divider />

        {/* Indentation */}
        <MenuButton
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
          title="Increase Indent"
          disabled={!editor.can().sinkListItem("listItem")}
        >
          <Indent size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
          title="Decrease Indent"
          disabled={!editor.can().liftListItem("listItem")}
        >
          <Outdent size={16} />
        </MenuButton>

        <Divider />

        {/* Lists */}
        <MenuButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title="Bullet List"
        >
          <List size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title="Numbered List"
        >
          <ListOrdered size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive("taskList")}
          title="Checklist"
        >
          <CheckSquare size={16} />
        </MenuButton>

        <Divider />

        {/* Blocks */}
        <MenuButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          title="Block Quote"
        >
          <Quote size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive("codeBlock")}
          title="Code Block"
        >
          <Code size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus size={16} />
        </MenuButton>

        <Divider />

        {/* Insert */}
        <MenuButton
          onClick={setLink}
          isActive={editor.isActive("link")}
          title="Insert Link"
        >
          <LinkIcon size={16} />
        </MenuButton>
        <MenuButton onClick={addImage} title="Insert Image">
          <ImageIcon size={16} />
        </MenuButton>
        <MenuButton onClick={insertTable} title="Insert Table">
          <TableIcon size={16} />
        </MenuButton>

        <Divider />

        {/* Clear Formatting */}
        <MenuButton
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
          title="Clear Formatting"
        >
          <Eraser size={16} />
        </MenuButton>

        <Divider />

        <MenuButton
          onClick={onToggleVcCtrl}
          isActive={showVcPanel}
          title="Version Control"
        >
          <GitGraph size={16} />
        </MenuButton>

        <MenuButton
          onClick={onToggleCommentsPanel}
          isActive={showCommentsPanel}
          title="Comment Sidebar"
          disabled={!hasComments}
        >
          <MessageSquare size={16} />
        </MenuButton>

        <MenuButton
          onClick={() => {}}
          isActive={showVcPanel}
          title="Conflicts"
          isLabel
        >
          {`${resolvedCount}/${totalCount}`}
        </MenuButton>
      </div>

      {/* Mobile bottom toolbar (touch-friendly) */}
      <div
        className="bs-editor__toolbar-mobile"
        aria-label="Mobile formatting toolbar"
      >
        <MenuButton
          onClick={() => editor.chain().focus().undo().run()}
          title="Undo"
          disabled={!editor.can().undo()}
        >
          <Undo size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().redo().run()}
          title="Redo"
          disabled={!editor.can().redo()}
        >
          <Redo size={16} />
        </MenuButton>

        <Dropdown
          label="Font"
          value={getSelectionFontFamily()}
          options={FONT_FAMILIES}
          onChange={handleFontFamilyChange}
          width="calc(var(--brand-space-16) * 2)"
        />

        <Dropdown
          label="Size"
          value={getSelectionFontSize()}
          options={FONT_SIZES}
          onChange={handleFontSizeChange}
          width="calc(var(--brand-space-8) * 2)"
        />

        <Dropdown
          label="Style"
          value={String(getCurrentHeading())}
          options={HEADING_OPTIONS}
          onChange={handleHeadingChange}
          width="var(--brand-space-20)"
        />

        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          isActive={editor.isActive({ textAlign: "left" })}
          title="Align Left"
        >
          <AlignLeft size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          isActive={editor.isActive({ textAlign: "center" })}
          title="Align Center"
        >
          <AlignCenter size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          isActive={editor.isActive({ textAlign: "right" })}
          title="Align Right"
        >
          <AlignRight size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          isActive={editor.isActive({ textAlign: "justify" })}
          title="Justify"
        >
          <AlignJustify size={16} />
        </MenuButton>

        <MenuButton
          onClick={() => editor.chain().focus().sinkListItem("listItem").run()}
          title="Increase Indent"
          disabled={!editor.can().sinkListItem("listItem")}
        >
          <Indent size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().liftListItem("listItem").run()}
          title="Decrease Indent"
          disabled={!editor.can().liftListItem("listItem")}
        >
          <Outdent size={16} />
        </MenuButton>

        <MenuButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title="Bullet List"
        >
          <List size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title="Numbered List"
        >
          <ListOrdered size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive("taskList")}
          title="Checklist"
        >
          <CheckSquare size={16} />
        </MenuButton>

        <MenuButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          title="Block Quote"
        >
          <Quote size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          isActive={editor.isActive("codeBlock")}
          title="Code Block"
        >
          <Code size={16} />
        </MenuButton>
        <MenuButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal Rule"
        >
          <Minus size={16} />
        </MenuButton>

        <MenuButton onClick={addImage} title="Insert Image">
          <ImageIcon size={16} />
        </MenuButton>
        <MenuButton onClick={insertTable} title="Insert Table">
          <TableIcon size={16} />
        </MenuButton>

        <MenuButton
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
          title="Clear Formatting"
        >
          <Eraser size={16} />
        </MenuButton>

        <MenuButton
          onClick={onToggleVcCtrl}
          isActive={showVcPanel}
          title="Version Control"
        >
          <GitGraph size={16} />
        </MenuButton>

        <MenuButton
          onClick={onToggleCommentsPanel}
          isActive={showCommentsPanel}
          title="Comment Sidebar"
          disabled={!hasComments}
        >
          <MessageSquare size={16} />
        </MenuButton>

        <MenuButton
          onClick={onToggleFullScreen}
          title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
          isActive={isFullScreen}
        >
          {isFullScreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </MenuButton>
      </div>
    </div>
  );
};

// --- Main Editor Component ---
export const DemoEditor = ({
  initialContent = {},
  onChange,
  placeholder = "Start typing your document...",
  className = "",
  comments = [],
  approvalState,
  prUrl,
  onSubmitForReview,
  onApprove,
  onRequestChanges,
  giteaHistoryPanel,
}: EditorProps) => {
  const sanitizedInitialContent = useMemo(
    () => sanitizeContentForEditor(initialContent),
    [initialContent],
  );

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
      CommentAnchor,
      VersionHistory,
      Conflict,
    ],
    content: sanitizedInitialContent,
    onUpdate: ({ editor }) => {
      queueMicrotask(() => {
        onChange?.(editor.getJSON());
      });
    },
    editorProps: {
      attributes: {
        class: "editor-content-area",
        autocorrect: "on",
        autocapitalize: "sentences",
        spellcheck: "true",
        inputmode: "text",
      },
    },
  });

  // console.log(JSON.stringify(editor.getJSON(), null, 2));

  // State
  const [showVcPanel, setShowVcPanel] = useState(false);
  const [showCommentsPanel, setShowCommentsPanel] = useState(
    comments.length > 0,
  );
  const [sidebarWidth, setSidebarWidth] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [originalContent, setOriginalContent] = useState("");
  const [selectionMenu, setSelectionMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
    placement: "above" as "above" | "below",
  });
  const sidebarLimitsRef = useRef({ min: 0, max: Number.POSITIVE_INFINITY });
  const scrollRef = useRef<HTMLDivElement>(null);

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
          .querySelector(".bs-editor")
          ?.getBoundingClientRect();
        if (editorRect) {
          const newWidth = editorRect.right - mouseMoveEvent.clientX;
          const { min, max } = sidebarLimitsRef.current;
          if (newWidth > min && newWidth < max) {
            // Min/Max constraints
            setSidebarWidth(newWidth);
          }
        }
      }
    },
    [isResizing],
  );

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") return;
    const min = readCssLengthPx(
      containerRef.current,
      "--bs-editor-sidebar-min",
    );
    const max = readCssLengthPx(
      containerRef.current,
      "--bs-editor-sidebar-max",
    );
    const initial = readCssLengthPx(
      containerRef.current,
      "--bs-editor-sidebar-default",
    );
    sidebarLimitsRef.current = {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : Number.POSITIVE_INFINITY,
    };
    if (Number.isFinite(initial) && initial > 0) {
      setSidebarWidth(initial);
    }
  }, []);

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
    if (
      editor &&
      !isPreviewMode &&
      sanitizedInitialContent !== undefined &&
      JSON.stringify(sanitizedInitialContent) !==
        JSON.stringify(editor.getJSON())
    ) {
      editor.commands.setContent(sanitizedInitialContent);
    }
  }, [sanitizedInitialContent, editor, isPreviewMode]);

  // Update editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isPreviewMode);
    }
  }, [isPreviewMode, editor]);

  useEffect(() => {
    if (comments.length === 0) {
      setShowCommentsPanel(false);
    }
  }, [comments.length]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const pluginState = getCommentAnchorState(editor.state);
    if (!pluginState) {
      return;
    }

    const staleCommentIds = new Set(pluginState.anchors.keys());

    comments.forEach((comment) => {
      const anchorRange = resolveCommentAnchor(comment);

      if (!anchorRange) {
        return;
      }

      const existing = pluginState?.anchors.get(comment.id);
      if (
        existing?.from === anchorRange.from &&
        existing?.to === anchorRange.to
      ) {
        staleCommentIds.delete(comment.id);
        return;
      }

      editor.commands.addCommentAnchor(
        anchorRange.from,
        anchorRange.to,
        comment.id,
      );

      staleCommentIds.delete(comment.id);
    });

    staleCommentIds.forEach((commentId) => {
      editor.commands.removeCommentAnchor(commentId);
    });
  }, [comments, editor, sanitizedInitialContent]);

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

  const handlePreviewDiff = (base: string, head: string) => {
    if (!editor) return;

    if (!isPreviewMode) {
      setOriginalContent(editor.getHTML());
    }

    // Use the extension command
    editor.commands.setDiffContent(base, head);
    setIsPreviewMode(true);
  };

  const handleExitPreview = () => {
    if (!editor) return;
    editor.commands.setContent(sanitizeContentForEditor(originalContent));
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

  const updateSelectionMenu = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      setSelectionMenu((prev) => ({ ...prev, visible: false }));
      return;
    }

    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const padding = 16;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const rawX = (start.left + end.right) / 2;
      const aboveY = Math.min(start.top, end.top);
      const belowY = Math.max(start.bottom, end.bottom);
      const placement = aboveY < 96 ? "below" : "above";
      const rawY = placement === "below" ? belowY : aboveY;

      const x = Math.min(Math.max(rawX, padding), viewportWidth - padding);
      const y = Math.min(Math.max(rawY, padding), viewportHeight - padding);

      setSelectionMenu({ visible: true, x, y, placement });
    } catch {
      setSelectionMenu((prev) => ({ ...prev, visible: false }));
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const handleSelection = () => {
      requestAnimationFrame(updateSelectionMenu);
    };

    const handleBlur = () => {
      setSelectionMenu((prev) => ({ ...prev, visible: false }));
    };

    editor.on("selectionUpdate", handleSelection);
    editor.on("blur", handleBlur);

    const scrollEl = scrollRef.current;
    scrollEl?.addEventListener("scroll", handleSelection, { passive: true });
    window.addEventListener("resize", handleSelection, { passive: true });

    return () => {
      editor.off("selectionUpdate", handleSelection);
      editor.off("blur", handleBlur);
      scrollEl?.removeEventListener("scroll", handleSelection);
      window.removeEventListener("resize", handleSelection);
    };
  }, [editor, updateSelectionMenu]);

  const handleCopySelection = useCallback(async () => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const text = editor.state.doc.textBetween(from, to, "\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      document.execCommand("copy");
    }
    setSelectionMenu((prev) => ({ ...prev, visible: false }));
  }, [editor]);

  const handlePasteSelection = useCallback(async () => {
    if (!editor) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        editor.chain().focus().insertContent(text).run();
      }
    } catch {
      // Clipboard API may be blocked; fail silently.
    }
    setSelectionMenu((prev) => ({ ...prev, visible: false }));
  }, [editor]);

  const handleSetLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href;
    const url = window.prompt("Enter URL:", previousUrl);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const resolveCssColor = (name: string, fallback: string) => {
    if (typeof window === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value || fallback;
  };

  const toggleVcPanel = useCallback(() => {
    setShowVcPanel((current) => {
      const next = !current;
      if (next) {
        setShowCommentsPanel(false);
      }
      return next;
    });
  }, []);

  const toggleCommentsPanel = useCallback(() => {
    if (comments.length === 0) {
      return;
    }

    setShowCommentsPanel((current) => {
      const next = !current;
      if (next) {
        setShowVcPanel(false);
      }
      return next;
    });
  }, [comments.length]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const containerNode = containerRef.current;
    if (!containerNode) {
      return;
    }

    const handleCommentAnchorClick = (event: MouseEvent) => {
      const clickTarget = event.target;
      if (!(clickTarget instanceof Element)) {
        return;
      }

      const proseMirrorRoot = clickTarget.closest(".ProseMirror");
      if (!(proseMirrorRoot instanceof HTMLElement) || !containerNode.contains(proseMirrorRoot)) {
        return;
      }

      const anchorElement = clickTarget.closest("[data-comment-id]");
      if (!(anchorElement instanceof HTMLElement)) {
        return;
      }

      const { commentId } = anchorElement.dataset;
      if (!commentId) {
        return;
      }

      editor.commands.setActiveComment(commentId);
      setShowVcPanel(false);
      setShowCommentsPanel(true);
    };

    containerNode.addEventListener("click", handleCommentAnchorClick);

    return () => {
      containerNode.removeEventListener("click", handleCommentAnchorClick);
    };
  }, [editor]);

  const showSidebar = showVcPanel || showCommentsPanel;
  const sidebarClassName = showVcPanel
    ? "bs-editor__sidebar"
    : "bs-editor__sidebar bs-editor__sidebar--comments";
  const sidebarStyle =
    sidebarWidth > 0
      ? ({
          "--bs-editor-sidebar-width": `${sidebarWidth}px`,
        } as React.CSSProperties)
      : undefined;

  return (
    <div className={`bs-editor demo-editor ${className}`} ref={containerRef}>
      {isPreviewMode && (
        <div className="bs-editor__preview">
          <span className="bs-editor__preview-label">
            <Eye size={16} />
            Previewing Changes (Read Only)
          </span>
          <button
            onClick={handleExitPreview}
            className="bs-editor__preview-btn"
          >
            <EyeOff size={14} /> Exit Preview
          </button>
        </div>
      )}
      {!isPreviewMode && (
        <Toolbar
          editor={editor}
          showVcPanel={showVcPanel}
          showCommentsPanel={showCommentsPanel}
          hasComments={comments.length > 0}
          onToggleVcCtrl={toggleVcPanel}
          onToggleCommentsPanel={toggleCommentsPanel}
          isFullScreen={isFullScreen}
          onToggleFullScreen={toggleFullScreen}
        />
      )}
      {selectionMenu.visible &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="bs-editor__selection-menu"
            data-placement={selectionMenu.placement}
            style={
              {
                "--bs-selection-x": `${selectionMenu.x}px`,
                "--bs-selection-y": `${selectionMenu.y}px`,
              } as React.CSSProperties
            }
            role="menu"
            aria-label="Selection actions"
          >
            <button
              type="button"
              className="bs-editor__selection-btn"
              onClick={handleCopySelection}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Copy"
              title="Copy"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              className="bs-editor__selection-btn"
              onClick={handlePasteSelection}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Paste"
              title="Paste"
            >
              <ClipboardPaste size={16} />
            </button>
            <button
              type="button"
              className="bs-editor__selection-btn"
              onClick={() => editor?.chain().focus().toggleBold().run()}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Bold"
              title="Bold"
            >
              <Bold size={16} />
            </button>
            <button
              type="button"
              className="bs-editor__selection-btn"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Italic"
              title="Italic"
            >
              <Italic size={16} />
            </button>
            <button
              type="button"
              className="bs-editor__selection-btn"
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Underline"
              title="Underline"
            >
              <UnderlineIcon size={16} />
            </button>
            <button
              type="button"
              className="bs-editor__selection-btn"
              onClick={() =>
                editor
                  ?.chain()
                  .focus()
                  .toggleHighlight({
                    color: resolveCssColor("--brand-coral", "#E85D26"),
                  })
                  .run()
              }
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Highlight"
              title="Highlight"
            >
              <Highlighter size={16} />
            </button>
            <button
              type="button"
              className="bs-editor__selection-btn"
              onClick={handleSetLink}
              onMouseDown={(event) => event.preventDefault()}
              aria-label="Insert Link"
              title="Insert Link"
            >
              <LinkIcon size={16} />
            </button>
          </div>,
          document.body,
      )}
      <div className="bs-editor__main">
        <div className="bs-editor__content">
          {approvalState && (
            <ApprovalStatusBanner
              approvalState={approvalState}
              prUrl={prUrl}
              onSubmitForReview={onSubmitForReview}
              onApprove={onApprove}
              onRequestChanges={onRequestChanges}
            />
          )}
          <div className="bs-editor__scroll" ref={scrollRef}>
            <EditorContent editor={editor} />
          </div>
        </div>

        {showSidebar && (
          <div className={sidebarClassName} style={sidebarStyle}>
            <div
              className={`bs-editor__resize-handle ${isResizing ? "is-resizing" : ""}`}
              onMouseDown={startResizing}
            />
            {showVcPanel ? (
              giteaHistoryPanel ? (
                giteaHistoryPanel
              ) : (
                <VersionControlPanel
                  getEditorContent={() =>
                    isPreviewMode ? originalContent : editor?.getHTML() || ""
                  }
                  onContentChange={(content) => {
                    editor?.commands.setContent(
                      sanitizeContentForEditor(content),
                    );
                  }}
                  onPreviewDiff={handlePreviewDiff}
                  isPreviewMode={isPreviewMode}
                />
              )
            ) : showCommentsPanel ? (
              <CommentSidebar editor={editor} comments={comments} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default DemoEditor;
