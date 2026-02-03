import { diff_match_patch } from 'diff-match-patch';

// Helper for deep equality of attributes
const isEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!keysB.includes(key) || !isEqual(a[key], b[key])) return false;
  }
  return true;
};

// Types for ProseMirror JSON
interface PMNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
  [key: string]: any;
}

interface PMMark {
  type: string;
  [key: string]: any;
}

export const diffJson = (base: Record<string, any>, head: Record<string, any>): Record<string, any> => {
  console.log('diffJson');
  console.log('base: \n', JSON.stringify(base, null, 2));
  console.log('head: \n', JSON.stringify(head, null, 2));

  const dmp = new diff_match_patch();

  // Recursive Diff Function
  const diffNodes = (nodeA: PMNode | undefined, nodeB: PMNode | undefined): PMNode[] => {
    // 1. Both missing (should catch recursion termination)
    if (!nodeA && !nodeB) return [];

    // 2. Addition (in Head, not A)
    if (!nodeA && nodeB) {
      return markNode(nodeB, 'insertion');
    }

    // 3. Deletion (in A, not Head)
    if (nodeA && !nodeB) {
      return markNode(nodeA, 'deletion');
    }

    // 4. Equal (Same type)
    if (nodeA && nodeB && nodeA.type === nodeB.type) {
        // A. TEXT NODES
        if (nodeA.text !== undefined && nodeB.text !== undefined) {
             // Check attributes/marks first?
             // If marks are different, it's a format change. 
             // BUT we typically want to diff the TEXT content first.
             
             // Simplification: Diff text, then apply marks.
             const diffs = dmp.diff_main(nodeA.text, nodeB.text);
             dmp.diff_cleanupSemantic(diffs);
             
             const resultNodes: PMNode[] = [];
             
             diffs.forEach(([op, text]) => {
                 if (!text) return;
                 if (op === 0) { // Equal
                     // Check if attributes/marks changed for this equal segment
                     const attrsChanged = !isEqual(nodeA.attrs, nodeB.attrs);
                     // Check marks (ignoring our diff marks)
                     // Since JSON doesn't have ID, we assume same marks relative to own doc
                     // Format Change = Same text, different formatting.
                     // We need to compare the SET of marks on A vs B.
                     // For "Equal" text, we use B's marks + 'formatChange' if they differ from A.
                     
                     const marksA = nodeA.marks || [];
                     const marksB = nodeB.marks || [];
                     
                     // Filter out non-style marks if any? No, all are style.
                     const styleChanged = !isEqual(marksA, marksB); // Simplistic check (order matters here)
                     
                     const newMarks = [...marksB];
                     if (styleChanged || attrsChanged) {
                         newMarks.push({ type: 'formatChange' });
                     }
                     
                     resultNodes.push({
                         type: 'text',
                         text,
                         marks: newMarks
                     });
                 } else if (op === 1) { // Insert (from B)
                     const newMarks = [...(nodeB.marks || []), { type: 'insertion' }];
                     resultNodes.push({
                         type: 'text',
                         text,
                         marks: newMarks
                     });
                 } else if (op === -1) { // Delete (from A)
                     const newMarks = [...(nodeA.marks || []), { type: 'deletion' }];
                     resultNodes.push({
                         type: 'text',
                         text,
                         marks: newMarks
                     });
                 }
             });
             return resultNodes;
        } 
        
        // B. BLOCK NODES
        // Check attributes (like heading level)
        const formatChanged = !isEqual(nodeA.attrs, nodeB.attrs);

        // Diff children (Content)
        // We need to align children.
        // Simple strategy: Walk parallel indexes.
        // Better: diff-match-patch on child "keys" (e.g. types)?
        // For simplicity: Longest Common Subsequence of Types?
        // Or just index walking with lookahead for insertions/deletions.
        
        const contentA = nodeA.content || [];
        const contentB = nodeB.content || [];
        
        const mergedContent: PMNode[] = [];
        
        // Use Myers Diff or similar on the array of blocks?
        // Implementing simple LCS lookahead
        let i = 0;
        let j = 0;
        
        while (i < contentA.length || j < contentB.length) {
            const childA = contentA[i];
            const childB = contentB[j];
            
            if (!childA && childB) { // Insert
                mergedContent.push(...markNode(childB, 'insertion'));
                j++;
            } else if (childA && !childB) { // Delete
                mergedContent.push(...markNode(childA, 'deletion'));
                i++;
            } else if (childA && childB) {
                // Determine if match, insert, or delete
                // Heuristic: If types match call it a match (and diff inside)
                // If types differ, check lookahead
                
                if (childA.type === childB.type) {
                    mergedContent.push(...diffNodes(childA, childB));
                    i++;
                    j++;
                } else {
                     // Try to see if childB is inserted (does childA match childB+1?)
                     if (j + 1 < contentB.length && contentB[j+1] && contentB[j+1].type === childA.type) {
                         // j is insertion
                         mergedContent.push(...markNode(childB, 'insertion'));
                         j++;
                     } else if (i + 1 < contentA.length && contentA[i+1] && contentA[i+1].type === childB.type) {
                         // i is deletion
                         mergedContent.push(...markNode(childA, 'deletion'));
                         i++;
                     } else {
                         // Replace (Delete A + Insert B)
                         mergedContent.push(...markNode(childA, 'deletion'));
                         mergedContent.push(...markNode(childB, 'insertion'));
                         i++;
                         j++;
                     }
                }
            }
        }

        // Parent Wrapper
        // If attrs changed, we can mark the parent!
        // But PM doesn't support marking blocks easily without 'style' attributes.
        // We will just return the block from B (Head) with merged content.
        // If attrs changed, we try to add a 'formatChange' mark to the text content?
        // Or if it's a block-level mark (like list item), we can try to add formatChange mark to text children.
        
        if (formatChanged) {
             // If block attributes changed (e.g. heading level), apply formatChange to all text children
             // This ensures visual feedback for structure changes.
             const markedContent: PMNode[] = [];
             mergedContent.forEach(child => {
                 markedContent.push(...markNode(child, 'formatChange'));
             });
             return [{
                 type: nodeB.type,
                 attrs: nodeB.attrs,
                 content: markedContent,
                 marks: nodeB.marks
             }];
        }

        return [{
            type: nodeB.type,
            attrs: nodeB.attrs,
            content: mergedContent,
            marks: nodeB.marks // Block marks?
        }];
        
    }
    
    // 5. Different Types (Replace)
    else if (nodeA && nodeB && nodeA.type !== nodeB.type) {
         // 5. Different Types (Format Change + Content Diff)
         
         // Treat as "B" but with "formatChange" applied to all surviving/matching content.
         // We do this by recursively diffing the children (just like Equal case),
         // and then marking the result as 'formatChange'.
         
         // Note: We don't check for attrs equality here because the type changed, so it's inherently a format change.
         // We compare content A vs Content B.
         
         const contentA = nodeA.content || [];
         const contentB = nodeB.content || [];
         
         const mergedContent: PMNode[] = [];
         
         let i = 0;
         let j = 0;
         
         // Simple LCS lookahead logic (same as Equal case)
         // TODO: Refactor this loop into a shared function to avoid duplication
         while (i < contentA.length || j < contentB.length) {
            const childA = contentA[i];
            const childB = contentB[j];
            
            if (!childA && childB) { // Insert
                mergedContent.push(...markNode(childB, 'insertion'));
                j++;
            } else if (childA && !childB) { // Delete
                mergedContent.push(...markNode(childA, 'deletion'));
                i++;
            } else if (childA && childB) {
                if (childA.type === childB.type) {
                    mergedContent.push(...diffNodes(childA, childB));
                    i++;
                    j++;
                } else {
                     // Lookahead
                     if (j + 1 < contentB.length && contentB[j+1] && contentB[j+1].type === childA.type) {
                         mergedContent.push(...markNode(childB, 'insertion'));
                         j++;
                     } else if (i + 1 < contentA.length && contentA[i+1] && contentA[i+1].type === childB.type) {
                         mergedContent.push(...markNode(childA, 'deletion'));
                         i++;
                     } else {
                         // Different types inside the mismatch block.
                         // Recurse! (nested mismatch)
                         mergedContent.push(...diffNodes(childA, childB));
                         i++;
                         j++;
                     }
                }
            }
         }

         // Now applies formatChange to the "surviving" content (Equal nodes that were diffed)
         // We do NOT want to overwrite 'insertion' or 'deletion' marks.
         const markedContent: PMNode[] = [];
         mergedContent.forEach(child => {
             // markNode now handles avoiding overwrite of insertion/deletion
             markedContent.push(...markNode(child, 'formatChange'));
         });

         return [{
             type: nodeB.type,
             attrs: nodeB.attrs,
             content: markedContent,
             marks: nodeB.marks
         }];
    }
    
    return [];
  };

  // Helper to deep-mark a node and its children
  const markNode = (node: PMNode, markType: 'insertion' | 'deletion' | 'formatChange'): PMNode[] => {
      // Avoid double marking if already marked
      if (node.marks && node.marks.some(m => m.type === markType)) {
          // Already marked, just return/recurse
          // But we might need to recurse if children not marked?
          // Simplification: assume if top marked, all marked (or we re-mark)
      }

      if (node.text) {
          const existingMarks = node.marks || [];

          // If we are applying formatChange, strictly avoid if insertion or deletion exists
          if (markType === 'formatChange') {
              if (existingMarks.some(m => m.type === 'insertion' || m.type === 'deletion')) {
                  return [node];
              }
          }
          
          // Avoid duplicates
          if (existingMarks.some(m => m.type === markType)) return [node];
          
          const newMarks = [...existingMarks, { type: markType }];
          return [{
              ...node,
              marks: newMarks
          }];
      }
      
      const newContent: PMNode[] = [];
      if (node.content) {
          node.content.forEach(child => {
              newContent.push(...markNode(child, markType));
          });
      }
      
      return [{
          ...node,
          attrs: node.attrs,
          content: newContent
      }];
  };

  // Root must be a doc
  const merged = diffNodes(base as PMNode, head as PMNode);
  // diffNodes returns array, but root is single doc
  const nodes = merged[0] || { type: 'doc', content: [] };
  console.log('nodes: \n', JSON.stringify(nodes, null, 2));
  return nodes;
};
