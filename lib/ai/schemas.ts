/**
 * Shared request/response contracts for every AI route.
 *
 * This module is imported by BOTH the server route handlers and the client
 * workspaces, so it must stay free of `server-only`, of Node built-ins and of
 * any environment access. It describes *what a request may contain* and *what a
 * response looks like* — never how a request reaches the provider.
 *
 * Every option the UI can send is a closed enum (or a bounded string/number),
 * not free-form JSON. That is deliberate:
 *   1. a typo in a tool's control list is a TypeScript error, not a mystery;
 *   2. option values are interpolated into the model prompt, so they are
 *      validated rather than trusted — an unknown key is a 400, never prompt
 *      injection;
 *   3. the provider layer stays provider-agnostic: it receives a prompt string
 *      plus a few well-known knobs, not a bag of arbitrary JSON.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Tasks                                                              */
/* ------------------------------------------------------------------ */

/** Text tasks — POST /api/ai/chat. */
export const AI_TEXT_TASKS = [
  "text-generator",
  "rewriter",
  "summarizer",
  "translator",
  "prompt-generator",
] as const;
export type AiTextTask = (typeof AI_TEXT_TASKS)[number];

/** Image-in / image-out tasks — POST /api/ai/image. */
export const AI_IMAGE_TASKS = [
  "image-generator",
  "image-enhancer",
  "image-upscaler",
  "background-remover",
  "background-generator",
] as const;
export type AiImageTask = (typeof AI_IMAGE_TASKS)[number];

/** Image-in / text-out tasks — POST /api/ai/vision. */
export const AI_VISION_TASKS = ["image-analyzer"] as const;
export type AiVisionTask = (typeof AI_VISION_TASKS)[number];

export type AiTask = AiTextTask | AiImageTask | AiVisionTask;

/** Image tasks that transform an uploaded image instead of generating one. */
export const AI_IMAGE_EDIT_TASKS = [
  "image-enhancer",
  "image-upscaler",
  "background-remover",
] as const;
export type AiImageEditTask = (typeof AI_IMAGE_EDIT_TASKS)[number];

export function isImageEditTask(task: AiImageTask): task is AiImageEditTask {
  return (AI_IMAGE_EDIT_TASKS as readonly string[]).includes(task);
}

/* ------------------------------------------------------------------ */
/*  Option vocabularies                                               */
/* ------------------------------------------------------------------ */

export const AI_TONES = [
  "neutral",
  "friendly",
  "formal",
  "confident",
  "playful",
  "empathetic",
  "direct",
  "casual",
  "persuasive",
  "technical",
] as const;

export const AI_LENGTHS = ["shorter", "short", "medium", "long", "detailed"] as const;

/**
 * Output shape. The values are self-describing on purpose: the server turns a
 * value such as `bullet-list` into a written instruction for the model, so the
 * enum has to read unambiguously without any client-side label.
 */
export const AI_FORMATS = [
  "plain-text",
  "markdown",
  "bullet-list",
  "short-paragraphs",
  "prose",
  "business-email",
  "blog-post",
  "seo-meta",
  "step-by-step",
  "json-object",
  "image-prompt",
  "text-prompt",
  "agent-instruction",
] as const;

/** Visual style for the image-generating tasks. */
export const AI_IMAGE_STYLES = [
  "photographic",
  "illustration",
  "flat-vector",
  "3d-render",
  "watercolour",
  "line-art",
  "studio-backdrop",
  "abstract-gradient",
  "solid-colour",
  "pattern",
  "scene",
] as const;

/** What to do with the pixels behind the subject on background-remover. */
export const AI_BACKGROUND_HANDLING = [
  "keep-transparent",
  "replace-with-white",
  "replace-with-black",
] as const;

/** What AI Image Analyzer should return. */
export const AI_ANALYZER_READOUTS = [
  "describe",
  "detailed-description",
  "alt-text",
  "ocr-text",
  "object-list",
  "key-value",
] as const;

export const AI_SIZES = [
  "256x256",
  "512x512",
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "1792x1024",
] as const;

