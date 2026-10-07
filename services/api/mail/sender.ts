import { logger } from "../logger";
import type { EmailOutbox } from "./outbox";
import { MailSendError, type MailTransport } from "./transport";

/**
 * Delivers the outbox.
 *
 * One pass every so often, and one right away whenever something is queued
 * (`wake`), so a reset email arrives in seconds rather than at the next tick.
 * Passes never overlap, and there is one API process (ADR 0003), so a row is
 * never sent twice by two senders.
 */
export function startMailSender(params: {
  outbox: EmailOutbox;
  transport: MailTransport;
  from: string;
  intervalMs?: number;
}): { wake: () => void; stop: () => void } {
  const { outbox, transport, from, intervalMs = 30_000 } = params;
  let busy = false;
  let again = false;

  const pass = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await sendDue({ outbox, transport, from });
      } while (again);
      outbox.prune();
    } catch (err) {
      logger.error("The mail sender could not read its outbox", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busy = false;
    }
  };

  void pass();
  const timer = setInterval(() => void pass(), intervalMs);
  return {
    wake: () => void pass(),
    stop: () => clearInterval(timer),
  };
}

/** One pass: send every email that is due. Exported for tests. */
export async function sendDue(params: {
  outbox: EmailOutbox;
  transport: MailTransport;
  from: string;
  now?: () => number;
}): Promise<void> {
  const { outbox, transport, from } = params;
  const now = params.now ?? Date.now;
  for (const email of outbox.due(now())) {
    try {
      const messageId = await transport.send({
        from,
        to: email.recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      outbox.markSent(email.id, messageId, now());
      logger.info("Email sent", {
        id: email.id,
        kind: email.kind,
        transport: transport.name,
      });
    } catch (err) {
      const permanent = err instanceof MailSendError && err.permanent;
      const message = err instanceof Error ? err.message : String(err);
      const after = outbox.markFailed(email.id, message, permanent, now());
      const log = after.status === "failed" ? logger.error : logger.warn;
      log("Email not sent", {
        id: email.id,
        kind: email.kind,
        attempts: after.attempts,
        willRetry: after.status === "pending",
        error: message,
      });
    }
  }
}
