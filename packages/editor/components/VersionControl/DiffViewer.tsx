import React, { useMemo } from "react";
import * as Diff from "diff";

interface DiffViewerProps {
  base: string;
  head: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ base, head }) => {
  const diff = useMemo(() => {
    // We diff words to make it more readable for text
    return Diff.diffWords(base || "", head || "");
  }, [base, head]);

  return (
    <div className="diff-viewer">
      <h3>Changes</h3>
      <div className="diff-content">
        {diff.map((part, index) => {
          const tokenClass = part.added
            ? "diff-token diff-token--added"
            : part.removed
              ? "diff-token diff-token--removed"
              : "diff-token";
          return (
            <span key={index} className={tokenClass}>
              {part.value}
            </span>
          );
        })}
      </div>
    </div>
  );
};
