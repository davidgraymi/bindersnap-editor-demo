/**
 * Read back the email the stack sent.
 *
 * The API sends every Bindersnap email (services/api/mail), and locally it
 * delivers to Mailpit (docker-compose.yml). Mailpit keeps every message and
 * answers a small JSON API, so a test can do what a person does: open the
 * email, follow the link.
 */

import { expect } from "@playwright/test";

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
