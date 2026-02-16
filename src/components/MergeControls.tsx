
import React from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import { Check, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { EditorState } from '@tiptap/pm/state';

interface MergeControlsProps {
  editor: Editor;
}

export const MergeControls = ({ editor }: MergeControlsProps) => {
  // Only show if insertion or deletion mark is active
  const shouldShow = ({ editor, state }: { editor: Editor, state: EditorState }) => {
     const { from, to } = state.selection;
     // Check if selection overlaps with insertion or deletion
     // Note: Default 'isActive' checks if the *whole* selection has the mark, 
     // or if cursor is inside. 
     return editor.isActive('insertion') || editor.isActive('deletion');
  };

  const acceptChange = () => {
    if (editor.isActive('insertion')) {
      // Accept insertion: keeps text, removes mark
      // We need to extend selection to the whole mark to be safe, 
      // but 'unsetMark' generally works on selection. 
      // Ideally we select the whole mark range first.
      const { from, to } = editor.state.selection;
      editor.chain().focus().extendMarkRange('insertion').unsetMark('insertion').run();
    } else if (editor.isActive('deletion')) {
      // Accept deletion: delete the content
      editor.chain().focus().extendMarkRange('deletion').deleteSelection().run();
    }
  };

  const rejectChange = () => {
    if (editor.isActive('insertion')) {
      // Reject insertion: delete the content
      editor.chain().focus().extendMarkRange('insertion').deleteSelection().run();
    } else if (editor.isActive('deletion')) {
      // Reject deletion: keep text (remove deletion mark)
      editor.chain().focus().extendMarkRange('deletion').unsetMark('deletion').run();
    }
  };

  const isInsertion = editor.isActive('insertion');
  const typeLabel = isInsertion ? 'Inserted' : 'Deleted';

  return (
    <BubbleMenu 
      editor={editor} 
      tippyOptions={{ duration: 100, placement: 'bottom' }} 
      shouldShow={shouldShow}
      pluginKey="mergeBubbleMenu"
      className="merge-bubble-menu"
    >
      <div className="merge-controls">
        <span className="merge-label">{typeLabel}</span>
        <div className="merge-actions">
          <button onClick={acceptChange} className="merge-btn accept" title="Accept Change">
            <Check size={14} /> Accept
          </button>
          <button onClick={rejectChange} className="merge-btn reject" title="Reject Change">
            <X size={14} /> Reject
          </button>
        </div>
      </div>
    </BubbleMenu>
  );
};
