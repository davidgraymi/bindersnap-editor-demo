import { randomBytes } from "node:crypto";

import { and, desc, eq, gte } from "drizzle-orm";

import { config } from "./config";
import { openSqliteDb, type SqliteDb } from "./db/client";
import { resourceRequests } from "./db/schema";
import type { EmailContent } from "./mail";

/**
 * "Email it to me", on the public site's templates, policy manual indexes and
 * checklist.
 *
 * A reader who isn't ready for a trial can ask for the page by email. That is
 * a plain HTML form posted to the API from bindersnap.com, with no script and
 * no account, so the route takes no session and trusts nothing in the body:
 * the page asked for must look like one of the site's, the address is sent
 * one fixed email whose only variable parts are that page's address and name,
 * and both the sender's address and the recipient's are rate limited.
 *
 * The rows are the list of people who asked, for the founder to write to.
 * Every email to them carries a link that stops all of it.
 */

/** The site pages a person can ask for, and nothing else. */
const RESOURCE = /^\/(templates|manuals|tools)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** How many pages one address can be sent in a day, whoever asks. */
export const DAILY_LIMIT_PER_ADDRESS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isRequestableResource(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= 120 && RESOURCE.test(value)
  );
}

export interface ResourceRequestRow {
  email: string;
  resource: string;
  createdAt: number;
  requestedAt: number;
  unsubscribed: boolean;
}

export class ResourceRequestStore {
  private db: SqliteDb;

  constructor(path: string = config.sessionsDbPath) {
    this.db = openSqliteDb(path);
  }

  /**
   * Keep the request, and say whether to send the email. Asking again for the
   * same page updates the row; asking after unsubscribing starts the emails
   * again, since the person has just asked for one.
   */
  record(
    emailAddress: string,
    resource: string,
    now = Date.now(),
  ): { send: boolean; unsubscribeToken: string } {
    const email = emailAddress.trim().toLowerCase();
    const recent = this.db
      .select({ id: resourceRequests.id })
      .from(resourceRequests)
      .where(
        and(
          eq(resourceRequests.email, email),
          gte(resourceRequests.requestedAt, now - DAY_MS),
        ),
      )
      .all().length;

    const token =
      this.db
        .select({ token: resourceRequests.unsubscribeToken })
        .from(resourceRequests)
        .where(eq(resourceRequests.email, email))
        .get()?.token ?? randomBytes(24).toString("base64url");

    this.db
      .insert(resourceRequests)
      .values({
        email,
        resource,
        unsubscribeToken: token,
        createdAt: now,
        requestedAt: now,
        unsubscribedAt: null,
      })
      .onConflictDoUpdate({
        target: [resourceRequests.email, resourceRequests.resource],
        set: { requestedAt: now },
      })
      .run();
    // They asked again: whatever they turned off before, this is a yes.
    this.db
      .update(resourceRequests)
      .set({ unsubscribedAt: null })
      .where(eq(resourceRequests.email, email))
      .run();

    return { send: recent < DAILY_LIMIT_PER_ADDRESS, unsubscribeToken: token };
  }

  /** Stop every email to the token's address. The address, or null. */
  unsubscribe(token: string, now = Date.now()): string | null {
    if (!token) return null;
    const row = this.db
      .select({ email: resourceRequests.email })
      .from(resourceRequests)
      .where(eq(resourceRequests.unsubscribeToken, token))
      .get();
    if (!row) return null;
    this.db
      .update(resourceRequests)
      .set({ unsubscribedAt: now })
      .where(eq(resourceRequests.email, row.email))
      .run();
    return row.email;
  }

  /** Every request on record, newest first. */
  list(): ResourceRequestRow[] {
    return this.db
      .select()
      .from(resourceRequests)
      .orderBy(desc(resourceRequests.requestedAt))
      .all()
      .map((row) => ({
        email: row.email,
        resource: row.resource,
        createdAt: row.createdAt,
        requestedAt: row.requestedAt,
        unsubscribed: row.unsubscribedAt !== null,
      }));
  }

