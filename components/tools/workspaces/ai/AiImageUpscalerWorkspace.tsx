"use client";

/**
 * AI Image Upscaler.
 *
 * Registry line:
 *   "ai-image-upscaler": dynamic(() => import("./ai/AiImageUpscalerWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiImageWorkspace from "./AiImageWorkspace";
import { MissingTool } from "./MissingTool";
import { STRENGTH_CHOICES, UPSCALE_SIZE_CHOICES, type AiControl } from "./controls";

const tool = getTool("ai-image-upscaler");

const CONTROLS: readonly AiControl[] = [
  { kind: "segmented", key: "size", label: "Target size", default: "1024x1024", options: UPSCALE_SIZE_CHOICES },
  {
    kind: "segmented",
    key: "strength",
    label: "How hard to work",
    default: "moderate",
    options: STRENGTH_CHOICES,
    hint: "More detail is invented, not recovered. Faces and text are the usual casualties.",
  },
  {
    kind: "text",
    key: "instructions",
    default: "",
    label: "What to focus on? (optional)",
    placeholder: "e.g. the soft face in the centre, the logo on the bottle",
    maxLength: 400,
  },
];

export default function AiImageUpscalerWorkspace() {
  if (!tool) return <MissingTool id="ai-image-upscaler" />;
  return (
    <AiImageWorkspace
      tool={tool}
      kind="edit"
      task="image-upscaler"
      options={CONTROLS}
      promptLabel="What needs the most detail?"
      promptPlaceholder="Keep the photograph as it is, but make the face and the lettering on the label sharp and clean at the larger size."
    />
  );
}