export const AI_DETAILS = ["low", "medium", "high"] as const;

export const AI_STRENGTHS = ["subtle", "moderate", "strong", "maximum"] as const;

export type AiTone = (typeof AI_TONES)[number];
export type AiLength = (typeof AI_LENGTHS)[number];
export type AiFormat = (typeof AI_FORMATS)[number];
export type AiImageStyle = (typeof AI_IMAGE_STYLES)[number];
export type AiSize = (typeof AI_SIZES)[number];
export type AiDetail = (typeof AI_DETAILS)[number];
export type AiStrength = (typeof AI_STRENGTHS)[number];

/* ------------------------------------------------------------------ */
/*  Option keys                                                        */
/* ------------------------------------------------------------------ */

/** Every key the `options` object may carry. */
export type AiOptionKey =
  | "tone"
  | "length"
  | "format"
  | "style"
  | "readout"
  | "backgroundHandling"
  | "size"
  | "detail"
  | "strength"
  | "creativity"
  | "keepStructure"
  | "language"
  | "audience"
  | "purpose"
  | "keywords"
  | "instructions";

/** Option keys whose value comes from a closed enum. */
export type AiChoiceKey = Exclude<
  AiOptionKey,
  "creativity" | "keepStructure" | "language" | "audience" | "purpose" | "keywords" | "instructions"
>;

/** Option keys whose value is short free text. */
export type AiTextKey = "language" | "audience" | "purpose" | "keywords" | "instructions";

/* ------------------------------------------------------------------ */
/*  Which options each task accepts                                    */
/* ------------------------------------------------------------------ */

/**
 * Option keys valid per task. Enforced on the server so a mis-wired workspace
 * fails loudly with a 400 instead of quietly sending a knob the prompt builder
 * would ignore.
 */
export const AI_TASK_OPTION_KEYS = {
  "text-generator": [
    "format",
    "tone",
    "length",
    "audience",
    "keywords",
    "creativity",
  ],
  rewriter: ["tone", "length", "creativity", "keepStructure", "format"],
  summarizer: ["length", "format", "purpose", "keepStructure"],
  translator: ["language", "tone", "keepStructure", "format"],
  "prompt-generator": ["format", "detail", "audience", "creativity"],
  "image-generator": ["size", "detail", "style", "creativity"],
  "image-enhancer": ["strength", "instructions"],
  "image-upscaler": ["size", "strength", "instructions"],
  "background-remover": ["backgroundHandling", "detail", "instructions"],
  "background-generator": ["size", "detail", "style", "creativity"],
  "image-analyzer": ["readout", "detail", "audience"],
} as const satisfies Record<AiTask, readonly AiOptionKey[]>;

/** Formats each text task actually understands. */
export const AI_TEXT_TASK_FORMATS = {
  "text-generator": [
    "plain-text",
    "markdown",
    "bullet-list",
    "short-paragraphs",
    "prose",
    "business-email",
    "blog-post",
    "seo-meta",
    "step-by-step",
  ],
  rewriter: ["plain-text", "markdown", "short-paragraphs", "bullet-list"],
  summarizer: ["bullet-list", "short-paragraphs", "prose", "plain-text", "markdown"],
  translator: ["plain-text", "markdown", "short-paragraphs"],
  "prompt-generator": ["image-prompt", "text-prompt", "agent-instruction", "step-by-step", "json-object"],
} as const satisfies Record<AiTextTask, readonly AiFormat[]>;

/* ------------------------------------------------------------------ */
/*  Limits                                                            */
/* ------------------------------------------------------------------ */

/** Hard ceiling on a single user prompt for a text task. */
export const AI_MAX_PROMPT_CHARS = 32_000;
/** Hard ceiling on a prompt for an image task (providers reject long prompts). */
export const AI_MAX_IMAGE_PROMPT_CHARS = 2_000;
/** Extra free-form instructions appended after the task system prompt. */
export const AI_MAX_SYSTEM_CHARS = 2_000;
/** Characters of a PDF we are willing to put in front of the model. */
export const AI_PDF_CONTEXT_CHARS = 24_000;
/**
 * Characters of extracted text we are willing to *upload* for one question.
 *
 * The route only ever uses the first `AI_PDF_CONTEXT_CHARS`, so sending a
 * five-megabyte text layer per question would cost bandwidth and time for
 * nothing. This is a transport ceiling, not a context limit, and the workspace
 * states it in the interface when a document is long enough to hit it.
 */
