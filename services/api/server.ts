/**
 * Bindersnap API service.
 *
 * Auth (login/signup/logout/me) was removed in favour of browser-direct PKCE
 * OAuth2 with Gitea — see apps/app/auth/pkce.ts.
 *
 * This server remains as the scaffold for future non-auth services
 * (e.g. Pandoc document conversion). Add routes here as those features land.
 */

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

const apiPortValue = Number.parseInt(
  process.env.API_PORT ?? process.env.PORT ?? "8787",
  10,
);
const apiPort =
  Number.isFinite(apiPortValue) && apiPortValue > 0 ? apiPortValue : 8787;
const enforceHttps = parseBoolean(
  process.env.BINDERSNAP_REQUIRE_HTTPS,
  process.env.NODE_ENV === "production",
);
const defaultAppOrigin = `http://localhost:${process.env.APP_PORT ?? "5173"}`;
const configuredAllowedOrigins = (
  process.env.BINDERSNAP_ALLOWED_ORIGINS ??
  process.env.BINDERSNAP_APP_ORIGIN ??
  defaultAppOrigin
)
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin !== "");

const allowedOrigins = new Set(
  configuredAllowedOrigins
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin)),
);

function normalizeOrigin(origin: string | null | undefined): string | null {
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

function json(
  status: number,
  body: Record<string, unknown>,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });

  if (headers) {
    new Headers(headers).forEach((value, key) => {
      responseHeaders.set(key, value);
    });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function requestOrigin(req: Request): string | null {
  return normalizeOrigin(req.headers.get("origin"));
}

function requestSourceOrigin(req: Request): string | null {
  const origin = requestOrigin(req);
  if (origin) {
    return origin;
  }

  const referer = req.headers.get("referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function requestProtocol(req: Request): string {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim().toLowerCase() ?? "";
  }

  return new URL(req.url).protocol.replace(":", "").toLowerCase();
}

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  if (allowedOrigins.has(origin)) {
    return true;
  }

  // Local dev fallback: allow loopback browser origins unless explicitly locked down.
  if (
    !process.env.BINDERSNAP_ALLOWED_ORIGINS &&
    !process.env.BINDERSNAP_APP_ORIGIN
  ) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  }

  return false;
}

function corsHeaders(req: Request): Headers {
  const headers = new Headers();
  const origin = requestOrigin(req);

  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set("Vary", "Origin");
  }

  return headers;
}

function mergeHeaders(base: Headers, extra?: HeadersInit): Headers {
  const headers = new Headers(base);
  if (extra) {
    new Headers(extra).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function isLocalRequest(req: Request): boolean {
  const { hostname } = new URL(req.url);
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function enforceTransportSecurity(
  req: Request,
  baseHeaders: Headers,
): Response | null {
  if (!enforceHttps || isLocalRequest(req)) {
    return null;
  }

  if (requestProtocol(req) === "https") {
    return null;
  }

  return json(400, { error: "HTTPS is required." }, baseHeaders);
}

function enforceStateChangingOrigin(
  req: Request,
  baseHeaders: Headers,
): Response | null {
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS"
  ) {
    return null;
  }

  const sourceOrigin = requestSourceOrigin(req);
  if (!isAllowedOrigin(sourceOrigin)) {
    return json(403, { error: "Cross-site request blocked." }, baseHeaders);
  }

  return null;
}

const server = Bun.serve({
  port: apiPort,
  idleTimeout: 30,
  async fetch(req) {
    const baseHeaders = corsHeaders(req);

    const transportError = enforceTransportSecurity(req, baseHeaders);
    if (transportError) {
      return transportError;
    }

    const originError = enforceStateChangingOrigin(req, baseHeaders);
    if (originError) {
      return originError;
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: baseHeaders,
      });
    }

    return json(404, { error: "Not found." }, baseHeaders);
  },
});

console.log(`Bindersnap API listening on http://localhost:${server.port}`);
