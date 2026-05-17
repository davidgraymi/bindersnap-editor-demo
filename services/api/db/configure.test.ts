import { describe, expect, test } from "bun:test";
import type { ApiConfig } from "../config";
import { configureBackends } from "./configure";

const sqliteConfig = {
  dbBackend: "sqlite",
  databaseUrl: "",
} as unknown as ApiConfig;

describe("configureBackends", () => {
  test("sqlite path is a no-op and reports sqlite", async () => {
    const chosen = await configureBackends(sqliteConfig);
    expect(chosen).toBe("sqlite");
  });
});
