# `src/services/` — Backend Service Clients

Shared service modules used across both the landing page and the real app.

## Contents

### `gitea/`

All Gitea API interaction. Built on `gitea-js`.

```
client.ts        — authenticated GiteaClient factory (Issue #9)
auth.ts          — token validation + sessionStorage management (Issue #12)
documents.ts     — commit, fetch, list versions of ProseMirror JSON docs (Issue #10)
pullRequests.ts  — PR lifecycle + ApprovalState mapping (Issue #11)
```

These modules are **stateless** — they accept a `GiteaClient` as a parameter and return typed results. No React context, no global singletons.

### `sanitizer.ts`

HTML sanitization using DOMPurify. Used by both the landing page and the real app when rendering user-generated content.

## Usage pattern

The real app (`src/app/`) creates an authenticated client once on login and passes it down as props or context. The landing page never imports from `src/services/gitea/` — the editor runs in demo mode without a client.

## Testing

Unit tests live alongside each module as `*.test.ts`. Tests use mocked `gitea-js` responses — they do **not** require a live Gitea instance. For real integration tests against a live Gitea, see `dev/tests/`.
