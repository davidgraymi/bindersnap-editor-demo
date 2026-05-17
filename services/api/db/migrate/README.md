# `services/api/db/migrate` — standalone migration runner

> [!WARNING]
> **NOT a runtime dependency of the API service.** Nothing in `services/api/` outside this directory imports anything from this directory. Do not change that.

## What this is

A small Bun script that applies the SQL files under `services/api/db/migrations/` to a Postgres database, then writes the new schema version into the `schema_versions` table.

It exists as a separate process, run as a separate deploy step, with separate credentials, **specifically so the API service never has the privilege or code path to alter schema**. This avoids the common anti-pattern where a service migrates on first connect — which couples deploy ordering to traffic, makes rollbacks unsafe, and turns "just restart" into a destructive operation.

## When it runs

- **CI deploy** — a job in `.github/workflows/deploy-api.yml` runs `bun run db:migrate` against the prod database **before** the Lambda update step. If migration fails, the API deploy fails.
- **Local dev** — when you bring up a fresh Postgres for the first time, run `bun run db:migrate` once.
- **Tests** — the integration-test fixture (when added) calls `runMigrations()` against an ephemeral database. Unit tests for the API never run migrations because they use the in-memory or SQLite backends.

## When it does NOT run

- Never on API startup.
- Never lazily on first DB call.
- Never as a side effect of importing any module from `services/api`.

If a code review ever shows `services/api/server.ts` (or anything imported by it) reaching into `db/migrate/`, that's a bug — block the PR.

## Usage

```bash
# Apply all pending migrations.
BINDERSNAP_DATABASE_URL=postgres://user:pass@host:5432/bindersnap \
  bun run db:migrate

# Show the current schema version without applying anything.
BINDERSNAP_DATABASE_URL=... bun run db:migrate -- --check
```

The runner is intentionally idempotent: re-running with no pending migrations is a no-op that just refreshes the `applied_at` timestamp on the version row.

## How the schema-version handshake works

1. Migration runner applies SQL → on success, upserts `schema_versions` row with `version` set to the latest journal entry tag (e.g. `0000_initial`).
2. API process imports `EXPECTED_SCHEMA_VERSION` from `db/version.ts` (a constant compiled into the build).
3. API startup queries `schema_versions`. If it's missing or the version differs, the API logs the mismatch and exits non-zero, leaving the previous task version serving.

A migration without a corresponding `EXPECTED_SCHEMA_VERSION` bump will be applied successfully and then the new API will refuse to start — which is the desired safety property.
