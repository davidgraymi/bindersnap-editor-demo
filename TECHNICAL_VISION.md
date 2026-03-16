# TECHNICAL_VISION.md — Bindersnap Editor Architecture

This document captures the technical vision, architectural decisions, and
engineering roadmap for the Bindersnap document editor. It is intended to be
read alongside `AGENTS.md`, which covers product identity, design tokens, and
copy guidelines.

**Last updated:** 2026  
**Owner:** David Gray (davidgraymi@gmail.com)  
**Status:** Pre-seed, active development

---

## The Product Problem This Solves

Bindersnap replaces a stack of three tools that regulated teams currently
stitch together: Word (writing), Notion (collaboration), and email
(approvals). The editor is the core primitive — everything else (approvals,
audit logs, compliance exports) is built on top of it.

The editor must therefore feel _better than Word_ to write in, _as fluid as
Notion_ to collaborate in, and _as trustworthy as a legal system_ for
approvals. These are not cosmetic goals. They are architectural requirements.

The central editorial insight is: **the approval trail is the product, not a
feature.** Every architectural decision in the editor should be read through
that lens. Version history, merge conflicts, change tracking, approval
states — these are first-class citizens, not plugins bolted on afterward.

---

## Technology Choices

### Tiptap + ProseMirror

The editor is built on [Tiptap](https://tiptap.dev/) (v2), which wraps
ProseMirror. This was a deliberate choice over alternatives:

- **vs. Lexical (Meta):** ProseMirror's schema system is stricter and better
  suited to document governance. Lexical's serialization model makes it harder
  to produce a stable, diff-able document format. ProseMirror's document model
  is a tree of typed nodes with typed marks — it maps naturally to a
  version-controlled document format.

- **vs. Slate:** ProseMirror has a significantly more robust collaborative
  editing story (via `y-prosemirror` and `hocuspocus`) and a larger extension
  ecosystem. Slate's schema flexibility is a liability for a product that needs
  strict document structure.

- **vs. Quill:** Quill's delta format is powerful for operational transforms
  but creates friction when building git-style diffing and merging. ProseMirror
  nodes are easier to reason about structurally.

- **vs. a custom editor from scratch:** The extensions we're building
  (merge conflicts, tracked changes, approval states) are genuinely novel, but
  the underlying text editing primitives (selections, transactions, decorations,
  collaborative cursors) are solved problems. ProseMirror solves them extremely
  well. We should build novelty on solid ground.

### Hocuspocus + Yjs for Real-Time Collaboration

Real-time collaboration is handled by
[Hocuspocus](https://tiptap.dev/hocuspocus/) (Tiptap's collaboration server)
with [Yjs](https://yjs.dev/) CRDTs under the hood. This gives us:

- Conflict-free real-time editing between multiple users
- Presence indicators (cursors, selections) via `y-prosemirror`
- Offline persistence and sync-on-reconnect via IndexedDB
- Operational transforms that resolve simultaneous keystrokes without conflict

Yjs has a single, narrow responsibility: **making concurrent live editing work
in the browser session.** It is the real-time coordination layer, nothing more.
It is explicitly NOT responsible for version history, branching, merging, or
approvals. Those concerns belong to Gitea (see below).

### Gitea as the Version Control Backend

Immutable version history, branching, merging, and approval workflows are
handled by a self-hosted [Gitea](https://gitea.io/) instance via its REST API.

This is a deliberate architectural choice over building a custom version control
system. The reasoning:

- **Legal defensibility.** Git's SHA-1/SHA-256 commit chain is cryptographically
  well-understood and has established legal precedent. Courts and compliance
  auditors have accepted git history as tamper-evident evidence because the hash
  chain is independently verifiable without trusting any particular vendor's
  implementation. A custom `contentHash` field in a Postgres table cannot make
  that claim.

- **Merge is already solved.** libgit2 (which Gitea uses internally) implements
  a battle-tested three-way merge algorithm. Reimplementing three-way merge from
  scratch — identifying common ancestors, diffing both sides, emitting conflict
  markers — would mean owning a large, subtle, and security-critical piece of
  infrastructure indefinitely.

- **Protected branches map directly to approval workflows.** Gitea's branch
  protection rules (require N approvals, require status checks, restrict who can
  push to `main`) are a near-direct analogue to Bindersnap's approval workflow.
  The approval system is essentially a configured branch protection policy.

- **Pull requests as the review primitive.** Gitea PRs give us review threads,
  change requests, approval gates, and a merge history for free. These are the
  exact primitives Bindersnap's review workflow needs.

- **Compliance standards.** Gitea can be self-hosted on-premises, which is a
  hard requirement for many regulated industry customers (healthcare, defense,
  certain finance). A SaaS-only version control backend would be a blocker.

**What Gitea stores:** Each Bindersnap document is a file (ProseMirror JSON,
serialized to a `.json` file) in a Gitea repository. Each workspace or team has
its own repository. Saves become commits. Reviews become pull requests. Approvals
become merge events on protected branches.

**What Gitea does NOT do:** Gitea has no awareness of the editor UI, real-time
collaboration, or the ProseMirror schema. It is a pure backend data store that
happens to have excellent version control semantics built in.

### React

The editor ships as a self-contained React component (`BindersnapEditor.tsx`)
with its own CSS (`bindersnap-editor.css`) imported directly. It is designed
to be portable — drop it into any React application and it renders correctly
regardless of the host page's stylesheet.

---

## The Extension Architecture

Extensions are the atomic units of editor capability. Each Bindersnap feature
that goes beyond standard rich text is implemented as a Tiptap extension.
Extensions should be:

1. **Self-contained** — an extension defines its own node/mark schema, its
   own commands, its own keyboard shortcuts, and its own rendering logic.
2. **Independently testable** — each extension should have unit tests that
   run against a headless ProseMirror editor instance.
3. **CSS-driven for style** — extension styling lives in
   `bindersnap-editor.css` under named sections. Extensions should not inline
   styles; they should produce HTML with the correct class names and let the
   stylesheet handle the visual treatment.

### Core Extensions (Tiptap built-in, configured)

These ship with Tiptap and are configured in `BindersnapEditor.tsx`:

| Extension        | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `StarterKit`     | Paragraphs, headings, lists, bold/italic, etc. |
| `Placeholder`    | Empty state placeholder text                   |
| `Link`           | Hyperlinks with safe `rel` attributes          |
| `Image`          | Inline and block image support                 |
| `Table`          | Resizable table with header support            |
| `TaskList`       | Checkbox task items                            |
| `Highlight`      | Text highlighting                              |
| `Underline`      | Underline mark                                 |
| `Typography`     | Smart quotes, em-dashes, etc.                  |
| `CharacterCount` | Word and character count for status bar        |
| `Color`          | Text color support                             |

### Bindersnap Custom Extensions (Built / To Build)

These are the novel extensions that differentiate Bindersnap from every other
document editor. They are listed roughly in order of implementation priority.

---

#### 1. `MergeConflict` — Status: In Development

**What it does:** Renders git-style merge conflict zones inside a document.
When two branches of a document diverge and are brought together for review,
the diff is shown as a three-zone block: _Current (ours)_, a divider, and
_Incoming (theirs)_. The author can resolve by accepting one side, the other,
or both.

**Why it's hard:** ProseMirror's node model requires a strict schema. Merge
conflict zones contain arbitrary document content (paragraphs, headings, lists)
inside them. This means the `MergeConflict` node must be defined as a block
container that accepts generic content, which creates schema complexity.
ProseMirror doesn't natively support "content that could be anything" without
careful `content` attribute specification.

**Architecture:**

```
Node: mergeConflictBlock
  ├── Node: mergeConflictZone (attrs: type = "ours" | "theirs" | "base")
  │     └── content: block+  (paragraphs, headings, etc.)
  └── Rendered UI: divider bar, resolve buttons
```

The `MergeConflict` node is an **island** — its content is not editable via
the main cursor. Editing happens inside each zone independently. Resolving a
conflict replaces the entire `mergeConflictBlock` with the accepted content.

**Key commands:**

- `resolveConflictOurs(pos)` — replace block with "ours" zone content
- `resolveConflictTheirs(pos)` — replace block with "theirs" zone content
- `resolveConflictBoth(pos)` — concatenate both zones in order
- `resolveConflictManual(pos, content)` — replace with manually edited content

**CSS classes:** `.bs-conflict`, `.bs-conflict__zone--ours`,
`.bs-conflict__zone--theirs`, `.bs-conflict__divider`, `.bs-conflict__actions`
(see `bindersnap-editor.css` section 10a)

---

#### 2. `TrackedChanges` — Status: In Development

**What it does:** Records insertions and deletions as inline marks rather than
immediately applying them to the document. Authors working in "track changes"
mode produce a document where their edits are visually annotated but not yet
committed. Reviewers can accept or reject each change individually or in bulk.

**Why it's hard:** ProseMirror transactions are immediate — they change the
document state. Tracked changes require intercepting transactions, converting
the intended edit into an annotated mark rather than a structural change. This
is a significant departure from ProseMirror's default mental model.

**Architecture:**

The extension intercepts transactions using a ProseMirror plugin. When
`trackChanges: true` is active:

1. **Insertions:** Instead of inserting text directly, insert text with a
   `tracked-insert` mark carrying `{author, timestamp, changeId}` attributes.
2. **Deletions:** Instead of deleting text, apply a `tracked-delete` mark to
   the range. The text remains visible with strikethrough styling.
3. **Replacements:** A replace operation becomes a tracked-delete on the old
   range followed by a tracked-insert of the new text.

The plugin must be careful about which transactions to intercept. Internal
transactions (e.g., from collaboration sync) should NOT be intercepted —
only user-initiated transactions should become tracked changes.

**Schema:**

```
Mark: trackedInsert
  attrs: { author: string, timestamp: number, changeId: string }

Mark: trackedDelete
  attrs: { author: string, timestamp: number, changeId: string }
  excludes: _ (can coexist with all other marks)
```

**Key commands:**

- `acceptChange(changeId)` — commit insertion / remove deletion mark
- `rejectChange(changeId)` — remove insertion / commit deletion (un-delete)
- `acceptAllChanges()` — commit all tracked changes in document
- `rejectAllChanges()` — reject all tracked changes

**State:** The plugin stores a `Map<changeId, ChangeRecord>` in its plugin
state, enabling efficient lookup by change ID without scanning the entire doc.

**CSS classes:** `.bs-insert`, `.bs-delete`, `.bs-change-actions` (see
`bindersnap-editor.css` section 10b)

---

#### 3. `ApprovalStatus` — Status: Planned

**What it does:** Renders a read-only status banner above the editor reflecting
the current approval state of the document — its Gitea PR status. This is a
**decoration rendered outside the document content area**, not a ProseMirror
node. It does not exist in the document's serialized JSON and has no effect
on what gets committed to Gitea.

**Why not `ApprovalBlock` (section-level locking)?** An earlier design proposed
an `approvalBlock` ProseMirror node that would lock sections of a document via
a client-side transaction filter. This was rejected for three reasons:

1. **Git branch protection is the correct locking primitive.** When `main` is
   protected and requires approvals to merge, the API enforces that rule — not
   the frontend. A client-side transaction filter is theater: it can be bypassed,
   it pollutes the document schema with approval metadata that has no business
   being in the document content, and it creates a false sense of security.

2. **Section-level approval granularity is solved by the clause library.**
   The real user need behind `ApprovalBlock` — "I don't want reviewers to change
   this pre-approved boilerplate" — is correctly addressed by embedding approved
   clause documents via the `ClauseEmbed` extension (see below). Each clause is
   its own document with its own git history and branch protection. The host
   document simply references it.

3. **What gets committed to Gitea should be clean document content.** Approval
   status, lock state, and review metadata are workflow concerns. They belong in
   the Postgres `approval_events` table and the Gitea PR state — not embedded as
   nodes or attributes inside the document JSON.

**Architecture:**

```
ApprovalStatusBanner (React component, rendered outside EditorContent)
  — driven by: Gitea PR status fetched via REST API
  — states: "Draft" | "In Review" | "Changes Requested" | "Approved"
  — does NOT affect document serialization in any way
```

The banner is passed into `BindersnapEditor` as a prop (`approvalStatus`) and
rendered above the ProseMirror scroll area. Enforcement of the approval gate
happens at the Gitea branch protection layer when a merge is attempted — the
banner is purely informational.

**CSS classes:** `.bs-approval`, `.bs-approval--pending`,
`.bs-approval--approved`, `.bs-approval--rejected`, `.bs-approval__badge`
(see `bindersnap-editor.css` section 10c — these classes remain for the banner,
they are just no longer applied to document-content nodes)

---

#### 4. `ClauseEmbed` — Status: Planned

**What it does:** Embeds a referenced clause document inline in the editor as
a visually distinct, read-only block. A clause is a separate Bindersnap
document — with its own file in the Gitea repository, its own version history,
and its own CODEOWNERS-enforced branch protection. The host document stores
only a reference (the clause's file path and pinned commit SHA). The
`ClauseEmbed` extension fetches the clause content at render time and displays
it in place.

**Why this is the correct architecture for "approved sections":**

Rather than locking a section _inside_ a document using client-side ProseMirror
tricks, Bindersnap promotes approved standard language to _separate files_ in
the git repository — the clause library. A contract that needs an approved
liability waiver embeds a reference to that clause file. The clause lives at a
known path in the repo, protected by CODEOWNERS. Nobody edits the clause inline
in the contract — they edit the clause file through its own review cycle, and
the contract author updates the pinned SHA when they want to pull in the newer
version. The contract's JSON remains clean document content with no approval
metadata embedded in it.

This maps directly to how legal operations teams actually work: standard
boilerplate is managed centrally and versioned independently of the contracts
that use it.

**Frontend rendering:** Because `clauseEmbed` stores a document ID and SHA as
node attributes, the editor renders it as a fully interactive embedded view —
showing the clause title, approval status, version number, and the actual
rendered content, all inline in the reading flow. The user experience is a
unified document. The data model is clean separation of concerns. The clause
content is never literally in the host document's JSON — only the reference
is. The display is assembled by the editor at render time from the fetched
clause file.

**CODEOWNERS integration:** Each clause file in the workspace Gitea repository
has an entry in `CODEOWNERS` mapping it to the team responsible for approving
changes:

```
# .gitea/CODEOWNERS
/clauses/liability-waiver.json          @legal-team
/clauses/payment-terms.json             @finance-team @legal-team
/clauses/data-processing-addendum.json  @privacy-team
```

Any PR that modifies a clause file requires sign-off from the designated owners,
enforced by Gitea at the API level. No frontend locking required. The clause
library is just git, with CODEOWNERS providing the governance layer.

**Architecture:**

```
Node: clauseEmbed
  attrs: {
    clauseId:  string   // Bindersnap document ID of the clause
    gitSha:    string   // pinned commit SHA — which version is embedded
    title:     string   // display name, cached at embed time for offline rendering
  }
  atom: true      (not editable inline — it is a reference, not content)
  draggable: true
```

The node is rendered via a NodeView (React component) that:

1. Reads `clauseId` and `gitSha` from node attrs.
2. Fetches the clause document JSON from Gitea at the pinned SHA (aggressively
   cached — clause content at a given SHA is immutable).
3. Renders clause content using a nested read-only `BindersnapEditor` instance.
4. Shows the clause title, version, approval badge, and a link to the source.
5. Shows a "newer version available" badge when the clause has been updated
   since the pinned SHA, with a one-click update action.

**Key commands:**

- `insertClause(clauseId, gitSha)` — insert a `clauseEmbed` node at cursor
- `updateClausePinnedSha(pos, newSha)` — pin to a newer clause version
- `detachClause(pos)` — convert the embed to editable inline content (with a
  prominent warning that the content is now unmanaged)

**CSS classes:** `.bs-clause-embed`, `.bs-clause-embed__header`,
`.bs-clause-embed__content`, `.bs-clause-embed__update-badge`

---

#### 5. `CommentAnchor` — Status: Planned

**What it does:** Anchors inline comment threads to specific text ranges in
the document. Comments are _not_ stored inside the document — they live in the
backend and are associated with the document by their anchor range. The
extension only stores the anchor (a decorated text range) and renders the
visual indicator.

**Architecture:**

The extension uses ProseMirror **decorations** rather than marks or nodes.
This is intentional: comment anchors are not part of the document's semantic
content — they are ephemeral UI overlays. Using decorations means they do not
affect document serialization or the schema.

```
Decoration (inline): CommentAnchorDecoration
  attrs: { commentId: string, resolved: boolean, active: boolean }
  class: "bs-comment-anchor" | "bs-comment-anchor--active"
```

The plugin state maintains a `Map<commentId, {from, to}>` of all active
comment positions. When the document changes (via a transaction), the plugin
maps these positions forward using ProseMirror's position mapping, keeping
anchors correctly attached to their text even as the document changes around
them.

The `CommentSidebar` component (outside the editor) reads the plugin state to
know which comment to highlight when the user's cursor enters an anchored
range.

**Key commands:**

- `addCommentAnchor(from, to, commentId)` — add anchor decoration
- `removeCommentAnchor(commentId)` — remove decoration when comment is deleted
- `setActiveComment(commentId)` — highlight active anchor

---

#### 6. `VersionSnapshot` — Status: Planned

**What it does:** Surfaces Gitea commit history and release tags inside the
editor UI as a version timeline. Handles both the _published version_ display
(derived from Gitea annotated tags) and the _branch-in-progress version_ display
(derived from `git describe` output). Also provides the commands that trigger
commits and the version history panel.

---

**The versioning model:**

Bindersnap uses two complementary version representations depending on context.

**Published versions — Gitea annotated tags, manually named or auto-semver:**

When a PR is merged to `main`, the backend creates an annotated tag on the
resulting commit. The tag name is the canonical published version of that
document. Users have two options at merge time:

- **Manual:** Enter a version label explicitly. This can be any string —
  `"v2"`, `"2024-Q4-Final"`, `"2.1"`. No format is enforced. Legal and
  compliance teams often prefer meaningful labels over strict semver.
- **Auto (semver):** The backend increments automatically. The user picks
  `major`, `minor`, or `patch` from a dropdown at PR creation time; the
  backend computes the next semver tag from the latest tag on `main` and
  applies it on merge. Default when no preference is set: `patch`.

The tag is permanent and immutable. `v2.0.1` on the commit is the proof of
what was approved.

**Branch versions — computed from `git describe`, never stored:**

While a document is on a working branch, its version is computed on demand
using the equivalent of `git describe --tags --long`, then the commit SHA is
stripped:

```
git describe output:   v2.0.0-3-gabcdef7
displayed in UI:       v2.0.0-3
```

This reads as "3 commits since the published version v2.0.0" — immediately
meaningful to any user without requiring explanation.

**Pre-first-release fallback:** If no tag is reachable from the branch (the
document has never been published), `git describe` will fail. The fallback
display is `0.0.0-{n}` where `n` is the total commit count on the branch.
This gives a meaningful version number from day one without special-casing.

**These versions are never stored.** The branch version is computed from Gitea
API responses at display time and discarded. No Postgres column, no cache, no
sync concern. The published version is the git tag — it lives in Gitea and
nowhere else.

---

**Architecture:**

The Gitea REST API provides everything needed:

```
GET  /api/v1/repos/{owner}/{repo}/commits?path={file}    → commit list for file
GET  /api/v1/repos/{owner}/{repo}/raw/{file}?ref={sha}   → file content at sha
GET  /api/v1/repos/{owner}/{repo}/compare/{base}...{head} → diff between shas
GET  /api/v1/repos/{owner}/{repo}/tags                   → published version tags
POST /api/v1/repos/{owner}/{repo}/tags                   → create tag on merge
```

`git describe` is not a Gitea REST endpoint — the equivalent is computed by
the Bindersnap backend: fetch the commit's reachable tags via
`GET /api/v1/repos/{owner}/{repo}/git/commits/{sha}`, walk back to find the
nearest tag, count intervening commits. This is a lightweight operation and
can be cached aggressively since it only changes on new commits.

When a user opens the version history panel:

1. Fetch the commit list for the document file from Gitea.
2. Fetch the tag list to identify which commits are published versions.
3. For each commit: if it has a tag, display the tag name as the version.
   If not, display the `git describe`-equivalent (`{nearest_tag}-{n}`).
4. Clicking any commit fetches the file at that SHA and opens it read-only.

**CSS classes:** `.bs-diff-added`, `.bs-diff-removed`, `.bs-diff-unchanged`,
`.bs-diff-hunk` (see `bindersnap-editor.css` section 10e)

---

#### 7. `DocumentHeader` — Status: Planned

**What it does:** A structured metadata block that always appears at the top
of a Bindersnap document. Unlike a heading (which is free text), the document
header is a typed node with defined fields: title, document type, status badge,
last modified, and owner.

**Architecture:**

```
Node: documentHeader (required first child of the document)
  attrs: {
    title:      string
    docType:    string | null   // "Contract" | "Policy" | "SOP" | etc.
    status:     string | null
    ownerId:    string | null
    updatedAt:  number | null
  }
  atom: true  (renders as a single unit, not editable inline)
```

The header is rendered via a `NodeView` — a custom React component that
replaces the default ProseMirror rendering. This gives us full control over
the visual treatment of the header without being constrained by the editor's
prose typography.

The title field is special: it _is_ editable inline (via the NodeView's own
contenteditable region), but the docType, status, and metadata fields are
controlled from the sidebar UI, not the editor.

---

## The Document Data Model

Bindersnap documents are ProseMirror JSON. The canonical serialized format is:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "documentHeader",
      "attrs": { "title": "Q4 Vendor Agreement", "docType": "Contract", "status": "in-review" }
    },
    {
      "type": "approvalBlock",
      "attrs": { "status": "approved", "approver": "priya@company.com", "gitSha": "a3f8c1d..." },
      "content": [...]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "..." }]
    }
  ]
}
```

This JSON is the file that lives in the Gitea repository. Every save is a
commit of this file. The file is the document. Git is the database.

**Three-layer persistence model:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Real-time collaboration (ephemeral, in-session)            │
│                                                                        │
│  Yjs CRDT (in-memory + IndexedDB)  ◄──►  Hocuspocus WebSocket server  │
│                                                                        │
│  Handles: concurrent keystrokes, live cursors, offline resilience.    │
│  Does NOT handle: version history, branches, approvals, or merges.    │
└─────────────────────────────┬────────────────────────────────────────┘
                              │  on deliberate save (Cmd+S,
                              │  approval transition, 30s debounce)
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — Version control (immutable, tamper-evident)                │
│                                                                        │
│  Gitea (self-hosted) — REST API                                        │
│    document.json file committed to repo on each save                  │
│    Branches = working copies (flat names, no state prefix)            │
│    Pull requests = review cycles (PR state = workflow state)          │
│    Protected branch rules on main = approval requirements             │
│    Annotated tags on main = published versions (manual or semver)     │
│    Commit SHA = canonical version ID for audit log                    │
│                                                                        │
│  Handles: version history, branching, merging, approval gates.        │
│  Does NOT handle: real-time editing, UI state, or user metadata.      │
└─────────────────────────────┬────────────────────────────────────────┘
                              │  document metadata, user records,
                              │  team permissions, comment threads
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — Application metadata (relational)                          │
│                                                                        │
│  Postgres — application database                                       │
│    Documents table (id, gitea_repo, gitea_path, workspace_id, ...)   │
│    Users, teams, permissions                                           │
│    Comment threads (keyed to document + git SHA + anchor position)    │
│    Approval events log (immutable append-only, references git SHA)    │
│                                                                        │
│  Handles: everything that isn't document content or version history.  │
└──────────────────────────────────────────────────────────────────────┘
```

