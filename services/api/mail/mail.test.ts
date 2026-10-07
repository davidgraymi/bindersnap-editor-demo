import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { escapeHtml, renderEmail } from "./layout";
import { EMAIL_MAX_ATTEMPTS, EmailOutbox, retryDelayMs } from "./outbox";
import { sendDue } from "./sender";
import {
  MailSendError,
  parseMailbox,
  type MailTransport,
  type OutgoingEmail,
} from "./transport";

function freshOutbox() {
  return new EmailOutbox(
    join(mkdtempSync(join(tmpdir(), "outbox-")), "outbox.db"),
  );
}

const email = {
  kind: "password-reset",
  recipient: "jordan@example.com",
  subject: "Reset your Bindersnap password",
  html: "<p>secret link</p>",
  text: "secret link",
};

function recordingTransport(
  behave: (email: OutgoingEmail) => string = () => "msg-1",
): MailTransport & { sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    name: "test",
    sent,
    async send(email) {
      const id = behave(email);
      sent.push(email);
      return id;
    },
  };
}

test("a queued email waits pending, due at once", () => {
  const outbox = freshOutbox();
  const queued = outbox.enqueue({ ...email, now: 1000 });
  expect(queued.status).toBe("pending");
  expect(outbox.due(1000).map((e) => e.id)).toEqual([queued.id]);
});

test("the same idempotency key queues one email, not two", () => {
  const outbox = freshOutbox();
  const first = outbox.enqueue({ ...email, idempotencyKey: "review:12:bob" });
  const again = outbox.enqueue({ ...email, idempotencyKey: "review:12:bob" });
  expect(again.id).toBe(first.id);
  expect(outbox.due()).toHaveLength(1);
  // Without a key, two emails are two emails.
  outbox.enqueue(email);
  outbox.enqueue(email);
  expect(outbox.due()).toHaveLength(3);
});

test("a sent email keeps who and when, and forgets its body", async () => {
  const outbox = freshOutbox();
  const queued = outbox.enqueue(email);
  const transport = recordingTransport();
  await sendDue({ outbox, transport, from: "Bindersnap <n@b.com>" });

  expect(transport.sent).toEqual([
    {
      from: "Bindersnap <n@b.com>",
      to: email.recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
    },
  ]);
  const after = outbox.get(queued.id)!;
  expect(after.status).toBe("sent");
  expect(after.providerMessageId).toBe("msg-1");
  expect(after.html).toBe("");
  expect(after.text).toBe("");
  expect(outbox.due()).toHaveLength(0);
});

test("a transient failure is tried again later, with backoff", async () => {
  const outbox = freshOutbox();
  const queued = outbox.enqueue({ ...email, now: 0 });
  const transport = recordingTransport(() => {
    throw new MailSendError("Throttling", false);
  });
  await sendDue({ outbox, transport, from: "x@y.z", now: () => 0 });

  const after = outbox.get(queued.id)!;
  expect(after.status).toBe("pending");
  expect(after.attempts).toBe(1);
  expect(after.lastError).toBe("Throttling");
  expect(after.nextAttemptAt).toBe(retryDelayMs(1));
  // Not due again until the delay has passed.
  expect(outbox.due(retryDelayMs(1) - 1)).toHaveLength(0);
  expect(outbox.due(retryDelayMs(1))).toHaveLength(1);
});

test("a permanent failure stops at once, body blanked", async () => {
  const outbox = freshOutbox();
  const queued = outbox.enqueue(email);
  const transport = recordingTransport(() => {
    throw new MailSendError("MessageRejected: bad address", true);
  });
  await sendDue({ outbox, transport, from: "x@y.z" });

  const after = outbox.get(queued.id)!;
  expect(after.status).toBe("failed");
  expect(after.html).toBe("");
});

test("an email stops in failed after its last try", () => {
  const outbox = freshOutbox();
  const queued = outbox.enqueue(email);
  for (let i = 1; i < EMAIL_MAX_ATTEMPTS; i++) {
    expect(outbox.markFailed(queued.id, "down", false).status).toBe("pending");
  }
  expect(outbox.markFailed(queued.id, "down", false).status).toBe("failed");
});

test("backoff doubles from a minute and caps at four hours", () => {
  expect(retryDelayMs(1)).toBe(60_000);
  expect(retryDelayMs(2)).toBe(120_000);
  expect(retryDelayMs(3)).toBe(240_000);
  expect(retryDelayMs(20)).toBe(4 * 60 * 60_000);
});

test("finished emails are forgotten after 30 days; pending ones never", async () => {
  const outbox = freshOutbox();
  const sent = outbox.enqueue({ ...email, now: 0 });
  const waiting = outbox.enqueue({ ...email, now: 0 });
  outbox.markSent(sent.id, "m", 0);
  outbox.prune(31 * 24 * 60 * 60_000);
  expect(outbox.get(sent.id)).toBeNull();
  expect(outbox.get(waiting.id)).not.toBeNull();
});

test("the layout escapes everything a person could have typed", () => {
  const rendered = renderEmail(
    {
      subject: "Review <Hand hygiene>",
      heading: `Jordan "JK" Kim asked you to review`,
      paragraphs: ["<script>alert(1)</script> & more"],
      action: { label: "Open the change", url: "https://b.com/a?x=1&y=2" },
      footnotes: ["You get this because you were asked."],
    },
    "https://bindersnap.com",
  );
  expect(rendered.html).not.toContain("<script>");
  expect(rendered.html).toContain(
    "&lt;script&gt;alert(1)&lt;/script&gt; &amp; more",
  );
  expect(rendered.html).toContain('href="https://b.com/a?x=1&amp;y=2"');
  expect(rendered.html).toContain("Jordan &quot;JK&quot; Kim");
  expect(rendered.html).toContain('href="https://bindersnap.com/"');
  expect(rendered.text).toContain("Open the change: https://b.com/a?x=1&y=2");
  expect(rendered.text).toContain("<script>alert(1)</script> & more");
  expect(rendered.subject).toBe("Review <Hand hygiene>");
});

test("escapeHtml covers quotes as well as angle brackets", () => {
  expect(escapeHtml(`<a href='x'>"&"</a>`)).toBe(
    "&lt;a href=&#39;x&#39;&gt;&quot;&amp;&quot;&lt;/a&gt;",
  );
});

test("a mailbox splits into name and address for Mailpit", () => {
  expect(parseMailbox("Bindersnap <notifications@bindersnap.com>")).toEqual({
    name: "Bindersnap",
    email: "notifications@bindersnap.com",
  });
  expect(parseMailbox("plain@example.com")).toEqual({
    name: "",
    email: "plain@example.com",
  });
});
