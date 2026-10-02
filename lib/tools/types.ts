/**
 * The single source of truth for tool metadata.
 *
 * Everything user-facing that iterates over tools — cards, search, categories,
 * related tools, the sitemap, breadcrumbs, JSON-LD and the tool page shell —
 * reads from this shape. Tool data is never duplicated in components.
 */

/** Canonical category slugs. `CATEGORIES` in ./categories must match this list. */
export type ToolCategory = "image" | "pdf" | "video" | "audio" | "text" | "ai" | "developer";

/**
 * Where the work happens. This drives the privacy badge on every tool page, so
 * it must describe reality, not aspiration.
 *
 *  - `local`  — files never leave the device (canvas / Web Audio / WebCodecs).
 *  - `server` — the file is uploaded to an API route for processing and the
 *               temporary copy is deleted when the request ends.
 *  - `ai`     — input is sent to the configured AI provider. No file is stored.
 */
export type ProcessingMode = "local" | "server" | "ai";

/**
 *  - `stable`          — implemented and working.
 *  - `beta`            — working, but browser support or quality varies.
 *  - `setup-required`  — the UI ships, but it cannot run until the owner
 *                        configures an env var / provider. The tool page says so
 *                        explicitly and lists the exact variable needed.
 */
export type ToolStatus = "stable" | "beta" | "setup-required";

export interface ToolFaqItem {
  question: string;
  answer: string;
}

/** Every lucide-react icon referenced by the registry, as a literal union so a
 *  typo becomes a TypeScript error instead of a blank square in the UI. */
export type ToolIconName =
  | "Activity"
  | "AlignLeft"
  | "ArrowLeftRight"
  | "AudioLines"
  | "AudioWaveform"
  | "BadgeCheck"
  | "Binary"
  | "Blend"
  | "Bolt"
  | "Braces"
  | "Brush"
  | "CalendarClock"
  | "CaseSensitive"
  | "Clapperboard"
  | "Code"
  | "Code2"
  | "Columns2"
  | "Combine"
  | "Contrast"
  | "Copy"
  | "Crop"
  | "Database"
  | "Diff"
  | "Dices"
  | "Download"
  | "Eraser"
  | "Eye"
  | "EyeOff"
  | "FileArchive"
  | "FileAudio"
  | "FileCode"
  | "FileImage"
  | "FileJson"
  | "FileLock"
  | "FileStack"
  | "FileText"
  | "FileType"
  | "FileVideo"
  | "Fingerprint"
  | "FlipHorizontal"
  | "FlipHorizontal2"
  | "FlipVertical"
  | "Gauge"
  | "GripVertical"
  | "Hash"
  | "Heading"
  | "Image"
  | "ImageDown"
  | "ImagePlus"
  | "Images"
  | "IndentIncrease"
  | "Key"
  | "Languages"
  | "Layers"
  | "LayoutGrid"
  | "Link"
  | "ListOrdered"
  | "Lock"
  | "Mail"
  | "Maximize2"
  | "MessageSquareText"
  | "Mic"
  | "Minimize2"
  | "Minus"
  | "MoveDiagonal"
  | "Music"
  | "Newspaper"
  | "Palette"
  | "PanelTop"
  | "Pause"
  | "PenLine"
  | "Percent"
  | "PiggyBank"
  | "Play"
  | "Plus"
  | "Quote"
  | "RefreshCw"
  | "Regex"
  | "Repeat"
  | "RotateCcw"
  | "RotateCw"
  | "Ruler"
  | "Scan"
  | "ScanEye"
  | "ScanLine"
  | "Scissors"
  | "ScrollText"
  | "Search"
  | "Send"
  | "Settings2"
  | "Shield"
  | "ShieldCheck"
  | "Shuffle"
  | "Signature"
  | "Slash"
  | "SlidersHorizontal"
  | "Sparkles"
  | "Split"
  | "SquareStack"
  | "Sticker"
  | "Strikethrough"
  | "Sun"
  | "Tag"
  | "Tags"
  | "Terminal"
  | "TextCursorInput"
  | "TextQuote"
  | "Timer"
  | "Trash2"
  | "Type"
  | "Undo2"
  | "Unlock"
  | "Upload"
  | "User"
  | "Users"
  | "Video"
  | "Volume2"
  | "VolumeX"
  | "Wand2"
  | "WandSparkles"
  | "Wrench"
  | "ZoomIn"
  | "ZoomOut";

export interface Tool {
  /** Stable kebab-case id, unique across all categories. Used as a React key
   *  and as the workspace lookup key. */
  id: string;
  /** Display name. */
  name: string;
  /** Slug unique within its category. */
  slug: string;
  category: ToolCategory;
  /** ≤ 160 chars. Used for cards and meta descriptions. */
  description: string;
  /** 1–2 sentences rendered directly under the H1. */
  intro: string;
  icon: ToolIconName;
  /** Search terms beyond the name/description. */
  keywords: string[];
  /** Absolute route, e.g. "/tools/image/compressor". */
  route: string;
  processing: ProcessingMode;
  status: ToolStatus;
  /** Surfaced in the "Popular Tools" rail on the homepage and /tools. */
  popular?: boolean;
  /** ISO date the tool was added. Drives the "New Tools" section. */
  addedOn: string;
  /** 4–6 bullet points for the Features block. */
  features: string[];
  /** 3–4 numbered steps for the "How it works" block. */
  howItWorks: string[];
  /** 3–5 entries; rendered as FAQPage JSON-LD. */
  faq: ToolFaqItem[];
  /** Tool ids, resolved to cards. Unknown ids are ignored. */
  related: string[];
  /** Required when status is "setup-required". Names the exact env var. */
  setupNote?: string;
  /** Primary CTA verb, e.g. "Compress". Defaults to "Process". */
  actionLabel?: string;
  /** Marks the experimental tool-builder output. */
  experimental?: boolean;
}

export type ToolMap = Readonly<Record<string, Tool>>;

export const PROCESSING_LABEL: Record<ProcessingMode, string> = {
  local: "Processed locally in your browser",
  server: "Temporarily uploaded for processing",
  ai: "Sent to the AI provider for processing",
};

export const PROCESSING_DESCRIPTION: Record<ProcessingMode, string> = {
  local:
    "Your file is decoded and processed on this device. It is never uploaded and never stored on a server.",
  server:
    "Your file is uploaded to the processing API, the result is streamed back, and the temporary copy is deleted as soon as the request finishes.",
  ai:
    "Your input is sent to the configured AI provider to generate the result. Nothing is written to our database and we do not store your prompts.",
};

/** Short badge text shown next to the tool title. */
export const PROCESSING_BADGE: Record<ProcessingMode, string> = {
  local: "Runs in your browser",
  server: "Server processing",
  ai: "Uses AI provider",
};
