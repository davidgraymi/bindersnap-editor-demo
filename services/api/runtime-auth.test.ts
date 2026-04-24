import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { initializeConfig } from "./config";

const configSource = readFileSync("services/api/config.ts", "utf8");
const serverSource = readFileSync("services/api/server.ts", "utf8");

describe("API runtime Gitea auth", () => {
  test("uses the dedicated service token for production Gitea calls", () => {
    expect(configSource).toContain("BINDERSNAP_GITEA_SERVICE_TOKEN");
    // All privileged call sites must go through the wrapper, not directly to the
    // service-token helper, so the dev fallback is applied consistently.
    expect(serverSource).toContain("buildGiteaPrivilegedHeaders");
    expect(serverSource).toContain("config.giteaServiceToken");
  });

  test("admin credentials are guarded by a non-production check", () => {
    // The buildGiteaPrivilegedHeaders function must contain the !config.isProduction
    // guard before any use of the admin credential variables.
    const fnMatch = serverSource.match(
      /function buildGiteaPrivilegedHeaders\b[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];
    expect(fnBody).toContain("!config.isProduction");
    const guardPos = fnBody.indexOf("!config.isProduction");
    const adminUserPos = fnBody.indexOf("config.giteaAdminUsername");
    const adminPassPos = fnBody.indexOf("config.giteaAdminPassword");
    expect(guardPos).toBeLessThan(adminUserPos);
    expect(guardPos).toBeLessThan(adminPassPos);
  });

  test("production config requires the service token", () => {
    expect(() =>
      initializeConfig({
        NODE_ENV: "production",
        BINDERSNAP_APP_ORIGIN: "https://bindersnap.com",
        STRIPE_SECRET_KEY: "sk_live_test",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        STRIPE_PRICE_ID: "price_test",
      }),
    ).toThrow("BINDERSNAP_GITEA_SERVICE_TOKEN is required in production.");
  });
});
