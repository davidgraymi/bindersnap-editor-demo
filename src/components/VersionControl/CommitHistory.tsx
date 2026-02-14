
import React from 'react';
import type { Commit } from '../../services/GitService';
import { History, Clock, User } from 'lucide-react';

interface CommitHistoryProps {
  history: Commit[];
  currentHeadId: string | null;
  selectedHeadId: string | null;
  selectedBaseId: string | null;
  onSelectCommit: (commit: Commit) => void;
}

export const CommitHistory: React.FC<CommitHistoryProps> = ({ history, currentHeadId, selectedHeadId, selectedBaseId, onSelectCommit }) => {
  return (
    <div className="vc-section flex flex-1 min-h-0 flex-col">
      <div className="vc-header">
        <History size={16} />
        <span className="vc-title">History</span>
      </div>
      
      <div className="vc-content flex-1 overflow-y-auto commit-list">
        {history.length === 0 ? (
          <div className="empty-state">No commits yet</div>
        ) : (
          history.map(commit => {
            const isComparing = !!selectedHeadId;
            let className = 'commit-item clickable';
            
            if (commit.id === selectedHeadId) {
              className += ' selected-head';
            } else if (commit.id === selectedBaseId) {
              className += ' selected-base';
            } else if (commit.id === currentHeadId && !isComparing) {
              // Only highlight current head if we are NOT in comparison mode
              className += ' active';
            }

            return (
            <div 
              key={commit.id} 
              className={className}
              onClick={() => onSelectCommit(commit)}
              title="Click to view details"
            >
              <div className="commit-message" title={commit.message}>{commit.message}</div>
              <div className="commit-meta">
                <span className="commit-author">
                  <User size={10} /> {commit.author}
                </span>
                <span className="commit-date">
                  <Clock size={10} /> 
                  {new Date(commit.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="commit-id">{commit.id.substring(0, 7)}</div>
            </div>
          );
        })
      )}
      </div>
    </div>
  );
};