export const AI_PDF_TRANSPORT_CHARS = 120_000;
/** Hard ceiling on one question in a PDF chat turn. */
export const AI_MAX_QUESTION_CHARS = 2_000;
/** How many previous turns we replay into a PDF chat request. */
export const AI_PDF_HISTORY_TURNS = 6;
/** Budgets for the streaming conversational tool. */
export const AI_MAX_STREAM_MESSAGES = 40;
export const AI_MAX_TURN_CHARS = 8_000;
export const AI_MAX_STREAM_CHARS = 64_000;
/** Hard ceiling on the JSON body any AI route will parse. */
export const AI_MAX_BODY_BYTES = 512 * 1024;
/** Hard ceiling on a single decoded image, before base64 is re-encoded. */
export const AI_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Hard ceiling on a PDF uploaded for a chat. */
export const AI_MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Base64 inflates bytes by 4/3, so the body guard for the routes that accept an
 * upload has to be sized from the *encoded* payload, not the decoded one. Plus
 * a little slack for the JSON envelope around it.
 */
export const AI_MAX_IMAGE_BODY_BYTES = Math.ceil(AI_MAX_IMAGE_BYTES * 1.4) + 64 * 1024;
export const AI_MAX_PDF_BODY_BYTES = Math.ceil(AI_MAX_PDF_BYTES * 1.4) + 64 * 1024;

/** Only these image types are ever forwarded to a provider. */
export const AI_ALLOWED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type AiAllowedImageMime = (typeof AI_ALLOWED_IMAGE_MIME)[number];

/* ------------------------------------------------------------------ */
/*  Text hygiene                                                       */
/* ------------------------------------------------------------------ */

/**
 * Removes C0/C1 control characters and Unicode line/paragraph separators while
 * keeping `\n` and `\t`, which are meaningful inside a prompt. Called on every
 * free-text field before it is validated, stored or sent upstream, so a paste
 * full of terminal escapes cannot smuggle anything into a log line or a header.
 */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/g, "");
}

/** A non-empty, control-character-free string with a hard length ceiling. */
export const boundedText = (max: number, min = 1) =>
  z
    .string()
    .transform(stripControlCharacters)
    .pipe(z.string().trim().min(min).max(max));

/** Same, but optional: absent, empty and whitespace-only all become `undefined`. */
export const optionalBoundedText = (max: number) =>
  z
    .string()
    .transform(stripControlCharacters)
    .pipe(z.string().trim().max(max))
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional();

/** A non-empty, control-character-free string with a hard length ceiling. */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/* ------------------------------------------------------------------ */
/*  Options                                                            */
/* ------------------------------------------------------------------ */

export const aiOptionsSchema = z.strictObject({
  tone: z.enum(AI_TONES).optional(),
  length: z.enum(AI_LENGTHS).optional(),
  format: z.enum(AI_FORMATS).optional(),
  style: z.enum(AI_IMAGE_STYLES).optional(),
  readout: z.enum(AI_ANALYZER_READOUTS).optional(),
  backgroundHandling: z.enum(AI_BACKGROUND_HANDLING).optional(),
  size: z.enum(AI_SIZES).optional(),
  detail: z.enum(AI_DETAILS).optional(),
  strength: z.enum(AI_STRENGTHS).optional(),
  creativity: z.number().min(0).max(1).optional(),
  keepStructure: z.boolean().optional(),
  language: optionalBoundedText(40),
  audience: optionalBoundedText(80),
  purpose: optionalBoundedText(120),
  keywords: optionalBoundedText(200),
  instructions: optionalBoundedText(400),
});

