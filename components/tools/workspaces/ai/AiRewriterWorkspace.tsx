"use client";

/**
 * AI Rewriter.
 *
 * Registry line:
 *   "ai-rewriter": dynamic(() => import("./ai/AiRewriterWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiTextWorkspace from "./AiTextWorkspace";
import { MissingTool } from "./MissingTool";
import {
  COPY_FORMAT_CHOICES,
  LENGTH_CHOICES,
  TONE_CHOICES,
  type AiControl,
} from "./controls";

const tool = getTool("ai-rewriter");

const CONTROLS: readonly AiControl[] = [
  { kind: "select", key: "tone", label: "Rewrite in this tone", default: "friendly", options: TONE_CHOICES },
  { kind: "segmented", key: "length", label: "Length", default: "shorter", options: LENGTH_CHOICES },
  { kind: "select", key: "format", label: "Format", default: "short-paragraphs", options: COPY_FORMAT_CHOICES },
  {
    kind: "slider",
    key: "creativity",
    label: "How much to change",
    default: 0.35,
    hint: "Left stays close to your words, right takes real liberties.",
  },
  {
    kind: "checkbox",
    key: "keepStructure",
    label: "Keep my headings and order",
    description: "Mirrors your sectioning instead of rewriting the shape.",
    default: false,
  },
];

const SAMPLE = `hi everyone, we are super excited to announce that our new product line is now available. it has been a long time in the making and we could not have done it without all of your support. we think you are really going to like it. order now and get 10% off your first purchase!!!`;

export default function AiRewriterWorkspace() {
  if (!tool) return <MissingTool id="ai-rewriter" />;
  return (
    <AiTextWorkspace
      tool={tool}
      task="rewriter"
      inputLabel="Text to rewrite"
      placeholder="Paste the paragraph, email or article you want rewritten…"
      sample={SAMPLE}
      options={CONTROLS}
    />
  );
}
