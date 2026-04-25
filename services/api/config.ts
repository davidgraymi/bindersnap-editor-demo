export type LogLevel = "debug" | "info" | "warn" | "error";
export type SessionCookieSameSite = "Strict" | "Lax" | "None";

// The complete configuration of the API server.
export interface ApiConfig {
  nodeEnv: string;
  isProduction: boolean;
  apiPort: number;
  appPort: number;
  giteaUrl: string;
  giteaAdminUsername: string;
  giteaAdminPassword: string;
  giteaServiceToken: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripePriceId: string;
  defaultAppOrigin: string;
  appOrigin: string;
  configuredAllowedOrigins: Set<string>;
  hasExplicitBrowserOrigins: boolean;
  emailDomain: string;
  sessionCookieName: string;
  tokenScopes: string[];
  sessionTtlMs: number;
  rememberedSessionTtlMs: number;
  enforceHttps: boolean;
  authRateLimitEnabled: boolean;
  bypassSubscriptionForUsers: string[];
  authRateLimitWindowMs: number;
  authRateLimitMax: number;
  sessionCookieDomain: string | null;
  sessionCookieSameSite: SessionCookieSameSite;
  sessionsDbPath: string;
  logLevel: LogLevel;
}

const REQUIRED_GITEA_TOKEN_SCOPES = [
  "write:user",
  "write:repository",
  "write:issue",
] as const;

// Spec types — every env var must have an entry in one of the three registries below.
type StringSpec = { requiredInProduction?: boolean; default: string };
type IntSpec = { requiredInProduction?: boolean; default: number };
type BoolSpec = {
  requiredInProduction?: boolean;
  default: boolean | ((isProduction: boolean) => boolean);
};

// Aliases (PORT → API_PORT, BUN_PUBLIC_GITEA_URL → GITEA_INTERNAL_URL, etc.) are
// resolved to canonical names in initializeConfig before these registries are consulted.
const STRING_ENV: Record<string, StringSpec> = {
  GITEA_ADMIN_USER: { default: "" },
  GITEA_ADMIN_PASS: { default: "" },
  GITEA_INTERNAL_URL: { default: "http://localhost:3000" },
  BINDERSNAP_GITEA_SERVICE_TOKEN: { requiredInProduction: true, default: "" },
  STRIPE_SECRET_KEY: { requiredInProduction: true, default: "" },
  STRIPE_WEBHOOK_SECRET: { requiredInProduction: true, default: "" },
  STRIPE_PRICE_ID: { requiredInProduction: true, default: "" },
  BINDERSNAP_ALLOWED_ORIGINS: { default: "" },
  BINDERSNAP_APP_ORIGIN: { default: "" },
  BINDERSNAP_USER_EMAIL_DOMAIN: { default: "users.bindersnap.local" },
  BINDERSNAP_SESSION_COOKIE_NAME: { default: "bindersnap_session" },
  BINDERSNAP_GITEA_TOKEN_SCOPES: { default: "" },
  BINDERSNAP_FREE_USERS: { default: "" },
  BINDERSNAP_SESSION_COOKIE_DOMAIN: { default: "" },
  BINDERSNAP_SESSION_COOKIE_SAME_SITE: { default: "Lax" },
  BINDERSNAP_SESSIONS_DB_PATH: { default: "/var/lib/bindersnap/sessions.db" },
  LOG_LEVEL: { default: "" },
};

const INT_ENV: Record<string, IntSpec> = {
  API_PORT: { default: 8787 },
  APP_PORT: { default: 5173 },
  BINDERSNAP_SESSION_TTL_MS: { default: 7 * 24 * 60 * 60 * 1000 },
  BINDERSNAP_REMEMBER_ME_SESSION_TTL_MS: { default: 30 * 24 * 60 * 60 * 1000 },
  BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS: { default: 10 * 60 * 1000 },
  BINDERSNAP_AUTH_RATE_LIMIT_MAX: { default: 20 },
};

const BOOL_ENV: Record<string, BoolSpec> = {
  BINDERSNAP_REQUIRE_HTTPS: { default: (isProduction) => isProduction },
  BINDERSNAP_AUTH_RATE_LIMIT_ENABLED: { default: true },
};

