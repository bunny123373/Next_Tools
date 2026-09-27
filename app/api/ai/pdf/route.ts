/**
 * `POST /api/ai/pdf` — AI PDF Chat.
 *
 * Body: `{ fileName?, fileBase64? | text?, question, history? }`
 * Out: `{ ok: true, output, model, context, usage? }`
 *
 * Two ways to get a document in, and the response always says which was used:
 *
 *  - `text` — the browser ran pdf.js and sent the extracted text. The PDF never
 *    leaves the device, which is the path the workspace uses by default. The
 *    route cannot verify that the text really came from a PDF, so it reports
 *    `source: "client-extracted"` and the workspace labels it as such.
 *  - `fileBase64` — a `data:application/pdf;base64,…` URL. The route extracts
 *    the text itself with pdf.js (`./extract.ts`) and reports
 *    `source: "server-extracted"` together with the real page count. This is the
 *    path the workspace offers when in-browser extraction fails.
 *
 * Truncation is always declared. `context.characters` is what the model actually
 * saw, `context.totalCharacters` is what the document held, and
 * `context.truncated` is `true` when they differ. A chat that quietly drops half
 * a contract is worse than one that admits it.
 */

import { isAiConfigured, resolveProvider } from "@/lib/ai/provider";
import { AI_MAX_PDF_BODY_BYTES, AI_PDF_CONTEXT_CHARS, pdfRequestSchema } from "@/lib/ai/schemas";
import { PDF_CHAT_SYSTEM_PROMPT, buildDocumentBlock, buildPdfQuestionMessage } from "@/lib/ai/prompt";
import { NO_STORE, HttpError, guardRateLimit, handleAiFailure, readJsonBody } from "../lib/http";
import { extractPdfText } from "./extract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** A base64 PDF is large and the model call is not instant. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = guardRateLimit(request, "pdf");
    if (limited) return limited;

    // A 25 MB PDF is ~35 MB of base64, so this route's body ceiling is sized
    // from the encoded payload rather than the shared text-only default.
    const body = await readJsonBody(request, pdfRequestSchema, AI_MAX_PDF_BODY_BYTES);

    if (!isAiConfigured()) {
      throw new HttpError(
        "not_configured",
        "No AI provider is configured on this deployment. Set AI_API_KEY, AI_BASE_URL and AI_MODEL, then restart the server.",
      );
    }

    let documentText: string;
    let source: "server-extracted" | "client-extracted";
    let pageCount: number | null = null;

    if (body.fileBase64) {
      const extracted = await extractPdfText(body.fileBase64);
      documentText = extracted.text;
      pageCount = extracted.pageCount;
      source = "server-extracted";
    } else if (body.text) {
      documentText = body.text;
      source = "client-extracted";
    } else {
      // The schema's refine already guarantees one of the two, so this is
      // unreachable in practice; it exists so the types narrow.
      throw new HttpError("bad_request", "Attach a PDF before asking a question.");
    }

    const { block, characters, totalCharacters, truncated } = buildDocumentBlock(
      documentText,
      body.fileName,
      AI_PDF_CONTEXT_CHARS,
    );

    const provider = resolveProvider();
    const result = await provider.chat({
      system: PDF_CHAT_SYSTEM_PROMPT,
      prompt: buildPdfQuestionMessage(body.question, block),
      history: body.history,
      // A grounded question does not need a creative model.
      temperature: 0.1,
    });

    return Response.json(
      {
        ok: true as const,
        output: result.text,
        model: result.model,
        context: { source, characters, totalCharacters, truncated, pageCount },
        usage: result.usage,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    return handleAiFailure(error, "pdf");
  }
}
