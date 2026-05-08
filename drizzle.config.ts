import type { Config } from "drizzle-kit";

// Drizzle-kit configuration. Used only by `bun run db:generate` and the
// standalone migration runner under services/api/db/migrate/. The API service
// itself does not import drizzle-kit.

export default {
  schema: "./services/api/db/schema.ts",
  out: "./services/api/db/migrations",
  dialect: "postgresql",
  // Keep the introspection URL out of this file — generation does not need it,
  // and the migration runner reads BINDERSNAP_DATABASE_URL directly.
  strict: true,
  verbose: true,
} satisfies Config;