function parseString(
  env: NodeJS.ProcessEnv,
  name: string,
  isProduction: boolean,
): string {
  const spec = STRING_ENV[name];
  if (!spec) throw new Error(`No string spec defined for env var ${name}`);
  const value = env[name]?.trim() ?? "";
  if (value === "" && spec.requiredInProduction && isProduction) {
    throw new Error(`${name} is required in production.`);
  }
  return value !== "" ? value : spec.default;
}

function parsePositiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  isProduction: boolean,
): number {
  const spec = INT_ENV[name];
  if (!spec) throw new Error(`No int spec defined for env var ${name}`);
  const raw = env[name]?.trim();
  if (
    (raw === undefined || raw === "") &&
    spec.requiredInProduction &&
    isProduction
  ) {
    throw new Error(`${name} is required in production.`);
  }
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : spec.default;
}

function parseBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  isProduction: boolean,
): boolean {
  const spec = BOOL_ENV[name];
  if (!spec) throw new Error(`No boolean spec defined for env var ${name}`);
  const raw = env[name]?.trim();
  const fallback =
    typeof spec.default === "function"
      ? spec.default(isProduction)
      : spec.default;
  if (
    (raw === undefined || raw === "") &&
    spec.requiredInProduction &&
    isProduction
  ) {
    throw new Error(`${name} is required in production.`);
  }
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveGiteaTokenScopes(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
): string[] {
  const scopesRaw = parseString(
    env,
    "BINDERSNAP_GITEA_TOKEN_SCOPES",
    isProduction,
  );
  const configuredScopes = scopesRaw
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope !== "");
  return Array.from(
    new Set<string>([...configuredScopes, ...REQUIRED_GITEA_TOKEN_SCOPES]),
  );
}

function resolveConfiguredAllowedOrigins(
  allowedOriginsRaw: string,
  appOriginRaw: string,
  defaultAppOrigin: string,
): Set<string> {
  return new Set(
    (allowedOriginsRaw || appOriginRaw || defaultAppOrigin)
      .split(",")
      .map(resolveOrigin)
      .filter((origin): origin is string => origin !== null),
  );
}

function resolvePrimaryAppOrigin(
  allowedOriginsRaw: string,
  appOriginRaw: string,
  defaultAppOrigin: string,
): string {
  return (
    resolveOrigin(appOriginRaw) ??
    resolveOrigin(allowedOriginsRaw.split(",")[0]) ??
    defaultAppOrigin
  );
}

function resolveOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function resolveCookieDomain(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
): string | null {
  const value = parseString(
    env,
    "BINDERSNAP_SESSION_COOKIE_DOMAIN",
    isProduction,
  );
  if (value === "") {
    return null;
  }

  if (!/^\.?[a-z0-9.-]+$/i.test(value)) {
    throw new Error(
      "BINDERSNAP_SESSION_COOKIE_DOMAIN must be a valid cookie domain.",
    );
  }

  return value;
}

function resolveCookieSameSite(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
): SessionCookieSameSite {
  const value = parseString(
    env,
    "BINDERSNAP_SESSION_COOKIE_SAME_SITE",
    isProduction,
  );
  switch (value.toLowerCase()) {
    case "strict":
      return "Strict";
    case "none":
      return "None";
    case "lax":
      return "Lax";
    default:
      throw new Error(
        "BINDERSNAP_SESSION_COOKIE_SAME_SITE must be one of Strict, Lax, or None.",
      );
  }
}

function resolveLogLevel(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
): LogLevel {
  const raw = parseString(env, "LOG_LEVEL", isProduction);
  switch (raw.toLowerCase()) {
    case "debug":
      return "debug";
    case "info":
      return "info";
    case "warn":
      return "warn";
    case "error":
      return "error";
    default:
      return isProduction ? "info" : "debug";
  }
}

function validateProductionOrigins(
  isProduction: boolean,
  allowedOriginsRaw: string,
  appOriginRaw: string,
): void {
  if (!isProduction) {
    return;
  }

  if (allowedOriginsRaw === "" && appOriginRaw === "") {
    throw new Error(
      "BINDERSNAP_ALLOWED_ORIGINS or BINDERSNAP_APP_ORIGIN is required in production.",
    );
  }
}

