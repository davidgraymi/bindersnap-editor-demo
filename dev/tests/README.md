# `dev/tests/` — Integration Tests

End-to-end integration tests that run against the **live local dev stack**. These hit real Gitea — no mocking.

## Prerequisites

`VITE_GITEA_TOKEN` is optional. If omitted (or invalid), tests will seed and create
their own token automatically using the seeded admin credentials.

## Running

```bash
bun run test:integration
```

This command now runs a deterministic cycle:
- `docker compose down -v`
- `docker compose up --build -d`
- Playwright smoke tests
- `docker compose down -v`

During this run, `BINDERSNAP_DEV_AUTO_LOGIN=false` is forced so tests always
exercise explicit token authentication.

For manual debugging with a stack you started yourself:

```bash
playwright test --config=dev/tests/playwright.config.ts
```

## What is tested here vs. unit tests

| Unit tests (`src/**/*.test.ts`) | Integration tests (`dev/tests/`) |
|---|---|
| Run without Docker | Require `docker compose up` |
| Mock `gitea-js` responses | Real Gitea API calls |
| Fast, run in CI on every push | Slower, run locally before merge |
| Test business logic in isolation | Test the full stack end-to-end |

## Test data

Fixture documents are seeded by the shared TypeScript workflow in `dev/tests/seed.ts`.
Both `docker compose` and Playwright use the same seeding logic to keep local and CI behavior aligned.
Tests reference the seeded repo `alice/quarterly-report` and its open PR/review state.
If tests fail unexpectedly, reset with: `docker compose down -v && docker compose up`.
