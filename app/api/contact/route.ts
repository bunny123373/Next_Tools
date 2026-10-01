import { apiError, apiOk, parseJson, withErrorHandling } from "@/lib/api/respond";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/api/rate-limit";
import { contactSchema } from "@/lib/validations/schemas";
import { getStore, type ContactRecord } from "@/lib/storage";
import { contactMessage, sendMail } from "@/lib/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/contact — deliver a contact form submission.
 *
 * Where it goes depends on configuration:
 *   - Mail configured (`RESEND_API_KEY` + `MAIL_FROM`) → emailed to the operator.
 *   - `CONTACT_FORM_ENDPOINT` set  → forwarded to that service.
 *   - `TOOL_REQUESTS_ENDPOINT` set → stored in the same backend as tool requests.
 *   - None of the above             → held in memory, and the response says so.
 *
 * The client is always told which of these happened, because silently dropping
 * a contact message is worse than admitting we cannot deliver it yet.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const limit = rateLimit(request, { bucket: "contact", ...LIMITS.form });
  if (!limit.allowed) {
    return apiError("rate_limited", "Too many messages. Please try again shortly.", {
      headers: rateLimitHeaders(limit),
    });
  }

  const parsed = await parseJson(request, contactSchema, { maxBytes: 16 * 1024 });
  if (!parsed.ok) return parsed.response;

  const input = parsed.data;

  if (input.website) {
    // Honeypot. Report success, store nothing.
    return apiOk({ delivered: true, destination: "discarded" }, { status: 201 });
  }

  const record: ContactRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    message: input.message,
    ...(input.context ? { context: input.context } : {}),
    createdAt: new Date().toISOString(),
  };

  // Mail is a notification, not the system of record. The record is saved
  // either way, so a mail failure must not fail the submission — losing a
  // contact message because a provider was briefly down would be worse than
  // not hearing about it by email, since /admin still holds it.
  const mail = await sendMail({
    ...contactMessage(record),
    // Answering the sender by hitting reply is the whole point.
    replyTo: record.email,
  });

  try {
    const endpoint = process.env.CONTACT_FORM_ENDPOINT;
    if (endpoint) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.CONTACT_FORM_TOKEN
            ? { authorization: `Bearer ${process.env.CONTACT_FORM_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(record),
        cache: "no-store",
      });
      if (!response.ok) {
        console.error(`[api/contact] endpoint responded ${response.status}`);
        return apiError(
          "upstream_error",
          "We couldn't deliver your message right now. Please try again in a moment.",
        );
      }
    } else {
      await getStore().saveContact(record);
    }
  } catch (error) {
    console.error("[api/contact] delivery failed:", error);
    return apiError(
      "upstream_error",
      "We couldn't deliver your message right now. Please try again in a moment.",
    );
  }

  const stored = process.env.CONTACT_FORM_ENDPOINT
    ? "contact-endpoint"
    : process.env.TOOL_REQUESTS_ENDPOINT
      ? "tool-requests-store"
      : "memory";

  return apiOk(
    // `destination` says where the MESSAGE went, which is what the visitor
    // cares about. It used to be derived from the store alone, so a submission
    // that reached nobody by email still reported "delivered".
    {
      delivered: mail === "sent" || stored !== "memory",
      mail,
      destination: mail === "sent" ? "email" : stored,
    },
    {
      status: 201,
      headers: {
        ...rateLimitHeaders(limit),
        ...(mail === "sent" ? {} : { "x-storage": "ephemeral" }),
      },
    },
  );
});
