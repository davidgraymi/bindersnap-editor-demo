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

### Hocuspocus + Yjs for Collaboration

Real-time collaboration is handled by
[Hocuspocus](https://tiptap.dev/hocuspocus/) (Tiptap's collaboration server)
with [Yjs](https://yjs.dev/) CRDTs under the hood. This gives us:

- Conflict-free real-time editing between multiple users
- Presence indicators (cursors, selections) via `y-prosemirror`
- Offline persistence with sync-on-reconnect
- A foundation for the version history system (Yjs snapshots)

The key architectural principle here: **Yjs handles concurrent editing state,
but Bindersnap's own version system handles approved snapshots.** These are
different things and should never be conflated. A Yjs "update" is ephemeral
coordination state. A Bindersnap "version" is an immutable, signed snapshot
that represents a meaningful document state (a draft, a review, an approval).

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

#### 3. `ApprovalBlock` — Status: Planned

**What it does:** Wraps a section of a document (or the entire document) in
an approval state container. The container has three states: `pending`,
`approved`, `rejected`. Approved content is locked — the ProseMirror schema
and plugin layer prevent edits inside an approved block. Editing an approved
block requires explicitly "unlocking" it, which creates a new review cycle.

**Why it's important:** This is the core differentiator. Most document tools
add approvals as a metadata field on the document. Bindersnap makes approval
a _structural property of the document content itself_. A contract can have
an approved boilerplate section and a pending negotiated section in the same
document, at the same time.

**Architecture:**

```
Node: approvalBlock
  attrs: {
    status:    "pending" | "approved" | "rejected",
    approver:  string | null,
    approvedAt: number | null,
    version:   string  // hash of approved content for tamper detection
  }
  content: block+
  selectable: true
  draggable: false
```

The locking mechanism: A ProseMirror plugin filters transactions that would
modify the content of an `approvalBlock` with `status: "approved"`. These
transactions are silently dropped unless they come with a special
`{meta: {unlock: true}}` flag set by the `unlockApprovalBlock` command (which
triggers a confirmation UI before proceeding).

The `version` attribute stores a SHA-256 hash of the serialized block content
at the time of approval. Any subsequent read of the block can verify this hash
to detect tampering.

**Key commands:**

- `submitForApproval(pos)` — set status to `pending`
- `approveBlock(pos, approver)` — set status to `approved`, lock, stamp hash
- `rejectBlock(pos, approver, note)` — set status to `rejected`, add note
- `unlockApprovalBlock(pos)` — begin new review cycle (requires confirmation)

**CSS classes:** `.bs-approval`, `.bs-approval--pending`,
`.bs-approval--approved`, `.bs-approval--rejected`, `.bs-approval__badge`,
`.bs-approval__content`, `.bs-approval__meta` (see `bindersnap-editor.css`
section 10c)

---

#### 4. `CommentAnchor` — Status: Planned

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

#### 5. `VersionSnapshot` — Status: Planned

**What it does:** Produces and restores named snapshots of the document, built
on top of Yjs's snapshot mechanism. Bindersnap versions are distinct from Yjs
updates — a version is an intentional, named, immutable checkpoint.

**Architecture:**

A version is created by calling `Y.snapshot(doc)` on the underlying Yjs
document and storing the resulting binary blob in the backend, alongside a
version record:

```typescript
interface DocumentVersion {
  id: string;
  documentId: string;
  name: string; // "v1.2 - After legal review"
  createdBy: string;
  createdAt: number;
  snapshot: Uint8Array; // Y.encodeSnapshot(Y.snapshot(doc))
  contentHash: string; // SHA-256 of ProseMirror JSON at this version
  status: "draft" | "in-review" | "approved";
}
```

Restoring a version renders the document in a read-only diff view using
`Y.createDocFromSnapshot`, which reconstructs the Yjs document state at that
point in time. The diff between two versions is computed by diffing their
ProseMirror JSON representations.

The diff display uses the `DiffView` mode of the editor (activated by
`diffMode="unified"` prop), which renders the computed diff using
`.bs-diff-added` / `.bs-diff-removed` / `.bs-diff-unchanged` spans.

---

#### 6. `DocumentHeader` — Status: Planned

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

Bindersnap documents are ProseMirror JSON under the hood. The canonical
serialized format is:

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
      "attrs": { "status": "approved", "approver": "priya@company.com", "version": "sha256:abc..." },
      "content": [...]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "..." }]
    }
  ]
}
```

This JSON is stored in the backend as the canonical document state. The Yjs
CRDT layer is ephemeral coordination — it ensures concurrent edits from
multiple users merge correctly in real time. But the backend is the source of
truth for _persisted_ document state.

**Two-layer persistence model:**

```
┌─────────────────────┐         ┌──────────────────────────────────┐
│  Yjs CRDT (in-memory│◄────────│  Hocuspocus server (WebSocket)   │
│  + IndexedDB cache) │         │  Ephemeral collaboration state   │
└──────────┬──────────┘         └──────────────────────────────────┘
           │  on deliberate save
           ▼
