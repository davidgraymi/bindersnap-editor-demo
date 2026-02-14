
import React, { useState, useEffect } from 'react';
import { GitBranch, Plus } from 'lucide-react';

interface BranchControlProps {
  currentBranch: string;
  branches: string[];
  onBranchChange: (branch: string) => void;
  onNewBranch: (name: string) => void;
}

export const BranchControl: React.FC<BranchControlProps> = ({ 
  currentBranch, 
  branches, 
  onBranchChange, 
  onNewBranch 
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newBranchName.trim()) {
      onNewBranch(newBranchName.trim());
      setNewBranchName('');
      setIsCreating(false);
    }
  };

  return (
    <div>
      <div className="vc-header">
        <GitBranch size={16} />
        <span className="vc-title">Branches</span>
      </div>
      
      <div className="vc-content">
        <div className="branch-selector">
          <select 
            value={currentBranch} 
            onChange={(e) => onBranchChange(e.target.value)}
            className="branch-select"
          >
            {branches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          
          <button 
            className="icon-btn" 
            onClick={() => setIsCreating(!isCreating)}
            title="New Branch"
          >
            <Plus size={16} />
          </button>
        </div>

        {isCreating && (
          <form onSubmit={handleCreate} className="new-branch-form">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="Branch name..."
              className="branch-input"
              autoFocus
            />
            <button type="submit" className="confirm-btn">Create</button>
          </form>
        )}
      </div>
    </div>
  );
};
