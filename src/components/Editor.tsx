import React, { useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, 
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, 
  Undo, Redo, Link as LinkIcon, Image as ImageIcon, 
  Highlighter, Type, Minus, Eraser 
} from 'lucide-react';

// --- Toolbar Component ---
const Toolbar = ({ editor }) => {
  if (!editor) return null;

  const addImage = () => {
    const url = window.prompt('URL');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const MenuButton = ({ onClick, isActive, disabled, children, title }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-2 rounded hover:bg-gray-200 transition-colors ${
        isActive ? 'bg-blue-100 text-blue-600' : 'text-gray-600'
      } disabled:opacity-30`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-1 p-2 bg-gray-50 border-b border-gray-300 sticky top-0 z-10">
      {/* History */}
      <MenuButton onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo size={18} /></MenuButton>
      <div className="w-[1px] h-6 bg-gray-300 mx-1 self-center" />

      {/* Headings */}
      <MenuButton 
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} 
        isActive={editor.isActive('heading', { level: 1 })} title="H1"
      ><Heading1 size={18} /></MenuButton>
      <MenuButton 
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} 
        isActive={editor.isActive('heading', { level: 2 })} title="H2"
      ><Heading2 size={18} /></MenuButton>
      
      <div className="w-[1px] h-6 bg-gray-300 mx-1 self-center" />

      {/* Formatting */}
      <MenuButton 
        onClick={() => editor.chain().focus().toggleBold().run()} 
        isActive={editor.isActive('bold')} title="Bold"
      ><Bold size={18} /></MenuButton>
      <MenuButton 
        onClick={() => editor.chain().focus().toggleItalic().run()} 
        isActive={editor.isActive('italic')} title="Italic"
      ><Italic size={18} /></MenuButton>
      <MenuButton 
        onClick={() => editor.chain().focus().toggleUnderline().run()} 
        isActive={editor.isActive('underline')} title="Underline"
      ><UnderlineIcon size={18} /></MenuButton>
      <MenuButton 
        onClick={() => editor.chain().focus().toggleStrike().run()} 
        isActive={editor.isActive('strike')} title="Strikethrough"
      ><Strikethrough size={18} /></MenuButton>
      
      <div className="w-[1px] h-6 bg-gray-300 mx-1 self-center" />

      {/* Color & Highlight */}
      <div className="flex items-center gap-1 px-1">
        <input 
          type="color" 
          onInput={e => editor.chain().focus().setColor(e.target.value).run()} 
          className="w-6 h-6 p-0 border-none cursor-pointer"
          title="Text Color"
        />
        <MenuButton 
          onClick={() => editor.chain().focus().toggleHighlight().run()} 
          isActive={editor.isActive('highlight')} title="Highlight"
        ><Highlighter size={18} /></MenuButton>
      </div>

      <div className="w-[1px] h-6 bg-gray-300 mx-1 self-center" />

      {/* Alignment */}
      <MenuButton onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })}><AlignLeft size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })}><AlignCenter size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })}><AlignRight size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().setTextAlign('justify').run()} isActive={editor.isActive({ textAlign: 'justify' })}><AlignJustify size={18} /></MenuButton>

      <div className="w-[1px] h-6 bg-gray-300 mx-1 self-center" />

      {/* Lists */}
      <MenuButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')}><List size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')}><ListOrdered size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().toggleTaskList().run()} isActive={editor.isActive('taskList')}><CheckSquare size={18} /></MenuButton>

      <div className="w-[1px] h-6 bg-gray-300 mx-1 self-center" />

      {/* Insert & Misc */}
      <MenuButton onClick={setLink} isActive={editor.isActive('link')}><LinkIcon size={18} /></MenuButton>
      <MenuButton onClick={addImage}><ImageIcon size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={18} /></MenuButton>
      <MenuButton onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Clear Formatting"><Eraser size={18} /></MenuButton>
    </div>
  );
};

// --- Main Editor Component ---
export const DemoEditor = ({ initialContent = "" }) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl outline-none min-h-full p-12',
      },
    },
  });

  return (
    <div className="flex flex-col items-center bg-gray-100 p-8 min-h-screen font-sans">
      <div className="w-full max-w-[850px] bg-white border border-gray-300 shadow-lg flex flex-col h-[800px] overflow-hidden rounded-sm">
        <Toolbar editor={editor} />
        
        {/* Fixed height and scrollable area */}
        <div className="flex-1 overflow-y-auto cursor-text bg-white custom-scrollbar">
          <EditorContent editor={editor} />
        </div>
      </div>
      
      {/* CSS for Tiptap internal styling */}
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left; color: #adb5bd; pointer-events: none; height: 0;
        }
        .ProseMirror { padding: 40px 60px; min-height: 100%; }
        .ProseMirror:focus { outline: none; }
        ul[data-type="taskList"] { list-style: none; padding: 0; }
        ul[data-type="taskList"] li { display: flex; align-items: center; }
        ul[data-type="taskList"] li > label { margin-right: 0.5rem; user-select: none; }
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #bbb; }
      `}</style>
    </div>
  );
};