**Branch conventions:**

Each document in Bindersnap maps to a single file in a Gitea repo. The only
structurally special branch is `main` — the protected, approved trunk. All
working branches are flat, human-named slugs with no state-encoding prefix.

```
main                        ← protected. Merges require passing PR approvals.
update-inclusive-language   ← an active working branch (any name, any author)
fix-payment-terms           ← another active working branch
```

**Why no `draft/*` or `review/*` prefixes:** A prefix scheme that encodes
workflow state (draft → review) requires renaming the branch when the state
transitions. That creates a race condition: Yjs sessions holding a reference
to the old branch name are broken the moment it is renamed, and any in-flight
Gitea commit could push to a branch that no longer exists. The PR itself is the
canonical answer to "is this branch in review?" — the branch name does not need
to duplicate that information. The only prefix worth encoding in the branch name
is one that is stable for the lifetime of the branch.

**Branch display names:** Git branches have no intrinsic ownership and no
concept of a friendly display name. Both of those live in the application layer.
Each branch has a corresponding Gitea issue whose title is the human-readable
display name ("Update Inclusive Language", "Fix Payment Terms Q4"). The issue
is also where assignees, descriptions, and status are tracked. The branch name
is the URL-safe slug; the issue title is what users see. They are permanently
decoupled — the user can rename their working branch's display name at any time
without touching git.

