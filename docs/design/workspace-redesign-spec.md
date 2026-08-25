# Workspace UX Redesign — Decision Record & Build Plan

Approved by David, 2026-08-22, after three mockup iterations.
Live mockup canvas: https://claude.ai/code/artifact/4a819079-ceb3-4d5f-904f-6060eaa820ac
Static copies of the approved mockups (exact markup + pixel values) live in
`docs/design/mockups/*.dc.html` — treat them as the visual source of truth.
Design tokens: `packages/ui-tokens/css/bindersnap-tokens.css`. Read `AGENTS.md`
before any change; every architecture decision there still holds. This is a
**presentation-layer redesign only** — no backend, BFF, or Gitea model changes
except where explicitly listed under "Backend touchpoints".

## Scope

Workspace app only (`apps/app/components/`). Landing page, auth screens, and
billing/admin pages are untouched. Git vocabulary is softened but the
structure (change requests, approvals, versions) stays.

## Cross-cutting rules (every screen)

- One coral element per screen: the next action. Green = approval/success only.
- Kill: 4-stat dashboard row, Quick Actions card, in-app `.bs-eyebrow`
  marketing labels, `owner/repo` paths anywhere in the UI, git icons
  (GitPullRequest etc.) in user-facing chrome.
- Meta lines say one thing: "Maya proposed a new version 2h ago".
- Status pills (mono 11px, pill radius): `Current`, `In review`,
  `Needs your review`, `Ready to publish`, `Draft`.
- Top nav (all pages): logo + wordmark, Home, Documents, spacer, search
  ("Search documents", `/` shortcut), coral "New document", bell, avatar.
  No "Changes" nav link. Search answers while you type: a panel of matching
  documents under the box, arrow keys and Enter to open one, more results
  fetched as you scroll. Enter with nothing picked still lands on the library.

## Screen decisions

### Home (`Main.dc.html`) — replaces HomePage AND InboxPage

Task-first. **Every row is a change request the user is part of** (author,
reviewer, or on a document they own) — never a document link. Three sections:

1. **Waiting on you** (coral section label + count): needs-your-review and
   ready-to-publish items, each with a Review/Publish ghost button.
2. **Your submissions**: user's open change requests with approval progress.
3. **Recently decided**: _closed_ change requests with outcome
   ("Published as v6 · Aug 19", "Closed · withdrawn by Tom").
   Only path to the library is the "Browse documents →" link.

### Documents (`Documents.dc.html`)

Library page with saved views as chips: **I contribute to** (default) /
**I own** / **Everything I can see**, plus removable person-filter chips
("Owned by Jack ×") and a dashed "+ Filter by person" affordance. Rows:
name, meta ("Jack owns · v3 · 2 open changes · updated 2h ago"), status pill.
Plain-language search; the `owner:@me` query syntax stays as a power feature,
not the placeholder.

### Document workspace (`DocumentDetail.dc.html`)

Header: title (Lora 26), `v3 · Current` pill, approved date, filename. No
owner/repo path. Coral "Submit new version" button. **Four tabs**: Document,
Changes (count bubble), History (NO count bubble), **Access & approvals**
(merges old Team + Settings tabs; named honestly because it holds approver
rules and required-approval count too). Document tab: preview + slim rail
(Waiting on a decision / Versions / Team avatars).

### Change review (`ChangeReview.dc.html`)

Opens **inside the Changes tab** — document header and tabs stay visible;
"← All changes" returns to the list. No assignee concept anywhere (submitter +
reviewers only; the Gitea assignee field goes unused).

- Description paragraph under the title, written by the author.
- **Proposed version** card is fixed chrome, same place on every change:
  file icon, "Proposed version", `filename · update N of M · date` (mono),
  quiet "All updates" link, "Open" ghost button.
- Reviewers row: avatar + name + state mark (green check = approved, gray
  clock = pending) + "+ Add reviewer" pill button.
- **Timeline is a spine on the page, not a box**: 1.5px solid hairline
  (#ebeae7) at left; 28px opaque dots (solid colors, never alpha) sit on it.
  Dot glyphs by event type: arrow = opened, speech bubble = comment/thread,
  refresh = proposal update, green check on solid green tint (#e3f1e6 bg /
  #b6e0c3 border) = approval, pencil = composer. Avatars appear in card
  headers next to names, never on the spine.
- Events (opened / updated / approved) are plain text rows on the paper;
  comments are white cards.
- Proposal updates are timeline events: "Maya updated the proposed version
  (update 2) · Aug 21 · earlier approvals were reset · compare".
- Decision is a **floating pill** bottom-right (Request changes ghost +
  **green** Approve), always reachable without scrolling.

### Threads (`ThreadStates.dc.html` — all four states)

One comment primitive. A reply turns a comment into a thread. Anyone can
resolve; **a new comment on a resolved thread reopens it**; unresolved
threads block publishing when `blockOnUnresolvedThreads` is on.

- Unresolved marker: 6px coral dot + "Unresolved" muted text (no pill).
- Resolved marker: small gray check + "Resolved" in faint #a8a29e.
- Show/Collapse toggle lives in the card header (top-right), toggling in
  place — it never moves as content expands. Collapsed shows author +
  first line + toggle. Unresolved "Show N replies" is slightly darker than
  resolved (it may need action).
- Replies are full-width, same structure as the root (avatar + name + date
  header, then text), separated by hairlines — no indentation.
- Resolution logged INSIDE the thread: "Priya marked this as resolved ·
  Aug 21 · a new comment reopens it".
- Actions right-aligned bottom: Resolve · Reply.

## Backend touchpoints (small, deliberate)

- Review-history/updates: PR branch commits ARE the updates; "compare" is a
  ref-to-ref view; approval reset is the existing `dismiss_stale_approvals`
  flag. New work is timeline rendering + notifications.
- Reopen-on-comment: resolution is already an append-only event log in
  `services/api/gitea-client/discussions.ts`; derive "unresolved" when a
  comment follows the latest resolve event.
- Everything else is derivable from existing endpoints.

## Build order (one branch + PR each; per memory: always branches and PRs)

1. **Shell + Home**: new top nav in `AppShell.tsx`; task-first `HomePage`;
   delete/redirect `InboxPage`. Home needs a "my change requests" aggregation
   (may extend `GET /api/app/documents` response or add an endpoint).
2. **Documents page**: saved-view chips, person filters, new row design.
3. **Document workspace**: header, 4 tabs (merge Collaborators + Permissions
   into Access & approvals), Document tab rail.
4. **Change review**: timeline spine, thread model, proposed-version card,
   floating decision pill, updates-as-events (largest PR; may split timeline
   rendering and update-events into two PRs).

Editor package (`packages/editor/`) is untouched — no `sync-demo` needed
unless that changes.
