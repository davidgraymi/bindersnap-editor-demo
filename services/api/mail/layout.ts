/**
 * Every Bindersnap email, laid out once.
 *
 * A feature describes what it has to say — a heading, a few paragraphs, the
 * one thing to click — and gets back the HTML and the plain text. Nothing a
 * person typed reaches the HTML unescaped: a binder or a person can be called
 * anything.
 *
 * Literal colours, not the --brand-* tokens, because mail clients drop custom
 * properties. The values are the tokens' own (packages/ui-tokens): paper
 * background, ink text, and the landing CTA — coral fill, ink label, since
 * white on coral fails contrast (AGENTS.md).
 */

export interface EmailContent {
  /** Subject line. Plain text. */
  subject: string;
  /** The first line a mail client previews. Plain text. */
  preview?: string;
  heading: string;
  /** Plain-text paragraphs, escaped on the way into HTML. */
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Small print under the action — why they got this, how long a link lasts. */
  footnotes?: string[];
  /**
   * For an email a person can choose not to get: why they got it, and links
   * to their settings and to stop it. A reset link has none — it is not
   * optional.
   */
  optOut?: { reason: string; settingsUrl: string; unsubscribeUrl: string };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const INK = "#1c1917";
const MUTED = "#78716c";
const PAPER = "#fafaf7";
const CARD = "#ffffff";
const RULE = "#e7e5e4";
const CORAL = "#e85d26";
const CORAL_DARK = "#c94d1a";
const SANS =
  "Geist, -apple-system, 'Segoe UI', system-ui, Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Lora, Georgia, 'Times New Roman', serif";

export function renderEmail(
  content: EmailContent,
  appOrigin: string,
): RenderedEmail {
  const home = `${appOrigin.replace(/\/+$/, "")}/`;
  const paragraphs = content.paragraphs
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; font-family: ${SANS}; font-size: 15px; line-height: 1.55; color: ${INK};">${escapeHtml(p)}</p>`,
    )
    .join("\n");
  const action = content.action
    ? `<p style="margin: 24px 0;"><a href="${escapeHtml(content.action.url)}" style="display: inline-block; padding: 10px 20px; border-radius: 6px; background: ${CORAL}; color: ${INK}; font-family: ${SANS}; font-size: 15px; font-weight: 500; text-decoration: none;">${escapeHtml(content.action.label)}</a></p>
<p style="margin: 0 0 16px; font-family: ${SANS}; font-size: 13px; line-height: 1.5; color: ${MUTED}; word-break: break-all;">If the button does not work, paste this into your browser:<br><a href="${escapeHtml(content.action.url)}" style="color: ${CORAL_DARK};">${escapeHtml(content.action.url)}</a></p>`
    : "";
  const footnotes = (content.footnotes ?? [])
    .map(
      (note) =>
        `<p style="margin: 0 0 8px; font-family: ${SANS}; font-size: 13px; line-height: 1.5; color: ${MUTED};">${escapeHtml(note)}</p>`,
    )
    .join("\n");
  const optOut = content.optOut
    ? `${escapeHtml(content.optOut.reason)} <a href="${escapeHtml(content.optOut.settingsUrl)}" style="color: ${MUTED};">Email settings</a> · <a href="${escapeHtml(content.optOut.unsubscribeUrl)}" style="color: ${MUTED};">Unsubscribe</a><br><br>`
    : "";
  const preview = content.preview
    ? `<div style="display: none; max-height: 0; overflow: hidden;">${escapeHtml(content.preview)}</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${PAPER};">
${preview}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${PAPER};">
<tr><td align="center" style="padding: 32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px;">
<tr><td style="padding: 0 0 20px;"><a href="${escapeHtml(home)}" style="font-family: ${SERIF}; font-size: 20px; font-weight: 600; color: ${INK}; text-decoration: none;">Bindersnap</a></td></tr>
<tr><td style="background: ${CARD}; border: 1px solid ${RULE}; border-radius: 8px; padding: 28px 24px;">
<h1 style="margin: 0 0 16px; font-family: ${SERIF}; font-size: 22px; line-height: 1.3; font-weight: 600; color: ${INK};">${escapeHtml(content.heading)}</h1>
${paragraphs}
${action}
${footnotes}
</td></tr>
<tr><td style="padding: 16px 4px 0; font-family: ${SANS}; font-size: 12px; line-height: 1.5; color: ${MUTED};">${optOut}Sent by <a href="${escapeHtml(home)}" style="color: ${MUTED};">Bindersnap</a>, where your organization keeps its documents and their approvals.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  const text = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...(content.action
      ? [`${content.action.label}: ${content.action.url}`, ""]
      : []),
    ...(content.footnotes ?? []).flatMap((note) => [note, ""]),
    "—",
    ...(content.optOut
      ? [
          content.optOut.reason,
          `Email settings: ${content.optOut.settingsUrl}`,
          `Unsubscribe: ${content.optOut.unsubscribeUrl}`,
          "",
        ]
      : []),
    `Bindersnap · ${home}`,
    "",
  ].join("\n");

  return { subject: content.subject, html, text };
}
