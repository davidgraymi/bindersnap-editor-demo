
import { v4 as uuidv4 } from 'uuid';

export interface Commit {
  id: string;
  parentId: string | null;
  message: string;
  timestamp: number;
  author: string;
  content: string; // Storing full HTML content for simplicity in this demo
}

export interface Branch {
  name: string;
  commitId: string;
}

export interface RepoState {
  commits: Record<string, Commit>;
  branches: Record<string, string>; // branchName -> commitId
  currentBranch: string;
  HEAD: string | null; // commitId
}

const STORAGE_KEY = 'bindersnap_git_repo';


export class GitService {
  private state: RepoState;
  private listeners: (() => void)[] = [];

  constructor() {
    this.state = this.loadState() || this.getInitialState();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  private getInitialState(): RepoState {
    return {
      commits: {},
      branches: { main: '' },
      currentBranch: 'main',
      HEAD: null,
    };
  }

  private loadState(): RepoState | null {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  }

  private saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  // --- Core Operations ---

  public init(initialContent: string) {
    if (this.state.HEAD) return; // Already initialized

    const commitId = uuidv4();
    const initialCommit: Commit = {
      id: commitId,
      parentId: null,
      message: 'Initial commit',
      timestamp: Date.now(),
      author: 'System',
      content: initialContent,
    };

    this.state.commits[commitId] = initialCommit;
    this.state.branches['main'] = commitId;
    this.state.HEAD = commitId;
    this.saveState();
    this.notify();
  }

  public commit(message: string, content: string, author: string = 'User'): Commit {
    if (!this.state.HEAD) {
      throw new Error('Repository not initialized');
    }

    const commitId = uuidv4();
    const newCommit: Commit = {
      id: commitId,
      parentId: this.state.HEAD,
      message,
      timestamp: Date.now(),
      author,
      content,
    };

    this.state.commits[commitId] = newCommit;
    this.state.HEAD = commitId;
    
    // Update current branch tip
    if (this.state.currentBranch) {
      this.state.branches[this.state.currentBranch] = commitId;
    }

    this.saveState();
    this.notify();
    return newCommit;
  }

  public createBranch(name: string) {
    if (this.state.branches[name]) {
      throw new Error(`Branch '${name}' already exists`);
    }
    if (!this.state.HEAD) {
        throw new Error('HEAD is null, cannot branch');
    }
    this.state.branches[name] = this.state.HEAD;
    this.saveState();
    this.notify();
  }

  public checkout(branchName: string): string {
    if (!this.state.branches[branchName]) {
      throw new Error(`Branch '${branchName}' does not exist`);
    }

    this.state.currentBranch = branchName;
    const commitId = this.state.branches[branchName];
    const commit = this.state.commits[commitId];
    if (!commit) {
        throw new Error(`Commit '${commitId}' not found`);
    }

    this.state.HEAD = commitId;
    this.saveState();
    this.notify();

    return commit.content;
  }

  public getBranches(): string[] {
    return Object.keys(this.state.branches);
  }

  public getCurrentBranch(): string {
    return this.state.currentBranch;
  }

  public getHistory(): Commit[] {
    const history: Commit[] = [];
    let currentId = this.state.HEAD;

    while (currentId) {
      const commit = this.state.commits[currentId];
      if (!commit) break;
      history.push(commit);
      currentId = commit.parentId;
    }

    return history;
  }

  public getCommit(id: string): Commit | undefined {
    return this.state.commits[id];
  }

  public findCommonAncestor(commitAId: string, commitBId: string): Commit | null {
    const visitedA = new Set<string>();
    let currentA: string | null = commitAId;

    while (currentA) {
      visitedA.add(currentA);
      const commit: Commit | undefined = this.state.commits[currentA];
      currentA = commit ? commit.parentId : null;
    }

    let currentB: string | null = commitBId;
    while (currentB) {
      if (visitedA.has(currentB)) {
        return this.state.commits[currentB] || null;
      }
      const commit: Commit | undefined = this.state.commits[currentB];
      currentB = commit ? commit.parentId : null;
    }

    return null;
  }

  public merge(sourceBranch: string, author: string = 'User'): { 
    success: boolean; 
    conflict?: boolean; 
    mergedContent?: string;
    theirContent?: string;
    baseContent?: string;
  } {
    const sourceCommitId = this.state.branches[sourceBranch];
    if (!sourceCommitId) throw new Error(`Branch '${sourceBranch}' not found`);
    
    const sourceCommit = this.state.commits[sourceCommitId];
    if (!sourceCommit) throw new Error(`Commit '${sourceCommitId}' not found`);

    const headId = this.state.HEAD;
    if (!headId) throw new Error('HEAD is null');

    const headCommit = this.state.commits[headId];
    if (!headCommit) throw new Error('HEAD commit not found');

    if (sourceCommitId === headId) {
       return { success: true, mergedContent: headCommit.content }; // Already up to date
    }

    const ancestor = this.findCommonAncestor(headId, sourceCommitId);
    
    // Simple 3-way merge logic check
    // If HEAD is unchanged from ancestor, fast-forward/clean merge to source.
    // If Source is unchanged from ancestor, do nothing.
    // If BOTH changed, CONFLICT (for this simple demo).
    
    const headContent = headCommit.content;
    const sourceContent = sourceCommit.content;
    const baseContent = ancestor ? ancestor.content : '';

    if (headContent === baseContent) {
        // Fast-forward-ish: User hasn't changed anything since ancestor, so take incoming
        // Note: In real git this changes the commit graph, here we just return content to be committed as a merge commit
        return { success: true, mergedContent: sourceContent };
    }

    if (sourceContent === baseContent) {
        // Incoming hasn't changed, keep ours
        return { success: true, mergedContent: headContent };
    }

    if (headContent === sourceContent) {
        // Identical changes
        return { success: true, mergedContent: headContent };
    }

    // Both changed and different -> Conflict
    return { 
        success: false, 
        conflict: true, 
        theirContent: sourceContent,
        baseContent: baseContent,
        mergedContent: undefined // UI needs to resolve
    };
  }
}

export const gitService = new GitService();
