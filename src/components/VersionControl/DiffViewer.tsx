import React, { useMemo } from 'react';
import * as Diff from 'diff';

interface DiffViewerProps {
  base: Record<string, any>;
  head: Record<string, any>;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ base, head }) => {
  const diff = useMemo(() => {
    // For the SIDE-BY-SIDE text diff viewer in conflict resolver,
    // we convert JSON to a readable string (rudimentary text extraction).
    // Ideally we'd use a real visual diff here too.
    const baseText = JSON.stringify(base, null, 2);
    const headText = JSON.stringify(head, null, 2);
    return Diff.diffLines(baseText, headText);
  }, [base, head]);

  return (
    <div className="diff-viewer">
      <h3>Changes (JSON Structure)</h3>
      <div className="diff-content" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        {diff.map((part, index) => {
          const color = part.added ? '#dcfce7' : part.removed ? '#fee2e2' : 'transparent';
          return (
            <span 
              key={index} 
              style={{ backgroundColor: color, display: 'block' }}
            >
              {part.value}
            </span>
          );
        })}
      </div>
    </div>
  );
};
