import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const serverSource = readFileSync("services/api/server.ts", "utf8");
const configSource = readFileSync("services/api/config.ts", "utf8");

describe("API runtime Gitea auth", () => {
  test("uses the dedicated service token for production Gitea calls", () => {
    // BINDERSNAP_GITEA_SERVICE_TOKEN is read in config.ts (the config extraction module)
    expect(configSource).toContain("BINDERSNAP_GITEA_SERVICE_TOKEN");
    // All privileged call sites must go through the wrapper, not directly to the
    // service-token helper, so the dev fallback is applied consistently.
    expect(serverSource).toContain("buildGiteaPrivilegedHeaders");
  });

  test("admin credentials are guarded by a non-production check", () => {
    // The buildGiteaPrivilegedHeaders function must contain the !isProduction
    // guard before any use of the admin credential variables.
    const fnMatch = serverSource.match(
      /function buildGiteaPrivilegedHeaders\b[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toContain("!isProduction");
    const guardPos = fnBody.indexOf("!isProduction");
    const adminUserPos = fnBody.indexOf("giteaAdminUsername");
    const adminPassPos = fnBody.indexOf("giteaAdminPassword");
    expect(guardPos).toBeLessThan(adminUserPos);
    expect(guardPos).toBeLessThan(adminPassPos);
  });
});
