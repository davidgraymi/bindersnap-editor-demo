# CLAUDE.md

**Read `AGENTS.md` before making any changes.** It is the single source of truth for architecture decisions, design system rules, GitHub workflow policy, and product context.

---

## Commands

All commands use **Bun** as the runtime and package manager.

```bash
# Development (run both together)
bun run dev:app       # SPA (hot reload, port 5173)
bun run dev:api       # API service (hot reload, port 8787)

# Build
bun run build         # Build SPA to dist/

# Tests
bun run test          # All unit tests (test:app + test:ops)
bun run test:app      # apps/app, packages/editor, packages/utils
bun run test:ops      # services/api, scripts, infra/backups
bun run test:integration  # Playwright (requires: bun run up)
bun test path/to/file.test.ts  # Single file

# Code formatting
bun run format        # Format all source files
bun run format:check  # Check without writing

# Local dev stack (Gitea + Hocuspocus + app)
bun run up            # Start
bun run down          # Tear down
```

Test files live alongside source as `*.test.ts`. TypeScript strict mode is the linter.

---

## Architecture

Bun monorepo — one SPA, shared packages, backend services.

| Directory | Purpose |
|-----------|---------|
| `apps/app/` | Unified SPA → GitHub Pages |
| `packages/ui-tokens/` | CSS design tokens (single source of truth) |
| `packages/utils/` | Shared utilities |
| `services/api/` | Auth + data BFF (port 8787) |
| `services/hocuspocus/` | Yjs WebSocket collaboration server |

**Path aliases:** `@editor/*`, `@gitea/*`, `@ui/*`, `@utils/*`

---

## Non-Negotiable Architecture Decisions

Settled. Do not reopen. If a task requires violating one, open a `human-needed` issue.

1. **BFF owns auth; Gitea tokens stay server-side.** The browser receives only an `HttpOnly` session cookie. No bearer tokens in `sessionStorage` or `localStorage`.

2. **Gitea is the only datastore.** No Postgres, no cache, no shadow state beyond the BFF's SQLite session store.

3. **File uploads flow browser → BFF → Gitea.** The BFF reads the file as base64 and commits to the Gitea contents API. See `docs/adr/0001-external-file-workflow-contract.md` — that ADR is law.

4. **Two independent workflows.** File vault (external uploads) and inline editor are separate. Do not conflate them.

5. **Editor UI changes need a flag.** If you change `packages/editor/` visuals, note it in your PR — the landing demo embed requires a manual `bun run sync-demo`.
