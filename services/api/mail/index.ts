import { config } from "../config";
import { logger } from "../logger";
import { renderEmail, type EmailContent } from "./layout";
import { emailOutboxStore, type QueuedEmail } from "./outbox";
import { startMailSender } from "./sender";
import {
  mailpitTransport,
  sesTransport,
  type MailTransport,
} from "./transport";

/**
 * The API's email, end to end (issue #665).
 *
 * A feature calls `queueEmail` with what it has to say. The email is rendered
 * in Bindersnap's layout, written to the outbox in SQLite, and sent in the
 * background — through Amazon SES in production, Mailpit locally. Queuing
 * never throws for a delivery problem, so an email can never fail the action
 * that caused it.
 */

let wakeSender: (() => void) | null = null;

export function mailTransportFromConfig(): MailTransport | null {
  switch (config.mailTransport) {
    case "ses":
      return sesTransport(config.awsRegion);
    case "mailpit":
      return mailpitTransport(config.mailpitUrl);
    case "off":
      return null;
  }
}

/** Start delivering. Called once, at boot. With mail off, emails just wait. */
export function startMail(): void {
  const transport = mailTransportFromConfig();
  if (!transport) {
    logger.warn(
      "Mail is off (BINDERSNAP_MAIL_TRANSPORT=off): emails are queued, not sent",
    );
    return;
  }
  const sender = startMailSender({
    outbox: emailOutboxStore(),
    transport,
    from: config.mailFrom,
  });
  wakeSender = sender.wake;
  logger.info("Mail sender started", {
    transport: transport.name,
    from: config.mailFrom,
  });
}

export function queueEmail(params: {
  kind: string;
  to: string;
  content: EmailContent;
  idempotencyKey?: string;
}): QueuedEmail {
  const rendered = renderEmail(params.content, config.appOrigin);
  const queued = emailOutboxStore().enqueue({
    kind: params.kind,
    recipient: params.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: params.idempotencyKey ?? null,
  });
  wakeSender?.();
  return queued;
}

export type { EmailContent } from "./layout";
