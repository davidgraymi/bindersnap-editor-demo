import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { config } from "../config";
import * as schema from "./schema";

type ApiDatabase = ReturnType<typeof drizzle<typeof schema>>;

function createSqliteClient(path: string): Database {
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode=WAL");
  return sqlite;
}

export function createDb(path: string = config.sessionsDbPath): ApiDatabase {
  return drizzle({ client: createSqliteClient(path), schema });
}

let defaultDb: ApiDatabase | null = null;

function getDefaultDb(): ApiDatabase {
  if (!defaultDb) {
    defaultDb = createDb(config.sessionsDbPath);
  }

  return defaultDb;
}

export const db = new Proxy({} as ApiDatabase, {
  get(_target, property, receiver) {
    return Reflect.get(getDefaultDb(), property, receiver);
  },
});
