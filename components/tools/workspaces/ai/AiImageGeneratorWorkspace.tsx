"use client";

/**
 * AI Image Generator.
 *
 * Registry line:
 *   "ai-image-generator": dynamic(() => import("./ai/AiImageGeneratorWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiImageWorkspace from "./AiImageWorkspace";
import { MissingTool } from "./MissingTool";
import { DETAIL_CHOICES, SIZE_CHOICES, STYLE_CHOICES, type AiControl } from "./controls";

const tool = getTool("ai-image-generator");

const CONTROLS: readonly AiControl[] = [
  { kind: "segmented", key: "size", label: "Canvas", default: "1024x1024", options: SIZE_CHOICES },
  { kind: "select", key: "style", label: "Visual style", default: "photographic", options: STYLE_CHOICES },
  { kind: "segmented", key: "detail", label: "Detail", default: "high", options: DETAIL_CHOICES },
  {
    kind: "slider",
    key: "creativity",
    label: "Creativity",
    default: 0.55,
    hint: "Left stays literal to your words, right lets the model interpret.",
  },
];

export default function AiImageGeneratorWorkspace() {
  if (!tool) return <MissingTool id="ai-image-generator" />;
  return (
    <AiImageWorkspace
      tool={tool}
      kind="generate"
      task="image-generator"
      options={CONTROLS}
      promptPlaceholder="A cluttered workbench under a single anglepoise lamp, late evening, brass tools worn smooth, deep shadows, 50 mm, shallow depth of field…"
    />
  );
}