export type AiOptions = z.infer<typeof aiOptionsSchema>;

/** Human-readable label for an option value, used in the written prompt. */
/**
 * Spoken labels for every option value, keyed by option then value.
 *
 * Keying by option matters: `medium` means one thing as a length and another as
 * a detail level, and the prompt builder has to say which. Values are written as
 * instructions rather than labels, because the model reads this text verbatim.
 */
const OPTION_LABELS = {
  tone: {
    neutral: "neutral and even-handed",
    friendly: "friendly and warm",
    formal: "formal and professional",
    confident: "confident and direct",
    playful: "playful with light humour",
    empathetic: "empathetic and supportive",
    direct: "direct and to the point",
    casual: "casual and conversational",
    persuasive: "persuasive and sales-ready",
    technical: "precise and technical",
  },
  length: {
    shorter: "noticeably shorter than the input",
    short: "short — roughly a quarter of the input length",
    medium: "medium length, comparable to the input",
    long: "longer than the input, adding useful detail",
    detailed: "as long as is useful, with thorough detail",
  },
  format: {
    "plain-text": "plain text with no markdown syntax",
    markdown: "GitHub-flavoured markdown, but no surrounding code fence",
    "bullet-list": "a flat markdown bullet list, no nested lists",
    "short-paragraphs": "short paragraphs of at most three sentences each",
    prose: "continuous prose with no headings or lists",
    "business-email": "a short business email with a subject line and a sign-off",
    "blog-post": "a blog post with a title and section headings",
    "seo-meta":
      "an SEO title under 60 characters, a meta description under 155 characters, and five keyword phrases",
    "step-by-step": "numbered steps, each one starting with an imperative verb",
    "json-object": "a single valid JSON object and nothing else",
    "image-prompt": "one image-generation prompt, written for a diffusion model",
    "text-prompt":
      "one reusable text-generation prompt, with the variable slots marked as [SQUARE_BRACKETS]",
    "agent-instruction":
      "a system prompt for an AI agent, with a role, constraints and an output contract",
  },
  style: {
    photographic: "photographic",
    illustration: "a clean digital illustration",
    "flat-vector": "flat vector art with solid fills and no gradients",
    "3d-render": "a 3D render with soft studio lighting",
    watercolour: "watercolour on paper",
    "line-art": "clean line art",
    "studio-backdrop": "a seamless studio backdrop",
    "abstract-gradient": "an abstract soft gradient",
    "solid-colour": "a flat single-colour background",
    pattern: "a repeating seamless pattern",
    scene: "a complete scene with depth and context",
  },
  backgroundHandling: {
    "keep-transparent": "keep the removed area fully transparent",
    "replace-with-white": "replace the removed area with pure white",
    "replace-with-black": "replace the removed area with pure black",
  },
  readout: {
    describe: "a short plain description of what is visible",
    "detailed-description":
      "a detailed description covering subject, setting, light, colours and composition",
    "alt-text": "alt text for accessibility, one sentence, describing only what is visible",
    "ocr-text": "every piece of text visible in the image, transcribed exactly, line by line",
    "object-list": "a list of the distinct objects or regions in the image, one per line",
    "key-value": "labelled fields on separate lines, in the form 'Label: value'",
  },
  detail: {
    low: "a low level of detail",
    medium: "a medium level of detail",
    high: "a high level of detail",
  },
  strength: {
    subtle: "a subtle change",
    moderate: "a moderate change",
    strong: "a strong change",
    maximum: "the strongest change the model can make",
  },
} as const;

/** The option keys that carry a label table. */
export type LabelledOptionKey = keyof typeof OPTION_LABELS;

/**
 * Spoken label for an option value, e.g. `format: "bullet-list"` becomes
 * "a flat markdown bullet list, no nested lists". Unknown values fall through
 * unchanged, which the schema would already have rejected.
 */
export function describeOptionValue<K extends LabelledOptionKey>(
  key: K,
  value: string,
): string {
  const table = OPTION_LABELS[key] as Readonly<Record<string, string>>;
  return table[value] ?? value;
}

