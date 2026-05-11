# `services/api/db`

Drizzle schema, migrations, and Postgres backend implementations for the API service.

> [!IMPORTANT]
> The migration runner under `db/migrate/` is **not part of the API service runtime**. It is invoked from CI (and by hand for local dev) as a separate process before the API deploy. The API never calls `migrate()`. See `db/migrate/README.md`.

## Layout

| Path                        | Purpose                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`                 | Drizzle schema for `sessions`, `subscriptions`, `subscription_access_overrides`, webhook tables, and `schema_versions`. Single source of truth. |
| `migrations/`               | Generated SQL migrations. Hand-edits forbidden — run `bun run db:generate`.                                                                     |
| `client.ts`                 | Lazy Postgres connection used by the runtime backends. Reads `BINDERSNAP_DATABASE_URL`.                                                         |
| `version.ts`                | The `EXPECTED_SCHEMA_VERSION` constant + the startup probe helper.                                                                              |
| `configure.ts`              | Startup hook that selects the backend trio and runs the schema-version probe when `BINDERSNAP_DB_BACKEND=postgres`.                             |
| `postgres-sessions.ts`      | `PostgresSessionBackend` — drizzle-backed `SessionBackend`.                                                                                     |
| `postgres-subscriptions.ts` | `PostgresSubscriptionBackend` + `PostgresWebhookEventBackend`.                                                                                  |
| `migrate/`                  | Standalone migration runner. Co-located here, but **not imported** by anything in `services/api/`.                                              |

## Selecting the backend at runtime

The API picks a backend at startup based on `BINDERSNAP_DB_BACKEND`:

- `sqlite` (default): existing on-disk SQLite store. Used in dev, tests, and the EC2 deployment until cutover.
- `postgres`: Postgres backends from this directory. Requires `BINDERSNAP_DATABASE_URL`.

When `postgres` is selected, `configureBackends()` calls `assertSchemaVersionMatches` against the database before installing the lazy-store factories. If the `schema_versions` row does not match `EXPECTED_SCHEMA_VERSION`, startup fails with a `SchemaVersionMismatchError` and the API never serves traffic. Run `bun run db:migrate` (or the equivalent CI step) to bring the database forward.

Cutover from SQLite to Postgres is performed by the one-shot copy script at `scripts/migrate-sqlite-to-postgres.ts`. It reads the existing `sessions.db` from the EC2 host, asserts the destination's `schema_versions` row matches `EXPECTED_SCHEMA_VERSION`, then copies all five tables in a single transaction with `ON CONFLICT DO NOTHING`. Re-running is safe; the script refuses by default if the destination already has rows (override with `--allow-non-empty`).

## Migration policy

Migrations are applied **only** by the standalone runner, **only** as a discrete deploy step that runs before the API rolls out. If the migration step fails, the API deploy fails and the previous task version keeps serving traffic. The API process never has the privileges or code path to alter schema.
