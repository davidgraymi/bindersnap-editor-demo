
import React, { useState } from 'react';
import { Save } from 'lucide-react';

interface CommitActionProps {
  onCommit: (message: string) => void;
}

export const CommitAction: React.FC<CommitActionProps> = ({ onCommit }) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      onCommit(message.trim());
      setMessage('');
    }
  };

  return (
    <div className="vc-section">
      <div className="vc-header">
        <Save size={16} />
        <span className="vc-title">Commit Changes</span>
      </div>
      
      <form onSubmit={handleSubmit} className="vc-content commit-form">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message..."
          className="commit-input"
          rows={3}
        />
        <button 
          type="submit" 
          className="commit-btn"
          disabled={!message.trim()}
        >
          Commit
        </button>
      </form>
    </div>
  );
};
