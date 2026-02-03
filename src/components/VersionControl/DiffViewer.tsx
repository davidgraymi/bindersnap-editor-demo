
import React, { useMemo } from 'react';
import * as Diff from 'diff';

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ oldContent, newContent }) => {
  const diff = useMemo(() => {
    // We diff words to make it more readable for text
    return Diff.diffWords(oldContent || '', newContent || '');
  }, [oldContent, newContent]);

  return (
    <div className="diff-viewer">
      <h3>Changes</h3>
      <div className="diff-content">
        {diff.map((part, index) => {
          const color = part.added ? '#dcfce7' : part.removed ? '#fee2e2' : 'transparent';
          const textDecoration = part.removed ? 'line-through' : 'none';
          return (
            <span 
              key={index} 
              style={{ backgroundColor: color, textDecoration, padding: '2px 0' }}
            >
              {part.value}
            </span>
          );
        })}
      </div>
    </div>
  );
};
