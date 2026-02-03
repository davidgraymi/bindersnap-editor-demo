
import React, { useState } from 'react';
import { DiffViewer } from './DiffViewer';

interface ConflictResolverProps {
  baseBranch: string;
  mergeBranch: string;
  ourContent: Record<string, any>;
  theirContent: Record<string, any>;
  onResolve: (resolvedContent: Record<string, any>) => void;
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
  
  // For manual merge, we can't easily edit JSON in a textarea. 
  // Simplified for Demo: Manual merge just picks one, or we show a JSON string editor.
  // Ideally this would be a real 3-way merge editor.
  // We'll stick to simple choice for now or JSON editor.
  const [manualContentJson, setManualContentJson] = useState(JSON.stringify(ourContent, null, 2));

  const handleApply = () => {
    let content = ourContent;
    if (resolution === 'ours') content = ourContent;
    if (resolution === 'theirs') content = theirContent;
    if (resolution === 'manual') {
        try {
            content = JSON.parse(manualContentJson);
        } catch (e) {
            alert('Invalid JSON');
            return;
        }
    }
    
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
              Manual JSON Merge
            </label>
          </div>

          <div className="conflict-preview">
            {resolution === 'manual' ? (
              <div className="manual-merge-area">
                <p className="help-text">Edit the JSON below to resolve (Advanced):</p>
                <textarea 
                  className="manual-editor"
                  value={manualContentJson} 
                  onChange={(e) => setManualContentJson(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
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
