"use client";

/**
 * AI Background Remover.
 *
 * Registry line:
 *   "ai-background-remover": dynamic(() => import("./ai/AiBackgroundRemoverWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiImageWorkspace from "./AiImageWorkspace";
import { MissingTool } from "./MissingTool";
import {
  BACKGROUND_HANDLING_CHOICES,
  DETAIL_CHOICES,
  type AiControl,
} from "./controls";

const tool = getTool("ai-background-remover");

const CONTROLS: readonly AiControl[] = [
  {
    kind: "select",
    key: "backgroundHandling",
    label: "Behind the subject",
    default: "keep-transparent",
    options: BACKGROUND_HANDLING_CHOICES,
  },
  {
    kind: "segmented",
    key: "detail",
    label: "Edge quality",
    default: "high",
    options: DETAIL_CHOICES,
    hint: "High asks the model to work harder on hair and fine edges, at more cost.",
  },
  {
    kind: "text",
    key: "instructions",
    default: "",
    label: "Anything to keep or drop? (optional)",
    placeholder: "e.g. keep the strap, drop the reflection",
    maxLength: 400,
  },
];

export default function AiBackgroundRemoverWorkspace() {
  if (!tool) return <MissingTool id="ai-background-remover" />;
  return (
    <AiImageWorkspace
      tool={tool}
      kind="edit"
      task="background-remover"
      options={CONTROLS}
      promptLabel="What should be kept?"
      promptPlaceholder="Remove the entire background and keep only the person, including the fine hair around the edges. Change nothing about the person themselves."
      dropzoneLabel="Drop the photo to cut out"
      uploadHint={
        <>
          One photo of a single subject works best. Keep it under 8 MB. Check the edges of the
          result before you rely on it — how good a cut-out this is depends entirely on the model
          configured.
        </>
      }
    />
  );
}