```typescript
interface DocumentBranch {
  id: string;
  documentId: string;
  gitBranch: string; // "update-inclusive-language" — immutable slug
  giteaIssueId: number; // Gitea issue ID — owns display name + assignees
  displayName: string; // cached from issue title for fast rendering
  createdAt: number;
  baseCommitSha: string; // the SHA this branch forked from
  prId: number | null; // Gitea PR ID once submitted for review
}
```

A user can have as many concurrent working branches as they need — there is no
per-user branch limit. Multiple collaborators can push to the same branch freely,
which is the correct git model. The issue is the unit of ownership, not the
branch name.

Documents are NOT auto-saved on every keystroke to Gitea. Keystrokes go to
the Yjs layer (IndexedDB) for resilience. Gitea commits happen on explicit user
action (Cmd+S), on approval transitions, and on a debounced interval (30s).

---

## The Approval Workflow Model

The approval system is the core business logic of Bindersnap. It operates at
the document level only. There is no sub-document locking — that concern is
handled by the clause library architecture instead.

### Document-level approval via Gitea PRs

A document is approved by merging a working branch into `main` through a
Gitea pull request. The PR must satisfy the branch protection rules configured
for `main` — typically: N required approvals from designated reviewers, no
outstanding change requests, all status checks passing. This is enforced by
Gitea at the API level. Bindersnap's UI surfaces the PR workflow as human
language ("Submit for Review", "Approve", "Request Changes", "Merge") — users
never interact with git directly.

