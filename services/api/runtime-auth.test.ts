import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("services/api/server.ts", "utf8");

describe("API runtime Gitea auth", () => {
  test("uses the dedicated service token instead of admin credentials", () => {
    expect(serverSource).toContain("BINDERSNAP_GITEA_SERVICE_TOKEN");
    expect(serverSource).not.toContain("GITEA_ADMIN_USER");
    expect(serverSource).not.toContain("GITEA_ADMIN_PASS");
  });
});
