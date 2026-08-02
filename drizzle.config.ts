import { defineConfig } from "drizzle-kit";

// drizzle-kit config for generating SQLite migrations from the schema.
// Runtime migration happens in services/api/db/client.ts (applied when a
// store opens the database); dbCredentials here only serve drizzle-kit's
// introspection commands.
export default defineConfig({
  dialect: "sqlite",
  schema: "./services/api/db/schema.ts",
  out: "./services/api/db/migrations",
  dbCredentials: {
    url: process.env.BINDERSNAP_SESSIONS_DB_PATH ?? "./sessions.db",
  },
});
