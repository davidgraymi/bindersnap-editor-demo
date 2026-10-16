import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Where an email goes once the outbox lets it out.
 *
 * Production hands it to Amazon SES with the EC2 instance role's own
 * credentials (infra/email), so no mail password exists anywhere. The local
 * stack hands it to Mailpit, which keeps it to be looked at. Unit tests and a
 * stack with mail switched off use neither.
 */

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface MailTransport {
  readonly name: string;
  /** Resolves with the provider's message id. Throws `MailSendError`. */
  send(email: OutgoingEmail): Promise<string>;
}

/**
 * A failed send, and whether trying again could help. SES refusing the
 * message itself (a malformed address) is permanent; throttling, an outage or
 * a not-yet-verified domain are not.
 */
export class MailSendError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "MailSendError";
  }
}

const PERMANENT_SES_ERRORS = new Set([
  "MessageRejected",
  "BadRequestException",
  "InvalidParameterValue",
]);

export function sesTransport(region: string): MailTransport {
  const client = new SESv2Client({ region });
  return {
    name: "ses",
    async send(email) {
      try {
        const result = await client.send(
          new SendEmailCommand({
            FromEmailAddress: email.from,
            Destination: { ToAddresses: [email.to] },
            Content: {
              Simple: {
                Subject: { Data: email.subject, Charset: "UTF-8" },
                Body: {
                  Html: { Data: email.html, Charset: "UTF-8" },
                  Text: { Data: email.text, Charset: "UTF-8" },
                },
                Headers: Object.entries(email.headers ?? {}).map(
                  ([Name, Value]) => ({ Name, Value }),
                ),
              },
            },
          }),
        );
        return result.MessageId ?? "";
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        const message = err instanceof Error ? err.message : String(err);
        throw new MailSendError(
          `${name || "SES"}: ${message}`,
          PERMANENT_SES_ERRORS.has(name),
        );
      }
    },
  };
}

/** Splits `Name <address>` for Mailpit's API, which wants the parts. */
export function parseMailbox(value: string): { name: string; email: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { name: "", email: value.trim() };
  return { name: match[1]!.replace(/^"|"$/g, ""), email: match[2]!.trim() };
}

export function mailpitTransport(baseUrl: string): MailTransport {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/send`;
  return {
    name: "mailpit",
    async send(email) {
      const from = parseMailbox(email.from);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: from.email, Name: from.name },
          To: [{ Email: email.to }],
          Subject: email.subject,
          HTML: email.html,
          Text: email.text,
          Headers: email.headers ?? {},
        }),
      }).catch((err: unknown) => {
        throw new MailSendError(
          `Mailpit unreachable: ${err instanceof Error ? err.message : String(err)}`,
          false,
        );
      });
      if (!response.ok) {
        throw new MailSendError(
          `Mailpit answered ${response.status}: ${await response.text()}`,
          response.status >= 400 && response.status < 500,
        );
      }
      const body = (await response.json().catch(() => ({}))) as { ID?: string };
      return body.ID ?? "";
    },
  };
}
