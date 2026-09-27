"use client";

/**
 * AI Prompt Generator.
 *
 * Registry line:
 *   "ai-prompt-generator": dynamic(() => import("./ai/AiPromptGeneratorWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiTextWorkspace from "./AiTextWorkspace";
import { MissingTool } from "./MissingTool";
import { DETAIL_CHOICES, PROMPT_FORMAT_CHOICES, type AiControl } from "./controls";

const tool = getTool("ai-prompt-generator");

const CONTROLS: readonly AiControl[] = [
  { kind: "select", key: "format", label: "What kind of prompt?", default: "image-prompt", options: PROMPT_FORMAT_CHOICES },
  { kind: "segmented", key: "detail", label: "How specific?", default: "high", options: DETAIL_CHOICES },
  {
    kind: "text",
    key: "audience",
    default: "",
    label: "What is it for? (optional)",
    placeholder: "e.g. a stock-photo library, a coding assistant, an internal triage agent",
    maxLength: 80,
  },
  {
    kind: "slider",
    key: "creativity",
    label: "Creativity",
    default: 0.5,
    hint: "Left is a safe conventional prompt, right is a more inventive one.",
  },
];

const SAMPLE = `I need a prompt that makes stock photos of people working from home look consistent across a whole library — same lighting feel, same framing, same colour palette, so they sit together on a website without looking like they came from five different shoots.`;

export default function AiPromptGeneratorWorkspace() {
  if (!tool) return <MissingTool id="ai-prompt-generator" />;
  return (
    <AiTextWorkspace
      tool={tool}
      task="prompt-generator"
      inputLabel="Describe the job"
      placeholder="What do you want a prompt to do, and what will run it?"
      sample={SAMPLE}
      options={CONTROLS}
      extension="md"
    />
  );
}
