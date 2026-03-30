# `dev/` — Local Development Stack

Everything needed to run the **full Bindersnap target architecture locally** for development and integration testing.

## What this spins up

| Service | URL | Purpose |
|---|---|---|
| Gitea | `http://localhost:3000` | Git backend, auth source, document storage |
| Hocuspocus | `ws://localhost:1234` | Real-time collaboration WebSocket server |
| Bindersnap app | `http://localhost:5173` | The real app (`src/app/`) with hot reload |

## Quick start

```bash
cd dev
docker compose up
```

First run takes ~60s for Gitea to initialize. On subsequent runs it's instant.

After Gitea is healthy, the seed script runs automatically and creates:
- Two users: `alice` (admin) and `bob` (collaborator)
- A demo repository: `alice/quarterly-report`
- Three documents in different approval states (see `gitea-seed/documents/`)
- An open PR from `bob/feature/q2-amendments` → `main` with a "Changes Requested" review

**Alice's token** is printed to stdout after seeding. Set it in your shell:

```bash
export VITE_GITEA_TOKEN=<printed-token>
export VITE_GITEA_URL=http://localhost:3000
```

Or copy `dev/.env.example` to `dev/.env` — `docker compose` picks it up automatically.

## Re-seeding

To reset to a clean state:

```bash
docker compose down -v  # destroys volumes
docker compose up       # re-creates and re-seeds
```

## Integration tests

With the stack running:

```bash
bun run test:integration
```

Tests live in `dev/tests/`. They run against real Gitea — no mocking. See `dev/tests/README.md`.

## Structure

```
docker-compose.yml        — service definitions
.env.example              — copy to .env for local overrides
gitea-seed/
  setup.sh                — idempotent seed script (runs via docker entrypoint)
  documents/              — ProseMirror JSON fixture documents
    draft.json            — working draft, no PR
    in-review.json        — open PR, awaiting review
    changes-requested.json— PR with changes requested
tests/
  README.md
  playwright.config.ts
  smoke.spec.ts
```

## This is not production

`dev/` is a developer tool. It is never deployed. The Docker Compose config uses insecure defaults (fixed passwords, no TLS) that are intentional for local speed. Do not use this config as a basis for any production deployment.
