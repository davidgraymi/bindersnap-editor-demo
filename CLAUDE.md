# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `AGENTS.md` before making any changes.** It contains non-negotiable architecture decisions, design system rules, and the GitHub workflow policy. This file summarizes what you need to get started quickly.

---

## Commands

All commands use **Bun** as the runtime and package manager.

```bash
# Development
bun run dev           # Start app (hot reload)
bun run dev:landing   # Start landing page
bun run dev:api       # Start API service

# Build
bun run build         # Build landing + app
bun run build:app     # Build app only
bun run build:landing # Build landing only

# Tests
bun run test          # Run all unit tests
bun run test:app      # Test app + gitea-client
bun run test:landing  # Test landing + editor + utils
bun run test:integration  # Playwright tests (requires: bun run up)

# Local dev stack (Docker Compose: Gitea + Hocuspocus + app)
bun run up            # Start full local stack
bun run down          # Tear down local stack
```

Test files live alongside source as `*.test.ts`. There is no separate linter script — TypeScript strict mode enforces type correctness.

---

## Architecture

This is a **Bun monorepo** containing two SPAs, shared packages, and backend services.

### Two Applications

| | `apps/landing/` | `apps/app/` |
|--|--|--|
| Published | GitHub Pages | Never public |
| Auth | None | PKCE OAuth2 |
| Gitea | No | Yes |
| Editor | Read-only demo | Fully wired |

### Packages (shared by both apps)

- `packages/editor/` — Tiptap 3 + ProseMirror editor. Backend-agnostic: receives a `giteaClient` prop for real use, runs demo mode without it. **Never import `gitea-client` inside `editor/`.**
- `packages/gitea-client/` — All Gitea API calls (auth, documents, PRs). Stateless service modules.
- `packages/ui-tokens/` — CSS design tokens (single source of truth for all visual values).
- `packages/utils/` — Shared utilities (DOMPurify sanitizer, etc.).

### Services

- `services/hocuspocus/` — Yjs WebSocket server for real-time collaboration.
- `server.ts` — Bun dev/prod server that routes both apps.

### Path aliases (tsconfig)

`@editor/*`, `@gitea/*`, `@ui/*`, `@utils/*` map to their respective packages.

---

## Non-Negotiable Architecture Decisions

These are settled. Do not reopen them. If a task seems to require violating one, open a `human-needed` issue instead.

1. **Pure SPA — no BFF.** `apps/app/` communicates directly with Gitea via bearer token. No Express/Bun/Hono proxy. The only permitted backend services are `services/hocuspocus/` and future Pandoc/Stripe services (backlogged).

2. **PKCE OAuth2 — browser holds the token.** Token lives in `sessionStorage`. No cookies. No server-side sessions. `apps/app/auth/` owns the flow; `packages/gitea-client/` consumes the token.

3. **Gitea is the only datastore.** Documents, approvals, and audit trail are Gitea repos/commits/PRs/reviews. No Postgres, no cache, no shadow state.

4. **File uploads are browser-direct.** `FileReader → base64 → Gitea contents API`. No server receives the file. See `docs/adr/0001-external-file-workflow.md` — that ADR is law for the file vault workflow.

5. **Two independent workflows.** File vault (external uploads, issues #101–#105) and inline editor (issues #71–#72) are separate. Do not conflate them.

---

## Design System

All visual values come from `packages/ui-tokens/css/bindersnap-tokens.css`. **Never hardcode hex values or pixel sizes.** Use `--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*` variables.

Key rules from `AGENTS.md`:
- Background is always `var(--color-paper)` (`#FAFAF7`), never `#fff`
- Coral (`--color-coral`) is used for exactly **one** primary action per section
- Typography: Lora (headlines only), Geist (body/UI), Geist Mono (eyebrows/labels/code)
- Spacing is a base-8 system (`--space-1` through `--space-24`)

---

## GitHub Workflow Policy

Use **GitHub MCP tools first** for all GitHub API actions. `gh` CLI is fallback-only (document the MCP tool that failed and why).

- Read: `issue_read`, `pull_request_read`, `list_issues`, `list_pull_requests`
- Write: `create_branch`, `create_or_update_file`, `create_pull_request`, `update_pull_request`, `add_issue_comment`, `pull_request_review_write`

Every PR must include workflow evidence (issue read method, branch creation method, commit SHA, PR creation method, any fallbacks used).

Local `git` for working tree operations. MCP for GitHub API operations.