The approval states map to Gitea PR and branch states:

```
Working    → branch exists, no open PR
In Review  → open PR from branch to main
Changes Requested → PR has a review requesting changes
Approved   → PR has required approvals, ready to merge
Published  → PR merged, document on main, tagged with a version
```

### Clause-level protection via CODEOWNERS

The "approved section" problem — preventing casual edits to standard approved
language inside a document — is solved architecturally by the clause library,
not by in-editor locking. Standard clauses live as separate files in the Gitea
repository. `CODEOWNERS` maps each clause file to the team that must approve
changes to it. When a clause file is modified in a PR, Gitea automatically
requires sign-off from the designated owners before the PR can merge.

The host document contains only a reference to the clause (its file path and
pinned SHA). The `ClauseEmbed` extension renders the clause content inline for
reading. Editing the clause requires opening the clause document itself and
going through its own review cycle.

This architecture enforces the rule at the API layer (Gitea CODEOWNERS) rather
than the UI layer (a JavaScript transaction filter). It is robust, independently
auditable, and requires zero custom implementation beyond configuring CODEOWNERS.

### The audit log

Every approval event (submit, approve, reject, merge) is recorded as an
immutable append-only entry in the `approval_events` Postgres table:

```
{ documentId, gitSha, prId, action, actorId, timestamp, note }
```

