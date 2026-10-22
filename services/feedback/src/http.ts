/** What both routes answer with, and how they log. */

export function allowedOrigin(
  origin: string | null,
  allowedOrigins: string,
): string | null {
  if (!origin) return null;
  const origins = allowedOrigins.split(",").map((value) => value.trim());
  return origins.includes(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ Vary: "Origin" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

export function reply(
  status: number,
  body: unknown,
  headers: Headers,
): Response {
  const out = new Headers(headers);
  out.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: out });
}

/**
 * The body as text, or null when it is larger than `max` bytes — by what it
 * says it is, and then by what it is.
 */
export async function readCapped(
  request: Request,
  max: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > max) return null;
  const raw = await request.text();
  return new TextEncoder().encode(raw).length > max ? null : raw;
}

export function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...fields }));
}
