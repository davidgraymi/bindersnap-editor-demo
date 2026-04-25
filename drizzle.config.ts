import { defineConfig } from "drizzle-kit";

const sessionsDbPath =
  process.env.BINDERSNAP_SESSIONS_DB_PATH ?? "/var/lib/bindersnap/sessions.db";

export default defineConfig({
  dialect: "sqlite",
  schema: "./services/api/db/schema.ts",
  out: "./services/api/db/migrations",
  dbCredentials: {
    url: sessionsDbPath,
  },
});