The `gitSha` is the Gitea commit SHA of the document file at the moment the
event occurred. The `prId` is the Gitea PR number. Both are independently
verifiable — an auditor can inspect the Gitea repository and confirm that the
referenced SHA contains exactly the content that was approved. No proprietary
hash to trust. It's just git.

---

## The Diff and Merge Architecture

This is the most important architectural section to understand. There are two
distinct diff/merge contexts in Bindersnap, and they must not be confused:

**Context A — Live editing:** Two users editing the same document simultaneously.
This is handled entirely by Yjs CRDTs. There are no conflicts, no merge step,
no involvement from git. Yjs resolves concurrent operations automatically.

**Context B — Version merging:** Two separate _saved versions_ of a document
being reconciled. This is where Gitea and ProseMirror both come into play.

---

### How version diffs are displayed (frontend)

When a user opens the version comparison view or a merge conflict view, the
frontend needs to display what changed between two document versions in a way
that is native to the editor — not a raw text diff.

The process:

1. **Fetch both versions from Gitea.** Using the REST API, fetch the
   `document.json` file at each of the two commit SHAs being compared.
2. **Deserialize both to ProseMirror JSON.**
3. **Run the ProseMirror-level diff algorithm.** This operates on the node
   tree rather than raw text. Structural changes (a paragraph becoming a
   heading, a list item being promoted) are represented as structural operations.
   For the MVP this is simplified: serialize both versions to plain text, apply
   Myers diff (`fast-diff`), then map character positions back to ProseMirror
   document positions. The full tree diff is a Phase 2 improvement.
4. **Render the diff in the editor** using `.bs-diff-added` /
   `.bs-diff-removed` / `.bs-diff-unchanged` decorations (not nodes — diffs are
   display-only and must not affect the document schema).

The raw git text diff from Gitea is deliberately NOT used for the visual
display. Git's text diff produces line-level hunks over raw JSON, which is
unreadable. The ProseMirror-level diff produces a semantically meaningful,
prose-aware comparison that makes sense to a non-technical user.

---

### How merges work (Gitea three-way merge)

