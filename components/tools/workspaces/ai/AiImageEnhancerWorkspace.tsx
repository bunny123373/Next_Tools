"use client";

/**
 * AI Image Enhancer.
 *
 * Registry line:
 *   "ai-image-enhancer": dynamic(() => import("./ai/AiImageEnhancerWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiImageWorkspace from "./AiImageWorkspace";
import { MissingTool } from "./MissingTool";
import { STRENGTH_CHOICES, type AiControl } from "./controls";

const tool = getTool("ai-image-enhancer");

const CONTROLS: readonly AiControl[] = [
  {
    kind: "segmented",
    key: "strength",
    label: "How far to go",
    default: "moderate",
    options: STRENGTH_CHOICES,
    hint: "Subtle keeps more of the original; maximum invents the most.",
  },
  {
    kind: "text",
    key: "instructions",
    default: "",
    label: "What is wrong with it? (optional)",
    placeholder: "e.g. heavy sensor noise in the shadows, the label text is smeared",
    maxLength: 400,
  },
];

export default function AiImageEnhancerWorkspace() {
  if (!tool) return <MissingTool id="ai-image-enhancer" />;
  return (
    <AiImageWorkspace
      tool={tool}
      kind="edit"
      task="image-enhancer"
      options={CONTROLS}
      promptLabel="What should be improved?"
      promptPlaceholder="Reduce the noise in the shadows and make the lettering on the label legible again, without changing the composition."
    />
  );
}
