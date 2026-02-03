
import React from 'react';
import type { Commit } from '../../services/GitService';
import { DiffViewer } from './DiffViewer';
import { X, Calendar, User, GitCommit } from 'lucide-react';

interface CommitDetailOverlayProps {
  commit: Commit;
  parentContent: string;
  onClose: () => void;
}

export const CommitDetailOverlay: React.FC<CommitDetailOverlayProps> = ({
  commit,
  parentContent,
  onClose
}) => {
  return (
    <div className="conflict-overlay" onClick={onClose}>
      <div className="conflict-modal commit-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="conflict-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GitCommit size={20} />
            <div>
              <h3>{commit.message}</h3>
              <p className="commit-id">{commit.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" style={{ border: 'none' }}>
            <X size={20} />
          </button>
        </div>

        <div className="conflict-body">
          <div className="commit-meta-detail" style={{ marginBottom: '20px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', fontSize: '13px' }}>
            <div style={{ display: 'flex', gap: '20px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <User size={14} /> <strong>{commit.author}</strong>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Calendar size={14} /> {new Date(commit.timestamp).toLocaleString()}
              </span>
            </div>
          </div>

          <h4>Changes</h4>
          <div className="diff-preview-area">
            <DiffViewer 
              base={parentContent} 
              head={commit.content} 
            />
          </div>
        </div>
      </div>
    </div>
  );
};