When two branches of a document need to be reconciled — e.g., two reviewers
made independent changes and their work needs to be combined — Bindersnap
delegates the merge entirely to Gitea.

The process:

1. **Both branches exist as Gitea branches.** Reviewer A's changes are on
   `draft/alice-edits`, Reviewer B's changes are on `draft/bob-edits`. Both
   branched from the same base commit on `review/q4-vendor`.
2. **Bindersnap calls the Gitea merge API.** Gitea performs a three-way merge
   using libgit2, with the common ancestor as the base. Auto-mergeable regions
   are resolved automatically.
3. **Gitea returns the merge result.** If there are conflicts, the merged file
   contains standard git conflict markers:
   ```
   <<<<<<< HEAD
   { "type": "paragraph", "content": [{ "type": "text", "text": "Alice's version..." }] }
   =======
   { "type": "paragraph", "content": [{ "type": "text", "text": "Bob's version..." }] }
   >>>>>>> draft/bob-edits
   ```
4. **The frontend parses the conflict markers** from the returned file content
   and converts each conflict region into a `mergeConflictBlock` ProseMirror
   node. This is the bridge between git's output and the editor's display.
5. **The user resolves conflicts in the editor** using the `MergeConflict`
   extension UI (accept ours, accept theirs, accept both, edit manually).
6. **Once all conflicts are resolved**, the clean ProseMirror JSON is committed
   back to Gitea as the merge commit, completing the merge.

The key insight: **Bindersnap does not implement merge logic.** It implements
conflict _display and resolution_ in the editor, delegating the actual merge
computation to Gitea. The `MergeConflict` extension is a renderer for git
conflict markers, not a merge algorithm.

---

### The conflict marker parser

The bridge between Gitea's output and the ProseMirror editor is a conflict
marker parser. When the merge result contains conflict markers, this parser:

1. Splits the JSON file content at `<<<<<<<`, `=======`, and `>>>>>>>` markers.
2. Attempts to parse each region as valid ProseMirror JSON.
3. If a region is valid ProseMirror JSON, wraps it in a `mergeConflictZone` node.
4. If a region is not valid JSON (e.g., the conflict bisects a JSON structure),
   falls back to treating the region as raw text with a warning.

Edge case: Conflicts that bisect a JSON object boundary (e.g., the `<<<` marker
lands inside a serialized string value) are inherently malformed. The parser
must handle this gracefully, treating the entire surrounding node as conflicted
rather than attempting to parse partial JSON.

---

## State Management Architecture

The editor's state is split across three layers:

### 1. ProseMirror / Tiptap editor state

The document content, cursor position, selection, and all extension plugin
state lives in the Tiptap `editor` object. This is the ground truth for "what
is in the document right now." It is never stored in React state — it is
accessed via `editor.getJSON()` or `editor.getHTML()` when needed.

### 2. React component state

UI state that does not belong in the document (sidebar open/closed, active
comment, toolbar dropdown state) lives in standard React `useState`. The
`BindersnapEditor` component is deliberately kept as a thin wrapper — most
React state lives in the page-level component that hosts the editor, not
inside the editor component itself.

### 3. Backend / server state

Document metadata (title, status, version list, approval records) lives in
the backend and is fetched via a standard REST or tRPC API. The editor
component receives these as props and remains stateless with respect to
backend data.

**The golden rule:** The editor component owns document content state.
The host page owns everything else. Props flow into the editor; HTML content
and events flow out.

---

## File Structure

```
src/
  components/
    editor/
      BindersnapEditor.tsx       ← Main editor React component
      bindersnap-editor.css      ← Co-located editor stylesheet (self-contained)
      extensions/
        MergeConflict/
          index.ts               ← Extension definition
          MergeConflictView.tsx  ← NodeView React component
          commands.ts            ← Extension commands
          plugin.ts              ← ProseMirror plugin (if needed)
          MergeConflict.test.ts  ← Unit tests
        TrackedChanges/
          index.ts
          plugin.ts              ← Transaction interceptor plugin
          commands.ts
          TrackedChanges.test.ts
        ApprovalStatus/
          index.ts               ← ApprovalStatus banner decoration
          ApprovalStatus.test.ts
        ClauseEmbed/
          index.ts               ← ClauseEmbed node + NodeView
          ClauseEmbedView.tsx    ← React NodeView — fetches + renders clause
          commands.ts
          ClauseEmbed.test.ts
        CommentAnchor/
          index.ts
          plugin.ts
          commands.ts
        VersionSnapshot/
          index.ts
          commands.ts            ← Calls Gitea API to commit/fetch versions
        DocumentHeader/
          index.ts
          DocumentHeaderView.tsx
      toolbar/
        Toolbar.tsx
        ToolbarButton.tsx
        HeadingSelect.tsx
      statusbar/
        StatusBar.tsx
      sidebar/
        CommentSidebar.tsx
        VersionSidebar.tsx       ← Displays Gitea commit history
        ApprovalSidebar.tsx

  services/
    gitea/
      client.ts                  ← Gitea REST API client (typed)
      documents.ts               ← commit, fetch, list versions for a document
      pullRequests.ts            ← create/merge/close PRs (review cycles)
      branches.ts                ← branch management for draft/review/main
    conflictParser.ts            ← Parses git conflict markers → ProseMirror nodes
    diffEngine.ts                ← ProseMirror JSON diff (Myers at text level for MVP)
    clauseCache.ts               ← LRU cache for clause content at pinned SHAs

  assets/
    css/
      bindersnap-tokens.css      ← Shared design token system (see AGENTS.md)
      bindersnap-landing.css     ← Landing page specific styles

  docs/
    bindersnap-social-cheatsheet.html  ← Brand social media reference
```

---

## Testing Strategy

### Unit tests (Vitest)

Each extension is tested against a headless ProseMirror/Tiptap instance.
Tests cover:

- Schema validity (nodes/marks are created correctly)
- Commands produce the expected document state
- Plugin state is updated correctly on transactions
- Edge cases: empty documents, selection at boundaries, nested structures

### Integration tests (Playwright)

Key user workflows are tested end-to-end:

