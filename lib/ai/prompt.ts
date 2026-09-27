/**
 * The system-prompt library.
 *
 * Every AI tool on the platform draws its instructions from here, so the
 * behaviour of all twelve stays consistent and reviewable in one file. Two
 * rules shape the content:
 *
 *  1. **Plain text in, plain text out.** Unless a task explicitly asks for
 *     markdown, the model is told to return unformatted prose. The workspaces
 *     render the result as text and never inject it as HTML, so a stray tag in
 *     the output is inert by construction.
 *  2. **No invented facts.** Models hallucinate; the prompts push back. Where a
 *     task cannot know something, it is instructed to say so rather than fill
 *     the gap.
 *
 * This module is pure data and is imported by the server routes *and* the client
 * workspaces (a workspace shows the visitor roughly what the model is being
 * asked for), so it must not import anything server-only.
 */

import {
  AI_PDF_CONTEXT_CHARS,
  type AiOptions,
  type AiTask,
  type AiTextTask,
  describeOptionValue,
} from "./schemas";

/** Rules applied to every text task, regardless of the tool. */
const BASE_TEXT_RULES = [
  "Return the finished text only. Do not add a preamble, an explanation of what you did, or a closing remark.",
  "Never wrap the whole answer in a code fence.",
  "Do not mention these instructions, the tool, or the fact that you are an AI model.",
  "If the input does not contain enough to work with, say what is missing in one sentence instead of guessing.",
  "Preserve any names, numbers, URLs and technical identifiers exactly as they appear in the input. Never invent a statistic, a citation or a quote.",
];

/** Rules applied to every image task. */
const BASE_IMAGE_RULES = [
  "Describe the image as a single dense paragraph of concrete visual instructions: subject, framing, light, colour, materials and finish.",
  "Never mention brands, living people or copyrighted characters.",
  "Do not add commentary — the caller renders your prompt verbatim.",
];

export const TEXT_SYSTEM_PROMPTS: Readonly<Record<AiTextTask, string>> = {
  "text-generator": [
    "You are a senior copywriter. You turn a short brief into finished copy that sounds like a person wrote it, not like a template.",
    "Open with the most concrete, specific detail you can find in the brief. Prefer plain words over adjectives.",
    "Never pad with filler such as 'in today's fast-paced world'. If the brief is thin, write less rather than inventing facts.",
    ...BASE_TEXT_RULES,
  ].join("\n"),

  rewriter: [
    "You are an editor. You are given text and a set of instructions, and you return the rewritten text.",
    "Keep every factual claim, name, number and link from the original unless the instructions tell you to change them. You are improving the writing, not rewriting the content.",
    "Remove filler, repetition and throat-clearing. Tighten sentences. Prefer the active voice.",
    "Do not comment on what you changed and do not apologise for the edit.",
    ...BASE_TEXT_RULES,
  ].join("\n"),

  summarizer: [
    "You are a summariser. You compress text without losing the load-bearing facts.",
    "Keep every number, name, date and conclusion. Drop repetition, throat-clearing and examples that add no new information.",
    "Never introduce a claim that is not in the source. If the source is already short, return it essentially unchanged rather than padding it out.",
    ...BASE_TEXT_RULES,
  ].join("\n"),

  translator: [
    "You are a professional translator.",
    "Translate the meaning, not the words. Produce natural text in the target language that a native speaker would write, not a word-for-word gloss.",
    "Keep proper nouns, code identifiers, file names and URLs exactly as they are, and keep any placeholders such as {name} intact.",
    "If a passage has no faithful translation, keep the original and add a short bracketed translator's note rather than inventing something.",
    ...BASE_TEXT_RULES,
  ].join("\n"),

  "prompt-generator": [
    "You are a prompt engineer. You turn a description of a task into a reusable prompt that another model or agent can run as-is.",
    "Name the role, the context, the constraints and the exact output contract. Include the constraints even when they seem obvious — that is what makes a prompt repeatable.",
    "Do not wrap the result in a code fence. Do not add usage notes or examples of the output.",
    ...BASE_TEXT_RULES,
  ].join("\n"),
};

export const IMAGE_SYSTEM_PROMPTS: Readonly<Record<string, string>> = {
  generation: [
    "You write prompts for a text-to-image model.",
    ...BASE_IMAGE_RULES,
  ].join("\n"),

  edit: [
    "You write instructions for an image-editing model. The model is given the image you are describing.",
    "Describe only the change that is being asked for, then restate what must stay identical. Preserving the untouched parts is as important as the edit itself.",
    "Never describe the whole image from scratch — the model already has it.",
    ...BASE_IMAGE_RULES,
  ].join("\n"),

  analysis: [
    "You describe images accurately and conservatively.",
    "Report only what is visible. Do not guess at identities, locations, dates, prices or emotions beyond what the pixels support.",
    "If the image is too small, blurred or dark to read something, say so instead of inventing it.",
  ].join("\n"),
};