/* ------------------------------------------------------------------ */
/*  Requests                                                           */
/* ------------------------------------------------------------------ */

export const chatRequestSchema = z
  .strictObject({
    task: z.enum(AI_TEXT_TASKS),
    /**
     * Extra instructions from the visitor. Appended *after* the task's own
     * system prompt — it can add requirements but it can never replace the
     * contract that makes the output safe and parseable.
     */
    system: optionalBoundedText(AI_MAX_SYSTEM_CHARS),
    prompt: boundedText(AI_MAX_PROMPT_CHARS),
    options: aiOptionsSchema.default({}),
  })
  .superRefine((value, ctx) => validateOptionsForTask(value.task, value.options, ctx));

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** A message in the transcript. `system` turns are added by the server, never sent. */
export const streamMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: boundedText(AI_MAX_TURN_CHARS),
});
export type StreamMessage = z.infer<typeof streamMessageSchema>;

/**
 * `POST /api/ai/chat/stream` — the conversational tool.
 *
 * The browser owns the transcript, so it resends the whole conversation each
 * turn. That makes it an attack surface the one-shot route is not: a visitor
 * could post an arbitrarily long "conversation". Hence the two hard budgets
 * below, checked *after* parsing so the error can name both at once.
 *
 * Note the cap is on the number of *messages*, not exchanges — a conversation
 * with `AI_MAX_STREAM_MESSAGES` messages holds half as many question/answer
 * pairs. Clients that budget on their own turn count will disagree with this
 * and send requests the server rejects.
 */
export const streamChatRequestSchema = z
  .strictObject({
    /** The live transcript, oldest first. Must start with a user message. */
    messages: z.array(streamMessageSchema).min(1).max(AI_MAX_STREAM_MESSAGES),
    /** Per-conversation persona. Appended after the server's own prompt. */
    system: optionalBoundedText(AI_MAX_SYSTEM_CHARS),
    /**
     * 0 = deterministic, 1 = inventive. Undefined leaves the model default,
     * which is the right choice for most conversations.
     */
    temperature: z.number().min(0).max(2).optional(),
  })
  .superRefine(validateStreamRequest);
export type StreamChatRequest = z.infer<typeof streamChatRequestSchema>;

/** Enforces the conversation budgets and the opening turn. */
function validateStreamRequest(
  value: { messages: readonly { role: string; content: string }[] },
  ctx: z.RefinementCtx,
): void {
  const total = value.messages.reduce((sum, turn) => sum + turn.content.length, 0);
  if (total > AI_MAX_STREAM_CHARS) {
    ctx.addIssue({
      code: "custom",
      path: ["messages"],
      message: `This conversation is ${Math.round(total / 1000)}k characters. The limit is ${Math.round(AI_MAX_STREAM_CHARS / 1000)}k — start a new chat to keep going.`,
    });
  }
  if (value.messages[0]?.role !== "user") {
    ctx.addIssue({
      code: "custom",
      path: ["messages"],
      message: "A conversation must start with your message.",
    });
  }
}

const imagePayloadSchema = z.strictObject({
  mime: z.enum(AI_ALLOWED_IMAGE_MIME),
  /** Raw base64 (no `data:` prefix). */
  base64: z.string().min(16).max(Math.ceil(AI_MAX_IMAGE_BYTES * 1.4)),
});

export const imageRequestSchema = z
  .strictObject({
    task: z.enum(AI_IMAGE_TASKS),
    prompt: boundedText(AI_MAX_IMAGE_PROMPT_CHARS),
    /** Required for the edit tasks, ignored by the generative ones. */
    image: imagePayloadSchema.optional(),
    options: aiOptionsSchema.default({}),
  })
  .superRefine((value, ctx) => {
    validateOptionsForTask(value.task, value.options, ctx);
    if (isImageEditTask(value.task) && !value.image) {
      ctx.addIssue({
        code: "custom",
        path: ["image"],
        message: "This tool needs an uploaded image to work on.",
      });
    }
    if (!isImageEditTask(value.task) && value.image) {
      ctx.addIssue({
        code: "custom",
        path: ["image"],
        message: "This task generates an image and does not take an upload.",
      });
    }
    if (value.image) {
      const bytes = base64ByteLength(value.image.base64);
      if (bytes > AI_MAX_IMAGE_BYTES) {
        ctx.addIssue({
          code: "custom",
          path: ["image", "base64"],
          message: `Images must be ${Math.round(AI_MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller.`,
        });
      }
    }
  });

