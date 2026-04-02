# ADR 0001: External-File Workflow Contract (Upload-as-PR)

Status: Accepted (MVP contract)  
Date: 2026-04-01  
Related: [Issue #85](https://github.com/davidgraymi/bindersnap-editor-demo/issues/85), #71, #72, #73

## Why This Exists

Bindersnap needs an explicit contract for teams that author files outside the app
(Word, Excel, PDF) but still need version control and approvals inside Bindersnap.

This ADR is the source-of-truth contract for that MVP workflow.

## Core Model

1. One document equals one Gitea repository for MVP.
2. Each uploaded file revision creates a new reviewable version.
3. Each version is represented by a pull request from an upload branch to `main`.
4. Merging an approved pull request establishes the current published version.
5. Prior versions remain immutable and downloadable from history.

## Lifecycle States

The workflow states are:

1. `draft upload`: uploader has created the upload branch and opened PR.
2. `in review`: PR has at least one assigned reviewer or active review comments.
3. `changes requested`: reviewer requested changes; uploader must update the same PR.
4. `approved/published`: required approvals exist and PR is merged to `main`.

Operational note:

- Approval and merge timestamps come from Gitea PR review events + merge commit
  history. No app-managed metadata file is required.

## Upload Branch Naming (Deterministic + Sortable)

Required format:

`upload/<document-slug>/<YYYYMMDD>/<HHMMSSZ>-<uploader-slug>-<contenthash8>`

Example:

`upload/acme-q2-quote/20260401/143012Z-asmith-8f3c2a1b`

Rules:

1. `document-slug` is lowercase kebab-case and stable for the document.
2. Timestamp is UTC and sortable (`YYYYMMDD` + `HHMMSSZ`).
3. `uploader-slug` is a stable short user identifier.
4. `contenthash8` is the first 8 hex characters of the uploaded file hash.
5. Uploads that produce identical branch names must be rejected and retried with
   a new upload event timestamp.

## Canonical File Naming (No Filename Chaos)

Required canonical path in repo root:

`<document-slug>.<ext>`

Examples:

1. `acme-q2-quote.docx`
2. `vendor-w9.pdf`
3. `quarterly-budget.xlsx`

Rules:

1. Canonical filename is stable across revisions.
2. Canonical filename cannot include version markers (`final`, `v2`, `approved`).
3. User-uploaded original filename is stored in commit trailers.
4. Extension must match an allowed file type.

## Canonical Version Pointer Strategy

MVP uses pure git pointers:

1. Current published version pointer: `main` HEAD commit.
2. Immutable published version pointers: annotated tags on merge commits.

Tag format:

`doc/v<NNNN>` (zero-padded, monotonic per repository)

Example:

`doc/v0004`

Rules:

1. Every publish merge to `main` must create exactly one new annotated tag.
2. `doc/v<NNNN>` increments by 1 for each published merge.
3. The tag points to the merge commit on `main`.
4. Historical versions are resolved through tags + commit history + merged PR refs.
5. No app-level moving pointer file is maintained.

## Git Audit Metadata (Commit Trailers)

To keep the backend pure git while preserving provenance, merge commits for
published versions must include these trailers:

1. `Bindersnap-Document-Id: <document-slug>`
2. `Bindersnap-Canonical-File: <document-slug>.<ext>`
3. `Bindersnap-Source-Filename: <original-user-filename>`
4. `Bindersnap-Upload-Branch: <upload-branch-name>`
5. `Bindersnap-Uploaded-By: <uploader-slug>`
6. `Bindersnap-File-Hash-SHA256: <full-hex-hash>`

Example commit footer:

```text
Bindersnap-Document-Id: acme-q2-quote
Bindersnap-Canonical-File: acme-q2-quote.docx
Bindersnap-Source-Filename: Acme Q2 Quote Final v3.docx
Bindersnap-Upload-Branch: upload/acme-q2-quote/20260401/143012Z-asmith-8f3c2a1b
Bindersnap-Uploaded-By: asmith
Bindersnap-File-Hash-SHA256: 8f3c2a1b8c0f8b2ed12e2e36fbfd18f6073e5c11a5823c80f7b6f8249ad2f0e3
```

## Supported File Types and Size Limits (MVP)

Supported file types:

Any file extension is permitted. The SPA stores the file as opaque base64 bytes in Gitea and never parses or executes the content, so the extension carries no security significance.

Size limit:

1. Maximum 25 MiB per file upload.

Validation behavior:

1. Reject files over 25 MiB before any API call.

## Role Mapping (Upload vs Approve vs Merge)

| Role        | Upload | Approve | Merge |
| ----------- | ------ | ------- | ----- |
| Viewer      | No     | No      | No    |
| Uploader    | Yes    | No      | No    |
| Reviewer    | No     | Yes     | No    |
| Publisher   | No     | Yes     | Yes   |
| Owner/Admin | Yes    | Yes     | Yes   |

Policy rules:

1. Upload permission does not imply approve permission.
2. Approve permission does not imply merge permission.
3. Merge must be blocked until required approvals are present.
4. Same human can hold multiple roles, but gates are still evaluated separately.

## Quote Workflow Examples

### Example A: Sales Quote DOCX

1. Upload branch: `upload/acme-q2-quote/20260401/143012Z-asmith-8f3c2a1b`
2. PR title: `Upload v4: Acme Q2 Quote`
3. Canonical file path: `acme-q2-quote.docx`
4. Transition: `draft upload` -> `in review` -> `changes requested` -> `in review` -> `approved/published`
5. On merge to `main`, publish tag `doc/v0004` is created on the merge commit.
6. Merge commit includes required Bindersnap trailers.

### Example B: Vendor W-9 PDF

1. Upload branch: `upload/vendor-w9/20260401/152233Z-jgray-4f9d21aa`
2. PR title: `Upload v2: Vendor W-9`
3. Canonical file path: `vendor-w9.pdf`
4. Merge creates tag `doc/v0002` on `main`.
5. Publish timestamp comes from merge commit time and PR merge event time in Gitea.

### Example C: Pricing XLSX

1. Upload branch: `upload/quarterly-budget/20260401/160455Z-klee-91b7c020`
2. PR title: `Upload v3: Quarterly Budget`
3. Canonical file path: `quarterly-budget.xlsx`
4. Review feedback happens on PR comments; no inline editing required.
5. Approved publish is represented by merged PR + new tag (for example `doc/v0003`).

## Non-Goals (Explicit)

1. No inline editing required for this workflow.
2. No real-time collaborative editing for external binary files.
3. No file conversion pipeline in MVP.
4. No OCR, redaction, or extraction pipeline in MVP.
5. No replacement of editor-first work in #71, #72, #73.
6. No Git LFS dependency for MVP.
7. No app-managed manifest file for version pointers.

## Consequences

Positive:

1. The approval trail is explicit and auditable.
2. Version identity is stable and easy to reason about.
3. Filename drift (`FINAL_v2_APPROVED(1)`) is prevented by contract.
4. Backend stays close to pure git primitives.

Tradeoffs:

1. Binary support is intentionally narrow in MVP.
2. Upload size ceiling is explicit and may exclude large files.
3. Additional automation (virus scanning, resumable uploads) is deferred.
4. Querying current metadata requires reading git tags/commits/PR data, not one JSON file.
