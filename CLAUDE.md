# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `AGENTS.md` before making any changes.** It contains design system rules, GitHub workflow policy, and product context.

---

## Commands

All commands use **Bun** as the runtime and package manager.

```bash
# Development (run both together for local dev)
bun run dev:app       # Start SPA (hot reload, port 5173)
bun run dev:api       # Start API service (hot reload, port 8787)

# Build
bun run build         # Build SPA to dist/

# Tests
bun run test          # Run all unit tests (test:app + test:ops)
bun run test:app      # Test apps/app, packages/gitea-client, packages/editor, packages/utils
bun run test:ops      # Test services/api, scripts, infra/backups
bun run test:integration  # Playwright tests (requires: bun run up)

# Run a single test file
bun test path/to/file.test.ts

# Code formatting
bun run format        # Format all source files with Prettier
bun run format:check  # Check formatting without writing

# Local dev stack (Docker Compose: Gitea + Hocuspocus + app)
bun run up            # Start full local stack
bun run down          # Tear down local stack
```

Test files live alongside source as `*.test.ts`. There is no separate linter script — TypeScript strict mode enforces type correctness.

---

## Architecture

This is a **Bun monorepo** with one unified SPA, shared packages, and backend services.

### One Application

`apps/app/` is the single deployable frontend — published to GitHub Pages. It pre-renders a static landing shell into `index.html`; React swaps to the workspace shell when a valid session is present.

### Packages (shared)

- `packages/editor/` — Tiptap 3 + ProseMirror editor. Backend-agnostic: receives a `giteaClient` prop for real use, runs demo mode without it. **Never import `gitea-client` inside `editor/`.**
- `packages/gitea-client/` — All Gitea API calls (auth, documents, PRs). Stateless service modules.
- `packages/ui-tokens/` — CSS design tokens (single source of truth for all visual values).
- `packages/utils/` — Shared utilities (DOMPurify sanitizer, etc.).

### Services

- `services/api/` — Lightweight BFF (Bun). Owns auth (login/signup/logout/me), session cookies, and Gitea token custody. App data calls go through `/api/app/*` routes.
- `services/hocuspocus/` — Yjs WebSocket server for real-time collaboration.
- `server.ts` — Bun dev/prod server that serves the SPA.

### Path aliases (tsconfig)

`@editor/*`, `@gitea/*`, `@ui/*`, `@utils/*` map to their respective packages.

---

## Non-Negotiable Architecture Decisions

These are settled. Do not reopen them. If a task seems to require violating one, open a `human-needed` issue instead.

1. **BFF owns auth; Gitea tokens stay server-side.** `services/api` handles login/signup and stores per-session Gitea tokens in its SQLite session store. The browser only receives an `HttpOnly` session cookie — never a raw Gitea token. No bearer tokens in `sessionStorage` or `localStorage`.

2. **Gitea is the only datastore.** Documents, approvals, and audit trail are Gitea repos/commits/PRs/reviews. No Postgres, no cache, no shadow state beyond the API's session store.

3. **File uploads are browser-direct.** `FileReader → base64 → Gitea contents API`. No server receives the file. See `docs/adr/0001-external-file-workflow.md` — that ADR is law for the file vault workflow.

4. **Two independent workflows.** File vault (external uploads, issues #101–#105) and inline editor (issues #71–#72) are separate. Do not conflate them.

5. **When editor UI changes, flag it.** If you change `packages/editor/` visuals, note it in your PR — the landing demo embed is a static snapshot requiring a manual `bun run sync-demo` update.

---

## Design System

All visual values come from `packages/ui-tokens/css/bindersnap-tokens.css`. **Never hardcode hex values or pixel sizes.** Use `--color-*`, `--font-*`, `--space-*`, `--radius-*`, `--shadow-*` variables.

Key rules:

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