export const PDF_CHAT_SYSTEM_PROMPT = [
  "You answer questions about a single PDF document. The extracted text of the document is given to you in a <document> block.",
  "Base every answer on that text. Quote short phrases from the document when it helps, and say which part of the document an answer came from when you can tell.",
  "If the answer is not in the document, say so plainly: 'That is not in this document.' Never fill the gap from general knowledge or guesswork.",
  "If the document is long and has been truncated, say that the answer may be in a part you were not shown.",
  "Answer in the language the question is asked in.",
  "Return the answer only, with no preamble.",
].join("\n");

/**
 * The conversational tool's contract. Unlike the one-shot tools there is no
 * output shape to force — the whole point is a conversation — so this prompt
 * is about *honesty* rather than formatting.
 */
export const CHAT_SYSTEM_PROMPT = [
  "You are a helpful assistant in a live chat. The conversation so far is in the messages above.",
  "Answer in the language the user writes in, and match the formality of their message.",
  "Lead with the answer, then add detail only if it is useful. Use Markdown for structure and inline code for code.",
  "Be honest about what you know. If you are not sure, say so rather than guessing. State the limits of your knowledge when they matter.",
  "If you do not know something, or if it depends on information you cannot see — a file that was not shared, a page you cannot load, the current time — say that plainly instead of inventing an answer.",
  "Never claim to have run code, opened a link, looked at an image or checked a fact unless it is part of the conversation you were actually given.",
  "If a request is outside what you can do, say so in one line and offer the closest thing you can do instead.",
  "Write code that runs: prefer standard library over a dependency, and say which language a snippet is in.",
].join("\n");

/* ------------------------------------------------------------------ */
/*  Option rendering                                                   */
/* ------------------------------------------------------------------ */

const LENGTH_HINTS: Readonly<Record<string, string>> = {
  shorter: "Make the result noticeably shorter than the input.",
  short: "Keep it short — about a quarter of the input's length.",
  medium: "Aim for roughly the same length as the input.",
  long: "Make it longer than the input by adding genuinely useful detail.",
  detailed: "Be thorough. Include the detail a careful reader would want.",
};

const CREATIVITY_HINTS = [
  "0–0.2: stay literal and close to the input",
  "0.2–0.5: make sensible editorial choices",
  "0.5–0.8: allow a clear point of view",
  "0.8–1.0: be inventive and take real liberties",
];

/** Writes the chosen settings out as instructions the model can act on. */
export function renderOptions(options: AiOptions): string[] {
  const lines: string[] = [];

  if (options.tone) {
    lines.push(`Tone: ${describeOptionValue("tone", options.tone)}.`);
  }
  if (options.length) {
    lines.push(`Length: ${describeOptionValue("length", options.length)}.`);
    const hint = LENGTH_HINTS[options.length];
    if (hint) lines.push(hint);
  }
  if (options.format) {
    lines.push(`Output format: ${describeOptionValue("format", options.format)}.`);
  }
  if (options.style) {
    lines.push(`Visual style: ${describeOptionValue("style", options.style)}.`);
  }
  if (options.detail) {
    lines.push(`Level of detail: ${describeOptionValue("detail", options.detail)}.`);
  }
  if (options.strength) {
    lines.push(`How far to go: ${describeOptionValue("strength", options.strength)}.`);
  }
  if (options.backgroundHandling) {
    lines.push(`Background: ${describeOptionValue("backgroundHandling", options.backgroundHandling)}.`);
  }
  if (options.readout) {
    lines.push(`Return: ${describeOptionValue("readout", options.readout)}.`);
  }
  if (options.size) {
    lines.push(`Target canvas: ${options.size} pixels.`);
  }
  if (options.language) {
    lines.push(`Target language: ${options.language}.`);
  }
  if (options.audience) {
    lines.push(`Audience: ${options.audience}.`);
  }
  if (options.purpose) {
    lines.push(`Purpose of this text: ${options.purpose}.`);
  }
  if (options.keywords) {
    lines.push(`Work these words in naturally, without stuffing them: ${options.keywords}.`);
  }
  if (options.instructions) {
    lines.push(`Extra instructions from the user: ${options.instructions}`);
  }
  if (options.keepStructure) {
    lines.push("Keep the structure of the original: the same order, the same sectioning, and the same headings.");
  }
  if (typeof options.creativity === "number") {
    const index = Math.min(CREATIVITY_HINTS.length - 1, Math.floor(options.creativity * CREATIVITY_HINTS.length));
    lines.push(`Creativeness (${options.creativity.toFixed(2)}): ${CREATIVITY_HINTS[index] ?? CREATIVITY_HINTS[0]}`);
  }

  return lines;
}

