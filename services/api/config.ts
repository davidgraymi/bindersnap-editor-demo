import { logger } from "./logger";
import { resolveGiteaTokenScopes } from "../../packages/gitea-client/tokenScopes";

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

const apiPortValue = Number.parseInt(
  process.env.API_PORT ?? process.env.PORT ?? "8787",
  10,
);
export const apiPort =
  Number.isFinite(apiPortValue) && apiPortValue > 0 ? apiPortValue : 8787;
export const giteaUrl =
  process.env.GITEA_INTERNAL_URL ??
  process.env.BUN_PUBLIC_GITEA_URL ??
  process.env.VITE_GITEA_URL ??
  "http://localhost:3000";
export const giteaAdminUsername = process.env.GITEA_ADMIN_USER?.trim() ?? "";
export const giteaAdminPassword = process.env.GITEA_ADMIN_PASS?.trim() ?? "";
export const giteaServiceToken =
  process.env.BINDERSNAP_GITEA_SERVICE_TOKEN?.trim() ?? "";
export const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !giteaServiceToken) {
  logger.error(
    "FATAL: BINDERSNAP_GITEA_SERVICE_TOKEN is not set in production",
    { env: "production" },
  );
  process.exit(1);
}

export const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
export const stripeWebhookSecret =
  process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
export const stripePriceId = process.env.STRIPE_PRICE_ID?.trim() ?? "";

const defaultStripeAppOrigin = "http://localhost:5173";
export const appOrigin = (
  process.env.BINDERSNAP_APP_ORIGIN ??
  process.env.BINDERSNAP_ALLOWED_ORIGINS?.split(",")[0] ??
  defaultStripeAppOrigin
).trim();

if (isProduction && !stripeSecretKey) {
  logger.error("FATAL: STRIPE_SECRET_KEY is not set in production", {
    env: "production",
  });
  process.exit(1);
}

if (isProduction && !stripeWebhookSecret) {
  logger.error("FATAL: STRIPE_WEBHOOK_SECRET is not set in production", {
    env: "production",
  });
  process.exit(1);
}

export const emailDomain =
  process.env.BINDERSNAP_USER_EMAIL_DOMAIN ?? "users.bindersnap.local";
export const sessionCookieName =
  process.env.BINDERSNAP_SESSION_COOKIE_NAME ?? "bindersnap_session";

export type SessionCookieSameSite = "Strict" | "Lax" | "None";

export const tokenScopes = resolveGiteaTokenScopes(
  process.env.BINDERSNAP_GITEA_TOKEN_SCOPES,
);
export const sessionTtlMs = parsePositiveInt(
  process.env.BINDERSNAP_SESSION_TTL_MS,
  7 * 24 * 60 * 60 * 1000,
);
export const rememberedSessionTtlMs = parsePositiveInt(
  process.env.BINDERSNAP_REMEMBER_ME_SESSION_TTL_MS,
  30 * 24 * 60 * 60 * 1000,
);
export const enforceHttps = parseBoolean(
  process.env.BINDERSNAP_REQUIRE_HTTPS,
  process.env.NODE_ENV === "production",
);
export const authRateLimitEnabled = parseBoolean(
  process.env.BINDERSNAP_AUTH_RATE_LIMIT_ENABLED,
  true,
);
export const bypassSubscriptionForUsers = new Set(
  (process.env.BINDERSNAP_FREE_USERS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u !== ""),
);
export const authRateLimitWindowMs = parsePositiveInt(
  process.env.BINDERSNAP_AUTH_RATE_LIMIT_WINDOW_MS,
  10 * 60 * 1000,
);
export const authRateLimitMax = parsePositiveInt(
  process.env.BINDERSNAP_AUTH_RATE_LIMIT_MAX,
  20,
);
const defaultAppOrigin = `http://localhost:${process.env.APP_PORT ?? "5173"}`;
export const configuredAllowedOrigins = (
  process.env.BINDERSNAP_ALLOWED_ORIGINS ??
  process.env.BINDERSNAP_APP_ORIGIN ??
  defaultAppOrigin
)
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");

function resolveCookieDomain(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  return /^\.?[a-z0-9.-]+$/i.test(trimmed) ? trimmed : null;
}

export function resolveCookieSameSite(
  value: string | undefined,
  fallback: SessionCookieSameSite = "Lax",
): SessionCookieSameSite {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "strict":
      return "Strict";
    case "none":
      return "None";
    case "lax":
      return "Lax";
    default:
      return fallback;
  }
}

export function normalizeOrigin(
  origin: string | null | undefined,
): string | null {
  if (!origin) {
    return null;
  }

  const trimmed = origin.trim();
  if (trimmed === "") {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export const sessionCookieDomain = resolveCookieDomain(
  process.env.BINDERSNAP_SESSION_COOKIE_DOMAIN,
);
export const sessionCookieSameSite = resolveCookieSameSite(
  process.env.BINDERSNAP_SESSION_COOKIE_SAME_SITE,
);
export const allowedOrigins = new Set(
  configuredAllowedOrigins
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin)),
);
