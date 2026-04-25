# Database Migration Plan — GitHub Issues

A breakdown of the work to introduce Drizzle ORM and a CLI-driven migration workflow to `services/api`, replacing the current bun:sqlite + auto-`CREATE TABLE IF NOT EXISTS` pattern in `services/api/sessions.ts`. Designed so each issue is independently pickable.

Recommended execution order: **#1 → #2 → #3 → #4 → #5 → #6**. #1, #2, #3 are sequential. #4 and #5 can run in parallel after #3. #6 is final.

---

## Issue #1 — Add Drizzle ORM + drizzle-kit and scaffold `services/api/db/`

**Labels:** `area:api`, `type:infra`, `priority:high`

### Context

`services/api/sessions.ts` currently constructs a `bun:sqlite` `Database` directly and runs `CREATE TABLE IF NOT EXISTS ...` inside the `SessionStore` constructor. This is the auto-migrate-on-startup anti-pattern — it doesn't survive horizontal scaling (race conditions on first boot, no version tracking, no rollback story) and ties us to SQLite syntax. We're moving to Drizzle ORM with drizzle-kit as the migration CLI so we can (a) decouple schema changes from app boot and (b) keep a clean SQLite → Postgres path open.

### Scope

Set up the dependencies and folder structure only. Do not touch `sessions.ts` yet (that's #3).

### Acceptance criteria

- [ ] `drizzle-orm` and `drizzle-kit` added to `package.json` (drizzle-kit as `devDependency`).
- [ ] New folder `services/api/db/` created with stub files:
  - `services/api/db/schema.ts` — empty export, ready for table definitions
  - `services/api/db/client.ts` — exports a `db` instance built from `drizzle(new Database(config.sessionsDbPath))` using the `drizzle-orm/bun-sqlite` driver, using `config.sessionsDbPath` from `services/api/config.ts`
  - `services/api/db/migrate.ts` — standalone script that imports `migrate` from `drizzle-orm/bun-sqlite/migrator`, runs it against the same DB path, and `process.exit(0)` on success or `process.exit(1)` on failure
- [ ] `drizzle.config.ts` at repo root, pointing `schema` to `services/api/db/schema.ts` and `out` to `services/api/db/migrations/`. `dialect: "sqlite"`.
- [ ] `package.json` scripts added:
  - `"db:generate": "bunx drizzle-kit generate"`
  - `"db:migrate": "bun run services/api/db/migrate.ts"`
  - `"db:studio": "bunx drizzle-kit studio"`
- [ ] `services/api/db/migrations/` exists and is committed (with a `.gitkeep` if empty).
- [ ] `bun install` succeeds; `bunx drizzle-kit generate --help` runs cleanly.

### Out of scope

Migrating the existing `sessions` table, changing `sessions.ts`, changing the Docker/CI flow.

### Verification

Run `bun install`, `bun run db:generate` (should report "no schema changes" or similar), `bun run db:migrate` (should be a no-op against an empty migrations dir).

---

## Issue #2 — Define `sessions` table in Drizzle schema and generate baseline migration

**Blocked by:** #1
**Labels:** `area:api`, `type:infra`, `priority:high`

### Context

The `sessions` table is currently created implicitly by `SessionStore`'s constructor (see `services/api/sessions.ts` lines 39–49). We need to express it in `services/api/db/schema.ts` so drizzle-kit can manage it going forward, and produce a baseline `0000_*.sql` migration that matches the current production schema exactly. The migration must be byte-compatible with existing prod databases — running it on a fresh DB should produce an identical schema to what `IF NOT EXISTS` currently produces.

### Current schema (reference)

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  gitea_token TEXT NOT NULL,
  gitea_token_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
```

Plus `PRAGMA journal_mode=WAL` set at connection time (this stays in `client.ts`, not the migration).

### Acceptance criteria

- [ ] `services/api/db/schema.ts` exports a `sessions` table using `sqliteTable` with columns matching the current schema exactly: `id TEXT PRIMARY KEY`, `username TEXT NOT NULL`, `gitea_token TEXT NOT NULL`, `gitea_token_name TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `expires_at INTEGER NOT NULL`.
- [ ] Index `idx_sessions_expires` on `expires_at` declared via Drizzle's index builder.
- [ ] `bun run db:generate` produces `services/api/db/migrations/0000_<name>.sql`. Inspect the generated SQL: column types, NULL constraints, and index name must match the existing schema. If drizzle-kit emits anything different (e.g. quoted identifiers, different index syntax), file a follow-up. The one allowed documented hand-edit is adding `IF NOT EXISTS` to the baseline SQL so the first `db:migrate` can adopt legacy pre-Drizzle SQLite files without failing on existing tables or indexes.
- [ ] Generated `meta/_journal.json` and `meta/0000_snapshot.json` committed alongside the SQL file.
- [ ] Add a short comment block at the top of `schema.ts` noting: "Column names use snake_case to match the existing database. TS field names are camelCase via Drizzle's column name aliases."
- [ ] On a fresh DB, `bun run db:migrate` creates a schema that is functionally identical to what `SessionStore` previously created. Verify by comparing `sqlite3 sessions.db .schema` output before and after.

### Out of scope

Switching `sessions.ts` to use Drizzle queries (#3). Adding new tables (#4).

### Verification

1. Delete a local sessions DB.
2. Run `bun run db:migrate`.
3. `sqlite3 <path> .schema` should show the same `sessions` table and `idx_sessions_expires` index as the legacy `CREATE TABLE IF NOT EXISTS` block.

---

## Issue #3 — Convert `SessionStore` to use Drizzle and remove startup `CREATE TABLE`

**Blocked by:** #2
**Labels:** `area:api`, `type:refactor`, `priority:high`

### Context

With the schema and migration in place, `SessionStore` should use the Drizzle `db` client from `services/api/db/client.ts` and stop running DDL at startup. This is the actual fix for the auto-migrate anti-pattern. The store's public API (`get`, `put`, `delete`, `reap`) and the `SessionRecord` interface must not change — there are tests (`services/api/sessions.test.ts`) and consumers (`services/api/server.ts`) that depend on it.

### Acceptance criteria

- [ ] `SessionStore` constructor no longer executes any `CREATE TABLE` or `CREATE INDEX` statements. The `PRAGMA journal_mode=WAL` setting moves to `services/api/db/client.ts` (set once when the Drizzle client is constructed).
- [ ] `get`, `put`, `delete`, `reap` reimplemented using Drizzle's query builder (`db.select().from(sessions).where(eq(...))`, `db.insert(sessions).values(...).onConflictDoUpdate(...)`, etc.). No raw SQL.
- [ ] `LazySessionStore` and the exported `sessionStore` singleton stay intact — same external surface.
- [ ] `rowToRecord` mapper is replaced by Drizzle's column-name aliasing in the schema (camelCase TS field → snake_case SQL column), so the manual mapping disappears.
- [ ] Existing tests in `services/api/sessions.test.ts` pass without modification. If a test references the constructor's DDL behavior, file a follow-up rather than modifying the test.
- [ ] `bun run test:ops` passes.
- [ ] If a test runs against a fresh DB file, it must first run migrations. Add a small test helper (e.g., `services/api/db/test-helpers.ts`) that calls `migrate()` programmatically against a temp DB. This is the only place app code is allowed to call `migrate()` — production code must not.

### Out of scope

Adding new tables. Changing the session schema. Changing how the API server boots.

### Verification

- `bun run test:ops` green.
- Grep `services/api/` for `CREATE TABLE` and `CREATE INDEX` — should return zero matches outside `services/api/db/migrations/`.
- Boot `bun run dev:api` against an existing sessions DB and confirm sessions still load.

---

## Issue #4 — Add the `subscriptions` table to the Drizzle workflow

**Blocked by:** #3
**Labels:** `area:api`, `type:feature`

This is the existing Stripe subscription table currently defined in
`services/api/subscriptions.ts`. It depends on #3 because the table must be
added through the Drizzle workflow (`db:generate` → review SQL → commit), not
via constructor-time DDL.

### Acceptance criteria

- [ ] Table `subscriptions` declared in `services/api/db/schema.ts` with columns matching the current store exactly:
      `username TEXT PRIMARY KEY`, `stripe_customer_id TEXT NOT NULL`, `stripe_subscription_id TEXT NOT NULL`, `status TEXT NOT NULL`, `current_period_end INTEGER`, `updated_at INTEGER NOT NULL`.
- [ ] `bun run db:generate` produces a new `0001_*.sql` migration. Review the generated SQL in the PR — call out any surprising defaults, indexes, or FK behavior in the PR description.
- [ ] Index `idx_subscriptions_customer` declared on `stripe_customer_id`.
- [ ] No foreign key is added in this migration; `username` continues to be an application-level link to the session/Gitea user because there is no users table in this SQLite database.
- [ ] `SubscriptionStore` follows the pattern established for `SessionStore` in #3 (Drizzle client, no raw SQL, no DDL at startup).
- [ ] Unit tests for `SubscriptionStore`; tests use the test helper from #3 to migrate a temp DB.
- [ ] No code path calls `migrate()` outside of `services/api/db/migrate.ts` and the test helper.

### Verification

Same as #3: tests green, no `CREATE TABLE` outside the migrations directory.

---

## Issue #5 — Wire `db:migrate` into the deploy pipeline as a separate, gating step

**Blocked by:** #3 (can run in parallel with #4)
**Labels:** `area:infra`, `area:api`, `priority:high`

### Context

The whole point of moving migrations to a CLI is that they run **before** any app instance starts, as a separate process — not on app boot. We need to update Docker, the local dev workflow, and any deploy/CI flow so that this is the actual production posture. Otherwise we've done the refactor but the anti-pattern is still in effect via `docker compose up`.

### Investigation tasks (do these first, then write the implementation plan in a PR comment)

- [ ] Find every place the API service starts in this repo: `docker-compose.yml`, `services/api/server.ts`, any `infra/` Terraform or deploy scripts.
- [ ] Find the GitHub Actions workflows under `.github/workflows/` that build/deploy the API.
- [ ] Document the current startup order in the issue thread before changing anything.

### Acceptance criteria

- [ ] In Docker Compose: add a one-shot service (e.g. `api-migrate`) that runs `bun run db:migrate` and exits. The `api` service `depends_on: api-migrate` with `condition: service_completed_successfully`.
- [ ] In any production deploy script/CI workflow: a migration step runs to completion before any app replica is rolled. Failure of the migration step blocks the deploy.
- [ ] In the local dev workflow: `bun run dev:api` should fail fast with a clear error if migrations are out of date, rather than silently running with a stale schema. (Implement this via a tiny check — e.g. compare the latest journal entry against the `__drizzle_migrations` table — not by calling `migrate()`.)
- [ ] README or `services/api/README.md` updated with a "Running migrations" section: when to run `db:generate`, `db:migrate`, what the deploy flow does, and the rule that app code must never call `migrate()`.
- [ ] CLAUDE.md / AGENTS.md updated under "Non-Negotiable Architecture Decisions" with: "Schema migrations run as a separate CLI step before app boot. App code must not auto-migrate. See `services/api/db/migrate.ts`."

### Out of scope

Switching to Postgres (separate, future epic).

### Verification

- `bun run up` boots the local stack with the migrate service running first.
- Manually break a migration (rename a column without generating a new migration) and confirm `bun run dev:api` reports "schema out of date" without crashing on a query.

---

## Issue #6 — Document the SQLite → Postgres migration path

**Blocked by:** #3
**Labels:** `area:api`, `type:docs`, `priority:medium`

### Context

We picked Drizzle partly so the SQLite → Postgres swap is mechanical when the time comes. We should write that down now, while the design is fresh, rather than re-deriving it under pressure later. This is also a forcing function to make sure the choices we make in #2–#4 don't paint us into a SQLite-only corner.

### Acceptance criteria

- [ ] New ADR at `docs/adr/0002-drizzle-orm-and-migration-strategy.md` covering:
  - Why Drizzle was chosen (vs. Prisma, Kysely, raw SQL).
  - The CLI-driven migration model and the rule against app-driven `migrate()` calls.
  - The SQLite → Postgres path: what changes (driver swap from `bun-sqlite` to `postgres-js`, schema file dialect change), what stays (query API, table definitions in TS, migration file format).
  - Known portability gotchas:
    - SQLite has no native boolean — Drizzle stores `0`/`1`. Decide column convention now (recommend: store as `integer` with mode `"boolean"`).
    - Timestamps: SQLite uses Unix epoch `INTEGER`; Postgres uses `timestamp with time zone`. Recommend: store all timestamps as `integer` (epoch ms) in SQLite and a typed wrapper helper that maps to `timestamp` in Postgres.
    - JSON: `text` in SQLite, `jsonb` in Postgres. Recommend: same wrapper-helper approach.
  - A "what we'd do on swap day" checklist (driver swap, regenerate migrations against Postgres, dump-and-load data, smoke tests).
- [ ] If the patterns above require helper functions (e.g. `timestampMs()`, `jsonColumn()`), add them to `services/api/db/columns.ts` as part of this issue and use them in `schema.ts`. Otherwise, note in the ADR that they should be added when the second timestamp/JSON column appears.

### Verification

ADR linked from `services/api/README.md` and from CLAUDE.md alongside ADR 0001.

---

## Cross-cutting notes for any subagent picking up this work

- **Bun-only.** Use `bun` and `bunx`, not `node`/`npm`/`npx`. The Drizzle driver is `drizzle-orm/bun-sqlite`, not `better-sqlite3`.
- **GitHub workflow policy** (from CLAUDE.md): use GitHub MCP tools first for branch/PR/issue ops. `gh` CLI is fallback-only and must be documented.
- **Don't conflate** the file-vault and inline-editor workflows — this work touches neither directly, but if a session/auth change ripples into them, stop and surface it.
- **No raw SQL in app code** after #3 lands. Migrations directory is the only place SQL lives. If a query genuinely needs raw SQL (recursive CTE, window function), use Drizzle's `sql` template tag and justify it in the PR.
