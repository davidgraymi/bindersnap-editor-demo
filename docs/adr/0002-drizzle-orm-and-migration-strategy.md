# ADR 0002: Drizzle ORM and Migration Strategy

Status: Accepted
Date: 2026-04-25
Related: `docs/db-migration-issues.md` issues #1-#6, `services/api/db/migrate.ts`, `docs/adr/0001-external-file-workflow-contract.md`

## Context

`services/api` started with direct `bun:sqlite` access and constructor-time
`CREATE TABLE IF NOT EXISTS` statements in the session store. That pattern is
acceptable for a spike, but it fails the moment we need repeatable schema
changes, explicit deploy ordering, or a credible SQLite-to-Postgres path.

We need one approach that covers all of the following:

1. Type-safe queries in application code.
2. Generated, committed migrations with version tracking.
3. A strict rule that schema changes happen before app boot, never during it.
4. Minimal churn when the API eventually moves from SQLite to Postgres.

## Decision

Bindersnap will use Drizzle ORM for application queries and `drizzle-kit` for
schema generation and migration management.

Operationally, schema changes follow this model:

1. Update TypeScript schema definitions under `services/api/db/`.
2. Generate SQL with `bun run db:generate`.
3. Review and commit the generated SQL plus Drizzle metadata.
4. Apply migrations with `bun run db:migrate` as a separate CLI step before the
   API starts.

Application code must not call `migrate()`, emit ad hoc DDL, or attempt to
"helpfully" create missing tables during startup.

## Why Drizzle

Drizzle fits this codebase better than the main alternatives.

### Drizzle vs. Prisma

Prisma would add a heavier runtime, a separate client generation layer, and a
larger conceptual shift than this API needs. The Bindersnap API is small,
Bun-native, and already close to SQL. Drizzle preserves that shape while still
adding typed schema and migration tooling.

### Drizzle vs. Kysely

Kysely gives a strong query builder, but it does not provide the same
first-party schema-to-migration workflow we want to standardize on here. We
would still need to choose and document an additional migration toolchain.

### Drizzle vs. raw SQL

Raw SQL alone would keep dependencies small, but it leaves too much repetitive
mapping and too much room for schema drift. The current session-store startup
DDL is the failure mode we are explicitly leaving behind.

## Migration Operating Model

The migration rule is intentionally strict:

1. `services/api/db/migrate.ts` is the production entry point for schema
   changes.
2. Docker Compose and deploy automation run that script before `api` starts.
3. Tests may call `migrate()` only through a dedicated test helper for fresh
   temporary databases.
4. Runtime code such as `services/api/server.ts`, stores, and route handlers
   must assume the schema is already present and current.

This gives us deterministic deploys:

1. Migration success is a gate for API rollout.
2. Migration failure stops the deploy before new app code starts.
3. Schema history is explicit in committed SQL and Drizzle metadata.

## SQLite to Postgres Path

The reason to do this work now is that the swap later should be mechanical, not
architectural.

### What changes

1. The Drizzle driver changes from `drizzle-orm/bun-sqlite` to the Postgres
   driver (`postgres-js` in the current plan).
2. The connection/client setup in `services/api/db/client.ts` changes from a
   file path to a Postgres connection string/pool.
3. `drizzle.config.ts` changes dialect from SQLite to Postgres.
4. Migration SQL is regenerated for the Postgres target and applied to the new
   database.

### What stays

1. Table definitions remain in TypeScript under `services/api/db/schema.ts`.
2. Application query code continues to use Drizzle's query API instead of being
   rewritten around a new ORM surface.
3. The operational model stays the same: generate reviewed migrations, commit
   them, run a separate migration CLI step before app boot.
4. The migration artifact shape stays "generated SQL files plus Drizzle
   metadata", even though the SQL content becomes Postgres-specific.

## Portability Conventions

We need a few conventions now so the future swap is boring.

### Boolean columns

SQLite has no native boolean type. The recommended convention is:

1. Store booleans as `integer` in SQLite.
2. Use Drizzle's boolean mode where supported so application code still sees a
   boolean.

This avoids SQLite-only truthy conventions leaking into application logic.

### Timestamps

SQLite should store timestamps as Unix epoch `INTEGER` values in milliseconds.
Postgres should use `timestamp with time zone`.

Recommendation:

1. Keep SQLite timestamp storage as integer milliseconds.
2. When the schema grows beyond the current simple session timestamps, add a
   shared wrapper such as `timestampMs()` in `services/api/db/columns.ts` so
   the schema can express one semantic type across both dialects.

That helper is deferred for now because the current migration work does not add
new timestamp-bearing tables beyond the existing session-store shape.

### JSON columns

SQLite treats JSON as text. Postgres should use `jsonb`.

Recommendation:

1. Store JSON payloads as `text` in SQLite for now.
2. Introduce a shared wrapper such as `jsonColumn()` in
   `services/api/db/columns.ts` when the second JSON-bearing column appears, so
   the conversion logic lives in one place.

We are deferring that helper for the same reason: the current schema does not
yet justify a local abstraction.

## Swap-Day Checklist

When Bindersnap is ready to move the API store from SQLite to Postgres, do this
in order:

1. Add the Postgres driver dependency and switch `services/api/db/client.ts` to
   a Postgres connection.
2. Update `drizzle.config.ts` to the Postgres dialect and target database.
3. Review every schema column for the portability rules above, adding wrapper
   helpers where repetition now exists.
4. Generate a new Postgres baseline migration set and review the SQL
   intentionally; do not assume SQLite-generated SQL carries over.
5. Provision the target Postgres database and run the generated migrations.
6. Export SQLite data, transform as needed for booleans/timestamps/JSON, and
   load it into Postgres.
7. Run smoke tests against the API on Postgres, including auth, session
   persistence, and any table introduced after the initial session store.
8. Cut over the API deployment only after the migration and smoke tests are
   green.

## Consequences

Positive:

1. Schema change order becomes explicit and reviewable.
2. Deploys fail before app rollout when the database is not ready.
3. The API query layer becomes more portable across SQLite and Postgres.

Tradeoffs:

1. Developers must remember to generate and commit migrations with schema
   changes.
2. We now rely on deployment automation to run the migration step correctly.
3. Cross-dialect portability still requires discipline around booleans,
   timestamps, and JSON.
