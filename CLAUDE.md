# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
bun install --frozen-lockfile

# Development server (landing page only, no Docker required)
bun run dev                    # http://localhost:5173

# Full dev stack (Gitea + Hocuspocus + Pandoc + app)
bun run up                     # docker compose up --build
bun run down                   # docker compose down -v

# Build
bun run build                  # production bundle → dist/
bun run clean                  # remove dist/

# Tests — unit (no Docker)
bun test src/services/sanitizer.test.ts
bun test src/editor/extensions/CommentAnchor/CommentAnchor.test.ts
bun test pandoc-service/transform.test.ts

# Tests — integration (manages docker compose lifecycle automatically)
bun run test:integration
```

## Architecture

This monorepo contains **two frontend applications** that share a common source tree, plus a local dev stack.

```
src/
  index.html / App.tsx / frontend.tsx  ← Landing page (published to GitHub Pages)
  app/                                  ← Real app entry (never published, requires Gitea auth)
  editor/                               ← Shared Tiptap editor (used by both apps)
  services/
    gitea/                              ← Gitea API client (auth, documents, PRs)
    pandoc.ts                           ← .docx ↔ ProseMirror JSON client
    sanitizer.ts                        ← HTML/ProseMirror JSON sanitization (DOMPurify)
  assets/css/bindersnap-tokens.css      ← Single source of truth for all design tokens

pandoc-service/                         ← Standalone microservice: Bun server wrapping Pandoc CLI
dev/
  docker-compose.yml                    ← Gitea + Hocuspocus + Pandoc + app
  gitea-seed/                           ← Seed script + fixture documents
  tests/                                ← Playwright integration tests
```

### Two-app pattern

| | Landing Page | Real App |
|---|---|---|
| Entry | `src/index.html` | `src/app/index.html` |
| Published | GitHub Pages | Never — local + private deploy only |
| Auth | No | Yes (Gitea token in sessionStorage) |

The `src/editor/` component is backend-agnostic. It receives a `giteaClient` prop for the real app and operates in read-only demo mode when that prop is absent. **Never import from `src/services/gitea/` inside `src/editor/`.**

### Dev stack services (Docker Compose)

| Service | Port | Purpose |
|---------|------|---------|
| Gitea | 3000 | Git backend, auth, document storage |
| Hocuspocus | 1234 | Real-time collaboration WebSocket (Yjs) |
| Pandoc service | 3001 | .docx ↔ JSON conversion |
| App | 5173 | Bun dev server with HMR |

Auto-login is enabled in dev mode — the server mints a Gitea token at `/api/dev/gitea-token` (controlled by `BUN_PUBLIC_DEV_AUTO_LOGIN`).

### Service client pattern

All `src/services/gitea/` modules accept a `GiteaClient` as a parameter — no global singletons or React context. This keeps them stateless and easily testable.

### Key environment variables

All build-time vars use `BUN_PUBLIC_` prefix (Bun build substitution):

| Variable | Default |
|----------|---------|
| `BUN_PUBLIC_GITEA_URL` | `http://localhost:3000` |
| `BUN_PUBLIC_HOCUSPOCUS_URL` | `ws://localhost:1234` |
| `BUN_PUBLIC_PANDOC_SERVICE_URL` | `http://localhost:3001` |
| `BUN_PUBLIC_DEV_AUTO_LOGIN` | `true` (dev), `false` (prod) |

## Design system

**All styles must use CSS variables from `src/assets/css/bindersnap-tokens.css`.** Never hardcode hex values or pixel sizes in component files.

Key rules:
- Default background is `var(--color-paper)` (`#FAFAF7`), never `#fff`
- `--color-coral` is for exactly ONE primary action or emphasis element per section
- Typography: Lora (`--font-serif`) for headlines only, Geist (`--font-sans`) for body/UI, Geist Mono (`--font-mono`) for labels/code/metadata

## GitHub workflow policy

This repo uses a **MCP-first workflow** for all GitHub API actions. See `AGENTS.md` for the full policy. Summary:

- Use GitHub MCP tools (`issue_read`, `create_branch`, `create_pull_request`, etc.) for all GitHub API operations
- Use local `git` only for working tree operations (edit, stage, commit, diff)
- `gh` CLI is fallback-only — document the MCP tool that failed and why
- Every PR must include workflow evidence (issue read method, branch creation method, commit SHA, PR creation method)

## Further reading

- `AGENTS.md` — design system rules, color/typography/voice guidelines, component patterns
- `TECHNICAL_VISION.md` — product vision and roadmap
- `src/editor/README.md` — editor extension conventions
- `src/services/README.md` — Gitea client architecture and testing approach
- `dev/README.md` — docker-compose setup and integration test usage
