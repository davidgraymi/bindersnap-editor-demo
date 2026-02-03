import { diff_match_patch } from 'diff-match-patch';

export const diffHtml = (oldHtml: string, newHtml: string): string => {
  const dmp = new diff_match_patch();
  dmp.Diff_Timeout = 0; // Disable timeout for accuracy

  // 1. Tokenize HTML into tags and text
  const splitRegex = /(<[^>]+>)/;
  // Filter empty strings allows clean mapping
  const tokens = (html: string) => html.split(splitRegex).filter(s => s !== '');
  
  const oldTokens = tokens(oldHtml);
  const newTokens = tokens(newHtml);

  // 2. Map tokens to unique characters for diffing.
  // CRITICAL: Normalize text (trim) so that whitespace changes don't cause diff mismatches.
  // We align content, not spacing.
  const tokenMap: Map<string, string> = new Map();
  let charCode = 0xe000;

  const getTokenChar = (token: string) => {
    // Normalize if text
    const isTag = token.startsWith('<') && token.endsWith('>');
    const key = isTag ? token : token.trim();
    
    if (tokenMap.has(key)) return tokenMap.get(key)!;
    const char = String.fromCharCode(charCode++);
    tokenMap.set(key, char);
    return char;
  };

  const oldString = oldTokens.map(getTokenChar).join('');
  const newString = newTokens.map(getTokenChar).join('');
  
  // 3. Diff the character strings
  const diffs = dmp.diff_main(oldString, newString);
  // dmp.diff_cleanupSemantic(diffs); // Keep disabled

  // 4. Reconstruct by walking the token streams
  let html = '';
  let formatDepth = 0;
  
  let oldIdx = 0;
  let newIdx = 0;

  const isTag = (s: string) => s.startsWith('<') && s.endsWith('>');
  const getTagType = (s: string): 'open' | 'close' | 'void' | 'text' => {
    if (!isTag(s)) return 'text';
    if (s.startsWith('</')) return 'close';
    if (s.match(/<((img|br|hr|input|meta)|[^>]*\/>)/i)) return 'void';
    return 'open';
  };

  diffs.forEach(([op, charString]) => {
    const len = charString.length;
    
    for (let i = 0; i < len; i++) {
        if (op === 0) { // Equal
            const token = newTokens[newIdx] || '';
            const type = getTagType(token);
            
            if (type === 'text' && formatDepth > 0) {
               html += `<span data-format-change>${token}</span>`;
            } else {
               html += token;
            }
            
            oldIdx++;
            newIdx++;
        } else if (op === 1) { // Insert
            const token = newTokens[newIdx] || '';
            const type = getTagType(token);
            
            if (type === 'text') {
               html += `<ins>${token}</ins>`;
            } else {
               html += token;
               if (type === 'open') formatDepth++;
               if (type === 'close') formatDepth--;
            }
            
            newIdx++;
        } else if (op === -1) { // Delete
            const token = oldTokens[oldIdx] || '';
            const type = getTagType(token);
            
            if (type === 'text') {
               html += `<span data-deletion>${token}</span>`;
            } else {
               // Deleted tag implies format change start/end for remaining text
               if (type === 'open') formatDepth++;
               if (type === 'close') formatDepth--;
            }
            
            oldIdx++;
        }
    }
  });

  return html;
};
