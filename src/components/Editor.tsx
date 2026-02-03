import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import FontFamily from '@tiptap/extension-font-family';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, 
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, 
  Undo, Redo, Link as LinkIcon, Image as ImageIcon, 
  Highlighter, Minus, Eraser, Quote, Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon, Indent, Outdent, Table as TableIcon,
  ChevronDown, Type, Palette
} from 'lucide-react';

// --- Types ---
interface ToolbarProps {
  editor: Editor | null;
}

interface EditorProps {
  initialContent?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  className?: string;
}

// --- Font Options ---
const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Comic Sans MS', value: 'Comic Sans MS, cursive' },
];

const FONT_SIZES = [
  { label: '8', value: '8px' },
  { label: '10', value: '10px' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '24', value: '24px' },
  { label: '30', value: '30px' },
  { label: '36', value: '36px' },
  { label: '48', value: '48px' },
  { label: '72', value: '72px' },
];

const HEADING_OPTIONS = [
  { label: 'Normal', value: 0 },
  { label: 'Heading 1', value: 1 },
  { label: 'Heading 2', value: 2 },
  { label: 'Heading 3', value: 3 },
  { label: 'Heading 4', value: 4 },
  { label: 'Heading 5', value: 5 },
  { label: 'Heading 6', value: 6 },
];

// --- Dropdown Component ---
interface DropdownProps {
  label: string;
  value: string;
  options: { label: string; value: string | number }[];
  onChange: (value: string | number) => void;
  width?: string;
}