export type ImageRequest = z.infer<typeof imageRequestSchema>;

export const visionRequestSchema = z
  .strictObject({
    task: z.enum(AI_VISION_TASKS),
    prompt: optionalBoundedText(AI_MAX_IMAGE_PROMPT_CHARS),
    image: imagePayloadSchema,
    options: aiOptionsSchema.default({}),
  })
  .superRefine((value, ctx) => {
    validateOptionsForTask(value.task, value.options, ctx);
    const bytes = base64ByteLength(value.image.base64);
    if (bytes > AI_MAX_IMAGE_BYTES) {
      ctx.addIssue({
        code: "custom",
        path: ["image", "base64"],
        message: `Images must be ${Math.round(AI_MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller.`,
      });
    }
  });

export type VisionRequest = z.infer<typeof visionRequestSchema>;

export const chatTurnSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: boundedText(AI_PDF_CONTEXT_CHARS),
});

export const pdfRequestSchema = z
  .strictObject({
    /** Display name only — used to label the context block. Never opened. */
    fileName: optionalBoundedText(160),
    /**
     * Either path, never both:
     *  - `fileBase64`: a `data:application/pdf;base64,…` URL. The route extracts
     *    the text itself with pdf.js and reports how much it kept.
     *  - `text`: text the browser already extracted with pdf.js, so the PDF
     *    itself never leaves the device. The route cannot verify it came from a
     *    PDF, so the response says which path was used.
     */
    fileBase64: z
      .string()
      .max(Math.ceil(AI_MAX_PDF_BYTES * 1.4))
      .regex(/^data:application\/pdf;base64,[A-Za-z0-9+/=\s]+$/i, "Expected a base64 PDF data URL")
      .optional(),
    text: optionalBoundedText(AI_PDF_TRANSPORT_CHARS),
    question: boundedText(AI_MAX_QUESTION_CHARS),
    history: z.array(chatTurnSchema).max(AI_PDF_HISTORY_TURNS).default([]),
  })
  .refine(
    (value) => Boolean(value.fileBase64) !== Boolean(value.text),
    { message: "Send either the PDF or the text extracted from it — not both." },
  )
  .refine((value) => Boolean(value.fileBase64 || value.text), {
    message: "Attach a PDF before asking a question.",
  });

export type PdfRequest = z.infer<typeof pdfRequestSchema>;

