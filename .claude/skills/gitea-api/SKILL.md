---
name: gitea-api
description: How the BFF talks to Gitea 28 — the typed client, the generated spec, which token to use, and which Gitea primitive models what. Use before changing services/api/gitea-client, adding a BFF route that reads or writes Gitea, or deciding where a new piece of data should live.
---

# Working with Gitea from the BFF

Gitea is where the evidence lives (non-negotiable 2). Read `AGENTS.md`
"Evidence lives in Gitea. Configuration lives in SQLite." and ADRs 0004 and
0005 before adding anything that stores data.

## The client

- `services/api/gitea-client/` holds every Gitea call, one module per area
  (`documents.ts`, `drafts.ts`, `pullRequests.ts`, `conflicts.ts`,
  `discussions.ts`, `orgs.ts`, `workspaces.ts`, …). Modules are stateless:
  they take a client and return typed results.
- Types come from Gitea's own OpenAPI spec in `gitea-client/spec/`, generated
  by `bun run generate:gitea-client` against the local stack's Gitea. Check an
  endpoint there, not from memory: Gitea's API changes between releases, and
  production runs 28.2.0.
- The `README.md` in that folder predates the BFF (it still mentions
  `sessionStorage`). Trust the code and `AGENTS.md` over it.
- Unit tests mock the fetch layer and need no Gitea. Behaviour that depends on
  what Gitea actually does belongs in a `tests/*.pw.ts` against the stack.

## Which token

- A person's own action (their draft, their review, their comment) runs with
  **their session token**, so Gitea records them as the actor.
- `BINDERSNAP_GITEA_SERVICE_TOKEN` is **read-only** and runs on nearly every
  request. Never give it a write scope.
- `BINDERSNAP_GITEA_ADMIN_TOKEN` is `write:admin` only: creating an account
  (signup, or a site admin's), password changes, account deletion, token
  revocation. Never use it to read.
- No response ever carries a Gitea token (non-negotiable 1, #662).

## Which primitive

| Bindersnap                     | Gitea                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| Organization                   | Org                                                          |
| Binder (workspace)             | Repository owned by the org                                  |
| Folder, document               | Directory, file in that repository                           |
| Version on record              | Commit on `main` plus a version tag (ADR 0005)               |
| Draft                          | Branch                                                       |
| Change                         | Pull request; assignee and review requests are Gitea's own   |
| Approval, request for changes  | PR review                                                    |
| Rules, per-folder reviewers    | Branch protection, `.gitea/CODEOWNERS`                       |
| Roles                          | Org teams                                                    |
| Review threads                 | Review comments with a `bindersnap:v1` marker, append-only   |
| Reactions                      | Comment reactions (`+1`, `-1`, `confused`, `eyes`, `heart`)  |

A binder's review policy — what branch protection cannot express — is the one
SQLite row in this area (`services/api/workspace-settings.ts`), logged in
`settings_events`.

If Gitea models it, use the primitive and never keep a copy in SQLite. A
derived index is allowed only if it can be rebuilt from Gitea and dropped
without loss, and no publish gate, approval check or audit export may read it.