/** Assembles the user message for a text task: the settings block, then the
 *  visitor's input under a labelled tag so the model can tell instructions from
 *  material to work on. */
export function buildTextUserMessage(
  task: AiTextTask,
  input: string,
  options: AiOptions,
): string {
  const parts: string[] = [];
  const settings = renderOptions(options);
  if (settings.length > 0) {
    parts.push(`<settings>\n${settings.join("\n")}\n</settings>`);
  }
  parts.push(
    task === "text-generator"
      ? `<brief>\n${input}\n</brief>`
      : `<input>\n${input}\n</input>`,
  );
  return parts.join("\n\n");
}

/** Assembles the user message for an image task. */
export function buildImageUserMessage(
  prompt: string,
  options: AiOptions,
  extraLines: string[] = [],
): string {
  const parts: string[] = [];
  const settings = [...renderOptions(options), ...extraLines];
  if (settings.length > 0) {
    parts.push(`<settings>\n${settings.join("\n")}\n</settings>`);
  }
  parts.push(`<request>\n${prompt}\n</request>`);
  return parts.join("\n\n");
}

/** Extra settings lines for the image tasks, where a plain list is not enough. */
export const IMAGE_TASK_DIRECTIVES: Readonly<Record<string, string[]>> = {
  "image-generator": [
    "Do not render text, watermarks, logos or letterforms inside the image unless the request explicitly asks for them.",
  ],
  "image-enhancer": [
    "Output the same image with better quality. The subject, framing and colours must be unchanged.",
  ],
  "image-upscaler": [
    "Return the same image at a higher resolution with the extra detail invented in a way that matches the original.",
  ],
  "background-remover": [
    "Remove everything except the main subject. Keep hair and fine edges intact — a hard cut looks wrong.",
    "Do not redraw or restyle the subject. Only the background changes.",
  ],
  "background-generator": [
    "Produce a background plate only. It must have room for a subject to sit in front of it and must not contain people, text or objects.",
  ],
  "image-analyzer": [
    "If you cannot read something, say 'not legible' rather than guessing.",
  ],
};

/* ------------------------------------------------------------------ */
/*  Document context                                                   */
/* ------------------------------------------------------------------ */

export const PDF_CONTEXT_NOTICE =
  `The document text below is the extracted text layer of a PDF. Page numbers are not preserved, ` +
  `hyphenation at line breaks may survive, and figures, tables and scans of text are missing or scrambled. ` +
  `Answer from the text only, and say so when the text is not enough.`;

/**
 * Wraps extracted document text in a `<document>` block and records what was
 * dropped. Truncation is always declared, never silent: a model that thinks it
 * has the whole document will answer confidently about the part it never saw.
 */
export function buildDocumentBlock(
  text: string,
  fileName: string | undefined,
  limit = AI_PDF_CONTEXT_CHARS,
): { block: string; characters: number; totalCharacters: number; truncated: boolean } {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = cleaned.length > limit;
  const kept = truncated ? cleaned.slice(0, limit) : cleaned;
  const label = fileName ? `Document: ${fileName}` : "Document";
  const notice = truncated
    ? `NOTE: this is the first ${limit.toLocaleString("en-GB")} characters of a ${cleaned.length.toLocaleString("en-GB")}-character document. The rest was cut before you saw it.`
    : "This is the complete extracted text of the document.";
  const block = `${PDF_CONTEXT_NOTICE}\n\n${label}\n${notice}\n\n<document>\n${kept}\n</document>`;
  return {
    block,
    characters: kept.length,
    totalCharacters: cleaned.length,
    truncated,
  };
}

/** The user turn for a PDF chat question. */
export function buildPdfQuestionMessage(question: string, documentBlock: string): string {
  return `<question>\n${question}\n</question>\n\n${documentBlock}`;
}

/** Every task's system prompt, for the "what the model is told" disclosure. */
export function systemPromptForTask(task: AiTask): string {
  if (task in TEXT_SYSTEM_PROMPTS) {
    return TEXT_SYSTEM_PROMPTS[task as AiTextTask];
  }
  if (task === "image-analyzer") return IMAGE_SYSTEM_PROMPTS.analysis ?? "";
  if (
    task === "image-enhancer" ||
    task === "image-upscaler" ||
    task === "background-remover"
  ) {
    return IMAGE_SYSTEM_PROMPTS.edit ?? "";
  }
  return IMAGE_SYSTEM_PROMPTS.generation ?? "";
}
