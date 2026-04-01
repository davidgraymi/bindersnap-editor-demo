# ADR-001: MVP External-File Workflow Contract (Upload-as-PR)

- Status: Accepted for MVP
- Date: 2026-04-01
- Related issue: https://github.com/davidgraymi/bindersnap-editor-demo/issues/85

## 1. Scope

This document defines the MVP contract for teams that author documents outside
Bindersnap (Word/Excel/PDF) but require version control and approvals inside
Bindersnap.

This contract complements editor-first work (Issues #71, #72, #73). It does not
replace it.

## 2. Core Model (MVP)

1. One document equals one Gitea repository.
2. Each uploaded file revision creates a new reviewable version.
3. Each new version is represented by a pull request (upload branch -> `main`).
4. Merge of an approved PR establishes the current published version.
5. Prior published versions remain immutable and downloadable.

## 3. Required Decisions

### 3.1 Upload branch naming convention

Branch format:

`upload/<document-id>/vNNNN-YYYYMMDDTHHMMSSZ`

Rules:

1. `<document-id>` is a stable lowercase kebab-case identifier.
2. `vNNNN` is a zero-padded, monotonic version candidate number.
3. Timestamp is UTC in basic ISO format for lexicographic sorting.

Example:

`upload/quote-acme-renewal-2026/v0004-20260401T210712Z`

### 3.2 Canonical file naming rules

Each repository stores exactly one canonical source file at:

`document/<document-id>.<ext>`

Rules:

1. Filename is derived from document id, not user-provided upload names.
2. Extension is fixed when the document repository is created.
3. User upload names such as `001_B.pdf` or `contract_FINAL_v2.docx` are ignored.
4. Upload pipeline rewrites the uploaded file into the canonical path.

Example:

`document/quote-acme-renewal-2026.pdf`

### 3.3 Canonical version pointer strategy

MVP uses a dual pointer:

1. Mutable current pointer file: `.bindersnap/version.json` on `main`
2. Immutable historical pointer: git tag `vNNNN` on each published merge commit

`version.json` schema (MVP):

```json
{
  "documentId": "quote-acme-renewal-2026",
  "currentVersion": "v0004",
  "publishedCommitSha": "<sha>",
  "publishedAt": "2026-04-01T21:14:00Z",
  "sourcePullRequest": 128
}
```

### 3.4 Supported file types and size limits (MVP)

Supported extensions:

1. `.docx`
2. `.xlsx`
3. `.pptx`
4. `.pdf`

Limits:

1. One canonical file per document repository
2. Maximum upload size: 25 MiB per revision
3. Uploads outside type/size policy are rejected before branch creation

### 3.5 Role mapping (upload vs approve vs merge)

1. Uploader
   Can create upload branches and open PRs.
2. Approver
   Can review, approve, or request changes on PRs.
3. Publisher
   Can merge approved PRs to `main` and create the publish tag/pointer update.

MVP policy:

1. Uploader and Publisher must be different users for regulated workflows.
2. Minimum one approval is required before publish.
3. Self-approval does not satisfy the minimum approval rule.

## 4. Lifecycle States

The external-file workflow state machine is:

1. Draft Upload
   File uploaded and committed to an upload branch; PR not yet ready for review.
2. In Review
   PR is open and marked ready; approvals pending.
3. Changes Requested
   Reviewer requested changes; uploader pushes additional commits to same PR branch.
4. Approved/Published
   Approved: PR has required approval(s), awaiting merge.
   Published: PR merged to `main`, `version.json` updated, `vNNNN` tag created.

Allowed transitions:

1. Draft Upload -> In Review
2. In Review -> Changes Requested
3. Changes Requested -> In Review
4. In Review -> Approved/Published (approved, waiting for merge)
5. Approved/Published (approved) -> Approved/Published (published)
6. Published -> Draft Upload (next version candidate)

## 5. Quote Workflow Examples

Document setup:

1. `document-id`: `quote-acme-renewal-2026`
2. Canonical file: `document/quote-acme-renewal-2026.pdf`

Version 4 upload:

1. Branch: `upload/quote-acme-renewal-2026/v0004-20260401T210712Z`
2. PR title: `Upload quote-acme-renewal-2026 v0004`
3. PR target: `main`
4. Review outcome: approved
5. Publish result: PR merged, tag `v0004`, pointer file updated

Version 5 with changes requested:

1. Branch: `upload/quote-acme-renewal-2026/v0005-20260403T143000Z`
2. Reviewer requests correction on legal terms
3. Uploader replaces file on same branch and pushes a new commit
4. PR returns to in-review and is later approved/published as `v0005`

## 6. Non-Goals (MVP)

1. No inline editing is required for this workflow.
2. No binary semantic diff rendering is required.
3. No multi-file bundle packaging per version.
4. No retroactive mutation of published versions.
5. No replacement of editor-first workflows.

## 7. Operational Notes

1. Preserve full PR timeline as part of the audit trail.
2. Enforce branch protection on `main` (no direct pushes).
3. Reject duplicate publish attempts for same branch/version candidate.
4. Use UTC everywhere for timestamps in branch names and metadata.