- Creating a document and submitting for approval
- Resolving a merge conflict via UI
- Accepting and rejecting tracked changes
- Version comparison view renders correctly

### Visual regression (Chromatic / Storybook)

Each extension has a Storybook story that renders it in isolation (light and
dark mode). Chromatic catches unintended visual regressions on each PR.

---

## Performance Constraints

The editor must remain responsive at:

- **Document size:** Up to 100,000 words without noticeable lag
- **Concurrent users:** Up to 50 simultaneous editors on one document
- **Version history:** Up to 1,000 saved versions per document
- **Comment count:** Up to 500 simultaneous comment anchors

Key performance decisions:

- **Decoration rendering:** Comment anchors use DecorationSet, which is
  incrementally updated via `map()` on each transaction rather than being
  fully rebuilt. This is critical for documents with many comments.
- **Tracked changes:** The tracked changes plugin stores a flat map of change
  IDs rather than scanning the document tree on every transaction.
- **Merge conflict blocks:** These are rendered via NodeViews (React
  components), which ProseMirror renders lazily. Large blocks are not mounted
  until they scroll into view.
- **Version history:** Gitea commit metadata (SHA, message, author, timestamp)
  is fetched as a lightweight list. The actual document content at a historical
  version is only fetched on demand when a user opens that version in the diff
  view. The full ProseMirror JSON is never pre-fetched.
- **Conflict marker parsing:** The conflict marker parser runs only once per
  merge operation, not on every editor transaction. The resulting
  `mergeConflictBlock` nodes are standard ProseMirror nodes and have no ongoing
  parsing cost.

---

## Security Considerations

### Content sanitization

All HTML content is sanitized before being set into the editor via DOMPurify.
The allowed schema mirrors the Tiptap StarterKit schema exactly — any HTML
element or attribute not in the schema is stripped. This prevents XSS via
document content.

### Version integrity via git

Document version integrity is provided by Gitea's commit chain, not a
proprietary hashing system. Git's SHA-1/SHA-256 content-addressed storage
means every version of every document has a cryptographically verifiable
identity. Tampering with a historical version would require rewriting the
commit history, which is detectable by anyone with a clone of the repository.

The `gitSha` stored in `approval_events` records serves as a legally defensible reference point. An auditor, regulator, or court
can independently verify that the SHA in an approval record corresponds to
specific document content by inspecting the Gitea repository directly — no
Bindersnap-specific tooling required.

### Collaboration authentication

Hocuspocus connections are authenticated via JWT tokens issued by the backend.
Each WebSocket connection carries a token that encodes the user's identity and
document permissions. The Hocuspocus server validates this token before
allowing the connection. Document read/write permissions are enforced at the
server, not just the UI.

### Gitea authentication

The Bindersnap backend communicates with Gitea using a service account token
with scoped repository permissions. Individual user identities are mapped to
Gitea committer metadata (name and email in commit records) so the git history
reflects real human actors, not a generic service account. This is important
for the legal audit trail — the git log should be human-readable as a record
of who changed what and when.

---

## Roadmap

The following phases map to the product milestones in the pitch deck. The
phases are not strictly sequential — some work overlaps.

### Phase 1: Core editor + Approval foundation (MVP)

_Goal: First 50 paying teams. The editor must be excellent at the basics and
the approval workflow must be end-to-end._

- [x] Tiptap base setup with all core extensions configured
- [x] `bindersnap-editor.css` — full prose typography and extension styles
- [x] `BindersnapEditor.tsx` component with toolbar and status bar
- [ ] `ApprovalStatus` banner — decoration reflecting Gitea PR state
- [ ] Document-level approval via Gitea PR workflow (submit, approve, reject)
- [ ] Gitea integration — Phase 1 subset: commit on save, basic PR lifecycle
- [ ] Basic version history (commit list, restore from SHA, no diff view yet)
- [ ] Hocuspocus real-time collaboration integration
- [ ] Comment system (sidebar + `CommentAnchor` extension)
- [ ] PDF export of approved document with approval metadata watermark
- [ ] Audit log export (CSV + PDF)

### Phase 2: Git-style review flow (Series A story)

_Goal: First enterprise logos. The editor must feel like a professional
document governance tool, not just a rich text editor._

- [ ] Gitea integration — service layer, commit on save, branch management
- [ ] Pull request workflow mapped to Bindersnap review UI (no git exposed to user)
- [ ] `TrackedChanges` extension — full accept/reject cycle
- [ ] `MergeConflict` extension — conflict marker parser + three-way merge via Gitea
- [ ] Version diff view — ProseMirror-level diff renderer, side-by-side and unified
- [ ] `VersionSnapshot` sidebar — commit history with computed versions, read-only view
- [ ] Published version tagging on merge — manual label or auto-semver
- [ ] Branch version display (`git describe` equivalent, computed on demand)
- [ ] `ClauseEmbed` extension — insert clause references, fetch + render inline
- [ ] Clause library UI — browse, search, and insert approved clauses
- [ ] CODEOWNERS scaffolding — auto-generate CODEOWNERS for clause files
- [ ] Review request workflow (assign reviewer, request changes, re-submit)
- [ ] Compare any two commits in diff view
- [ ] Approval signature (typed name capture on PR merge event)

### Phase 3: Enterprise and compliance depth

_Goal: Support regulated industry customers with strict compliance requirements._

- [ ] `DocumentHeader` extension — structured document metadata
- [ ] HIPAA compliance mode (audit all access, not just approvals)
- [ ] SSO / SAML integration with Hocuspocus auth
- [ ] Document templates (workspace-level templates with pre-inserted clause embeds)
- [ ] Clause drift detection (surface when an embedded clause's pinned SHA is
      behind the latest approved version of that clause)
- [ ] Automated clause recognition (detect when inline text matches a known
      clause and offer to convert it to a managed `clauseEmbed`)
- [ ] eSignature integration (via DocuSign or native)
- [ ] SOC 2 Type II audit log export format

### Phase 4: Intelligence layer

_Goal: Make Bindersnap the smartest document tool for regulated teams._

