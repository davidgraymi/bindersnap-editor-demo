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

type DerivedConfigKeys =
  | "nodeEnv"
  | "isProduction"
  | "defaultAppOrigin"
  | "appOrigin"
  | "configuredAllowedOrigins"
  | "hasExplicitBrowserOrigins"
  | "tokenScopes"
  | "enforceHttps"
  | "logLevel";

type StaticConfigDefaults = Omit<ApiConfig, DerivedConfigKeys>;

// The default configuration of a subset of ApiConfig values.
const DEFAULT_CONFIG = {
  apiPort: 8787,
  appPort: 5173,
  giteaUrl: "http://localhost:3000",
  giteaAdminUsername: "",
  giteaAdminPassword: "",
  giteaServiceToken: "",
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  stripePriceId: "",
  emailDomain: "users.bindersnap.local",
  sessionCookieName: "bindersnap_session",
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  rememberedSessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  authRateLimitEnabled: true,
  bypassSubscriptionForUsers: [],
  authRateLimitWindowMs: 10 * 60 * 1000,
  authRateLimitMax: 20,
  sessionCookieDomain: null,
  sessionCookieSameSite: "Lax",
  sessionsDbPath: "/var/lib/bindersnap/sessions.db",
} satisfies StaticConfigDefaults;

// Values that must be set in the environment in production. Not specifying these will lead to program termination.
const REQUIRED_PRODUCTION_CONFIG = {
  BINDERSNAP_GITEA_SERVICE_TOKEN: "giteaServiceToken",
  STRIPE_SECRET_KEY: "stripeSecretKey",
  STRIPE_WEBHOOK_SECRET: "stripeWebhookSecret",
  STRIPE_PRICE_ID: "stripePriceId",
} as const satisfies Record<string, keyof ApiConfig>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readTrimmedString(
  env: NodeJS.ProcessEnv,
  name: string,
  options?: {
    defaultValue?: string;
    isProduction?: boolean;
  },
): string {
  const value = env[name]?.trim() ?? options?.defaultValue ?? "";

  if (
    options?.isProduction &&
    name in REQUIRED_PRODUCTION_CONFIG &&
    value === ""
  ) {
    throw new Error(`${name} is required in production.`);
  }

  return value;
}

function resolveGiteaTokenScopes(scopesRaw?: string): string[] {
  const configuredScopes = (scopesRaw ?? "")
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

function resolveCookieDomain(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return null;
  }

  if (!/^\.?[a-z0-9.-]+$/i.test(trimmed)) {
    throw new Error(
      "BINDERSNAP_SESSION_COOKIE_DOMAIN must be a valid cookie domain.",
    );
  }

  return trimmed;
}

function resolveCookieSameSite(
  value: string | undefined,
): SessionCookieSameSite {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_CONFIG.sessionCookieSameSite;
  }

  switch (normalized) {
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
  raw: string | undefined,
  isProduction: boolean,
): LogLevel {
  switch (raw?.trim().toLowerCase()) {
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
  const apiPort = parsePositiveInt(
    env.API_PORT ?? env.PORT,
    DEFAULT_CONFIG.apiPort,
  );
  const appPort = parsePositiveInt(env.APP_PORT, DEFAULT_CONFIG.appPort);
  const defaultAppOrigin = `http://localhost:${appPort}`;
  const allowedOriginsRaw = readTrimmedString(
    env,
    "BINDERSNAP_ALLOWED_ORIGINS",
  );
  const appOriginRaw = readTrimmedString(env, "BINDERSNAP_APP_ORIGIN");

  validateProductionOrigins(isProduction, allowedOriginsRaw, appOriginRaw);

  return {
    nodeEnv,
    isProduction,
    apiPort,
    appPort,
    giteaUrl:
      env.GITEA_INTERNAL_URL ??
      env.BUN_PUBLIC_GITEA_URL ??
      env.VITE_GITEA_URL ??
      DEFAULT_CONFIG.giteaUrl,
    giteaAdminUsername: readTrimmedString(env, "GITEA_ADMIN_USER"),
    giteaAdminPassword: readTrimmedString(env, "GITEA_ADMIN_PASS"),
    giteaServiceToken: readTrimmedString(
      env,
      "BINDERSNAP_GITEA_SERVICE_TOKEN",
      {
        defaultValue: DEFAULT_CONFIG.giteaServiceToken,
        isProduction,
      },
    ),
    stripeSecretKey: readTrimmedString(env, "STRIPE_SECRET_KEY", {
      defaultValue: DEFAULT_CONFIG.stripeSecretKey,
      isProduction,
    }),
    stripeWebhookSecret: readTrimmedString(env, "STRIPE_WEBHOOK_SECRET", {
      defaultValue: DEFAULT_CONFIG.stripeWebhookSecret,
      isProduction,
    }),
    stripePriceId: readTrimmedString(env, "STRIPE_PRICE_ID", {
      defaultValue: DEFAULT_CONFIG.stripePriceId,
      isProduction,
    }),
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
    hasExplicitBrowserOrigins:
      allowedOriginsRaw.trim() !== "" || appOriginRaw.trim() !== "",
    emailDomain: env.BINDERSNAP_USER_EMAIL_DOMAIN ?? DEFAULT_CONFIG.emailDomain,
    sessionCookieName:
      env.BINDERSNAP_SESSION_COOKIE_NAME ?? DEFAULT_CONFIG.sessionCookieName,
    tokenScopes: resolveGiteaTokenScopes(env.BINDERSNAP_GITEA_TOKEN_SCOPES),
    sessionTtlMs: parsePositiveInt(
      env.BINDERSNAP_SESSION_TTL_MS,
      DEFAULT_CONFIG.sessionTtlMs,
    ),
    rememberedSessionTtlMs: parsePositiveInt(
      env.BINDERSNAP_REMEMBER_ME_SESSION_TTL_MS,
      DEFAULT_CONFIG.rememberedSessionTtlMs,
    ),
    enforceHttps: parseBoolean(env.BINDERSNAP_REQUIRE_HTTPS, isProduction),
    authRateLimitEnabled: parseBoolean(
      env.BINDERSNAP_AUTH_RATE_LIMIT_ENABLED,
      DEFAULT_CONFIG.authRateLimitEnabled,
    ),
    bypassSubscriptionForUsers: (env.BINDERSNAP_FREE_USERS ?? "")
      .split(",")
      .map((username) => username.trim())
      .filter((username) => username !== ""),
    authRateLimitWindowMs: parsePositiveInt(
      env.BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS,
      DEFAULT_CONFIG.authRateLimitWindowMs,
    ),
    authRateLimitMax: parsePositiveInt(
      env.BINDERSNAP_AUTH_RATE_LIMIT_MAX,
      DEFAULT_CONFIG.authRateLimitMax,
    ),
    sessionCookieDomain: resolveCookieDomain(
      env.BINDERSNAP_SESSION_COOKIE_DOMAIN,
    ),
    sessionCookieSameSite: resolveCookieSameSite(
      env.BINDERSNAP_SESSION_COOKIE_SAME_SITE,
    ),
    sessionsDbPath:
      env.BINDERSNAP_SESSIONS_DB_PATH ?? DEFAULT_CONFIG.sessionsDbPath,
    logLevel: resolveLogLevel(env.LOG_LEVEL, isProduction),
  };
}

export const config = initializeConfig();
