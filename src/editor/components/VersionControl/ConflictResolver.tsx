
import React, { useState } from 'react';
import { DiffViewer } from './DiffViewer';

interface ConflictResolverProps {
  baseBranch: string;
  mergeBranch: string;
  ourContent: string;
  theirContent: string;
  onResolve: (resolvedContent: string) => void;
  onCancel: () => void;
}

export const ConflictResolver: React.FC<ConflictResolverProps> = ({
  baseBranch,
  mergeBranch,
  ourContent,
  theirContent,
  onResolve,
  onCancel
}) => {
  const [resolution, setResolution] = useState<'ours' | 'theirs' | 'manual'>('manual');
  const [manualContent, setManualContent] = useState(ourContent);

  const handleApply = () => {
    let content = manualContent;
    if (resolution === 'ours') content = ourContent;
    if (resolution === 'theirs') content = theirContent;
    
    onResolve(content);
  };

  return (
    <div className="conflict-overlay">
      <div className="conflict-modal">
        <div className="conflict-header">
          <h3>Merge Conflict</h3>
          <p>Merging <strong>{mergeBranch}</strong> into <strong>{baseBranch}</strong></p>
        </div>

        <div className="conflict-body">
          <div className="conflict-options">
            <label>
              <input 
                type="radio" 
                checked={resolution === 'ours'} 
                onChange={() => setResolution('ours')}
              />
              Keep Current ({baseBranch})
            </label>
            <label>
              <input 
                type="radio" 
                checked={resolution === 'theirs'} 
                onChange={() => setResolution('theirs')}
              />
              Accept Incoming ({mergeBranch})
            </label>
            <label>
              <input 
                type="radio" 
                checked={resolution === 'manual'} 
                onChange={() => setResolution('manual')}
              />
              Manual Merge
            </label>
          </div>

          <div className="conflict-preview">
            {resolution === 'manual' ? (
              <div className="manual-merge-area">
                <p className="help-text">Edit the content below to resolve the conflict:</p>
                <textarea 
                  className="manual-editor"
                  value={manualContent} 
                  onChange={(e) => setManualContent(e.target.value)}
                />
              </div>
            ) : (
              <div className="diff-preview-area">
                <DiffViewer 
                   base={resolution === 'ours' ? theirContent : ourContent} 
                   head={resolution === 'ours' ? ourContent : theirContent} 
                />
              </div>
            )}
          </div>
        </div>

        <div className="conflict-footer">
          <button className="cancel-btn" onClick={onCancel}>Cancel Merge</button>
          <button className="resolve-btn" onClick={handleApply}>Resolve & Commit</button>
        </div>
      </div>
    </div>
  );
};