/** Rejects option keys (and `format` values) a task does not understand. */
function validateOptionsForTask(
  task: AiTask,
  options: AiOptions,
  ctx: z.RefinementCtx,
): void {
  const allowed = new Set<string>(AI_TASK_OPTION_KEYS[task]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      ctx.addIssue({
        code: "custom",
        path: ["options", key],
        message: `"${key}" is not a setting this tool uses.`,
      });
    }
  }

  if ("format" in options && options.format) {
    const formats = AI_TEXT_TASK_FORMATS[task as AiTextTask];
    if (formats && !(formats as readonly string[]).includes(options.format)) {
      ctx.addIssue({
        code: "custom",
        path: ["options", "format"],
        message: `"${options.format}" is not an output format this tool can produce.`,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Responses                                                          */
/* ------------------------------------------------------------------ */

export const AI_ERROR_CODES = [
  "not_configured",
  "rate_limited",
  "auth",
  "bad_request",
  "timeout",
  "upstream",
  "content_filtered",
  "network",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/**
 * The only wording a visitor ever sees for a failure. These strings are safe by
 * construction: no upstream body, no request echo, no key, no stack trace. The
 * routes send exactly this text, and the client reuses the same table when a
 * request never reached the server at all.
 */
export const AI_ERROR_MESSAGES: Readonly<Record<AiErrorCode, string>> = {
  not_configured:
    "The AI provider has not been configured on this deployment, so this tool cannot run yet. The page below lists the environment variables it needs.",
  rate_limited: "Too many requests from this device. Wait a few seconds and try again.",
  auth: "The AI provider rejected our credentials. This is a server configuration problem, not something you can fix in the browser.",
  bad_request: "The AI provider could not accept that request. Try rephrasing your input or changing an option.",
  timeout: "The AI provider took too long to answer and we gave up. Try again, or send a shorter input.",
  upstream: "The AI provider returned an error we could not interpret. This is usually temporary — try again in a moment.",
  content_filtered:
    "The AI provider refused to answer that. Its safety filter most likely triggered on the wording of your input.",
  network: "We could not reach the AI provider from the server. Check the provider URL and try again.",
};

/** HTTP status for each failure class. */
export const AI_ERROR_STATUS: Readonly<Record<AiErrorCode, number>> = {
  not_configured: 501,
  rate_limited: 429,
  auth: 502,
  bad_request: 400,
  timeout: 504,
  upstream: 502,
  content_filtered: 422,
  network: 502,
};

export const aiErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.enum(AI_ERROR_CODES),
    message: z.string().max(400),
  }),
});

export const aiUsageSchema = z.strictObject({
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const chatResponseSchema = z.strictObject({
  ok: z.literal(true),
  output: z.string(),
  model: z.string(),
  usage: aiUsageSchema.optional(),
});

export const imageResponseSchema = z.strictObject({
  ok: z.literal(true),
  image: z.strictObject({
    mime: z.string().max(80),
    base64: z.string(),
  }),
  model: z.string(),
  /** Providers may echo an expanded prompt; shown to the user when present. */
  revisedPrompt: z.string().max(2000).optional(),
});

export const visionResponseSchema = z.strictObject({
  ok: z.literal(true),
  output: z.string(),
  model: z.string(),
  usage: aiUsageSchema.optional(),
});

export const pdfContextSchema = z.strictObject({
  /** How the document text reached the model. */
  source: z.enum(["server-extracted", "client-extracted"]),
  /** Characters actually placed in front of the model. */
  characters: z.number().int().nonnegative(),
  /** Characters available before truncation. */
  totalCharacters: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /** Number of pages read, when the server did the extraction. */
  pageCount: z.number().int().nonnegative().nullable(),
});

export const pdfResponseSchema = z.strictObject({
  ok: z.literal(true),
  output: z.string(),
  model: z.string(),
  context: pdfContextSchema,
  usage: aiUsageSchema.optional(),
});

export const statusResponseSchema = z.strictObject({
  configured: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  imageModel: z.string().nullable(),
  features: z.strictObject({
    chat: z.boolean(),
    image: z.boolean(),
    edit: z.boolean(),
    vision: z.boolean(),
  }),
});

export type AiStatusResponse = z.infer<typeof statusResponseSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type ImageResponse = z.infer<typeof imageResponseSchema>;
export type VisionResponse = z.infer<typeof visionResponseSchema>;
export type PdfResponse = z.infer<typeof pdfResponseSchema>;
export type PdfContext = z.infer<typeof pdfContextSchema>;
export type AiUsage = z.infer<typeof aiUsageSchema>;
export type AiErrorResponse = z.infer<typeof aiErrorResponseSchema>;

/* ------------------------------------------------------------------ */
/*  Data URL helpers                                                    */
/* ------------------------------------------------------------------ */

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

/** File extension for a MIME type, used when offering a download. */
export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime.toLowerCase()] ?? "bin";
}

/** Parses a data URL, returning `null` when it is not one. */
export function parseDataUrl(
  value: string,
): { mime: string; base64: string } | null {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/is.exec(value);
  if (!match || !match[1] || !match[2]) return null;
  return { mime: match[1].toLowerCase(), base64: match[2] };
}
