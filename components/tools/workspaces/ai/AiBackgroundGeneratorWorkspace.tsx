"use client";

/**
 * AI Background Generator.
 *
 * Registry line:
 *   "ai-background-generator": dynamic(() => import("./ai/AiBackgroundGeneratorWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiImageWorkspace from "./AiImageWorkspace";
import { MissingTool } from "./MissingTool";
import {
  BACKGROUND_STYLE_CHOICES,
  DETAIL_CHOICES,
  SIZE_CHOICES,
  type AiControl,
} from "./controls";

const tool = getTool("ai-background-generator");

const CONTROLS: readonly AiControl[] = [
  { kind: "segmented", key: "size", label: "Canvas", default: "1024x1024", options: SIZE_CHOICES },
  { kind: "select", key: "style", label: "Background type", default: "studio-backdrop", options: BACKGROUND_STYLE_CHOICES },
  { kind: "segmented", key: "detail", label: "Detail", default: "medium", options: DETAIL_CHOICES },
  { kind: "slider", key: "creativity", label: "Creativity", default: 0.5 },
];

export default function AiBackgroundGeneratorWorkspace() {
  if (!tool) return <MissingTool id="ai-background-generator" />;
  return (
    <AiImageWorkspace
      tool={tool}
      kind="generate"
      task="background-generator"
      options={CONTROLS}
      promptPlaceholder="A soft grey seamless sweep for a product photograph, gentle top-left key light, no objects, empty centre…"
    />
  );
}