  /** Delete everything held about an address, for a privacy request. */
  forget(emailAddress: string): void {
    this.db
      .delete(resourceRequests)
      .where(eq(resourceRequests.email, emailAddress.trim().toLowerCase()))
      .run();
  }
}

/** The list as the site admin reads it: who asked, and for what. */
export function reportResourceRequests(
  rows: ResourceRequestRow[],
  limit = 100,
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.resource, (counts.get(row.resource) ?? 0) + 1);
  }
  return {
    people: new Set(rows.map((row) => row.email)).size,
    byResource: [...counts]
      .map(([resource, requests]) => ({ resource, requests }))
      .sort(
        (a, b) =>
          b.requests - a.requests || a.resource.localeCompare(b.resource),
      ),
    recent: rows.slice(0, limit).map((row) => ({
      email: row.email,
      resource: row.resource,
      requestedAt: row.requestedAt,
      unsubscribed: row.unsubscribed,
    })),
  };
}

let store: ResourceRequestStore | null = null;

export function resourceRequestStore(): ResourceRequestStore {
  store ??= new ResourceRequestStore();
  return store;
}

/** `/templates/hand-hygiene-policy` → "Hand hygiene policy". */
export function resourceName(resource: string): string {
  const words = resource.split("/").at(-1)!.replace(/-/g, " ");
  return words[0]!.toUpperCase() + words.slice(1);
}

/** Templates and manual indexes are Word files; a tool is its page. */
function hasWordFile(resource: string): boolean {
  return resource.startsWith("/templates/") || resource.startsWith("/manuals/");
}

