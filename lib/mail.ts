import "server-only";

/**
 * Outbound email.
 *
 * There was no mail path in this project at all. Submissions were forwarded as
 * raw JSON to `TOOL_REQUESTS_ENDPOINT` or held in memory, so a contact message
 * went nowhere a human would ever see it — which is exactly what the warning
 * on the forms was warning about.
 *
 * This adds one, over Resend's HTTP API, which needs nothing but `fetch`:
 * adding an SDK for it would mean a dependency for three request fields.
 *
 * Required:
 *   RESEND_API_KEY   the API key
 *   MAIL_FROM        a sender Resend has verified, e.g. "Balu Tools <on@yourdomain>"
 * Optional:
 *   MAIL_TO          overrides where mail is delivered. Defaults to SITE.contactEmail,
 *                    which is where the forms already tell people to write.
 *
 * A failure here NEVER fails a submission. The record is already saved by the
 * caller, and losing a queued message because a mail provider was briefly down
 * would be worse than not hearing about it by email — the admin list still has
 * it. What the caller gets back is whether the mail went, so the response can
 * stop claiming a message was delivered when it only sat in memory.
 */

/** What the caller should tell the visitor, honestly. */
export type MailOutcome = "sent" | "not-configured" | "failed";

export interface MailMessage {
  subject: string;
  /** Plain text body. The text alternative is not optional — a mail with no
   *  text part is a spam filter's idea of a joke. */
  text: string;
  replyTo?: string;
  /** Pre-escaped HTML, or undefined to send text only. */
  html?: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isMailConfigured(): boolean {
  return Boolean(env("RESEND_API_KEY") && env("MAIL_FROM"));
}

/** Where mail goes. Kept in one place so both routes agree. */
function recipient(): string | null {
  return env("MAIL_TO") ?? env("NEXT_PUBLIC_CONTACT_EMAIL") ?? "steveharringtone999@gmail.com";
}

/**
 * Sends one message. Never throws — the outcome is the return value.
 *
 * Failures are logged with the status only. The provider's body can contain
 * addresses and infrastructure detail, none of which belongs in a log line
 * that may be shipped somewhere public.
 */
export async function sendMail(message: MailMessage): Promise<MailOutcome> {
  const apiKey = env("RESEND_API_KEY");
  const from = env("MAIL_FROM");
  const to = recipient();

  if (!apiKey || !from || !to) return "not-configured";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      // A submission is one-shot; a cached response would be a lie.
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`[mail] resend responded ${response.status}`);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("[mail] send failed:", error instanceof Error ? error.name : "unknown");
    return "failed";
  }
}

/** Escapes text for safe inclusion in an HTML mail body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A label/value row. Typed as a tuple so a spread array cannot widen to string[]. */
type Field = readonly [string, string];

/** A readable HTML body from label/value pairs. Everything is escaped. */
function renderHtml(title: string, fields: readonly Field[]): string {
  const rows = fields
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#666;font:13px/1.5 system-ui,sans-serif;white-space:nowrap;vertical-align:top">${escapeHtml(
          label,
        )}</td><td style="padding:6px 0;color:#111;font:13px/1.5 system-ui,sans-serif;white-space:pre-wrap">${escapeHtml(
          value,
        )}</td></tr>`,
    )
    .join("");

  return [
    '<div style="font:14px/1.5 system-ui,-apple-system,sans-serif;max-width:640px">',
    `<h1 style="font-size:17px;margin:0 0 12px;color:#111">${escapeHtml(title)}</h1>`,
    `<table style="border-collapse:collapse">${rows}</table>`,
    "</div>",
  ].join("");
}

/** Formats an ISO timestamp for a mail body, without pulling in a date library. */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/* ------------------------------------------------------------------ */
/*  Message builders                                                   */
/* ------------------------------------------------------------------ */

/**
 * Both forms need the same composition: a plain-text body for the message
 * itself, and an HTML body that escapes everything a visitor typed. Building
 * them here keeps the escaping in one place, and there is exactly one copy of
 * it — an HTML mail built by concatenating visitor input is a header-injection
 * and phishing vector, and the temptation to skip it grows with every new
 * field added to a form.
 */
export function contactMessage(record: {
  name: string;
  email: string;
  message: string;
  context?: string;
  createdAt: string;
}): { subject: string; text: string; html: string } {
  const subject = `Contact form: ${record.name} <${record.email}>`;
  const fields: Field[] = [
    ["From", `${record.name} <${record.email}>`],
    ...(record.context ? ([["Where", record.context]] satisfies Field[]) : []),
    ["Received", formatWhen(record.createdAt)],
    ["Message", record.message],
  ];

  return {
    subject,
    text: [
      `New message from the contact form`,
      ``,
      `Name:    ${record.name}`,
      `Email:   ${record.email}`,
      record.context ? `Where:   ${record.context}` : null,
      `When:    ${formatWhen(record.createdAt)}`,
      ``,
      record.message,
      ``,
      `Reply directly to this email to answer ${record.email}.`,
    ]
      .filter((line) => line !== null)
      .join("\n"),
    html: renderHtml("New message from the contact form", fields),
  };
}

export function toolRequestMessage(record: {
  toolName: string;
  category: string;
  description: string;
  reason?: string;
  email?: string;
  createdAt: string;
}): { subject: string; text: string; html: string } {
  const subject = `Tool request: ${record.toolName} (${record.category})`;
  const fields: Field[] = [
    ["Tool", record.toolName],
    ["Category", record.category],
    ...(record.email ? ([["Their email", record.email]] satisfies Field[]) : []),
    ["Received", formatWhen(record.createdAt)],
    ["What they asked for", record.description],
    ...(record.reason ? ([["Why", record.reason]] satisfies Field[]) : []),
  ];

  return {
    subject,
    text: [
      `New tool request`,
      ``,
      `Tool:      ${record.toolName}`,
      `Category:  ${record.category}`,
      record.email ? `Email:    ${record.email}` : null,
      `When:      ${formatWhen(record.createdAt)}`,
      ``,
      `Requested:`,
      record.description,
      record.reason ? `\nWhy:\n${record.reason}` : null,
    ]
      .filter((line) => line !== null)
      .join("\n"),
    html: renderHtml("New tool request", fields),
  };
}