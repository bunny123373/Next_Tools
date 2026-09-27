"use client";

/**
 * AI Summarizer.
 *
 * Registry line:
 *   "ai-summarizer": dynamic(() => import("./ai/AiSummarizerWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiTextWorkspace from "./AiTextWorkspace";
import { MissingTool } from "./MissingTool";
import { LENGTH_CHOICES, SUMMARY_FORMAT_CHOICES, type AiControl } from "./controls";

const tool = getTool("ai-summarizer");

const CONTROLS: readonly AiControl[] = [
  { kind: "segmented", key: "length", label: "Length", default: "medium", options: LENGTH_CHOICES },
  { kind: "select", key: "format", label: "Format", default: "bullet-list", options: SUMMARY_FORMAT_CHOICES },
  {
    kind: "text",
    key: "purpose",
    default: "",
    label: "What is the summary for? (optional)",
    placeholder: "e.g. a board update, an email to the team, revision before an exam",
    maxLength: 120,
    hint: "Saying who it is for changes what the model treats as important.",
  },
  {
    kind: "checkbox",
    key: "keepStructure",
    label: "Mirror the original's headings",
    default: false,
  },
];

const SAMPLE = `Quarterly operations review, Q3.

Fulfilment costs rose 11% quarter on quarter, driven mainly by a third-party carrier surcharge that took effect on 1 August and a one-off re-warehousing of the Rotterdam site. Two of the three contract renewals for the Frankfurt carrier were negotiated down by 6% and 9% respectively; the third is in negotiation with the supplier as of the date of this report.

Headcount was flat at 214. The two open engineering roles from Q2 were closed in September, and the on-call rotation is now covered by four engineers rather than five, which has increased after-hours page volume by roughly one incident per week.

Warehouse safety record: zero reportable incidents. The quarterly fire inspection passed with two minor observations, both closed within five working days.

Customer support CSAT was 4.3/5, unchanged. Median first response time improved from 6.2 hours to 4.8 hours after the triage rules were updated.`;

export default function AiSummarizerWorkspace() {
  if (!tool) return <MissingTool id="ai-summarizer" />;
  return (
    <AiTextWorkspace
      tool={tool}
      task="summarizer"
      inputLabel="Text to summarise"
      placeholder="Paste an article, a report, meeting notes or a transcript…"
      sample={SAMPLE}
      options={CONTROLS}
    />
  );
}