- [ ] Inline AI drafting assistant (context-aware, trained on document type)
- [ ] Clause comparison ("this embedded clause differs from the latest approved
      version of the clause in these ways — update or keep pinned version")
- [ ] Risk flagging ("this section contains language that has been rejected in
      past approval cycles")
- [ ] Auto-summary of changes between versions
- [ ] Smart merge conflict resolution suggestions

---

## Open Questions and Decisions Pending

These are architectural questions that have not been definitively resolved
and should be discussed before implementation begins on the relevant phase.

**Q1: ProseMirror schema strictness vs. content flexibility**  
The `MergeConflict` node needs to accept arbitrary block content inside each
conflict zone. ProseMirror's `content` expression `block+` works, but can cause
issues with paste handling and schema validation. Should we define a tighter
allowed content list, or accept the flexibility trade-off? (Note: `ApprovalBlock`
has been removed as a document node — this question now applies only to
`MergeConflict` and `ClauseEmbed`.)

**Q2: Tracked changes storage — in-doc marks vs. out-of-doc store**  
The current design stores tracked changes as ProseMirror marks inside the
document. An alternative is to store them out-of-band (in the backend, keyed
by document position ranges), similar to how GitHub stores PR review comments.
The in-doc approach is simpler but makes the document larger, complicates the
Gitea commit diff (the raw JSON diff will contain mark metadata noise), and
makes export harder. The out-of-band approach is cleaner but requires position
mapping on every document change and a separate reconciliation step when the
document is committed to Gitea. Decision pending.

**Q3: Version branching model — RESOLVED**  
~~Should Bindersnap support true document branching?~~  
**Decision:** Bindersnap uses Gitea branches as the branching primitive. Any
number of working branches per document, per user, with no enforced naming
scheme beyond being a valid git slug. `main` is the single protected approved
trunk. Workflow state (in review, changes requested, approved) is read from the
Gitea PR attached to the branch — it is never encoded in the branch name.
Branch display names live in the associated Gitea issue title, decoupled from
the git branch name. Published versions are annotated git tags on `main`,
either manually named or auto-incremented semver. Branch-in-progress versions
are computed on demand using `git describe` logic (nearest tag + commit count),
displayed as `{tag}-{n}`, and never persisted.

**Q4: Conflict resolution UX — inline or modal?**  
The current design resolves conflicts inline (buttons inside the
`MergeConflictBlock`). An alternative is a dedicated side-by-side modal review
view. Inline is more like Google Docs review. Modal is more like a proper code
review tool. Given that our ICP is non-technical, inline may be more
approachable. However, for complex multi-conflict merges, a modal may be
necessary to give adequate context.

**Q5: Export format**  
The primary export format is currently HTML (for PDF generation via headless
Chrome). Should we also support native `.docx` export (via `docx.js`)? Legal
teams often require Word format for their own document management systems.
This is likely a Phase 2 or 3 requirement but the architecture should not
preclude it.

**Q6: Gitea repo structure — one repo per workspace or one repo per document?**  
Each document is a single `.json` file. The question is whether documents are
stored as individual files in a shared workspace repository, or each document
gets its own repository. One-repo-per-workspace is simpler (fewer repos to
manage, cross-document links are easier) but means the git history for any one
document is noisier. One-repo-per-document is cleaner from a version control
perspective but creates repo proliferation at scale. Leaning toward
one-repo-per-workspace with a file-per-document, using Gitea's file-level
history API (`GET /repos/{owner}/{repo}/commits?path={filepath}`) to scope
history to a specific document.

**Q7: Conflict marker parsing edge cases**  
When Gitea's merge produces conflict markers that bisect a JSON structure (e.g.,
`<<<<<<<` lands inside a serialized string value or between two sibling nodes),
the resulting file is not valid JSON and cannot be parsed directly. The conflict
marker parser must handle this gracefully. Two approaches: (a) treat the entire
surrounding top-level node as conflicted and present it as raw text with a
manual resolution UI, or (b) attempt to reconstruct valid JSON on both sides by
context. Approach (a) is safer but may produce large conflict blocks for minor
changes. Decision pending.

**Q8: `ClauseEmbed` rendering — nested editor vs. HTML render**  
The `ClauseEmbed` NodeView needs to render clause content inline. Two approaches:
(a) instantiate a nested read-only `BindersnapEditor` inside the NodeView —
gives full prose typography and extension support but has real performance
implications if a document contains many clauses, and (b) render the clause
content as static HTML using a lightweight serializer — faster, simpler, but
loses interactive features like comment anchors inside embedded clauses. Leaning
toward (b) for the MVP with (a) as a Phase 3 upgrade once performance
characteristics are understood. Decision pending.

**Q9: `ApprovalBlock` removal — CSS and editor stylesheet**  
The `bindersnap-editor.css` file contains styling for `.bs-approval`,
`.bs-approval--pending`, `.bs-approval--approved`, `.bs-approval--rejected`,
etc. (section 10c). With `ApprovalBlock` removed as a document node, these
classes are retained for the `ApprovalStatus` banner component but the
`bs-approval__content` and `bs-approval__meta` classes that assumed document
node structure should be reviewed and potentially removed. The editor stylesheet
should be audited for any lock-related styles that were predicated on the old
`approvalBlock` architecture.

---

## Key References

- Tiptap documentation: https://tiptap.dev/docs
- ProseMirror guide: https://prosemirror.net/docs/guide/
- Yjs documentation: https://docs.yjs.dev/
- Hocuspocus documentation: https://tiptap.dev/hocuspocus/
- Gitea REST API documentation: https://gitea.io/api/swagger
- Gitea installation guide: https://docs.gitea.com/installation/install-from-binary
- libgit2 merge documentation: https://libgit2.org/libgit2/#HEAD/group/merge
- ProseMirror change tracking reference implementation:
  https://marijnhaverbeke.nl/blog/collaborative-editing-cm.html
- Design tokens and brand system: see `AGENTS.md` and
  `src/assets/css/bindersnap-tokens.css`
- Editor stylesheet: `src/components/editor/bindersnap-editor.css`
- Social media and brand reference: `docs/bindersnap-social-cheatsheet.html`
