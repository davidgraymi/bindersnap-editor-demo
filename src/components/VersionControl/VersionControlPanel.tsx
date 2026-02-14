
import React, { useEffect, useState } from 'react';
import { gitService, type Commit } from '../../services/GitService';
import { BranchControl } from './BranchControl';
import { CommitHistory } from './CommitHistory';
import { CommitAction } from './CommitAction';
import { ConflictResolver } from './ConflictResolver';
import { CommitDetailOverlay } from './CommitDetailOverlay';
import { GitGraph } from 'lucide-react';

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
  const [headId, setHeadId] = useState<string | null>(null);
  const [comparisonState, setComparisonState] = useState<{ headId: string; baseId: string } | null>(null);
  
  const [showMerge, setShowMerge] = useState(false);
  const [conflictState, setConflictState] = useState<{
    isConflict: boolean;
    mergeBranch: string;
    theirContent: string;
    baseContent: string;
    ourContent: string;
  } | null>(null);

  const [selectedCommit, setSelectedCommit] = useState<{ commit: Commit; parentContent: string } | null>(null);

  const refreshState = () => {
    setBranches(gitService.getBranches());
    setCurrentBranch(gitService.getCurrentBranch());
    setHistory(gitService.getHistory());
    const head = gitService.getCommit(gitService.getHistory()[0]?.id || '');
    setHeadId(head?.id || null);
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

  // Clear selection if preview is exited
  useEffect(() => {
    if (!isPreviewMode) {
      setComparisonState(null);
    }
  }, [isPreviewMode]);

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
        setConflictState({
          isConflict: true,
          mergeBranch: branchToMerge,
          theirContent: result.theirContent!,
          baseContent: result.baseContent!,
          ourContent: getEditorContent()
        });
      }
    } catch (e: any) {
      alert(e.message);
    }
    setShowMerge(false);
  };

  const handleSelectCommit = (commit: Commit) => {
    // Ideally fetch this async or have a better way, but for now we look up parent synchronously
    const parentId = commit.parentId;
    let parentContent = '';
    
    if (parentId) {
      const parent = gitService.getCommit(parentId);
       if (parent) parentContent = parent.content;
    }

    setComparisonState({
      headId: commit.id,
      baseId: parentId || ''
    });
    
    // Instead of local overlay, trigger preview in editor
    onPreviewDiff(parentContent, commit.content);
  };

  const handleResolveConflict = (resolvedContent: string) => {
    if (conflictState) {
      gitService.commit(`Merge branch '${conflictState.mergeBranch}' into '${currentBranch}'`, resolvedContent);
      onContentChange(resolvedContent);
      setConflictState(null);
    }
  };

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
        history={history}
        currentHeadId={headId}
        selectedHeadId={comparisonState?.headId || null}
        selectedBaseId={comparisonState?.baseId || null}
        onSelectCommit={handleSelectCommit}
      />

      {conflictState && (
        <ConflictResolver 
          baseBranch={currentBranch}
          mergeBranch={conflictState.mergeBranch}
          ourContent={conflictState.ourContent}
          theirContent={conflictState.theirContent}
          onResolve={handleResolveConflict}
          onCancel={() => setConflictState(null)}
        />
      )}
    </div>
  );
};
