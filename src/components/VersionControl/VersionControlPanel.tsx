
import React, { useEffect, useState } from 'react';
import { gitService, type Commit } from '../../services/GitService';
import { BranchControl } from './BranchControl';
import { CommitHistory } from './CommitHistory';
import { ConflictResolver } from './ConflictResolver';
import { GitGraph } from 'lucide-react';
import { diffHtml } from '../../utils/htmlDiff';

interface VersionControlPanelProps {
  getEditorContent: () => string;
  onContentChange: (content: string) => void;
  onPreviewDiff: (base: string, head: string) => void;
  isPreviewMode: boolean;
}

export const VersionControlPanel: React.FC<VersionControlPanelProps> = ({ 
  getEditorContent, 
  onContentChange,
  onPreviewDiff,
  isPreviewMode
}) => {
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [history, setHistory] = useState<Commit[]>([]);
  
  const [showMerge, setShowMerge] = useState(false);

  const refreshState = () => {
    setBranches(gitService.getBranches());
    setCurrentBranch(gitService.getCurrentBranch());
    setHistory(gitService.getHistory());
    const head = gitService.getCommit(gitService.getHistory()[0]?.id || '');
  };

  useEffect(() => {
    // Initialize if needed (empty repo)
    // We check once on mount
    const content = getEditorContent();
    if (gitService.getHistory().length === 0 && content) {
      gitService.init(content);
    }
    
    refreshState();
    const unsubscribe = gitService.subscribe(refreshState);
    return unsubscribe;
  }, []);

  /* Removed comparisonState tracking */

  const handleBranchChange = (branch: string) => {
    try {
      const content = gitService.checkout(branch);
      onContentChange(content);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleNewBranch = (name: string) => {
    try {
      gitService.createBranch(name);
      handleBranchChange(name);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleCommit = (message: string) => {
    try {
      gitService.commit(message, getEditorContent());
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleMergeStart = (branchToMerge: string) => {
    if (branchToMerge === currentBranch) return;

    try {
      const result = gitService.merge(branchToMerge);
      if (result.success && result.mergedContent !== undefined) {
        // Auto-merge successful
        gitService.commit(`Merge branch '${branchToMerge}' into '${currentBranch}'`, result.mergedContent);
        // Content updates via listener automatically, but we might need to push the new content to the editor
        onContentChange(result.mergedContent);
      } else if (result.conflict) {
        // Granular Merge:
        // Generate diff between CURRENT (Ours) and INCOMING (Theirs)
        // and set it as the editor content. The editor's MergeControls will allow resolution.
        if (result.theirContent) {
           const diffContent = diffHtml(getEditorContent(), result.theirContent);
           onContentChange(diffContent);
           // We might want to notify the user
           // alert("Merge conflicts detected. Please resolve them in the editor.");
        }
      }
    } catch (e: any) {
      alert(e.message);
    }
    setShowMerge(false);
  };



  // Removed handleResolveConflict as it is now done in editor via MergeControls (which just modifies content)
  // When user is done, they can "Commit" via the panel or Ctrl+S as usual.

  return (
    <div className="vc-panel">
      <div className="vc-panel-header">
        <GitGraph size={20} />
        <h2>Version Control</h2>
      </div>

      <div className="vc-section flex-none">
        <BranchControl
          branches={branches}
          currentBranch={currentBranch}
          onBranchChange={handleBranchChange}
          onNewBranch={handleNewBranch}
        />

        <div style={{ height: '16px' }}></div>

         <button 
           className="merge-toggle-btn" 
           onClick={() => setShowMerge(!showMerge)}
           style={{ width: '100%', padding: '6px', fontSize: '13px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '4px', cursor: 'pointer' }}
         >
           Merge...
         </button>
         {showMerge && (
           <div className="merge-selector" style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
             {branches.filter(b => b !== currentBranch).map(b => (
               <button 
                 key={b} 
                 onClick={() => handleMergeStart(b)}
                 style={{ textAlign: 'left', padding: '6px', background: 'white', border: '1px solid #e5e7eb', cursor: 'pointer', fontSize: '13px' }}
               >
                 Merge <strong>{b}</strong>
               </button>
             ))}
             {branches.filter(b => b !== currentBranch).length === 0 && <div style={{ fontSize: '12px', color: '#888' }}>No other branches</div>}
           </div>
         )}
       </div>

      <CommitHistory 
        commits={history}
        currentBranch={currentBranch} 
      />


    </div>
  );
};
