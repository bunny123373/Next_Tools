"use client";

/**
 * AI Image Analyzer.
 *
 * Registry line:
 *   "ai-image-analyzer": dynamic(() => import("./ai/AiImageAnalyzerWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiImageWorkspace from "./AiImageWorkspace";
import { MissingTool } from "./MissingTool";
import { DETAIL_CHOICES, READOUT_CHOICES, type AiControl } from "./controls";

const tool = getTool("ai-image-analyzer");

const CONTROLS: readonly AiControl[] = [
  { kind: "select", key: "readout", label: "What do you want back?", default: "detailed-description", options: READOUT_CHOICES },
  { kind: "segmented", key: "detail", label: "How closely to look", default: "medium", options: DETAIL_CHOICES },
  {
    kind: "text",
    key: "audience",
    default: "",
    label: "Who is the readout for? (optional)",
    placeholder: "e.g. a screen reader, a catalogue, an editor selecting a crop",
    maxLength: 80,
  },
];

export default function AiImageAnalyzerWorkspace() {
  if (!tool) return <MissingTool id="ai-image-analyzer" />;
  return (
    <AiImageWorkspace
      tool={tool}
      kind="analyze"
      task="image-analyzer"
      options={CONTROLS}
      promptLabel="Ask something specific (optional)"
      dropzoneLabel="Drop the image to read"
    />
  );
}
