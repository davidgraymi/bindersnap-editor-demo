import React, { useCallback, useState, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, 
  List, ListOrdered, CheckSquare, AlignLeft, AlignCenter, AlignRight,
  AlignJustify, Undo, Redo, Link as LinkIcon, Image as ImageIcon, 
  Highlighter, Minus, Eraser, Quote, Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon, Indent, Outdent, Table as TableIcon,
  ChevronDown, Type, GitGraph, Maximize, Minimize
} from 'lucide-react';

interface RichTextToolbarProps {
  editor: Editor | null;
  showVcPanel: boolean;
  onToggleVcCtrl: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
}

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { label: 'Arial Black', value: '"Arial Black", "Arial Bold", Gadget, sans-serif' },
  { label: 'Bodoni', value: '"Bodoni 72", "Bodoni MT", Bodoni, "Huppert", serif' },
  { label: 'Book Antiqua', value: '"Book Antiqua", Palatino, "Palatino Linotype", "Palatino LT STD", "Georgia", serif' },
  { label: 'Bradley Hand', value: '"Bradley Hand", "Bradley Hand ITC", cursive' },
  { label: 'Brush Script MT', value: '"Brush Script MT", "Brush Script Std", cursive' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe, "Segoe UI", Optima, Arial, sans-serif' },
  { label: 'Cambria', value: 'Cambria, Georgia, serif' },
  { label: 'Candara', value: 'Candara, sans-serif' },
  { label: 'Century Gothic', value: '"Century Gothic", CenturyGothic, AppleGothic, sans-serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", cursive, sans-serif' },
  { label: 'Consolas', value: 'Consolas, monaco, monospace' },
  { label: 'Copperplate', value: 'Copperplate, "Copperplate Gothic Light", sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, "Lucida Sans Typewriter", "Lucida Typewriter", monospace' },
  { label: 'Didot', value: 'Didot, "Didot LT STD", "Hoefler Text", Garamond, "Times New Roman", serif' },
  { label: 'Franklin Gothic', value: '"Franklin Gothic Medium", "Franklin Gothic", "ITC Franklin Gothic", Arial, sans-serif' },
  { label: 'Garamond', value: '"EB Garamond", Garamond, "Baskerville", "Baskerville Old Face", "Hoefler Text", "Times New Roman", serif' },
  { label: 'Georgia', value: 'Georgia, Times, "Times New Roman", serif' },
  { label: 'Helvetica', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Impact', value: 'Impact, Haettenschweiler, "Franklin Gothic Bold", Charcoal, "Helvetica Inserat", "Bitstream Vera Sans Bold", "Arial Black", sans-serif' },
  { label: 'Inter', value: '"Inter", sans-serif' },
  { label: 'Lato', value: '"Lato", sans-serif' },
  { label: 'Lora', value: '"Lora", serif' },
  { label: 'Lucida Console', value: '"Lucida Console", "Lucida Sans Typewriter", "Monaco", "Bitstream Vera Sans Mono", monospace' },
  { label: 'Lucida Sans Unicode', value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif' },
  { label: 'Merriweather', value: '"Merriweather", serif' },
  { label: 'Monaco', value: 'Monaco, "Bitstream Vera Sans Mono", "Lucida Console", Terminal, monospace' },
  { label: 'Montserrat', value: '"Montserrat", sans-serif' },
  { label: 'Open Sans', value: '"Open Sans", sans-serif' },
  { label: 'Oswald', value: '"Oswald", sans-serif' },
  { label: 'Palatino', value: 'Palatino, "Palatino Linotype", "Palatino LT STD", "Book Antiqua", Georgia, serif' },
  { label: 'Papyrus', value: 'Papyrus, fantasy' },
  { label: 'Perpetua', value: 'Perpetua, Baskerville, "Big Caslon", "Palatino Linotype", Palatino, "URW Palladio L", "Nimbus Roman No9 L", serif' },
  { label: 'Playfair Display', value: '"Playfair Display", serif' },
  { label: 'Roboto', value: '"Roboto", sans-serif' },
  { label: 'Rockwell', value: 'Rockwell, "Courier Bold", Courier, Georgia, Times, "Times New Roman", serif' },
  { label: 'Segoe UI', value: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Source Sans Pro', value: '"Source Sans Pro", sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Verdana, Segoe, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, Baskerville, Georgia, serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", "Lucida Sans", Tahoma, sans-serif' },
  { label: 'Ubuntu', value: '"Ubuntu", sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
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

export const RichTextToolbar = ({ editor, showVcPanel, onToggleVcCtrl, isFullScreen, onToggleFullScreen }: RichTextToolbarProps) => {
  const [textColor, setTextColor] = useState('#000000');
  const [highlightColor, setHighlightColor] = useState('#ffff00');
  const [, forceUpdate] = useState({});

  // Force re-render when selection or content changes so dropdowns reflect current text state
  useEffect(() => {
    if (!editor) return;
    
    const updateHandler = () => forceUpdate({});
    editor.on('selectionUpdate', updateHandler);
    editor.on('transaction', updateHandler);
    
    return () => {
      editor.off('selectionUpdate', updateHandler);
      editor.off('transaction', updateHandler);
    };
  }, [editor]);

  if (!editor) return null;

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

  // Helper to get consistent style value across selection, returns sentinel if mixed
  const getSelectionFontFamily = (): string => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      // Cursor position, no selection
      return editor.getAttributes('textStyle').fontFamily || '';
    }
    
    let fontFamily: string | null = null;
    let hasMixed = false;
    
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const textStyleMark = node.marks.find(m => m.type.name === 'textStyle');
        const currentFont = textStyleMark?.attrs?.fontFamily || '';
        
        if (fontFamily === null) {
          fontFamily = currentFont;
        } else if (fontFamily !== currentFont) {
          hasMixed = true;
        }
      }
    });
    
    // Return sentinel that won't match any option when mixed
    return hasMixed ? '__mixed__' : (fontFamily || '');
  };

  const getSelectionFontSize = (): string => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      // Cursor position, no selection
      return editor.getAttributes('textStyle').fontSize || '16px';
    }
    
    let fontSize: string | null = null;
    let hasMixed = false;
    
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText && node.marks) {
        const textStyleMark = node.marks.find(m => m.type.name === 'textStyle');
        const currentSize = textStyleMark?.attrs?.fontSize || '16px';
        
        if (fontSize === null) {
          fontSize = currentSize;
        } else if (fontSize !== currentSize) {
          hasMixed = true;
        }
      }
    });
    // Return sentinel that won't match any option when mixed
    return hasMixed ? '__mixed__' : (fontSize || '16px');
  };

  const getCurrentHeading = (): number => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      // Cursor position, check active heading
      for (let i = 1; i <= 6; i++) {
        if (editor.isActive('heading', { level: i })) return i;
      }
      return 0;
    }
    
    // Check if selection spans multiple block types
    let headingLevel: number | null = null;
    let hasMixed = false;
    
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isBlock && (node.type.name === 'heading' || node.type.name === 'paragraph')) {
        const currentLevel = node.type.name === 'heading' ? (node.attrs.level as number) : 0;
        
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
    editor.chain().focus().setFontSize(size as string).run();
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
          value={getSelectionFontFamily()}
          options={FONT_FAMILIES}
          onChange={handleFontFamilyChange}
          width="120px"
        />

        <Dropdown
          label="Size"
          value={getSelectionFontSize()}
          options={FONT_SIZES}
          onChange={handleFontSizeChange}
          width="70px"
        />

        <Divider />

        <Dropdown
          label="Style"
          value={String(getCurrentHeading())}
          options={HEADING_OPTIONS}
          onChange={handleHeadingChange}
          width="110px"
        />

        <div style={{ marginLeft: 'auto' }}>
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

        <Divider />

        <MenuButton 
          onClick={onToggleVcCtrl} 
          isActive={showVcPanel}
          title="Version Control"
        >
          <GitGraph size={16} />
        </MenuButton>
      </div>
    </div>
  );
};

export default RichTextToolbar;