const Dropdown = ({ label, value, options, onChange, width = '100px' }: DropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find(o => String(o.value) === String(value))?.label || label;

  return (
    <div className="editor-dropdown" ref={ref} style={{ width }}>
      <button 
        className="editor-dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="editor-dropdown-label">{selectedLabel}</span>
        <ChevronDown size={14} />
      </button>
      {isOpen && (
        <div className="editor-dropdown-menu">
          {options.map((option) => (
            <button
              key={String(option.value)}
              className={`editor-dropdown-item ${String(option.value) === String(value) ? 'active' : ''}`}
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
      )}
    </div>
  );
};

// --- Color Picker Component ---
interface ColorPickerProps {
  icon: React.ReactNode;
  color: string;
  onChange: (color: string) => void;
  title: string;
}

const ColorPicker = ({ icon, color, onChange, title }: ColorPickerProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  
  return (
    <div className="editor-color-picker" title={title}>
      <button 
        className="editor-toolbar-btn"
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {icon}
        <div 
          className="editor-color-indicator" 
          style={{ backgroundColor: color || '#000000' }}
        />
      </button>
      <input
        ref={inputRef}
        type="color"
        value={color || '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="editor-color-input"
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
}

const MenuButton = ({ onClick, isActive, disabled, children, title }: MenuButtonProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    type="button"
    className={`editor-toolbar-btn ${isActive ? 'active' : ''}`}
  >
    {children}
  </button>
);

// --- Divider Component ---
const Divider = () => <div className="editor-toolbar-divider" />;

// --- Toolbar Component ---
const Toolbar = ({ editor }: ToolbarProps) => {
  if (!editor) return null;

  const [textColor, setTextColor] = useState('#000000');
  const [highlightColor, setHighlightColor] = useState('#ffff00');

  const addImage = useCallback(() => {
    const url = window.prompt('Enter image URL:');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL:', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const insertTable = useCallback(() => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  const getCurrentHeading = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive('heading', { level: i })) return i;
    }
    return 0;
  };

  const handleHeadingChange = (level: string | number) => {
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    }
  };

  const handleFontFamilyChange = (family: string | number) => {
    if (family === '') {
      editor.chain().focus().unsetFontFamily().run();
    } else {
      editor.chain().focus().setFontFamily(family as string).run();
    }
  };

  const handleFontSizeChange = (size: string | number) => {
    editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
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
    <div className="editor-toolbar">
      {/* Row 1: History, Font Family, Font Size, Heading */}
      <div className="editor-toolbar-row">
        <MenuButton onClick={() => editor.chain().focus().undo().run()} title="Undo" disabled={!editor.can().undo()}>
          <Undo size={16} />
        </MenuButton>
        <MenuButton onClick={() => editor.chain().focus().redo().run()} title="Redo" disabled={!editor.can().redo()}>
          <Redo size={16} />
        </MenuButton>
        
        <Divider />

        <Dropdown
          label="Font"
          value={editor.getAttributes('textStyle').fontFamily || ''}
          options={FONT_FAMILIES}
          onChange={handleFontFamilyChange}
          width="120px"
        />

        <Dropdown
          label="Size"
          value={editor.getAttributes('textStyle').fontSize || '16px'}
          options={FONT_SIZES}
          onChange={handleFontSizeChange}
          width="70px"
        />

        <Divider />

        <Dropdown
          label="Normal"
          value={String(getCurrentHeading())}
          options={HEADING_OPTIONS}
          onChange={handleHeadingChange}
          width="110px"
        />
      </div>

      {/* Row 2: Formatting, Colors, Alignment, Lists, Blocks, Insert */}
      <div className="editor-toolbar-row">
        {/* Text Formatting */}
        <MenuButton 
          onClick={() => editor.chain().focus().toggleBold().run()} 
          isActive={editor.isActive('bold')} 
          title="Bold (Ctrl+B)"
        >
          <Bold size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleItalic().run()} 
          isActive={editor.isActive('italic')} 
          title="Italic (Ctrl+I)"
        >
          <Italic size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleUnderline().run()} 
          isActive={editor.isActive('underline')} 
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleStrike().run()} 
          isActive={editor.isActive('strike')} 
          title="Strikethrough"
        >
          <Strikethrough size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleSubscript().run()} 
          isActive={editor.isActive('subscript')} 
          title="Subscript"
        >
          <SubscriptIcon size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleSuperscript().run()} 
          isActive={editor.isActive('superscript')} 
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
        />
        <ColorPicker 
          icon={<Highlighter size={16} />}
          color={highlightColor}
          onChange={handleHighlightChange}
          title="Highlight Color"
        />

        <Divider />

        {/* Alignment */}
        <MenuButton 
          onClick={() => editor.chain().focus().setTextAlign('left').run()} 
          isActive={editor.isActive({ textAlign: 'left' })}
          title="Align Left"
        >
          <AlignLeft size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().setTextAlign('center').run()} 
          isActive={editor.isActive({ textAlign: 'center' })}
          title="Align Center"
        >
          <AlignCenter size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().setTextAlign('right').run()} 
          isActive={editor.isActive({ textAlign: 'right' })}
          title="Align Right"
        >
          <AlignRight size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().setTextAlign('justify').run()} 
          isActive={editor.isActive({ textAlign: 'justify' })}
          title="Justify"
        >
          <AlignJustify size={16} />
        </MenuButton>

        <Divider />

        {/* Indentation */}
        <MenuButton 
          onClick={() => editor.chain().focus().sinkListItem('listItem').run()} 
          title="Increase Indent"
          disabled={!editor.can().sinkListItem('listItem')}
        >
          <Indent size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().liftListItem('listItem').run()} 
          title="Decrease Indent"
          disabled={!editor.can().liftListItem('listItem')}
        >
          <Outdent size={16} />
        </MenuButton>

        <Divider />

        {/* Lists */}
        <MenuButton 
          onClick={() => editor.chain().focus().toggleBulletList().run()} 
          isActive={editor.isActive('bulletList')}
          title="Bullet List"
        >
          <List size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleOrderedList().run()} 
          isActive={editor.isActive('orderedList')}
          title="Numbered List"
        >
          <ListOrdered size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleTaskList().run()} 
          isActive={editor.isActive('taskList')}
          title="Checklist"
        >
          <CheckSquare size={16} />
        </MenuButton>

        <Divider />

        {/* Blocks */}
        <MenuButton 
          onClick={() => editor.chain().focus().toggleBlockquote().run()} 
          isActive={editor.isActive('blockquote')}
          title="Block Quote"
        >
          <Quote size={16} />
        </MenuButton>
        <MenuButton 
          onClick={() => editor.chain().focus().toggleCodeBlock().run()} 
          isActive={editor.isActive('codeBlock')}
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
          isActive={editor.isActive('link')}
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
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} 
          title="Clear Formatting"
        >
          <Eraser size={16} />
        </MenuButton>
      </div>
    </div>
  );
};

// --- Custom FontSize Extension ---

const FontSize = Extension.create({
  name: 'fontSize',
  
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => element.style.fontSize || null,
            renderHTML: attributes => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});

// --- Main Editor Component ---
export const DemoEditor = ({ 
  initialContent = '', 
  onChange,
  placeholder = 'Start typing your document...',
  className = ''
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
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Subscript,
      Superscript,
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'editor-content-area',
      },
    },
  });

  return (
    <div className={`demo-editor ${className}`}>
      <Toolbar editor={editor} />
      <div className="editor-content-wrapper">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default DemoEditor;
