"use client";

/**
 * AI PDF Chat.
 *
 * Registry line:
 *   "ai-pdf-chat": dynamic(() => import("./ai/AiPdfChatWorkspace")),
 */

import { getTool } from "@/lib/tools/registry";
import AiPdfChatPanel from "./AiPdfChatPanel";
import { MissingTool } from "./MissingTool";

const tool = getTool("ai-pdf-chat");

export default function AiPdfChatWorkspace() {
  if (!tool) return <MissingTool id="ai-pdf-chat" />;
  return <AiPdfChatPanel tool={tool} />;
}
