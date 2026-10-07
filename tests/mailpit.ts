/**
 * Read back the email the stack sent.
 *
 * The API sends every Bindersnap email (services/api/mail), and locally it
 * delivers to Mailpit (docker-compose.yml). Mailpit keeps every message and
 * answers a small JSON API, so a test can do what a person does: open the
 * email, follow the link.
 */

import { expect } from "@playwright/test";

import { API_BASE_URL, APP_BASE_URL } from "./helpers";

export const MAILPIT_URL = `http://localhost:${process.env.MAILPIT_PORT ?? "8025"}`;

export interface Email {
  id: string;
  subject: string;
  from: string;
  to: string[];
  html: string;
  text: string;
  /** Every `href` in the HTML body, in order. */
  links: string[];
  /** The message's headers, first value of each. */
  headers: Record<string, string>;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
  Created: string;
  To: { Address: string }[];
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Name: string; Address: string };
  To: { Address: string }[];
  HTML: string;
  Text: string;
}

async function search(to: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const response = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${query}&limit=50`,
  );
  if (!response.ok) {
    throw new Error(`Mailpit search failed: ${response.status}`);
  }
  const body = (await response.json()) as { messages?: MailpitSummary[] };
  return body.messages ?? [];
}

async function read(id: string): Promise<Email> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!response.ok) {
    throw new Error(`Mailpit read failed: ${response.status}`);
  }
  const message = (await response.json()) as MailpitMessage;
  const headerResponse = await fetch(
    `${MAILPIT_URL}/api/v1/message/${id}/headers`,
  );
  const rawHeaders = headerResponse.ok
    ? ((await headerResponse.json()) as Record<string, string[]>)
    : {};
  const headers = Object.fromEntries(
    Object.entries(rawHeaders).map(([name, values]) => [name, values[0] ?? ""]),
  );
  const links = [...message.HTML.matchAll(/href="([^"]+)"/g)].map((m) =>
    m[1]!.replaceAll("&amp;", "&"),
  );
  return {
    id: message.ID,
    subject: message.Subject,
    from: message.From.Name
      ? `${message.From.Name} <${message.From.Address}>`
      : message.From.Address,
    to: message.To.map((t) => t.Address),
    html: message.HTML,
    text: message.Text,
    links,
    headers,
  };
}

/**
 * The newest email to `to` whose subject matches, waiting for it to arrive.
 * The API sends from its outbox, so a message lands a moment after the action.
 */
export async function waitForEmail(
  to: string,
  subject: RegExp,
  { timeout = 20_000 }: { timeout?: number } = {},
): Promise<Email> {
  let found: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        found = (await search(to)).find((m) => subject.test(m.Subject));
        return Boolean(found);
      },
      { timeout, message: `an email to ${to} matching ${subject}` },
    )
    .toBe(true);
  return read(found!.ID);
}

/** How many emails `to` has received so far. */
export async function countEmails(to: string): Promise<number> {
  return (await search(to)).length;
}

/**
 * Confirm a new account's email the way its owner would: open the link in the
 * email signup sent. Until then the API refuses the app's routes.
 */
export async function confirmEmail(session: string): Promise<void> {
  const me = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Cookie: `bindersnap_session=${session}` },
  });
  const pending = ((await me.json()) as { user?: { pendingEmail?: string } })
    .user?.pendingEmail;
  if (!pending) return;
  const email = await waitForEmail(pending, /^Confirm your email/);
  const link = email.links.find((href) => href.includes("/-/verify_email?"));
  const token = new URL(link!).searchParams.get("token");
  const response = await fetch(`${API_BASE_URL}/auth/email/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP_BASE_URL },
    body: JSON.stringify({ token }),
  });
  expect(response.status, await response.text()).toBe(200);
}

/**
 * `fetch` for `POST /auth/signup` that also confirms the new account's email,
 * for the specs that need a working account rather than a signup. The answer
 * is the signup's own, unread.
 */
export async function signUpAndConfirm(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== 200) return response;
  const session = (response.headers.get("set-cookie") ?? "").match(
    /bindersnap_session=([^;]+)/,
  )?.[1];
  if (session) await confirmEmail(session);
  return response;
}
