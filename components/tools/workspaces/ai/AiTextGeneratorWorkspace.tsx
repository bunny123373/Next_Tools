"use client";

/**
 * AI Text Generator.
 *
 * A thin configuration of the shared text workspace. The tool object comes from
 * the registry so there is exactly one source of metadata; the controls live
 * here so a change to a tool's options cannot affect any other tool.
 *
 * Registry line:
 *   "ai-text-generator": dynamic(() => import("./ai/AiTextGeneratorWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiTextWorkspace from "./AiTextWorkspace";
import { MissingTool } from "./MissingTool";
import {
  GENERATOR_FORMAT_CHOICES,
  LENGTH_CHOICES,
  TONE_CHOICES,
  type AiControl,
} from "./controls";

const tool = getTool("ai-text-generator");

const CONTROLS: readonly AiControl[] = [
  { kind: "select", key: "format", label: "Format", default: "prose", options: GENERATOR_FORMAT_CHOICES },
  { kind: "select", key: "tone", label: "Tone", default: "neutral", options: TONE_CHOICES },
  { kind: "segmented", key: "length", label: "Length", default: "medium", options: LENGTH_CHOICES },
  {
    kind: "slider",
    key: "creativity",
    label: "Creativity",
    default: 0.5,
    hint: "Left is literal, right is inventive.",
  },
  {
    kind: "text",
    key: "audience",
    default: "",
    label: "Audience (optional)",
    placeholder: "e.g. first-time buyers, a technical audience, a school assembly",
    maxLength: 80,
  },
  {
    kind: "text",
    key: "keywords",
    default: "",
    label: "Keywords to include (optional)",
    placeholder: "comma separated",
    maxLength: 200,
  },
];

const SAMPLE = `A small bakery that opened above a launderette six months ago and now has a queue out of the door every Saturday morning. Two bakers, one oven, everything baked on site. We want a short paragraph for the website home page that explains what makes the bread different, and a line for a poster that goes in the window.`;

export default function AiTextGeneratorWorkspace() {
  if (!tool) return <MissingTool id="ai-text-generator" />;
  return (
    <AiTextWorkspace
      tool={tool}
      task="text-generator"
      inputLabel="Your brief"
      placeholder="What do you need written, and for whom?"
      sample={SAMPLE}
      options={CONTROLS}
    />
  );
}
