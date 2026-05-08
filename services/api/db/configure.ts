import { config, type ApiConfig } from "../config";
import { setSessionBackendFactory } from "../sessions";
import {
  setSubscriptionBackendFactory,
  setWebhookEventBackendFactory,
} from "../subscriptions";
import { getPostgresDb } from "./client";
import { PostgresSessionBackend } from "./postgres-sessions";
import {
  PostgresSubscriptionBackend,
  PostgresWebhookEventBackend,
} from "./postgres-subscriptions";
import { assertSchemaVersionMatches } from "./version";

// Picks the backend trio at startup. Called from server.ts before Bun.serve so
// the lazy stores resolve to the right backend on first use.
//
// Postgres path additionally runs the schema-version probe so the API refuses
// to serve traffic against a database the migration runner has not brought up
// to date. Returns the chosen backend so callers can log it.
export async function configureBackends(
  apiConfig: ApiConfig = config,
): Promise<"sqlite" | "postgres"> {
  if (apiConfig.dbBackend === "sqlite") {
    return "sqlite";
  }

  const db = getPostgresDb({ url: apiConfig.databaseUrl });
  await assertSchemaVersionMatches(db);

  setSessionBackendFactory(() => new PostgresSessionBackend(db));
  setSubscriptionBackendFactory(() => new PostgresSubscriptionBackend(db));
  setWebhookEventBackendFactory(() => new PostgresWebhookEventBackend(db));

  return "postgres";
}
