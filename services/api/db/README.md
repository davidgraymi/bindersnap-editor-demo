# `services/api/db`

Drizzle schema, migrations, and Postgres backend implementations for the API service.

> [!IMPORTANT]
> The migration runner under `db/migrate/` is **not part of the API service runtime**. It is invoked from CI (and by hand for local dev) as a separate process before the API deploy. The API never calls `migrate()`. See `db/migrate/README.md`.

## Layout

| Path          | Purpose                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.ts`   | Drizzle schema for `sessions`, `subscriptions`, `subscription_access_overrides`, webhook tables, and `schema_versions`. Single source of truth. |
| `migrations/` | Generated SQL migrations. Hand-edits forbidden — run `bun run db:generate`.                                                                     |
| `client.ts`   | Lazy Postgres connection used by the runtime backends. Reads `BINDERSNAP_DATABASE_URL`.                                                         |
| `version.ts`  | The `EXPECTED_SCHEMA_VERSION` constant + the startup probe helper.                                                                              |
| `migrate/`    | Standalone migration runner. Co-located here, but **not imported** by anything in `services/api/`.                                              |

> Postgres `SessionBackend`/`SubscriptionBackend`/`WebhookEventBackend` implementations land in the follow-up PR. They require flipping the existing sync interfaces to async because `postgres-js` is async; that touches every call site and is its own slice.

## Selecting the backend at runtime (planned)

Once the Postgres backend implementations land, the API will pick a backend at startup based on `BINDERSNAP_DB_BACKEND`:

- `sqlite` (default): existing on-disk SQLite store. Used in dev, tests, and the EC2 deployment until cutover.
- `postgres`: Postgres backends from this directory. Requires `BINDERSNAP_DATABASE_URL`.

When `postgres` is selected the API will run the schema-version probe (see `version.ts`) on first connection and refuse to start if the database schema does not match the version this code was built against. The probe code is in place; the wiring to call it lands with the runtime backends.

## Migration policy

Migrations are applied **only** by the standalone runner, **only** as a discrete deploy step that runs before the API rolls out. If the migration step fails, the API deploy fails and the previous task version keeps serving traffic. The API process never has the privileges or code path to alter schema.
