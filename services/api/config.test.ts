import { describe, expect, test } from "bun:test";

import { initializeConfig } from "./config";

describe("API config", () => {
  test("uses development defaults when env vars are unset", () => {
    const config = initializeConfig({});

    expect(config.nodeEnv).toBe("development");
    expect(config.apiPort).toBe(8787);
    expect(config.appPort).toBe(5173);
    expect(config.giteaUrl).toBe("http://localhost:3000");
    expect(config.appOrigin).toBe("http://localhost:5173");
    expect(config.configuredAllowedOrigins).toEqual(
      new Set(["http://localhost:5173"]),
    );
    expect(config.sessionCookieName).toBe("bindersnap_session");
    expect(config.sessionCookieDomain).toBeNull();
    expect(config.sessionCookieSameSite).toBe("Lax");
    expect(config.tokenScopes).toEqual([
      "write:user",
      "write:repository",
      "write:issue",
    ]);
  });

  test("normalizes session cookie and browser origin config", () => {
    const config = initializeConfig({
      BINDERSNAP_ALLOWED_ORIGINS:
        " https://bindersnap.com/ , https://app.bindersnap.com/billing ",
      BINDERSNAP_SESSION_COOKIE_DOMAIN: " .bindersnap.com ",
      BINDERSNAP_SESSION_COOKIE_SAME_SITE: " none ",
    });

    expect(config.appOrigin).toBe("https://bindersnap.com");
    expect(config.configuredAllowedOrigins).toEqual(
      new Set(["https://bindersnap.com", "https://app.bindersnap.com"]),
    );
    expect(config.sessionCookieDomain).toBe(".bindersnap.com");
    expect(config.sessionCookieSameSite).toBe("None");
  });

  test("invalid session cookie config fails fast", () => {
    expect(() =>
      initializeConfig({
        BINDERSNAP_SESSION_COOKIE_DOMAIN: "bad domain",
      }),
    ).toThrow(
      "BINDERSNAP_SESSION_COOKIE_DOMAIN must be a valid cookie domain.",
    );

    expect(() =>
      initializeConfig({
        BINDERSNAP_SESSION_COOKIE_SAME_SITE: "not-valid",
      }),
    ).toThrow(
      "BINDERSNAP_SESSION_COOKIE_SAME_SITE must be one of Strict, Lax, or None.",
    );
  });

  test("production config requires Stripe checkout and origin settings", () => {
    const productionBaseEnv = {
      NODE_ENV: "production",
      BINDERSNAP_GITEA_SERVICE_TOKEN: "svc_token",
      BINDERSNAP_APP_ORIGIN: "https://bindersnap.com",
      STRIPE_SECRET_KEY: "sk_live_test",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_ID: "price_test",
    };

    expect(() =>
      initializeConfig({
        ...productionBaseEnv,
        STRIPE_PRICE_ID: "",
      }),
    ).toThrow("STRIPE_PRICE_ID is required in production.");

    expect(() =>
      initializeConfig({
        NODE_ENV: "production",
        BINDERSNAP_GITEA_SERVICE_TOKEN: "svc_token",
        STRIPE_SECRET_KEY: "sk_live_test",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        STRIPE_PRICE_ID: "price_test",
      }),
    ).toThrow(
      "BINDERSNAP_ALLOWED_ORIGINS or BINDERSNAP_APP_ORIGIN is required in production.",
    );
  });

  test("production config succeeds when required values are present", () => {
    const config = initializeConfig({
      NODE_ENV: "production",
      API_PORT: "9999",
      APP_PORT: "4444",
      GITEA_INTERNAL_URL: "http://gitea:3000",
      BINDERSNAP_GITEA_SERVICE_TOKEN: "svc_token",
      BINDERSNAP_APP_ORIGIN: "https://bindersnap.com",
      STRIPE_SECRET_KEY: "sk_live_test",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
      STRIPE_PRICE_ID: "price_test",
      LOG_LEVEL: "warn",
    });

    expect(config.isProduction).toBe(true);
    expect(config.apiPort).toBe(9999);
    expect(config.appPort).toBe(4444);
    expect(config.giteaServiceToken).toBe("svc_token");
    expect(config.appOrigin).toBe("https://bindersnap.com");
    expect(config.logLevel).toBe("warn");
  });
});
