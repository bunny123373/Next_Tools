/**
 * Tool builder templates — pure data, safe to import from anywhere.
 *
 * This list is the entire "vocabulary" of the builder. It is closed by design:
 * a template names an existing, hand-written, tested tool, and a set of preset
 * option values. No entry can contain code, and there is no path by which a
 * model response becomes executable.
 *
 * Kept separate from ./generate so a Server Component can read the catalogue
 * (and count it) without importing the server-only AI code.
 */

export interface ToolTemplate {
  /** Closed vocabulary. Anything outside this list is rejected. */
  id: string;
  label: string;
  /** What you get, in plain language. */
  summary: string;
  /** Existing tool id from the registry whose workspace gets reused. */
  baseToolId: string;
  /** Keywords used by the local matcher and by the AI classifier. */
  keywords: readonly string[];
  /** Option presets applied to the chosen workspace. */
  presets: Readonly<Record<string, string>>;
}

export const TEMPLATES: readonly ToolTemplate[] = [
  {
    id: "compress-image",
    label: "Image compressor (to JPEG or WebP)",
    summary:
      "Re-compress a photo at a quality you choose, optionally converting it to WebP for a much smaller file.",
    baseToolId: "image-compressor",
    keywords: [
      "compress", "shrink", "smaller", "optimise", "optimize", "reduce", "size",
      "webp", "jpeg", "jpg", "quality", "photo", "image", "picture",
    ],
    presets: { outputFormat: "auto" },
  },
  {
    id: "resize-image",
    label: "Image resizer",
    summary: "Set a new width and height, optionally locked to the original aspect ratio.",
    baseToolId: "image-resizer",
    keywords: ["resize", "scale", "dimensions", "width", "height", "thumbnail", "enlarge", "image", "picture"],
    presets: { maintainAspectRatio: "true" },
  },
  {
    id: "convert-image",
    label: "Image format converter",
    summary: "Convert between JPEG, PNG and WebP.",
    baseToolId: "image-converter",
    keywords: ["convert", "format", "change", "png", "jpg", "jpeg", "webp", "image", "picture", "photo"],
    presets: {},
  },
  {
    id: "crop-image",
    label: "Image cropper",
    summary: "Cut an image to a chosen region, with aspect-ratio presets.",
    baseToolId: "image-cropper",
    keywords: ["crop", "cut", "trim", "aspect", "square", "ratio", "image", "picture", "photo"],
    presets: {},
  },
  {
    id: "merge-pdf",
    label: "PDF merger",
    summary: "Combine several PDFs into one, in an order you control.",
    baseToolId: "pdf-merge",
    keywords: ["merge", "combine", "join", "concatenate", "pdf", "document", "files"],
    presets: {},
  },
  {
    id: "split-pdf",
    label: "PDF splitter",
    summary: "Split a PDF into separate files by page, range, or every page.",
    baseToolId: "pdf-split",
    keywords: ["split", "divide", "separate", "extract", "page", "pdf", "document"],
    presets: {},
  },
  {
    id: "images-to-pdf",
    label: "Images to PDF",
    summary: "Turn a set of images into a single PDF document.",
    baseToolId: "jpg-to-pdf",
    keywords: ["pdf", "images", "photos", "jpg", "png", "document", "scan", "combine"],
    presets: { pageSize: "fit" },
  },
  {
    id: "pdf-to-images",
    label: "PDF to images",
    summary: "Render PDF pages to JPEG or PNG files.",
    baseToolId: "pdf-to-jpg",
    keywords: ["pdf", "jpg", "png", "image", "render", "export", "pages"],
    presets: {},
  },
  {
    id: "word-count",
    label: "Word and character counter",
    summary: "Count words, characters, sentences and reading time as you type.",
    baseToolId: "word-counter",
    keywords: ["word", "count", "character", "words", "essay", "read", "reading time", "text"],
    presets: {},
  },
  {
    id: "case-converter",
    label: "Case converter",
    summary: "Convert text between upper, lower, Title, camel, snake and more.",
    baseToolId: "case-converter",
    keywords: ["case", "upper", "lower", "capitalise", "capitalize", "camel", "snake", "kebab", "title", "text"],
    presets: {},
  },
  {
    id: "slug-generator",
    label: "Slug generator",
    summary: "Turn a title into a clean URL slug.",
    baseToolId: "slug-generator",
    keywords: ["slug", "url", "permalink", "link", "seo", "hyphenate", "text"],
    presets: {},
  },
  {
    id: "text-cleaner",
    label: "Text cleaner",
    summary: "Strip extra whitespace, control characters and other noise from text.",
    baseToolId: "text-cleaner",
    keywords: ["clean", "tidy", "whitespace", "trim", "strip", "normalise", "normalize", "text"],
    presets: {},
  },
  {
    id: "json-formatter",
    label: "JSON formatter",
    summary: "Pretty-print or minify JSON, with a precise error position when it is invalid.",
    baseToolId: "json-formatter",
    keywords: ["json", "format", "pretty", "beautify", "minify", "prettify", "data", "api"],
    presets: {},
  },
  {
    id: "uuid-generator",
    label: "UUID generator",
    summary: "Generate cryptographically random UUID v4 values in bulk.",
    baseToolId: "uuid-generator",
    keywords: ["uuid", "guid", "random", "unique", "id", "identifier"],
    presets: {},
  },
  {
    id: "hash-generator",
    label: "Hash generator",
    summary: "Hash text or a file with MD5, SHA-256, SHA-512, BLAKE2 and more.",
    baseToolId: "hash-generator",
    keywords: ["hash", "md5", "sha", "sha256", "checksum", "digest", "fingerprint", "blake2", "crc"],
    presets: {},
  },
  {
    id: "qr-generator",
    label: "QR code generator",
    summary: "Generate a scannable QR code as PNG or SVG.",
    baseToolId: "qr-generator",
    keywords: ["qr", "qrcode", "barcode", "code", "scan", "link", "url"],
    presets: {},
  },
  {
    id: "base64",
    label: "Base64 encoder / decoder",
    summary: "Encode text to Base64 or decode it back, including URL-safe Base64.",
    baseToolId: "base64-encoder",
    keywords: ["base64", "encode", "decode", "btoa", "atob", "binary", "data uri"],
    presets: {},
  },
  {
    id: "url-encode",
    label: "URL encoder / decoder",
    summary: "Percent-encode or decode a URL, with a component-by-component breakdown.",
    baseToolId: "url-encoder",
    keywords: ["url", "encode", "decode", "percent", "escape", "uri", "query", "link"],
    presets: {},
  },
  {
    id: "jwt-decoder",
    label: "JWT decoder",
    summary: "Inspect a JSON Web Token's header and payload, and verify an HMAC signature.",
    baseToolId: "jwt-decoder",
    keywords: ["jwt", "token", "bearer", "auth", "claim", "decode", "signature", "oauth"],
    presets: {},
  },
  {
    id: "timestamp",
    label: "Timestamp converter",
    summary: "Convert between Unix timestamps, ISO 8601 and human-readable dates.",
    baseToolId: "timestamp-converter",
    keywords: ["timestamp", "epoch", "unix", "date", "time", "iso", "convert"],
    presets: {},
  },
  {
    id: "regex-tester",
    label: "Regex tester",
    summary: "Test a regular expression against sample text with group-by-group results.",
    baseToolId: "regex-tester",
    keywords: ["regex", "regexp", "regular expression", "pattern", "match", "test"],
    presets: {},
  },
] as const;

export type TemplateId = (typeof TEMPLATES)[number]["id"];

const TEMPLATE_IDS: ReadonlySet<string> = new Set(TEMPLATES.map((template) => template.id));

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && TEMPLATE_IDS.has(value);
}

export function getTemplate(id: string): ToolTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
