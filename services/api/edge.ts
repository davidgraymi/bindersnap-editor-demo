/**
 * What the API does for itself now that nothing stands between it and
 * Cloudflare (#806).
 *
 * In production a request reaches the API one way: Cloudflare terminates TLS,
 * and the `cloudflared` container carries the request over the Docker network
 * to `api:8787`. The API publishes no port on the host and the security group
 * allows nothing in (infra/compute), so the headers Cloudflare adds can be
 * trusted. Caddy used to sit in between, setting the headers below and
 * limiting the Stripe webhook; it was retired, and these are its jobs.
 */

/**
 * Sent with every response. The API answers with JSON and files, never a
 * page, so nothing it serves may run a script, load anything or be framed.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

/** Unless a response set a stricter one itself (a downloaded document's). */
const DEFAULT_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

/**
 * Add the security headers to `headers` in place, keep any
 * `Content-Security-Policy` already set, and say nothing about the server.
 */
export function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", DEFAULT_CSP);
  }
  headers.delete("server");
}

/**
 * The address a request came from, for rate limits and logs.
 *
 * **Behind Cloudflare, only `CF-Connecting-IP` is the visitor's.** Cloudflare
 * appends to an `X-Forwarded-For` the visitor sent rather than replacing it,
 * so its first entry is whatever the visitor chose to write there: keyed on
 * that, one attacker could spread sign-in guesses over endless buckets, or
 * fill a victim's. `CF-Connecting-IP` is set by Cloudflare alone, and it can
 * be believed only because the tunnel is the only way in.
 *
 * Elsewhere (the local stack, CI) there is no Cloudflare, so the usual proxy
 * headers are read in order. Failing all of them, the request's own host name
 * stands in: it is no address, but it is one bucket rather than none.
 */
export function clientIpFrom(req: Request, behindCloudflare: boolean): string {
  if (behindCloudflare) {
    return (
      req.headers.get("cf-connecting-ip")?.trim() || new URL(req.url).hostname
    );
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const cfConnectingIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return new URL(req.url).hostname;
}

/**
 * At most `max` events per key in each `windowMs`, counted in memory.
 *
 * Fixed windows: a key may get up to twice `max` across a window's edge,
 * which is fine for a flood guard. Expired keys are swept once the map grows,
 * so a flood from many addresses cannot hold memory past its window.
 */
export class WindowLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Count one event; `true` when this key is over its limit. */
  limited(key: string): boolean {
    const now = this.now();
    if (this.windows.size >= 10_000) this.sweep(now);

    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }
    window.count += 1;
    return window.count > this.max;
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * `POST /stripe/webhook`: 60 a second from one address. Checking a Stripe
 * signature is an HMAC over the whole body, so a flood of unsigned requests
 * is refused here, before any of that work. Stripe itself sends nowhere near
 * this many.
 */
export const stripeWebhookLimiter = new WindowLimiter(60, 1000);