/** Where the unsubscribe link in an email leads, and what one click POSTs to. */
export function resourceUnsubscribeUrl(token: string): string {
  return `${config.apiOrigin}/site/resource-requests/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** The one email this feature sends. */
export function resourceRequestEmail(
  resource: string,
  unsubscribeToken: string,
  siteOrigin: string = config.siteOrigin,
): EmailContent {
  const name = resourceName(resource);
  const page = `${siteOrigin}${resource}`;
  const word = hasWordFile(resource);
  return {
    subject: `${name}, from Bindersnap`,
    preview: word
      ? "The Word file you asked for, and the page it came from."
      : "The page you asked for.",
    heading: name,
    paragraphs: word
      ? [
          "Here is the Word file you asked for on bindersnap.com. Open it in Word and make it your own.",
          "The page it came from lists the rule behind each part, so you can check it before you adopt it.",
        ]
      : [
          "Here is the page you asked for on bindersnap.com. Every row links to the rule it comes from.",
        ],
    action: word
      ? { label: "Download the Word file", url: `${page}.docx` }
      : { label: "Open the page", url: page },
    footnotes: [
      ...(word ? [`The page it came from: ${page}`] : []),
      "I'm David, and I build Bindersnap. If this was useful, or wrong, tell me at david@bindersnap.com. I read every one.",
    ],
    optOut: {
      reason:
        "You got this because you asked for it on bindersnap.com. We may write again about the rules behind it or about Bindersnap.",
      unsubscribeUrl: resourceUnsubscribeUrl(unsubscribeToken),
    },
  };
}

/** One email per address, page and day, however often the form is sent. */
export function resourceRequestEmailKey(
  email: string,
  resource: string,
  now = Date.now(),
): string {
  return `resource-request:${email.trim().toLowerCase()}:${resource}:${new Date(now).toISOString().slice(0, 10)}`;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * The unsubscribe page, served by the API itself: these readers have no
 * account, so the app's unsubscribe page is not theirs. Literal colours, the
 * tokens' own values, as in `mail/layout.ts`.
 *
 * `ask` shows a button and not an automatic unsubscribe, because mail
 * scanners open links to check them.
 */
export function unsubscribePage(
  state: "ask" | "done",
  token: string,
  siteOrigin: string = config.siteOrigin,
): string {
  const body =
    state === "ask"
      ? `<h1>Stop emails from Bindersnap?</h1>
<p>You asked for a page from bindersnap.com by email. Press the button and we won't write to this address again.</p>
<form method="post" action="/site/resource-requests/unsubscribe?token=${escapeHtml(encodeURIComponent(token))}"><button type="submit">Unsubscribe</button></form>`
      : `<h1>You're unsubscribed.</h1>
<p>We won't write to this address again. If you ask for another page by email, we'll send that one.</p>
<p><a href="${escapeHtml(siteOrigin)}/">Back to bindersnap.com</a></p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Unsubscribe | Bindersnap</title>
<style>
body{margin:0;padding:48px 16px;background:#fafaf7;color:#1c1917;font:16px/1.55 -apple-system,"Segoe UI",system-ui,Roboto,Arial,sans-serif}
main{max-width:480px;margin:0 auto;padding:28px 24px;background:#fff;border:1px solid #e7e5e4;border-radius:8px}
h1{margin:0 0 16px;font:600 22px/1.3 Georgia,"Times New Roman",serif}
p{margin:0 0 16px}
button{padding:10px 20px;border:0;border-radius:6px;background:#e85d26;color:#1c1917;font:500 15px/1.2 inherit;cursor:pointer}
a{color:#c94d1a}
</style>
</head>
<body><main>
${body}
</main></body>
</html>
`;
}

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  // The page has its own styles and one form that posts back here.
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ResourceRequestDeps {
  store: ResourceRequestStore;
  /** True when this sender has posted too often. */
  limited: (clientIp: string) => boolean;
  send: (params: {
    to: string;
    content: EmailContent;
    idempotencyKey: string;
    oneClickUnsubscribeUrl: string;
  }) => void;
  siteOrigin: string;
  now?: () => number;
}

/**
 * `POST /site/resource-requests`, from the form on a site page.
 *
 * Always answers by sending the browser back to the page it came from: to
 * `#sent` when the request was taken, `#send-again` when it could not be. The
 * page shows the matching line with `:target`, so it needs no script. A full
 * honeypot field or an address already sent its share today also lands on
 * `#sent`, so neither a bot nor someone probing an address learns anything.
 */
export async function handleResourceRequest(
  req: Request,
  clientIp: string,
  deps: ResourceRequestDeps,
): Promise<Response> {
  const home = `${deps.siteOrigin}/`;
  if (Number(req.headers.get("content-length") ?? "0") > 4096) {
    return seeOther(home);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return seeOther(home);
  }
  const resource = form.get("resource");
  if (!isRequestableResource(resource)) return seeOther(home);
  const page = `${deps.siteOrigin}${resource}`;

  if (deps.limited(clientIp)) return seeOther(`${page}#send-again`);
  // A field people never see, and bots fill in.
  if (String(form.get("website") ?? "") !== "") return seeOther(`${page}#sent`);

  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return seeOther(`${page}#send-again`);
  }

  const now = deps.now?.() ?? Date.now();
  const { send, unsubscribeToken } = deps.store.record(email, resource, now);
  if (send) {
    deps.send({
      to: email,
      content: resourceRequestEmail(
        resource,
        unsubscribeToken,
        deps.siteOrigin,
      ),
      idempotencyKey: resourceRequestEmailKey(email, resource, now),
      oneClickUnsubscribeUrl: resourceUnsubscribeUrl(unsubscribeToken),
    });
  }
  return seeOther(`${page}#sent`);
}

/**
 * `GET` and `POST /site/resource-requests/unsubscribe?token=…`.
 *
 * GET shows the button. POST stops the emails: it is what the button sends,
 * and what a mail client's own unsubscribe button sends with no Origin
 * (RFC 8058). The same page for a token that matches nobody, so tokens cannot
 * be probed.
 */
export function handleResourceUnsubscribe(
  req: Request,
  deps: Pick<ResourceRequestDeps, "store" | "siteOrigin">,
): { response: Response; email: string | null } {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (req.method === "POST") {
    const email = deps.store.unsubscribe(token);
    return {
      response: new Response(unsubscribePage("done", token, deps.siteOrigin), {
        headers: HTML_HEADERS,
      }),
      email,
    };
  }
  return {
    response: new Response(unsubscribePage("ask", token, deps.siteOrigin), {
      headers: HTML_HEADERS,
    }),
    email: null,
  };
}
