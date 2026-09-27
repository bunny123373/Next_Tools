"use client";

/**
 * AI Translator.
 *
 * Registry line:
 *   "ai-translator": dynamic(() => import("./ai/AiTranslatorWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiTextWorkspace from "./AiTextWorkspace";
import { MissingTool } from "./MissingTool";
import { TRANSLATION_FORMAT_CHOICES, TONE_CHOICES, type AiControl } from "./controls";

const tool = getTool("ai-translator");

const CONTROLS: readonly AiControl[] = [
  {
    kind: "text",
    key: "language",
    default: "",
    label: "Translate into",
    placeholder: "e.g. Portuguese (Brazil), Japanese, Irish, Swahili",
    maxLength: 40,
    hint: "Name the language, and add a variant if it matters — it changes the result more than anything else.",
  },
  { kind: "select", key: "tone", label: "Register", default: "neutral", options: TONE_CHOICES },
  { kind: "select", key: "format", label: "Format", default: "plain-text", options: TRANSLATION_FORMAT_CHOICES },
  { kind: "checkbox", key: "keepStructure", label: "Keep my paragraphing", default: true },
];

const SAMPLE = `Dear customer,

Your order {order_id} shipped this morning and should arrive within two working days. The courier is Predictable Logistics, and tracking is available in your account under "Orders".

If the parcel arrives damaged, reply to this message with a photograph and we will replace it within five working days — no return required.

Kind regards,
The Fulfilment Team`;

export default function AiTranslatorWorkspace() {
  if (!tool) return <MissingTool id="ai-translator" />;
  return (
    <AiTextWorkspace
      tool={tool}
      task="translator"
      inputLabel="Text to translate"
      placeholder="Paste the text, and say which language you want it in…"
      sample={SAMPLE}
      options={CONTROLS}
    />
  );
}
