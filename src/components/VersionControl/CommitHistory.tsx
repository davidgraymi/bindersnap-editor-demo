
import React from 'react';
import type { Commit } from '../../services/GitService';
import { History, Clock, User } from 'lucide-react';

interface CommitHistoryProps {
  commits: Commit[];
  currentBranch: string;
}

export const CommitHistory: React.FC<CommitHistoryProps> = ({ commits, currentBranch }) => {
  return (
    <div className="vc-section flex flex-1 min-h-0 flex-col">
      <div className="vc-header">
        <History size={16} />
        <span className="vc-title">History</span>
      </div>
      
      <div className="vc-content flex-1 overflow-y-auto commit-list">
        {commits.length === 0 ? (
          <div className="empty-state">No commits yet</div>
        ) : (
          commits.map(commit => {
            const className = 'commit-item';

            return (
            <div 
              key={commit.id} 
              className={className}
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
