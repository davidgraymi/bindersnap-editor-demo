# `dev/tests/` — Integration Tests

End-to-end integration tests that run against the **live local dev stack**. These hit real Gitea — no mocking.

## Prerequisites

The Docker dev stack must be running:

```bash
cd dev && docker compose up
```

And `VITE_GITEA_TOKEN` must be set (printed after first seed run).

## Running

```bash
bun run test:integration
```

Or directly:

```bash
bunx playwright test --config=dev/tests/playwright.config.ts
```

## What is tested here vs. unit tests

| Unit tests (`src/**/*.test.ts`) | Integration tests (`dev/tests/`) |
|---|---|
| Run without Docker | Require `docker compose up` |
| Mock `gitea-js` responses | Real Gitea API calls |
| Fast, run in CI on every push | Slower, run locally before merge |
| Test business logic in isolation | Test the full stack end-to-end |

## Test data

Fixture documents are seeded by `dev/gitea-seed/setup.sh`. Tests reference the seeded repo `alice/quarterly-report` and the documents committed there. If tests fail unexpectedly, try resetting: `docker compose down -v && docker compose up`.
