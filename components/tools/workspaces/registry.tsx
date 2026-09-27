import * as React from "react";
import dynamic from "next/dynamic";
import type { Tool } from "@/lib/tools/types";
import { ToolShell, SetupRequired } from "@/components/tools/ToolShell";
import { Notice } from "@/components/tools/states";
import { Wrench } from "lucide-react";

/**
 * Tool id → workspace component.
 *
 * >>> GENERATED FILE — do not edit by hand. <<<
 * Regenerate with:  node scripts/sync-workspaces.mjs --write
 *
 * Every entry uses `next/dynamic`, which gives each tool its own chunk. That is
 * what keeps a heavy dependency (pdf-lib, pdfjs, lamejs, gifenc) out of the
 * category page and the homepage: opening one tool downloads only that tool's
 * code, and the rest stay on disk.
 *
 * The key MUST equal the tool's `id` in `lib/tools/definitions/<category>.ts`.
 * `/admin/tools` reports any tool whose workspace is missing.
 */
type WorkspaceComponent = React.ComponentType;

export const WORKSPACES: Record<string, WorkspaceComponent> = {
  // ai
  "ai-background-generator": dynamic(() => import("./ai/AiBackgroundGeneratorWorkspace")),
  "ai-background-remover": dynamic(() => import("./ai/AiBackgroundRemoverWorkspace")),
  "ai-image-analyzer": dynamic(() => import("./ai/AiImageAnalyzerWorkspace")),
  "ai-image-enhancer": dynamic(() => import("./ai/AiImageEnhancerWorkspace")),
  "ai-image-generator": dynamic(() => import("./ai/AiImageGeneratorWorkspace")),
  "ai-image-upscaler": dynamic(() => import("./ai/AiImageUpscalerWorkspace")),
  "ai-pdf-chat": dynamic(() => import("./ai/AiPdfChatWorkspace")),
  "ai-prompt-generator": dynamic(() => import("./ai/AiPromptGeneratorWorkspace")),
  "ai-rewriter": dynamic(() => import("./ai/AiRewriterWorkspace")),
  "ai-summarizer": dynamic(() => import("./ai/AiSummarizerWorkspace")),
  "ai-text-generator": dynamic(() => import("./ai/AiTextGeneratorWorkspace")),
  "ai-translator": dynamic(() => import("./ai/AiTranslatorWorkspace")),

  // audio
  "audio-merger": dynamic(() => import("./audio/AudioMerger")),
  "audio-normalizer": dynamic(() => import("./audio/AudioNormalizer")),
  "audio-speed": dynamic(() => import("./audio/AudioSpeed")),
  "audio-splitter": dynamic(() => import("./audio/AudioSplitter")),
  "audio-to-text": dynamic(() => import("./audio/AudioToText")),
  "audio-trimmer": dynamic(() => import("./audio/AudioTrimmer")),
  "mp3-converter": dynamic(() => import("./audio/Mp3Converter")),
  "remove-silence": dynamic(() => import("./audio/RemoveSilence")),
  "volume-booster": dynamic(() => import("./audio/VolumeBooster")),
  "wav-converter": dynamic(() => import("./audio/WavConverter")),

  // developer
  "api-tester": dynamic(() => import("./developer/ApiTesterWorkspace")),
  "base64-decoder": dynamic(() => import("./developer/Base64DecoderWorkspace")),
  "base64-encoder": dynamic(() => import("./developer/Base64EncoderWorkspace")),
  "color-picker": dynamic(() => import("./developer/ColorPickerWorkspace")),
  "cron-generator": dynamic(() => import("./developer/CronGeneratorWorkspace")),
  "css-formatter": dynamic(() => import("./developer/CssFormatterWorkspace")),
  "diff-checker": dynamic(() => import("./developer/DiffCheckerWorkspace")),
  "hash-generator": dynamic(() => import("./developer/HashGeneratorWorkspace")),
  "html-formatter": dynamic(() => import("./developer/HtmlFormatterWorkspace")),
  "http-header-viewer": dynamic(() => import("./developer/HttpHeaderViewerWorkspace")),
  "javascript-formatter": dynamic(() => import("./developer/JavascriptFormatterWorkspace")),
  "json-formatter": dynamic(() => import("./developer/JsonFormatterWorkspace")),
  "json-minifier": dynamic(() => import("./developer/JsonMinifierWorkspace")),
  "json-validator": dynamic(() => import("./developer/JsonValidatorWorkspace")),
  "jwt-decoder": dynamic(() => import("./developer/JwtDecoderWorkspace")),
  "markdown-to-html": dynamic(() => import("./developer/MarkdownToHtmlWorkspace")),
  "qr-generator": dynamic(() => import("./developer/QrGeneratorWorkspace")),
  "regex-tester": dynamic(() => import("./developer/RegexTesterWorkspace")),
  "sql-formatter": dynamic(() => import("./developer/SqlFormatterWorkspace")),
  "timestamp-converter": dynamic(() => import("./developer/TimestampConverterWorkspace")),
  "url-decoder": dynamic(() => import("./developer/UrlDecoderWorkspace")),
  "url-encoder": dynamic(() => import("./developer/UrlEncoderWorkspace")),
  "uuid-generator": dynamic(() => import("./developer/UuidGeneratorWorkspace")),
  "xml-formatter": dynamic(() => import("./developer/XmlFormatterWorkspace")),

  // image
  "color-extractor": dynamic(() => import("./image/ColorExtractorWorkspace")),
  "image-blur": dynamic(() => import("./image/ImageBlurWorkspace")),
  "image-compressor": dynamic(() => import("./image/ImageCompressorWorkspace")),
  "image-converter": dynamic(() => import("./image/ImageConverterWorkspace")),
  "image-cropper": dynamic(() => import("./image/ImageCropperWorkspace")),
  "image-flipper": dynamic(() => import("./image/ImageFlipperWorkspace")),
  "image-grayscale": dynamic(() => import("./image/ImageGrayscaleWorkspace")),
  "image-metadata": dynamic(() => import("./image/ImageMetadataWorkspace")),
  "image-pixelate": dynamic(() => import("./image/ImagePixelateWorkspace")),
  "image-resizer": dynamic(() => import("./image/ImageResizerWorkspace")),
  "image-rotator": dynamic(() => import("./image/ImageRotatorWorkspace")),
  "image-watermark": dynamic(() => import("./image/ImageWatermarkWorkspace")),
  "jpg-to-png": dynamic(() => import("./image/JpgToPngWorkspace")),
  "jpg-to-webp": dynamic(() => import("./image/JpgToWebpWorkspace")),
  "png-to-jpg": dynamic(() => import("./image/PngToJpgWorkspace")),
  "webp-to-jpg": dynamic(() => import("./image/WebpToJpgWorkspace")),

  // pdf
  "jpg-to-pdf": dynamic(() => import("./pdf/JpgToPdfWorkspace")),
  "pdf-compress": dynamic(() => import("./pdf/PdfCompressorWorkspace")),
  "pdf-merge": dynamic(() => import("./pdf/PdfMergeWorkspace")),
  "pdf-metadata": dynamic(() => import("./pdf/PdfMetadataWorkspace")),
  "pdf-page-extractor": dynamic(() => import("./pdf/PdfPageExtractorWorkspace")),
  "pdf-page-numbers": dynamic(() => import("./pdf/PdfPageNumbersWorkspace")),
  "pdf-protect": dynamic(() => import("./pdf/PdfProtectWorkspace")),
  "pdf-remove-password": dynamic(() => import("./pdf/PdfRemovePasswordWorkspace")),
  "pdf-repair": dynamic(() => import("./pdf/PdfRepairWorkspace")),
  "pdf-rotator": dynamic(() => import("./pdf/PdfRotatorWorkspace")),
  "pdf-split": dynamic(() => import("./pdf/PdfSplitWorkspace")),
  "pdf-to-jpg": dynamic(() => import("./pdf/PdfToJpgWorkspace")),
  "pdf-to-text": dynamic(() => import("./pdf/PdfToTextWorkspace")),
  "pdf-watermark": dynamic(() => import("./pdf/PdfWatermarkWorkspace")),
  "png-to-pdf": dynamic(() => import("./pdf/PngToPdfWorkspace")),

  // text
  "case-converter": dynamic(() => import("./text/CaseConverter")),
  "character-counter": dynamic(() => import("./text/CharacterCounter")),
  "find-replace": dynamic(() => import("./text/FindReplace")),
  "lorem-ipsum": dynamic(() => import("./text/LoremIpsumGenerator")),
  "markdown-editor": dynamic(() => import("./text/MarkdownEditor")),
  "reading-time": dynamic(() => import("./text/ReadingTimeCalculator")),
  "remove-duplicate-lines": dynamic(() => import("./text/RemoveDuplicateLines")),
  "sentence-counter": dynamic(() => import("./text/SentenceCounter")),
  "slug-generator": dynamic(() => import("./text/SlugGenerator")),
  "text-cleaner": dynamic(() => import("./text/TextCleaner")),
  "text-diff": dynamic(() => import("./text/TextDiffChecker")),
  "text-sorter": dynamic(() => import("./text/TextSorter")),
  "word-counter": dynamic(() => import("./text/WordCounter")),

  // video
  "video-compressor": dynamic(() => import("./video/VideoCompressor")),
  "video-converter": dynamic(() => import("./video/VideoConverter")),
  "video-cropper": dynamic(() => import("./video/VideoCropper")),
  "video-frames": dynamic(() => import("./video/VideoFrames")),
  "video-resizer": dynamic(() => import("./video/VideoResizer")),
  "video-speed": dynamic(() => import("./video/VideoSpeed")),
  "video-to-audio": dynamic(() => import("./video/VideoToAudio")),
  "video-to-gif": dynamic(() => import("./video/VideoToGif")),
  "video-trimmer": dynamic(() => import("./video/VideoTrimmer")),
  "video-watermark": dynamic(() => import("./video/VideoWatermark")),
};

export function getWorkspace(toolId: string): WorkspaceComponent | null {
  return WORKSPACES[toolId] ?? null;
}

/**
 * Renders a tool's workspace, or an honest explanation if the mapping is
 * missing. This turns "a developer forgot to register a workspace" into a clear
 * message instead of a blank panel.
 */
export function ToolWorkspace({ tool }: { tool: Tool }) {
  const Workspace = getWorkspace(tool.id);

  if (!Workspace) {
    if (tool.status === "setup-required") {
      return <SetupRequired tool={tool} />;
    }
    return (
      <ToolShell>
        <Notice tone="warning" icon={<Wrench className="size-3.5" />} title="Workspace not registered.">
          This tool is listed in the registry but its workspace component is not wired up. That is
          a bug in the build, not something you can fix — please{" "}
          <a href="/request-tool" className="underline underline-offset-2">
            let us know
          </a>
          .
        </Notice>
      </ToolShell>
    );
  }

  return <Workspace />;
}