export function initializeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";

  // Resolve env var aliases to their canonical names before all other lookups.
  const resolvedEnv: NodeJS.ProcessEnv = {
    ...env,
    API_PORT: env.API_PORT ?? env.PORT,
    GITEA_INTERNAL_URL:
      env.GITEA_INTERNAL_URL ?? env.BUN_PUBLIC_GITEA_URL ?? env.VITE_GITEA_URL,
  };

  const apiPort = parsePositiveInt(resolvedEnv, "API_PORT", isProduction);
  const appPort = parsePositiveInt(resolvedEnv, "APP_PORT", isProduction);
  const defaultAppOrigin = `http://localhost:${appPort}`;
  const allowedOriginsRaw = parseString(
    resolvedEnv,
    "BINDERSNAP_ALLOWED_ORIGINS",
    isProduction,
  );
  const appOriginRaw = parseString(
    resolvedEnv,
    "BINDERSNAP_APP_ORIGIN",
    isProduction,
  );

  validateProductionOrigins(isProduction, allowedOriginsRaw, appOriginRaw);

  return {
    nodeEnv,
    isProduction,
    apiPort,
    appPort,
    giteaUrl: parseString(resolvedEnv, "GITEA_INTERNAL_URL", isProduction),
    giteaAdminUsername: parseString(
      resolvedEnv,
      "GITEA_ADMIN_USER",
      isProduction,
    ),
    giteaAdminPassword: parseString(
      resolvedEnv,
      "GITEA_ADMIN_PASS",
      isProduction,
    ),
    giteaServiceToken: parseString(
      resolvedEnv,
      "BINDERSNAP_GITEA_SERVICE_TOKEN",
      isProduction,
    ),
    stripeSecretKey: parseString(
      resolvedEnv,
      "STRIPE_SECRET_KEY",
      isProduction,
    ),
    stripeWebhookSecret: parseString(
      resolvedEnv,
      "STRIPE_WEBHOOK_SECRET",
      isProduction,
    ),
    stripePriceId: parseString(resolvedEnv, "STRIPE_PRICE_ID", isProduction),
    defaultAppOrigin,
    appOrigin: resolvePrimaryAppOrigin(
      allowedOriginsRaw,
      appOriginRaw,
      defaultAppOrigin,
    ),
    configuredAllowedOrigins: resolveConfiguredAllowedOrigins(
      allowedOriginsRaw,
      appOriginRaw,
      defaultAppOrigin,
    ),
    hasExplicitBrowserOrigins: allowedOriginsRaw !== "" || appOriginRaw !== "",
    emailDomain: parseString(
      resolvedEnv,
      "BINDERSNAP_USER_EMAIL_DOMAIN",
      isProduction,
    ),
    sessionCookieName: parseString(
      resolvedEnv,
      "BINDERSNAP_SESSION_COOKIE_NAME",
      isProduction,
    ),
    tokenScopes: resolveGiteaTokenScopes(resolvedEnv, isProduction),
    sessionTtlMs: parsePositiveInt(
      resolvedEnv,
      "BINDERSNAP_SESSION_TTL_MS",
      isProduction,
    ),
    rememberedSessionTtlMs: parsePositiveInt(
      resolvedEnv,
      "BINDERSNAP_REMEMBER_ME_SESSION_TTL_MS",
      isProduction,
    ),
    enforceHttps: parseBoolean(
      resolvedEnv,
      "BINDERSNAP_REQUIRE_HTTPS",
      isProduction,
    ),
    authRateLimitEnabled: parseBoolean(
      resolvedEnv,
      "BINDERSNAP_AUTH_RATE_LIMIT_ENABLED",
      isProduction,
    ),
    bypassSubscriptionForUsers: parseString(
      resolvedEnv,
      "BINDERSNAP_FREE_USERS",
      isProduction,
    )
      .split(",")
      .map((username) => username.trim())
      .filter((username) => username !== ""),
    authRateLimitWindowMs: parsePositiveInt(
      resolvedEnv,
      "BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS",
      isProduction,
    ),
    authRateLimitMax: parsePositiveInt(
      resolvedEnv,
      "BINDERSNAP_AUTH_RATE_LIMIT_MAX",
      isProduction,
    ),
    sessionCookieDomain: resolveCookieDomain(resolvedEnv, isProduction),
    sessionCookieSameSite: resolveCookieSameSite(resolvedEnv, isProduction),
    sessionsDbPath: parseString(
      resolvedEnv,
      "BINDERSNAP_SESSIONS_DB_PATH",
      isProduction,
    ),
    logLevel: resolveLogLevel(resolvedEnv, isProduction),
  };
}

export const config = initializeConfig();