┌─────────────────────┐
│  Backend (Postgres) │  ← source of truth, immutable version history
│  ProseMirror JSON   │
│  + version records  │
└─────────────────────┘
```

Documents are NOT auto-saved on every keystroke to the backend. They are
auto-saved to the Yjs persistence layer (IndexedDB) for resilience, and saved
to the backend on explicit user action (Cmd+S), on approval transitions, and
on a debounced interval (30s) for safety.

---

## The Approval Workflow Model

The approval system is the core business logic of Bindersnap. It works at two
levels:

### Document-level approval

A document as a whole can be submitted for review, approved, or rejected. This
transitions the document's `status` field and triggers notifications to
reviewers. This is a metadata operation — it does not affect the editor state.

### Block-level approval

Individual `approvalBlock` nodes within a document can be approved
independently. This is where Bindersnap is genuinely novel — you can have a
contract where the boilerplate sections are approved and locked, and the
negotiated terms sections are still in review, all in the same document at the
same time.

**The audit log:** Every approval event (submit, approve, reject, unlock) is
written as an immutable record to an `approval_events` table with:

```
{ documentId, blockId, action, actorId, timestamp, contentHash, note }
```

The content hash at time of approval is stored with the event. This is what
makes the audit log tamper-evident — you can verify that the content being
pointed to by the approval event matches what's in the document today.

---

## The Diff and Merge Architecture

### How diffs are computed

Document diffs in Bindersnap are computed at the ProseMirror JSON level, not
at the raw text level. This means structural changes (a paragraph becoming a
heading, a list item being promoted) are represented as structural diff
operations, not just text insertions/deletions.

The diff algorithm:

1. Serialize both document versions to ProseMirror JSON.
2. Run a tree diff algorithm (similar to `fast-diff` but operating on the node
   tree rather than text strings) to produce a sequence of add/remove/unchanged
   node operations.
3. Convert the diff to a set of Tiptap transactions that can be applied to
   produce the diff view.

For the MVP, step 2 is simplified: we serialize both versions to plain text and
use Myers diff algorithm (`fast-diff`) to produce a character-level diff, then
map character positions back to ProseMirror document positions. This is less
structurally aware but sufficient for the initial approval review flow.

### How merges work

A merge produces a `mergeConflictBlock` node wherever the two document versions
diverge in incompatible ways. The merge algorithm:

1. Identify the common ancestor version (the last approved or branched-from
   version).
2. Compute diffs from ancestor → ours and ancestor → theirs.
3. Regions where both diffs are identical: auto-merge (no conflict).
4. Regions where only one side changed: auto-merge with the changed side.
5. Regions where both sides changed differently: emit a `mergeConflictBlock`.

This is a three-way merge at the document level. It is intentionally similar
to how git handles text merges, but operating on the ProseMirror document tree
rather than raw text.

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
        ApprovalBlock/
          index.ts
          ApprovalBlockView.tsx
          commands.ts
          plugin.ts
          ApprovalBlock.test.ts
        CommentAnchor/
          index.ts
          plugin.ts
          commands.ts
        VersionSnapshot/
          index.ts
          commands.ts
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
        VersionSidebar.tsx
        ApprovalSidebar.tsx

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
- **Version snapshots:** Snapshots are stored as binary Yjs blobs and only
  decoded on demand (when a user opens the version history panel). They are
  never decoded as part of the main document load.

---

## Security Considerations

### Content sanitization

All HTML content is sanitized before being set into the editor via DOMPurify.
The allowed schema mirrors the Tiptap StarterKit schema exactly — any HTML
element or attribute not in the schema is stripped. This prevents XSS via
document content.

### Approval tamper detection

The `contentHash` stored with each approval event is computed over the
canonical ProseMirror JSON serialization of the approved block. On any future
read of that block, the hash can be recomputed and compared. A mismatch
indicates tampering and should be surfaced to the user as a security warning.

### Collaboration authentication

Hocuspocus connections are authenticated via JWT tokens issued by the backend.
Each WebSocket connection carries a token that encodes the user's identity and
document permissions. The Hocuspocus server validates this token before
allowing the connection. Document read/write permissions are enforced at the
server, not just the UI.

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
- [ ] `ApprovalBlock` extension — pending / approved / rejected states
- [ ] Document-level approval API integration (submit, approve, reject)
- [ ] Basic version history (save + restore, no diff view yet)
- [ ] Hocuspocus real-time collaboration integration
- [ ] Comment system (sidebar + `CommentAnchor` extension)
- [ ] PDF export of approved document with approval metadata watermark
- [ ] Audit log export (CSV + PDF)

### Phase 2: Git-style review flow (Series A story)

_Goal: First enterprise logos. The editor must feel like a professional
document governance tool, not just a rich text editor._

- [ ] `TrackedChanges` extension — full accept/reject cycle
- [ ] `MergeConflict` extension — three-way merge conflict resolution
- [ ] Version diff view — side-by-side and unified diff rendering
- [ ] `VersionSnapshot` extension — named versions, branching
- [ ] Review request workflow (assign reviewer, request changes, re-submit)
- [ ] Block-level approval (approve individual sections independently)
- [ ] Compare any two versions in diff view
- [ ] Approval signature (typed name or drawn signature on `approvalBlock`)

### Phase 3: Enterprise and compliance depth

_Goal: Support regulated industry customers with strict compliance requirements._

- [ ] `DocumentHeader` extension — structured document metadata
- [ ] HIPAA compliance mode (audit all access, not just approvals)
- [ ] SSO / SAML integration with Hocuspocus auth
- [ ] Document templates with pre-approved boilerplate sections
- [ ] Clause library — approved text blocks that can be inserted and are
      version-tracked independently
- [ ] Automated clause detection (surface when a clause matches a known
      approved template)
- [ ] eSignature integration (via DocuSign or native)
- [ ] SOC 2 Type II audit log export format

### Phase 4: Intelligence layer

_Goal: Make Bindersnap the smartest document tool for regulated teams._

- [ ] Inline AI drafting assistant (context-aware, trained on document type)
- [ ] Clause comparison ("this clause differs from the approved version in your
      template library in these ways")
- [ ] Risk flagging ("this section contains language that has been rejected in
      past approval cycles")
- [ ] Auto-summary of changes between versions
- [ ] Smart merge conflict resolution suggestions

---

## Open Questions and Decisions Pending

These are architectural questions that have not been definitively resolved
and should be discussed before implementation begins on the relevant phase.

**Q1: ProseMirror schema strictness vs. content flexibility**  
The `ApprovalBlock` and `MergeConflict` nodes need to accept arbitrary block
content. ProseMirror's `content` expression `block+` works, but it can cause
issues with paste handling and schema validation. Should we define a tighter
allowed content list, or accept the flexibility trade-off?

**Q2: Tracked changes storage — in-doc marks vs. out-of-doc store**  
The current design stores tracked changes as ProseMirror marks inside the
document. An alternative is to store them out-of-band (in the backend, keyed
by document position ranges), similar to how GitHub stores PR review comments.
The in-doc approach is simpler but makes the document larger and complicates
export. The out-of-band approach is cleaner but requires position mapping on
every document change. Decision pending.

**Q3: Version branching model**  
Should Bindersnap support true document branching (like git branches), or only
linear version history? Branching is more powerful but dramatically more
complex to implement and explain to non-technical users. The ICP (compliance
manager, not developer) may find branching confusing. Leaning toward linear
history with a "compare any two" capability rather than branches.

**Q4: Conflict resolution UX — inline or modal?**  
The current design resolves conflicts inline (buttons inside the
`MergeConflictBlock`). An alternative is a dedicated side-by-side modal review
view. Inline is more like Google Docs review. Modal is more like a proper code
review tool. Given that our ICP is non-technical, inline may be more approachable.

**Q5: Export format**  
The primary export format is currently HTML (for PDF generation via headless
Chrome). Should we also support native `.docx` export (via `docx.js`)? Legal
teams often require Word format for their own document management systems.
This is likely a Phase 2 or 3 requirement but the architecture should not
preclude it.

---

## Key References

- Tiptap documentation: https://tiptap.dev/docs
- ProseMirror guide: https://prosemirror.net/docs/guide/
- Yjs documentation: https://docs.yjs.dev/
- Hocuspocus documentation: https://tiptap.dev/hocuspocus/
- ProseMirror change tracking reference implementation:
  https://marijnhaverbeke.nl/blog/collaborative-editing-cm.html
- Design tokens and brand system: see `AGENTS.md` and
  `src/assets/css/bindersnap-tokens.css`
- Editor stylesheet: `src/components/editor/bindersnap-editor.css`
- Social media and brand reference: `docs/bindersnap-social-cheatsheet.html`
