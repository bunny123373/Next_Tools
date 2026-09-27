/**
 * Pure text transforms shared by the text tools.
 *
 * No React, no DOM rendering, no network. Everything here is deterministic so a
 * workspace can call it straight from a `useMemo` and get an answer on the same
 * keystroke that produced the input — which is the whole point of the text
 * category.
 *
 * Deliberately dependency-free. The Markdown renderer and the URL sanitiser
 * live here rather than coming from a third-party parser because the Markdown
 * tool makes a security promise ("pasted text can never inject markup") and
 * that promise is only honest if the code honouring it is in this file.
 */

/* ================================================================== */
/*  Shared limits                                                      */
/* ================================================================== */

/**
 * Above this the DOM (not the string maths) is what costs time, so the
 * Markdown preview renders a prefix and says so.
 */
export const MARKDOWN_RENDER_LIMIT = 200_000;

/** Line diffing is the one genuinely super-linear transform we ship. */
export const DIFF_CHAR_LIMIT = 2_000_000;
export const DIFF_LINE_LIMIT = 20_000;
/** D (the edit distance) we are willing to trace before falling back. */
export const DIFF_MAX_EDIT_DISTANCE = 1200;
/** Word-level highlighting is only attempted for reasonably sized pairs. */
export const DIFF_WORD_LIMIT = 8_000;

/** Hard ceiling on regex matches we will enumerate for highlighting. */
export const MATCH_LIMIT = 20_000;

/* ================================================================== */
/*  Counting helpers                                                   */
/* ================================================================== */

/** Word count used by the generators; mirrors the shared UI helper. */
function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** UTF-8 byte length without allocating a second copy of the string. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        // Unpaired high surrogate — encoded as the replacement character.
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * User-perceived character count. Uses `Intl.Segmenter` when the browser has
 * it so a family emoji or a combining accent counts once, and falls back to
 * code points where it does not.
 */
export function graphemeCount(text: string): number {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let count = 0;
    for (const _ of segmenter.segment(text)) count += 1;
    return count;
  }
  return [...text].length;
}

export interface CharacterBreakdown {
  letters: number;
  digits: number;
  punctuation: number;
  spaces: number;
  newlines: number;
  other: number;
  nonAscii: number;
  longestWord: string;
  longestWordLength: number;
  averageWordLength: number;
}

/** Where the characters actually go. Used by the character counter. */
export function characterBreakdown(text: string): CharacterBreakdown {
  let letters = 0;
  let digits = 0;
  let punctuation = 0;
  let spaces = 0;
  let newlines = 0;
  let other = 0;
  let nonAscii = 0;

  for (const ch of text) {
    if (ch === "\n" || ch === "\r") newlines += 1;
    else if (ch === "\t") spaces += 1;
    else if (/\s/u.test(ch)) spaces += 1;
    else if (/\p{L}/u.test(ch)) letters += 1;
    else if (/\p{N}/u.test(ch)) digits += 1;
    else if (/[\p{P}\p{S}]/u.test(ch)) punctuation += 1;
    else other += 1;
    if (ch.charCodeAt(0) > 127) nonAscii += 1;
  }

  const words = text.trim() ? text.trim().split(/\s+/) : [];
  let longestWord = "";
  let totalLength = 0;
  for (const word of words) {
    totalLength += [...word].length;
    if ([...word].length > [...longestWord].length) longestWord = word;
  }

  return {
    letters,
    digits,
    punctuation,
    spaces,
    newlines,
    other,
    nonAscii,
    longestWord,
    longestWordLength: [...longestWord].length,
    averageWordLength: words.length ? totalLength / words.length : 0,
  };
}

export interface ParagraphCount {
  words: number;
  characters: number;
  text: string;
}

/** Per-paragraph word counts, for the word counter's bar chart. */
export function paragraphBreakdown(text: string): ParagraphCount[] {
  if (!text.trim()) return [];
  return text
    .split(/\n\s*\n/)
    .filter((part) => part.trim().length > 0)
    .map((part) => ({
      words: wordCount(part),
      characters: [...part].length,
      text: part.trim(),
    }));
}

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be",
  "because", "been", "but", "by", "can", "did", "do", "does", "for", "from", "had", "has",
  "have", "he", "her", "here", "him", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "me", "my", "no", "not", "of", "on", "or", "our", "out", "she", "so", "some",
  "than", "that", "the", "their", "them", "then", "there", "these", "they", "this", "to",
  "too", "up", "us", "was", "we", "were", "what", "when", "which", "who", "will", "with",
  "would", "you", "your",
]);

export interface WordFrequencyEntry {
  word: string;
  count: number;
  /** 0–1 share of all words. */
  share: number;
}

/**
 * Most frequent words. Punctuation-only tokens are dropped; stop words can be
 * kept or skipped so the report is useful for prose *and* for keyword work.
 */
export function wordFrequency(
  text: string,
  options: { limit?: number; ignoreStopWords?: boolean; minCount?: number } = {},
): WordFrequencyEntry[] {
  const { limit = 25, ignoreStopWords = false, minCount = 1 } = options;
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  if (tokens.length === 0) return [];

  const counts = new Map<string, number>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (ignoreStopWords && STOP_WORDS.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count, share: count / tokens.length }));
}

/* ================================================================== */
/*  Sentence analysis                                                  */
/* ================================================================== */

export interface SentenceInfo {
  index: number;
  text: string;
  words: number;
  characters: number;
  /** More words than this and it is usually hard to follow. */
  long: boolean;
}

/**
 * Split into sentences. The terminator set matches the shared UI counter,
 * trailing quotes/brackets stay attached to the sentence they belong to, and a
 * final fragment without a terminator still counts as a sentence.
 */
export function splitSentences(text: string): SentenceInfo[] {
  if (!text.trim()) return [];
  const matches =
    text.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? [text.trim()];
  return matches
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw, index) => {
      const words = wordCount(raw);
      return {
        index: index + 1,
        text: raw,
        words,
        characters: [...raw].length,
        long: words > 25,
      };
    });
}

/* ================================================================== */
/*  Case conversion                                                    */
/* ================================================================== */

export type CaseMode =
  | "upper"
  | "lower"
  | "title"
  | "sentence"
  | "camel"
  | "pascal"
  | "snake"
  | "kebab"
  | "constant"
  | "dot"
  | "alternating"
  | "inverse"
  | "train";

export interface CaseOption {
  value: CaseMode;
  label: string;
  /** What the mode does, shown under the case list. */
  hint: string;
}

export const CASE_OPTIONS: readonly CaseOption[] = [
  { value: "upper", label: "UPPERCASE", hint: "Every letter uppercased." },
  { value: "lower", label: "lowercase", hint: "Every letter lowercased." },
  { value: "title", label: "Title Case", hint: "Capitalises each word, keeps small words lowercase and leaves acronyms alone." },
  { value: "sentence", label: "Sentence case", hint: "One capital per sentence, acronyms preserved." },
  { value: "camel", label: "camelCase", hint: "firstWordThenCamel — no separator." },
  { value: "pascal", label: "PascalCase", hint: "EveryWordCapitalised — no separator." },
  { value: "snake", label: "snake_case", hint: "words_joined_with_underscores." },
  { value: "kebab", label: "kebab-case", hint: "words-joined-with-hyphens." },
  { value: "constant", label: "CONSTANT_CASE", hint: "WORDS_JOINED_AND_UPPERCASED." },
  { value: "dot", label: "dot.case", hint: "words.joined.with.dots." },
  { value: "train", label: "Train-Case", hint: "Capitalised-Words-With-Hyphens." },
  { value: "alternating", label: "aLtErNaTiNg", hint: "Alternates the case of every letter." },
  { value: "inverse", label: "iNVERSE", hint: "Swaps the case of every letter." },
];

/** Words that stay lowercase in Title Case unless they open or close a title. */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of",
  "on", "or", "over", "per", "the", "to", "up", "via", "vs", "with", "yet",
]);

/** An existing all-caps token such as "NASA" or "FBI". */
function isAcronym(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase();
}

function capitaliseSegment(segment: string): string {
  if (isAcronym(segment)) return segment;
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

function capitaliseWord(word: string, keepFirst: boolean, keepLast: boolean): string {
  // Hyphenated titles capitalise every part ("State-of-the-Art"), so the
  // small-word rule is applied per segment rather than to the whole token.
  const parts = word.split("-");
  return parts
    .map((part, index) => {
      const isEdge = (keepFirst && index === 0) || (keepLast && index === parts.length - 1);
      if (parts.length > 1 && !isEdge && SMALL_WORDS.has(part.toLowerCase())) {
        return part.toLowerCase();
      }
      return part.replace(/[\p{L}\p{N}]+/gu, capitaliseSegment);
    })
    .join("-");
}

/**
 * Title Case that behaves: small words stay lowercase, hyphenated parts are
 * both capitalised, and acronyms the author typed are left intact.
 */
export function toTitleCase(input: string): string {
  const token = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  const tokens = input.match(token) ?? [];
  let position = 0;
  return input.replace(token, (word) => {
    const index = position;
    position += 1;
    const first = index === 0;
    const last = index === tokens.length - 1;
    if (!first && !last && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return capitaliseWord(word, first, last);
  });
}

/** Sentence case: one capital per sentence, everything else lowercased. */
export function toSentenceCase(input: string): string {
  const lowered = input.toLowerCase();
  return lowered.replace(
    /(^|[.!?…]["')\]]*)(\s*)(\p{L})/gu,
    (_match, prefix: string, gap: string, letter: string) => prefix + gap + letter.toUpperCase(),
  );
}

/** Swap the case of every cased character. */
export function invertCase(input: string): string {
  return Array.from(input, (ch) => {
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    if (upper === lower) return ch;
    return ch === upper ? lower : upper;
  }).join("");
}

/** aLtErNaTiNg — flips on every cased letter it meets. */
export function alternateCase(input: string): string {
  let flip = true;
  return input.replace(/\p{L}/gu, (ch) => {
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    if (upper === lower) return ch;
    flip = !flip;
    return flip ? upper : lower;
  });
}

/**
 * Break an arbitrary identifier into words, honouring existing camel humps,
 * digit boundaries and acronyms (`getHTTPResponseV2` → get, HTTP, Response, V2).
 */
export function splitIdentifier(input: string): string[] {
  return input
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length > 0);
}

function joinWords(words: string[], separator: string, transform: (word: string) => string): string {
  return words.map(transform).join(separator);
}

function lowerFirst(word: string): string {
  return word.charAt(0).toLowerCase() + word.slice(1);
}

function upperFirst(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Convert to any supported case. Multi-line input is converted line by line so
 * the structure of the document survives.
 */
export function convertCase(input: string, mode: CaseMode): string {
  if (!input) return "";
  const perLine = (fn: (line: string) => string): string => input.split("\n").map(fn).join("\n");

  switch (mode) {
    case "upper":
      return input.toUpperCase();
    case "lower":
      return input.toLowerCase();
    case "title":
      return perLine(toTitleCase);
    case "sentence":
      return perLine(toSentenceCase);
    case "alternating":
      return perLine(alternateCase);
    case "inverse":
      return perLine(invertCase);
    case "camel":
      return perLine((line) => {
        const words = splitIdentifier(line);
        if (words.length === 0) return "";
        return lowerFirst(words[0]!) + joinWords(words.slice(1), "", upperFirst);
      });
    case "pascal":
      return perLine((line) => joinWords(splitIdentifier(line), "", upperFirst));
    case "snake":
      return perLine((line) => joinWords(splitIdentifier(line), "_", (w) => w.toLowerCase()));
    case "kebab":
      return perLine((line) => joinWords(splitIdentifier(line), "-", (w) => w.toLowerCase()));
    case "constant":
      return perLine((line) => joinWords(splitIdentifier(line), "_", (w) => w.toUpperCase()));
    case "dot":
      return perLine((line) => joinWords(splitIdentifier(line), ".", (w) => w.toLowerCase()));
    case "train":
      return perLine((line) => joinWords(splitIdentifier(line), "-", upperFirst));
    default:
      return input;
  }
}

/* ================================================================== */
/*  Duplicate line removal                                             */
/* ================================================================== */

export interface DedupeOptions {
  sort?: "none" | "asc" | "desc";
  ignoreCase?: boolean;
  ignoreWhitespace?: boolean;
  /** Collapse runs of blank lines and drop leading/trailing ones. */
  collapseBlankLines?: boolean;
}

export interface DedupeResult {
  text: string;
  linesIn: number;
  linesOut: number;
  removed: number;
  /** Every line that was dropped, in the order it was dropped. */
  duplicates: string[];
  blankLinesRemoved: number;
}

/**
 * Remove repeated lines, keeping the first occurrence so the original order is
 * preserved unless the caller asks for a sort.
 */
export function dedupeLines(input: string, options: DedupeOptions = {}): DedupeResult {
  const { sort = "none", ignoreCase = false, ignoreWhitespace = false, collapseBlankLines = false } =
    options;

  const rawLines = input.split(/\r\n|\r|\n/);
  const linesIn = rawLines.length;

  const keyOf = (line: string): string => {
    const trimmed = ignoreWhitespace ? line.trim() : line;
    return ignoreCase ? trimmed.toLowerCase() : trimmed;
  };

  // Step 1 — blank lines are handled on their own terms: a run between two
  // content lines collapses to a single blank line, and a run at either end
  // disappears. Nothing is ever compared against a blank line.
  let lines = rawLines;
  let blankLinesRemoved = 0;
  if (collapseBlankLines) {
    lines = [];
    let run = 0;
    for (const line of rawLines) {
      if (line.trim() === "") {
        run += 1;
        continue;
      }
      if (run > 0) {
        if (lines.length > 0) {
          lines.push("");
          blankLinesRemoved += run - 1;
        } else {
          blankLinesRemoved += run;
        }
        run = 0;
      }
      lines.push(line);
    }
    blankLinesRemoved += run;
  }

  // Step 2 — first occurrence wins, so the original order survives.
  const duplicates: string[] = [];
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.trim() === "") {
      kept.push(line);
      continue;
    }
    const key = keyOf(line);
    if (seen.has(key)) {
      duplicates.push(line);
      continue;
    }
    seen.add(key);
    kept.push(line);
  }

  let output = kept;
  if (sort !== "none") {
    // Sorting a list makes "blank line" meaningless, so blanks are dropped.
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    const content = kept.filter((line) => line.trim() !== "");
    blankLinesRemoved += kept.length - content.length;
    output = [...content].sort((a, b) => collator.compare(a, b));
    if (sort === "desc") output.reverse();
  }

  return {
    text: output.join("\n"),
    linesIn,
    linesOut: output.length,
    removed: duplicates.length + blankLinesRemoved,
    duplicates,
    blankLinesRemoved,
  };
}

/* ================================================================== */
/*  Text cleaning                                                      */
/* ================================================================== */

export type CleanOperationId =
  | "trim"
  | "trim-trailing"
  | "collapse-spaces"
  | "remove-tabs"
  | "crlf-to-lf"
  | "strip-zero-width"
  | "strip-control"
  | "curly-to-straight"
  | "nbsp-to-space"
  | "collapse-blanks"
  | "remove-blank-lines"
  | "remove-html"
  | "remove-urls"
  | "remove-emails"
  | "remove-contacts"
  | "remove-duplicate-words";

export interface CleanOperation {
  id: CleanOperationId;
  label: string;
  /** Shown under the label so every toggle is individually verifiable. */
  description: string;
  group: "whitespace" | "characters" | "strip";
}

/**
 * Every operation, in the order they are applied. Order matters: line endings
 * are normalised before anything looks for newlines, tabs become spaces before
 * runs of spaces are collapsed, and markup is removed before the URL/email
 * passes so a link inside an attribute goes with its tag.
 */
export const CLEAN_OPERATIONS: readonly CleanOperation[] = [
  { id: "crlf-to-lf", label: "Normalise CRLF to LF", description: "Windows and classic-Mac line endings become \\n", group: "whitespace" },
  { id: "trim", label: "Trim the whole text", description: "Removes whitespace at the very start and end", group: "whitespace" },
  { id: "trim-trailing", label: "Trim each line", description: "Removes trailing spaces and tabs from every line", group: "whitespace" },
  { id: "remove-tabs", label: "Remove tabs", description: "Tabs become a single space", group: "whitespace" },
  { id: "collapse-spaces", label: "Collapse repeated spaces", description: "Two or more spaces become one", group: "whitespace" },
  { id: "collapse-blanks", label: "Collapse 3+ blank lines to 1", description: "Extra vertical whitespace between paragraphs", group: "whitespace" },
  { id: "remove-blank-lines", label: "Remove empty lines", description: "Deletes every line that is only whitespace", group: "whitespace" },
  { id: "strip-zero-width", label: "Strip zero-width characters", description: "Zero-width space/joiner and the byte-order mark", group: "characters" },
  { id: "strip-control", label: "Strip control characters", description: "Everything unprintable except line breaks", group: "characters" },
  { id: "curly-to-straight", label: "Curly quotes to straight", description: "“ ” ‘ ’ — – … become ASCII", group: "characters" },
  { id: "nbsp-to-space", label: "Non-breaking spaces to spaces", description: "Includes thin and hair spaces", group: "characters" },
  { id: "remove-html", label: "Remove HTML tags", description: "Drops markup such as <b> or <div>", group: "strip" },
  { id: "remove-urls", label: "Remove URLs", description: "http(s):// and www. links", group: "strip" },
  { id: "remove-emails", label: "Remove email addresses", description: "user@example.com and mailto: links", group: "strip" },
  { id: "remove-contacts", label: "Remove URLs and emails", description: "Both of the above in one pass", group: "strip" },
  { id: "remove-duplicate-words", label: "Remove duplicate words", description: "“the the cat” becomes “the cat”", group: "strip" },
];

export const CLEAN_GROUPS: readonly { id: CleanOperation["group"]; label: string }[] = [
  { id: "whitespace", label: "Whitespace" },
  { id: "characters", label: "Characters" },
  { id: "strip", label: "Strip content" },
];

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

const CLEANERS: Record<CleanOperationId, (text: string) => string> = {
  "crlf-to-lf": (text) => text.replace(/\r\n?/g, "\n"),
  trim: (text) => text.trim(),
  "trim-trailing": (text) => text.replace(/[ \t]+$/gm, ""),
  "collapse-spaces": (text) => text.replace(/ {2,}/g, " "),
  "remove-tabs": (text) => text.replace(/\t/g, " "),
  "collapse-blanks": (text) => text.replace(/\n{3,}/g, "\n\n"),
  "remove-blank-lines": (text) => text.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n+/g, "\n").replace(/^\n|\n$/g, ""),
  "strip-zero-width": (text) => text.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, ""),
  "strip-control": (text) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""),
  "curly-to-straight": (text) =>
    text.replace(/[\u2018\u2019\u201a\u201b]/g, "'").replace(/[\u201c\u201d\u201e\u201f]/g, '"').replace(/[\u2013\u2014\u2212]/g, "-").replace(/\u2026/g, "..."),
  "nbsp-to-space": (text) => text.replace(/[\u00a0\u2007\u202f\u2009]/g, " "),
  "remove-html": (text) => text.replace(HTML_TAG_PATTERN, ""),
  "remove-urls": (text) => text.replace(URL_PATTERN, ""),
  "remove-emails": (text) => text.replace(EMAIL_PATTERN, ""),
  "remove-contacts": (text) => text.replace(URL_PATTERN, " ").replace(EMAIL_PATTERN, " ").replace(/[ \t]{2,}/g, " "),
  "remove-duplicate-words": (text) =>
    text.replace(/\b([\p{L}\p{N}'’-]+)(\s+\1\b)+/giu, "$1"),
};

export interface CleanStep {
  id: CleanOperationId;
  label: string;
  /** Characters this operation removed, measured during the real run. */
  removed: number;
}

export interface CleanResult {
  text: string;
  charactersIn: number;
  charactersOut: number;
  removed: number;
  steps: CleanStep[];
}

/** Apply the selected operations in the canonical order and report each delta. */
export function cleanText(input: string, enabled: readonly CleanOperationId[]): CleanResult {
  const wanted = new Set(enabled);
  let text = input;
  const steps: CleanStep[] = [];

  for (const operation of CLEAN_OPERATIONS) {
    if (!wanted.has(operation.id)) continue;
    const before = text.length;
    text = CLEANERS[operation.id](text);
    steps.push({
      id: operation.id,
      label: operation.label,
      removed: Math.max(0, before - text.length),
    });
  }

  return {
    text,
    charactersIn: input.length,
    charactersOut: text.length,
    removed: Math.max(0, input.length - text.length),
    steps,
  };
}

/* ================================================================== */
/*  Slug generation                                                    */
/* ================================================================== */

export interface SlugOptions {
  separator: "-" | "_" | ".";
  lowercase: boolean;
  /** 0 disables the cap. Otherwise a hard truncate on a word boundary. */
  maxLength: number;
  stripDiacritics: boolean;
  /** Literal replacements applied before anything else, e.g. `&` → ` and `. */
  replacements: readonly (readonly [string, string])[];
}

export interface SlugResult {
  slug: string;
  /** `encodeURIComponent` of the slug — identical for ASCII, different for
   *  scripts that survive the "keep letters" rule. */
  encoded: string;
  words: number;
  /** True when the max length forced a shorter slug. */
  truncated: boolean;
}

/** NFD-decompose and drop the combining marks, so "Crème" → "Creme". */
export function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/\p{M}+/gu, "");
}

export function generateSlug(input: string, options: SlugOptions): SlugResult {
  const { separator, lowercase, maxLength, stripDiacritics: strip, replacements } = options;
  let text = input.trim();

  // Longest keys first so "&&" is replaced before "&".
  const ordered = [...replacements].filter(([from]) => from.length > 0).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    text = text.split(from).join(to);
  }

  if (strip) text = stripDiacritics(text);
  if (lowercase) text = text.toLowerCase();

  // An apostrophe is a possessive marker, not a word break: "sibling's" must
  // not become "sibling-s".
  text = text.replace(/['’]/g, "");

  text = text.replace(/[^\p{L}\p{N}]+/gu, separator);
  let parts = text.split(separator).filter((part) => part.length > 0);

  let truncated = false;
  if (maxLength > 0 && parts.length > 0) {
    let length = parts.join(separator).length;
    if (length > maxLength) {
      truncated = true;
      while (parts.length > 1 && parts.join(separator).length > maxLength) {
        parts = parts.slice(0, -1);
      }
      // No boundary left to cut on: hard truncate the last remaining word.
      const last = parts[parts.length - 1]!;
      if (last.length > maxLength) {
        parts = [...parts.slice(0, -1), last.slice(0, maxLength)];
        length = parts.join(separator).length;
      }
      parts = parts.filter((part) => part.length > 0);
    }
  }

  const slug = parts.join(separator);
  return {
    slug,
    encoded: encodeURIComponent(slug),
    words: parts.length,
    truncated,
  };
}

/* ================================================================== */
/*  Placeholder text generation                                        */
/* ================================================================== */

const LOREM_OPENING = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";

/**
 * The standard Cicero-derived passage, split into sentences. It is real Latin
 * filler (public domain) rather than lorem-shaped noise, so output reads like
 * the placeholder everybody recognises.
 */
const LOREM_SENTENCES: readonly string[] = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
  "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.",
  "Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit, sed quia non numquam eius modi tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem.",
  "Ut enim ad minima veniam, quis nostrum exercitationem ullam corporis suscipit laboriosam, nisi ut aliquid ex ea commodi consequatur.",
  "Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae consequatur, vel illum qui dolorem eum fugiat quo voluptas nulla pariatur.",
  "Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus, omnis voluptas assumenda est, omnis dolor repellendus.",
  "Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae.",
  "Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis voluptatibus maiores alias consequatur aut perferendis doloribus asperiores repellat.",
  "Tempora incidunt ut labore et dolore magnam aliquam quaerat voluptatem, ut enim ad minima veniam quis nostrum exercitationem ullam corporis suscipit laboriosam nisi ut aliquid ex ea commodi consequatur.",
  "On the other hand, we denounce with righteous indignation and dislike men who are so beguiled and demoralised by the charms of pleasure of the moment, blinded by desire, that they cannot foresee the pain and trouble that are bound to ensue.",
  "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.",
  "Et harum quidem rerum facilis est et expedita distinctio, nam libero tempore cum soluta nobis est eligendi optio cumque nihil impedit quo minus id quod maxime placeat facere possimus omnis voluptas assumenda est omnis dolor repellendus.",
  "Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet ut et voluptates repudiandae sint et molestiae non recusandae itaque earum rerum hic tenetur a sapiente delectus.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium totam rem aperiam eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo nemo enim ipsam voluptatem.",
];

/**
 * "Bacon ipsum" style filler. Original mock-elegiac prose written for this
 * tool in the spirit of the generator everyone knows — not a quotation.
 */
const BACON_SENTENCES: readonly string[] = [
  "To improve thy chances at the table, bacon ipsum dolor sit amet shall be the first course.",
  "Hark, good sir, a kingdom for a rasher of belly, for thy heart is a hungry beast and the belly knows no season.",
  "I have measured many a man with a finer eye, yet never one whose counsel was so well seasoned as this.",
  "Let the bacon be rendered unto thee, and the doubtings of the household shall melt away like fat upon the fire.",
  "Verily, a goodly slice is a lantern in the dark, and the man who cuts it generously is beloved of his neighbour.",
  "Beware the man who speaketh of virtue whilst chewing, for he is the sort of knave the pot doth never boil.",
  "There was a landlord in the north who promised a feast, and delivered a single sausage, and was never invited home again.",
  "Marry, this is the paradox of the larder, that the more we take away, the more we boast of what remains.",
  "And so the cook heeded the season, and the table learned what patience is worth at a winter's end.",
  "Give a man a fire and he will warm his hands, give him a flagon of ale and he will warm the whole household.",
  "Thou wouldst not part with thy dinner, and yet thou wouldst part with thy patience, which is the cheaper of the two.",
  "Thus it is written upon the old stone: eat well, speak little, and keep thy bacon out of other men's reach.",
  "Now be not deceived by the thin cut, for it is the fat cut that carries the honest weight of the meal.",
  "Lo, the gravy ran freely, and the company forgave everything, which is the surest sign of a well-cooked dish.",
];

const BACON_WORDS: readonly string[] = [
  "bacon", "ham", "gammon", "larder", "kitchen", "pantry", "skillet", "brisket", "crust",
  "gravy", "sauce", "salt", "pepper", "crumb", "oven", "hearth", "spit", "knife", "plate",
  "table", "supper", "breakfast", "tavern", "ale", "stout", "pudding", "sausage", "fat",
  "crust", "dripping", "savoury", "tinder", "peasant", "kitchen", "servant",
];

export type LoremCorpus = "lorem" | "bacon" | "custom";
export type LoremMode = "per-paragraph" | "total";
export type LoremFormat = "text" | "html";

export interface LoremOptions {
  corpus: LoremCorpus;
  mode: LoremMode;
  paragraphs: number;
  wordsPerParagraph: number;
  totalWords: number;
  startWithLorem: boolean;
  /** Do not reuse a sentence (or word) until the pool is exhausted. */
  noRepeat: boolean;
  format: LoremFormat;
  customWords: readonly string[];
}

export interface LoremResult {
  text: string;
  words: number;
  paragraphs: number;
  sentences: number;
}

const MIN_SENTENCE_WORDS = 6;
const MAX_SENTENCE_WORDS = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** A uniform random integer in [0, max) using the platform CSPRNG. */
function randomIndex(max: number): number {
  if (max <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0]!;
  } while (value >= limit);
  return value % max;
}

/** Fisher–Yates using `crypto.getRandomValues`, so a shuffle is not seedable. */
export function shuffleArray<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Build placeholder copy. A new draw every time the controls change or the
 * Generate button is pressed, so the output is never a fixed block of text.
 */
export function generateLorem(options: LoremOptions): LoremResult {
  const {
    corpus,
    mode,
    paragraphs: rawParagraphs,
    wordsPerParagraph: rawWords,
    totalWords: rawTotal,
    startWithLorem,
    noRepeat,
    format,
    customWords,
  } = options;

  const paragraphCount = clamp(rawParagraphs, 1, 50);
  const perParagraph = clamp(rawWords, 1, 500);
  const total = clamp(rawTotal, 1, 20_000);

  const words = customWords
    .flatMap((line) => line.split(/[\s,]+/))
    .map((word) => word.trim())
    .filter((word) => word.length > 0);

  if (corpus === "custom" && words.length === 0) {
    return { text: "", words: 0, paragraphs: 0, sentences: 0 };
  }

  // A shuffled queue of sentences. In no-repeat mode the queue is only
  // reshuffled once every sentence has been used, which is what keeps the
  // output from looking mechanically repetitive.
  let queue: string[] = [];
  const refill = (): void => {
    const pool =
      corpus === "lorem"
        ? [...LOREM_SENTENCES]
        : corpus === "bacon"
          ? [...BACON_SENTENCES]
          : // A word list is always shuffled: emitting it in the order it was
            // typed would repeat the same paragraph forever.
            buildWordSentences(words);
    queue = shuffleArray(pool);
  };
  refill();

  const nextSentence = (): string => {
    // No-repeat mode drains the whole pool before it is reshuffled, so nothing
    // appears twice until every other sentence has been used. With it off the
    // pool is reshuffled on every draw and repeats are allowed.
    if (queue.length === 0 || !noRepeat) refill();
    return queue.pop() ?? LOREM_SENTENCES[0]!;
  };

  // Each target is one paragraph's word budget. In "total" mode the budget is
  // split evenly across a number of paragraphs derived from the request.
  const targets: number[] = [];
  if (mode === "per-paragraph") {
    for (let i = 0; i < paragraphCount; i += 1) targets.push(perParagraph);
  } else {
    const average = (MIN_SENTENCE_WORDS + MAX_SENTENCE_WORDS) / 2;
    const count = Math.max(1, Math.round(total / average));
    const base = Math.floor(total / count);
    for (let i = 0; i < count; i += 1) {
      targets.push(i < total % count ? base + 1 : base);
    }
  }

  // Step 1 — assemble whole sentences until every budget is met. Whole
  // sentences only, so the prose reads naturally.
  const groups: string[][] = targets.map(() => []);
  for (let p = 0; p < targets.length; p += 1) {
    let budget = targets[p]!;
    if (p === 0 && startWithLorem && corpus !== "custom") {
      groups[p]!.push(LOREM_OPENING);
      budget -= wordCount(LOREM_OPENING);
    }
    while (budget > 0) {
      const sentence = nextSentence();
      groups[p]!.push(sentence);
      budget -= wordCount(sentence);
    }
  }

  // Step 2 — in "total" mode the request is a hard ceiling: the last sentence
  // is cut on a word boundary so the output lands on the requested count.
  if (mode === "total") {
    let budget = total;
    let stopGroup = groups.length;
    let stopIndex = 0;
    search: for (let g = 0; g < groups.length; g += 1) {
      const group = groups[g]!;
      for (let i = 0; i < group.length; i += 1) {
        if (budget <= 0) {
          stopGroup = g;
          stopIndex = i;
          break search;
        }
        const cost = wordCount(group[i]!);
        if (cost > budget) {
          const words = group[i]!.split(/\s+/).slice(0, Math.max(1, budget));
          group[i] = `${words.join(" ")}.`;
          stopGroup = g;
          stopIndex = i + 1;
          break search;
        }
        budget -= cost;
      }
    }
    for (let g = stopGroup; g < groups.length; g += 1) {
      groups[g]!.length = g === stopGroup ? stopIndex : 0;
    }
  }

  const paragraphs: string[] = [];
  for (const group of groups) {
    const text = group.join(" ").trim();
    if (text.length > 0) paragraphs.push(text);
  }

  const text =
    format === "html"
      ? paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n")
      : paragraphs.join("\n\n");

  return {
    text,
    words: wordCount(text.replace(/<\/?p>/g, " ")),
    paragraphs: paragraphs.length,
    sentences: splitSentences(paragraphs.join(" ")).length,
  };
}

/** Turn a custom word list into sentences of a plausible length, shuffled. */
function buildWordSentences(words: readonly string[]): string[] {
  const sentences: string[] = [];
  const pool = shuffleArray(words);
  const perSentence = Math.max(MIN_SENTENCE_WORDS, Math.min(MAX_SENTENCE_WORDS, Math.round(words.length / 4) || 8));
  if (words.length <= perSentence) return [`${words.join(" ")}.`];
  for (let i = 0; i < pool.length; i += perSentence) {
    sentences.push(`${pool.slice(i, i + perSentence).join(" ")}.`);
  }
  return sentences.length > 0 ? sentences : [`${words.join(" ")}.`];
}

/* ================================================================== */
/*  Markdown rendering                                                 */
/* ================================================================== */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape every character that could open a tag or attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/**
 * Only these URL schemes survive. Everything else — `javascript:`, `data:`,
 * `vbscript:` and any scheme we have not thought about — is rejected, so the
 * check fails closed.
 */
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:|ftp:)/i;

export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim().replace(/[\u0000-\u0020]+/g, "");
  if (!url) return null;
  // Relative, anchor and protocol-relative URLs contain no scheme at all.
  if (/^[#?/]/.test(url) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
    return /[\s<>"]/.test(url) ? null : url;
  }
  if (!SAFE_SCHEME.test(url)) return null;
  return /[\s<>"]/.test(url) ? null : url;
}

/* -- raw HTML policy -------------------------------------------------- */

/**
 * Tags allowed to survive when the user turns "allow inline HTML" on. Inline
 * phrasing content only: nothing that can host script, load a document, or
 * re-parent the surrounding block structure.
 */
const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "del", "dfn", "em", "i", "img",
  "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup",
  "time", "u", "var", "wbr",
]);

/** Allowed tags that have no closing tag. */
const VOID_TAGS = new Set(["br", "img", "wbr"]);

/** Elements removed *with their content* — they are never merely unwrapped. */
const DANGEROUS_TAGS = [
  "script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math",
  "form", "textarea", "title", "head", "link", "meta", "base", "frame", "frameset",
  "applet", "audio", "video", "canvas", "portal",
];

/** Attributes kept per tag. `on*` and `style` are not on any list, by design. */
const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  time: new Set(["datetime"]),
  q: new Set(["cite"]),
  del: new Set(["cite", "datetime"]),
  ins: new Set(["cite", "datetime"]),
  abbr: new Set(["title"]),
  input: new Set(["type", "checked", "disabled"]),
};

const ATTR_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function safeAttributes(tag: string, raw: string): string {
  const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
  const out: string[] = [];
  ATTR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = ATTR_PATTERN.exec(raw);
  while (match !== null) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    // Never trust an attribute we have not explicitly allowed, and never an
    // event handler — the `on` prefix check is a belt to the allowlist braces.
    if (!name.startsWith("on") && allowed.has(name)) {
      if (name === "href" || name === "src" || name === "cite") {
        const url = sanitizeUrl(value);
        if (url) {
          out.push(`${name}="${escapeHtml(url)}"`);
          if (tag === "a") {
            out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
          }
        }
      } else if (tag === "input") {
        if (name === "type" && value.toLowerCase() === "checkbox") out.push('type="checkbox"');
        if (name === "checked" || name === "disabled") out.push(name);
      } else {
        out.push(`${name}="${escapeHtml(value)}"`);
      }
    }
    match = ATTR_PATTERN.exec(raw);
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

/**
 * Delete elements that can execute code or load a document, *including their
 * content*. Repeats until stable so nested pairs cannot slip out. Comments,
 * doctypes and processing instructions go too — they never render.
 */
function stripDangerousElements(raw: string): string {
  let text = raw;
  let changed = true;
  while (changed) {
    changed = false;
    for (const tag of DANGEROUS_TAGS) {
      const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
      const next = text
        .replace(paired, "")
        .replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<![^>]*>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
}

/**
 * Sanitise a single tag, keeping its original open/close shape so a run of
 * inline HTML keeps the structure the author wrote. "" means "dropped".
 */
function sanitizeTag(raw: string): string {
  const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>$/.exec(raw);
  if (!match) return "";
  const slash = match[1]!;
  const tag = match[2]!.toLowerCase();
  const rawAttrs = match[3]!;

  // An unknown tag is dropped; its text content survives.
  if (!ALLOWED_TAGS.has(tag)) return "";
  if (slash === "/") return /\/\s*$/.test(rawAttrs) ? "" : `</${tag}>`;

  const attributes = safeAttributes(tag, rawAttrs);
  if (VOID_TAGS.has(tag)) return `<${tag}${attributes} />`;
  // A link with no usable href is no longer a link.
  if (tag === "a" && !attributes.includes(' href="')) return "";
  return `<${tag}${attributes}>`;
}

/**
 * Sanitise a run of raw HTML down to the inline allowlist above.
 *
 * This renderer escapes HTML by default — with `allowInlineHtml` off, a pasted
 * `<script>` tag ends up on the page as visible text. The toggle is for people
 * who deliberately want `<kbd>` and `<mark>`; even then it cannot emit a
 * script, an event handler, a `style` attribute or a `javascript:` URL.
 */
export function sanitizeInlineHtml(raw: string): string {
  return stripDangerousElements(raw).replace(RAW_TAG_GLOBAL, sanitizeTag);
}

export interface MarkdownOptions {
  /**
   * When true a safe subset of inline HTML is preserved instead of being shown
   * as text. Off by default — see `sanitizeInlineHtml`.
   */
  allowInlineHtml?: boolean;
}

export interface MarkdownRenderResult {
  html: string;
  /** Set when the source was longer than `MARKDOWN_RENDER_LIMIT`. */
  truncatedFrom: number | null;
}

/* -- inline ----------------------------------------------------------- */

const MARK_OPEN = "\uE000";
const MARK_CLOSE = "\uE001";
const MARK_PATTERN = /\uE000(\d+)\uE001/g;

const CODE_SPAN = /(`+)([\s\S]*?[^`])\1(?!`)/g;
const AUTOLINK = /<((?:https?:\/\/|ftp:\/\/|mailto:|tel:)[^\s<>]+)>/g;
const EMAIL_AUTOLINK = /<([\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,})>/gu;
const IMAGE = /!\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)/g;
const LINK = /\[((?:[^\[\]\\]|\\.)*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)/g;
const BARE_URL = /(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?'"])/g;
const RAW_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:"[^"]*"|'[^']*'|[^>])*>/g;
const RAW_TAG_GLOBAL = new RegExp(RAW_TAG.source, "g");

function restoreMarks(text: string, items: readonly string[]): string {
  if (items.length === 0) return text;
  return text.replace(MARK_PATTERN, (_match, index: string) => items[Number(index)] ?? "");
}

function mark(items: string[], html: string): string {
  items.push(html);
  return `${MARK_OPEN}${items.length - 1}${MARK_CLOSE}`;
}

/** Render one line of inline Markdown to HTML. */
export function renderInline(source: string, options: MarkdownOptions = {}): string {
  const items: string[] = [];
  let text = source;

  // 1. Code spans come out first so nothing inside them is ever re-parsed.
  text = text.replace(CODE_SPAN, (_match, _fence: string, code: string) =>
    mark(items, `<code>${escapeHtml(code.trim())}</code>`),
  );

  // 2. Autolinks before raw HTML, or `<https://x>` would look like a <https> tag.
  text = text.replace(AUTOLINK, (_match, url: string) => {
    const href = sanitizeUrl(url);
    if (!href) return escapeHtml(url);
    return mark(
      items,
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url)}</a>`,
    );
  });

  // 2b. `<someone@example.com>` becomes a mailto link.
  text = text.replace(EMAIL_AUTOLINK, (_match, address: string) =>
    mark(
      items,
      `<a href="mailto:${escapeHtml(address)}">${escapeHtml(address)}</a>`,
    ),
  );

  // 3. Optional inline HTML, reduced to the allowlist. Each tag is sanitised
  //    on its own so the surrounding text still goes through emphasis, and the
  //    closing tag of a dropped element is dropped with it.
  if (options.allowInlineHtml) {
    text = stripDangerousElements(text);
    const dropped = new Set<string>();
    text = text.replace(RAW_TAG, (tag) => {
      const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag);
      const name = head ? head[2]!.toLowerCase() : "";
      if (head && head[1] === "/") {
        if (dropped.delete(name)) return "";
        const safe = sanitizeTag(tag);
        return safe ? mark(items, safe) : "";
      }
      const safe = sanitizeTag(tag);
      if (!safe) {
        if (name && !VOID_TAGS.has(name)) dropped.add(name);
        return "";
      }
      return mark(items, safe);
    });
  }

  // 4. Images before links, so `![alt](src)` does not become `!` + link.
  text = text.replace(IMAGE, (_match, alt: string, src: string, title?: string) => {
    const url = sanitizeUrl(src);
    if (!url) return escapeHtml(alt);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return mark(items, `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy" />`);
  });

  text = text.replace(LINK, (_match, label: string, href: string, title?: string) => {
    const url = sanitizeUrl(href);
    if (!url) return renderInline(label, options);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return mark(
      items,
      `<a href="${escapeHtml(url)}"${titleAttr} target="_blank" rel="noopener noreferrer nofollow">${renderInline(label, options)}</a>`,
    );
  });

  // 5. Bare URLs become links too — but only when nobody wrapped them already.
  text = text.replace(BARE_URL, (_match, prefix: string, url: string) => {
    const href = sanitizeUrl(url.startsWith("www.") ? `https://${url}` : url);
    if (!href) return prefix + escapeHtml(url);
    return `${prefix}${mark(
      items,
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(url)}</a>`,
    )}`;
  });

  // 6. Everything still visible is text, so it gets escaped.
  text = escapeHtml(text);

  // 7. Emphasis. `**` before `*`, and `_` is only emphasis at word edges so
  //    `snake_case` survives intact.
  text = text
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/\*\*+(?=\S)([\s\S]*?\S)\*\*+/g, "<strong>$1</strong>")
    .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?[^_])__(?![\p{L}\p{N}_])/gu, (_m, p: string, inner: string) => `${p}<strong>${inner}</strong>`)
    .replace(/\*(?=\S)([^*\n]+?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]+?)_(?![\p{L}\p{N}_])/gu, (_m, p: string, inner: string) => `${p}<em>${inner}</em>`);

  // 8. Hard line breaks: two trailing spaces, or a trailing backslash.
  text = text.replace(/(?: {2,}|\\)\n/g, "<br />\n");

  return restoreMarks(text, items);
}

/* -- blocks ----------------------------------------------------------- */

interface FenceMatch {
  marker: "`" | "~";
  length: number;
  indent: number;
  info: string;
}

function matchFence(line: string): FenceMatch | null {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
  if (!match) return null;
  const marker = match[1]!;
  const info = (match[2] ?? "").trim();
  // An info string for a backtick fence may not itself contain a backtick.
  if (marker.startsWith("`") && info.includes("`")) return null;
  return {
    marker: marker[0] as "`" | "~",
    length: marker.length,
    indent: line.length - line.trimStart().length,
    info,
  };
}

function dedent(lines: readonly string[], size: number): string {
  return lines.map((line) => (size > 0 ? line.replace(new RegExp(`^ {0,${size}}`), "") : line)).join("\n");
}

function isThematicBreak(line: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

interface ListItem {
  indent: number;
  ordered: boolean;
  start: number;
  content: string;
}

function matchListItem(line: string): ListItem | null {
  const unordered = /^(\s*)([-*+])[ \t]+(.*)$/.exec(line);
  if (unordered) {
    return {
      indent: unordered[1]!.length,
      ordered: false,
      start: 1,
      content: unordered[3]!,
    };
  }
  const ordered = /^(\s*)(\d{1,9})([.)])[ \t]+(.*)$/.exec(line);
  if (ordered) {
    return {
      indent: ordered[1]!.length,
      ordered: true,
      start: Number(ordered[2]),
      content: ordered[4]!,
    };
  }
  return null;
}

function renderBlocks(lines: readonly string[], options: MarkdownOptions): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = matchFence(line);
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      const closing = new RegExp(`^ {0,3}\\${fence.marker}{${fence.length},}[ \\t]*$`);
      while (j < lines.length) {
        if (closing.test(lines[j]!)) {
          j += 1;
          break;
        }
        body.push(lines[j]!);
        j += 1;
      }
      const language = fence.info.split(/\s+/)[0] ?? "";
      const safeLanguage = /^[A-Za-z0-9_+#.-]{1,32}$/.test(language) ? language : "";
      const codeClass = safeLanguage ? ` class="language-${escapeHtml(safeLanguage)}"` : "";
      out.push(`<pre><code${codeClass}>${escapeHtml(dedent(body, fence.indent))}\n</code></pre>`);
      i = j;
      continue;
    }

    if (isThematicBreak(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (heading) {
      const depth = heading[1]!.length;
      const text = (heading[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      out.push(`<h${depth}>${renderInline(text, options)}</h${depth}>`);
      i += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length) {
        const current = lines[j]!;
        if (/^ {0,3}>/.test(current)) {
          inner.push(current.replace(/^ {0,3}>[ \t]?/, ""));
          j += 1;
          continue;
        }
        if (current.trim() === "") break;
        inner.push(current);
        j += 1;
      }
      out.push(`<blockquote>\n${renderBlocks(inner, options)}\n</blockquote>`);
      i = j;
      continue;
    }

    if (matchListItem(line)) {
      const list = renderList(lines, i, options);
      out.push(list.html);
      i = list.next;
      continue;
    }

    const buffer: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      const current = lines[i]!;
      if (
        isThematicBreak(current) ||
        matchFence(current) ||
        matchListItem(current) ||
        /^ {0,3}>/.test(current) ||
        /^ {0,3}#{1,6}(?:[ \t]|$)/.test(current)
      ) {
        break;
      }
      buffer.push(current);
      i += 1;
    }
    if (buffer.length > 0) {
      out.push(`<p>${renderInline(buffer.join("\n"), options)}</p>`);
    }
  }

  return out.join("\n");
}

function renderList(lines: readonly string[], start: number, options: MarkdownOptions): { html: string; next: number } {
  const first = matchListItem(lines[start]!)!;
  const baseIndent = first.indent;
  const items: string[][] = [];
  let current: string[] | null = null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    const item = matchListItem(line);

    if (item && item.indent <= baseIndent && item.ordered === first.ordered) {
      if (current) items.push(current);
      current = [item.content];
      i += 1;
      continue;
    }

    if (line.trim() === "") {
      let j = i;
      while (j < lines.length && lines[j]!.trim() === "") j += 1;
      if (j >= lines.length) {
        i = j;
        break;
      }
      const nextLine = lines[j]!;
      const nextItem = matchListItem(nextLine);
      const nextIndent = nextLine.length - nextLine.trimStart().length;
      if (nextItem && nextItem.indent <= baseIndent) {
        if (current) items.push(current);
        current = null;
        i = j;
        break;
      }
      if (nextIndent > baseIndent) {
        if (current) current.push("");
        i = j;
        continue;
      }
      if (current) items.push(current);
      current = null;
      i = j;
      break;
    }

    if (current) {
      const indent = line.length - line.trimStart().length;
      current.push(line.slice(Math.min(indent, baseIndent + 2)));
      i += 1;
      continue;
    }

    break;
  }
  if (current) items.push(current);

  const rendered = items.map((itemLines) => {
    const head = itemLines[0] ?? "";
    const task = /^\[([ xX])\][ \t]+(.*)$/.exec(head);
    const body = task ? [task[2]!, ...itemLines.slice(1)] : itemLines;
    let inner = renderBlocks(body, options).trim();
    // A tight item is a single run of inline content, not a <p>.
    inner = inner.replace(/^<p>([\s\S]*?)<\/p>$/, "$1");
    const checkbox = task
      ? `<input type="checkbox" disabled${task[1]!.toLowerCase() === "x" ? " checked" : ""} /> `
      : "";
    return `<li>${checkbox}${inner}</li>`;
  });

  const tag = first.ordered ? "ol" : "ul";
  const startAttr = first.ordered && first.start !== 1 ? ` start="${first.start}"` : "";
  return { html: `<${tag}${startAttr}>\n${rendered.join("\n")}\n</${tag}>`, next: i };
}

/**
 * Markdown → HTML.
 *
 * Security policy, in one place: every character of text output is escaped, so
 * pasted markup is inert by default. Links and images only keep an href/src if
 * the scheme is http(s), mailto, tel or ftp; anything else loses the attribute.
 * The optional inline-HTML toggle can emit the allowlist in `sanitizeInlineHtml`
 * and nothing else — no script elements (with or without content), no `on*`
 * handler, no `style`, no `javascript:` URL.
 */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): MarkdownRenderResult {
  let text = source.replace(/\r\n?/g, "\n");
  let truncatedFrom: number | null = null;
  if (text.length > MARKDOWN_RENDER_LIMIT) {
    truncatedFrom = text.length;
    text = text.slice(0, MARKDOWN_RENDER_LIMIT);
  }
  return { html: renderBlocks(text.split("\n"), options), truncatedFrom };
}

/** A complete, standalone document for the "Download .html" action. */
export function wrapHtmlDocument(title: string, bodyHtml: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    "</head>",
    "<body>",
    bodyHtml,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export interface MarkdownStats {
  words: number;
  characters: number;
  headings: number;
  links: number;
  codeBlocks: number;
  images: number;
}

export function markdownStats(source: string): MarkdownStats {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let headings = 0;
  let codeBlocks = 0;
  let inFence = false;
  for (const line of lines) {
    if (matchFence(line)) {
      if (!inFence) codeBlocks += 1;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line)) headings += 1;
  }
  return {
    words: wordCount(source),
    characters: source.length,
    headings,
    codeBlocks,
    links: (source.match(/(?<!!)\[[^\]]*\]\(/g) ?? []).length,
    images: (source.match(/!\[[^\]]*\]\(/g) ?? []).length,
  };
}

/* ================================================================== */
/*  Find & replace                                                     */
/* ================================================================== */

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** `m` flag — `^` and `$` match at line boundaries. */
  multiline: boolean;
  /** Interpret `$1` / `$2` in the replacement. Requires a capturing pattern. */
  backreferences: boolean;
}

export type CompileResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: string; pathological: boolean };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Heuristics, not a proof: a quantifier applied to a group that already
 * contains a quantifier, or a quantifier stacked straight after `.*`, is the
 * shape that makes a backtracking engine hang. We refuse those outright.
 */
export function looksPathological(pattern: string): boolean {
  const nested = /\([^()]{0,400}(?:[*+]|\{\d+,\d*\})[^()]{0,400}\)\s*(?:[*+]|\{\d+,\d*\})/;
  const stacked = /(?:\.\*|\.\+|\[[^\]]{0,80}\])\s*(?:[*+]|\{\d+,\d*\})/;
  return nested.test(pattern) || stacked.test(pattern);
}

/** Compile the user's find pattern, or explain why it will not compile. */
export function compileFinder(pattern: string, options: FindOptions): CompileResult {
  if (pattern === "") {
    return { ok: false, error: "Type something to find.", pathological: false };
  }

  let source = options.regex ? pattern : escapeRegExp(pattern);

  if (options.wholeWord) {
    const startsWord = /^[\p{L}\p{N}_]/u.test(source);
    const endsWord = /[\p{L}\p{N}_]$/u.test(source);
    // `(?:…)` keeps the author's own group numbering intact, so $1 still
    // refers to their first capture group.
    source = `${startsWord ? "\\b" : ""}(?:${source})${endsWord ? "\\b" : ""}`;
  }

  const flags = `g${options.matchCase ? "" : "i"}${options.multiline ? "m" : ""}`;

  if (options.regex && looksPathological(pattern)) {
    return {
      ok: false,
      pathological: true,
      error:
        "That pattern has a quantifier wrapped around another one, which can freeze the browser. Simplify it — for example (a+)+ becomes a+.",
    };
  }

  try {
    return { ok: true, regex: new RegExp(source, flags) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The pattern is not valid.";
    return { ok: false, pathological: false, error: `That regular expression isn't valid: ${detail}` };
  }
}

export interface MatchRange {
  start: number;
  end: number;
  text: string;
}

export interface MatchResult {
  matches: MatchRange[];
  /** True when we stopped early because there were too many to enumerate. */
  truncated: boolean;
}

/** Enumerate matches, with the empty-match guard that keeps `x*` terminating. */
export function findMatches(text: string, regex: RegExp, limit = MATCH_LIMIT): MatchResult {
  const scanner = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  const matches: MatchRange[] = [];
  let match: RegExpExecArray | null = scanner.exec(text);

  while (match !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    if (match[0].length === 0) scanner.lastIndex += 1;
    if (scanner.lastIndex > text.length) break;
    if (matches.length >= limit) return { matches, truncated: true };
    match = scanner.exec(text);
  }
  return { matches, truncated: false };
}

/**
 * Apply a replacement. With `backreferences` off the replacement is a literal
 * string, so a literal `$` in the text is never interpreted.
 */
export function applyReplacement(
  text: string,
  regex: RegExp,
  replacement: string,
  options: { all: boolean; backreferences: boolean },
): { text: string; count: number } {
  const before = findMatches(text, regex);
  if (options.all) {
    const next = options.backreferences
      ? text.replace(regex, replacement)
      : text.replace(regex, () => replacement);
    return { text: next, count: before.matches.length };
  }
  const single = new RegExp(regex.source, regex.flags.replace(/g/g, ""));
  const next = options.backreferences ? text.replace(single, replacement) : text.replace(single, () => replacement);
  return { text: next, count: next === text ? 0 : 1 };
}

/** How many capture groups the pattern exposes, for the help text. */
export function countCaptureGroups(pattern: string, options: FindOptions): number {
  const compiled = compileFinder(pattern, options);
  if (!compiled.ok) return 0;
  // `(` that is neither escaped nor a group opener, plus `(?<name>`.
  const openers = compiled.regex.source.match(/(?<!\\)\((?!\?[:=!])/g) ?? [];
  return openers.length;
}

/* ================================================================== */
/*  Line diff                                                          */
/* ================================================================== */

type LcsOp = { kind: "eq"; a: number; b: number } | { kind: "del"; a: number } | { kind: "ins"; b: number };

/**
 * Myers O(ND) diff over any comparable sequence. Returns null when the edit
 * distance blows past `maxD`, so the caller can degrade instead of freezing.
 * `trace` costs O(D) rows of O(N+M) and `maxD` is capped by DIFF_MAX_EDIT_DISTANCE.
 */
function lcsDiff<T>(a: readonly T[], b: readonly T[], maxD: number): LcsOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const max = Math.min(n + m, maxD);
  const offset = max;
  const size = 2 * max + 2;
  const v = new Int32Array(size);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)) {
        x = v[k + 1 + offset]!;
      } else {
        x = v[k - 1 + offset]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d, offset);
    }
  }
  return null;
}

function backtrack<T>(trace: readonly Int32Array[], a: readonly T[], b: readonly T[], dEnd: number, offset: number): LcsOp[] {
  const ops: LcsOp[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = dEnd; d > 0; d -= 1) {
    const v = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!) ? k + 1 : k - 1;
    const prevX = v[prevK + offset]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: "eq", a: x - 1, b: y - 1 });
      x -= 1;
      y -= 1;
    }
    // A "right" step consumed a line of A (a deletion); a "down" step consumed
    // a line of B (an insertion). Exactly one of x / y moves.
    if (x > prevX) {
      ops.push({ kind: "del", a: x - 1 });
      x -= 1;
    } else {
      ops.push({ kind: "ins", b: y - 1 });
      y -= 1;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: "eq", a: x - 1, b: y - 1 });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    ops.push({ kind: "del", a: x - 1 });
    x -= 1;
  }
  while (y > 0) {
    ops.push({ kind: "ins", b: y - 1 });
    y -= 1;
  }
  return ops.reverse();
}

export interface DiffWordPart {
  text: string;
  changed: boolean;
}

export type DiffRowType = "equal" | "insert" | "delete" | "replace";

export interface DiffRow {
  type: DiffRowType;
  left?: string;
  right?: string;
  leftNo?: number;
  rightNo?: number;
  leftParts?: DiffWordPart[];
  rightParts?: DiffWordPart[];
}

export interface DiffOptions {
  ignoreWhitespace?: boolean;
  ignoreCase?: boolean;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
  changed: number;
  linesA: number;
  linesB: number;
  /** True when the edit distance was capped and the middle is shown as one block. */
  approximate: boolean;
}

export type DiffOutcome = { ok: true; result: DiffResult } | { ok: false; error: string };

function normaliseLine(line: string, options: DiffOptions): string {
  // "Ignore whitespace" behaves like `diff -w`: every run of spaces, tabs and
  // other horizontal whitespace collapses to a single space, and the ends are
  // trimmed, so indentation-only edits disappear.
  const folded = options.ignoreWhitespace ? line.replace(/[^\S\n]+/g, " ").trim() : line;
  return options.ignoreCase ? folded.toLowerCase() : folded;
}

/** Word-level parts for a changed line pair, or null when it is too large. */
function wordParts(a: string, b: string): { left: DiffWordPart[]; right: DiffWordPart[] } | null {
  if (a.length + b.length > DIFF_WORD_LIMIT) return null;
  const leftTokens = a.match(/\s+|[^\s]+/g) ?? [];
  const rightTokens = b.match(/\s+|[^\s]+/g) ?? [];
  // A tight edit-distance cap keeps the trace small; past it we simply show
  // the line pair without word-level highlighting.
  const ops = lcsDiff(leftTokens, rightTokens, 400);
  if (!ops) return null;

  const left: DiffWordPart[] = [];
  const right: DiffWordPart[] = [];
  const push = (target: DiffWordPart[], text: string, changed: boolean): void => {
    const last = target[target.length - 1];
    if (last && last.changed === changed) last.text += text;
    else target.push({ text, changed });
  };

  for (const op of ops) {
    if (op.kind === "eq") {
      push(left, leftTokens[op.a]!, false);
      push(right, rightTokens[op.b]!, false);
    } else if (op.kind === "del") {
      push(left, leftTokens[op.a]!, true);
    } else {
      push(right, rightTokens[op.b]!, true);
    }
  }
  return { left, right };
}

/**
 * Line-level diff of two texts. Returns a readable error instead of running
 * when the inputs are past the cap, so a 5 MB paste cannot wedge the tab.
 */
export function diffLines(original: string, updated: string, options: DiffOptions = {}): DiffOutcome {
  if (original.length > DIFF_CHAR_LIMIT || updated.length > DIFF_CHAR_LIMIT) {
    return {
      ok: false,
      error: `This tool compares up to ${Math.round(DIFF_CHAR_LIMIT / 1024)} KB per side. Yours is ${Math.max(original.length, updated.length) > DIFF_CHAR_LIMIT ? "larger" : "within the limit"} — trim the documents, or compare them in sections.`,
    };
  }

  const leftLines = original.split(/\r\n|\r|\n/);
  const rightLines = updated.split(/\r\n|\r|\n/);
  if (leftLines.length > DIFF_LINE_LIMIT || rightLines.length > DIFF_LINE_LIMIT) {
    return {
      ok: false,
      error: `This tool compares up to ${DIFF_LINE_LIMIT.toLocaleString("en")} lines per side. Yours has ${Math.max(leftLines.length, rightLines.length).toLocaleString("en")} — compare it in sections.`,
    };
  }

  const leftKeys = leftLines.map((line) => normaliseLine(line, options));
  const rightKeys = rightLines.map((line) => normaliseLine(line, options));

  // Cheap win: peel off the identical head and tail first.
  let head = 0;
  while (head < leftKeys.length && head < rightKeys.length && leftKeys[head] === rightKeys[head]) head += 1;
  let tail = 0;
  while (
    tail < leftKeys.length - head &&
    tail < rightKeys.length - head &&
    leftKeys[leftKeys.length - 1 - tail] === rightKeys[rightKeys.length - 1 - tail]
  ) {
    tail += 1;
  }

  const ops: LcsOp[] = [];
  for (let i = 0; i < head; i += 1) ops.push({ kind: "eq", a: i, b: i });

  const midLeft = leftKeys.slice(head, leftKeys.length - tail);
  const midRight = rightKeys.slice(head, rightKeys.length - tail);
  let approximate = false;
  const middle = lcsDiff(midLeft, midRight, DIFF_MAX_EDIT_DISTANCE);

  if (middle === null) {
    approximate = true;
    midLeft.forEach((_, index) => ops.push({ kind: "del", a: head + index }));
    midRight.forEach((_, index) => ops.push({ kind: "ins", b: head + index }));
  } else {
    for (const op of middle) {
      if (op.kind === "eq") ops.push({ kind: "eq", a: head + op.a, b: head + op.b });
      else if (op.kind === "del") ops.push({ kind: "del", a: head + op.a });
      else ops.push({ kind: "ins", b: head + op.b });
    }
  }

  for (let i = 0; i < tail; i += 1) {
    ops.push({ kind: "eq", a: leftKeys.length - tail + i, b: rightKeys.length - tail + i });
  }

  const rows = groupRows(ops, leftLines, rightLines);
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const row of rows) {
    if (row.type === "insert") added += 1;
    else if (row.type === "delete") removed += 1;
    else if (row.type === "replace") changed += 1;
  }

  return {
    ok: true,
    result: {
      rows,
      added,
      removed,
      changed,
      linesA: leftLines.length,
      linesB: rightLines.length,
      approximate,
    },
  };
}

function groupRows(ops: readonly LcsOp[], left: readonly string[], right: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  let leftNo = 1;
  let rightNo = 1;

  while (i < ops.length) {
    const op = ops[i]!;
    if (op.kind === "eq") {
      rows.push({ type: "equal", left: left[op.a], right: right[op.b], leftNo, rightNo });
      leftNo += 1;
      rightNo += 1;
      i += 1;
      continue;
    }

    const deletions: number[] = [];
    const insertions: number[] = [];
    while (i < ops.length && ops[i]!.kind !== "eq") {
      const current = ops[i]!;
      if (current.kind === "del") deletions.push(current.a);
      else if (current.kind === "ins") insertions.push(current.b);
      i += 1;
    }

    const pairs = Math.min(deletions.length, insertions.length);
    for (let p = 0; p < pairs; p += 1) {
      const leftText = left[deletions[p]!] ?? "";
      const rightText = right[insertions[p]!] ?? "";
      const parts = wordParts(leftText, rightText);
      rows.push({
        type: "replace",
        left: leftText,
        right: rightText,
        leftNo: leftNo + p,
        rightNo: rightNo + p,
        leftParts: parts?.left,
        rightParts: parts?.right,
      });
    }
    for (let p = pairs; p < deletions.length; p += 1) {
      rows.push({ type: "delete", left: left[deletions[p]!], leftNo: leftNo + p });
    }
    for (let p = pairs; p < insertions.length; p += 1) {
      rows.push({ type: "insert", right: right[insertions[p]!], rightNo: rightNo + p });
    }
    leftNo += deletions.length;
    rightNo += insertions.length;
  }

  return rows;
}

/** A plain-text unified diff, ready to paste into a review or a patch. */
export function toUnifiedDiff(result: DiffResult, leftLabel = "original", rightLabel = "updated"): string {
  const lines: string[] = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  for (const row of result.rows) {
    if (row.type === "equal") {
      lines.push(`  ${row.left ?? ""}`);
    } else if (row.type === "insert") {
      lines.push(`+ ${row.right ?? ""}`);
    } else if (row.type === "delete") {
      lines.push(`- ${row.left ?? ""}`);
    } else {
      lines.push(`- ${row.left ?? ""}`);
      lines.push(`+ ${row.right ?? ""}`);
    }
  }
  return lines.join("\n");
}

/* ================================================================== */
/*  Sorting                                                            */
/* ================================================================== */

export type SortMode =
  | "asc"
  | "desc"
  | "numeric"
  | "natural"
  | "length"
  | "reverse"
  | "shuffle"
  | "dedupe-sort";

export type SortScope = "lines" | "commas" | "words" | "csv";

export interface SortOptions {
  mode: SortMode;
  scope: SortScope;
  caseSensitive: boolean;
  ignoreArticles: boolean;
  stripBlankLines: boolean;
  /** 1-based column, CSV scope only. */
  column: number;
}

export interface SortResult {
  text: string;
  count: number;
  removed: number;
  itemsIn: number;
}

interface SortItem {
  cells: string[];
  raw: string;
}

const ARTICLE = /^(?:the|a|an)\s+/i;

/** Locale-aware, digit-aware comparison — `file10` sorts after `file9`. */
export function makeNaturalCollator(caseSensitive: boolean): Intl.Collator {
  return new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: caseSensitive ? "variant" : "base",
  });
}

function toNumber(value: string): number {
  const cleaned = value.replace(/[^0-9.eE+-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Minimal RFC-4180 row splitter: honours quoted fields containing commas. */
export function parseCsvRows(input: string): string[][] {
  return input.replace(/\r\n?/g, "\n").split("\n").map((line) => splitCsvRow(line));
}

function splitCsvRow(line: string): string[] {
  const row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    field += ch;
  }
  row.push(field);
  return row;
}

function toItems(input: string, scope: SortScope): SortItem[] {
  if (scope === "commas") {
    return input
      .split(/\s*,\s*/)
      .filter((value, index, all) => value !== "" || all.length === 1)
      .map((value) => ({ cells: [value], raw: value }));
  }
  if (scope === "words") {
    const trimmed = input.trim();
    return trimmed === "" ? [] : trimmed.split(/\s+/).map((value) => ({ cells: [value], raw: value }));
  }
  if (scope === "csv") {
    // The original line is kept so quoting and spacing survive the sort.
    return input
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => ({ cells: splitCsvRow(line), raw: line }));
  }
  return input.split(/\r\n|\r|\n/).map((value) => ({ cells: [value], raw: value }));
}

function compareBy(mode: SortMode, caseSensitive: boolean) {
  const collator = makeNaturalCollator(caseSensitive);
  const fold = (value: string): string => (caseSensitive ? value : value.toLowerCase());

  switch (mode) {
    case "natural":
      return (a: string, b: string): number => collator.compare(a, b);
    case "numeric": {
      return (a: string, b: string): number => {
        const na = toNumber(fold(a));
        const nb = toNumber(fold(b));
        if (Number.isNaN(na) && Number.isNaN(nb)) return collator.compare(fold(a), fold(b));
        if (Number.isNaN(na)) return 1;
        if (Number.isNaN(nb)) return -1;
        return na - nb;
      };
    }
    case "length":
      return (a: string, b: string): number => a.length - b.length || collator.compare(fold(a), fold(b));
    case "desc":
      return (a: string, b: string): number => {
        const fa = fold(a);
        const fb = fold(b);
        return fa < fb ? 1 : fa > fb ? -1 : 0;
      };
    default:
      return (a: string, b: string): number => {
        const fa = fold(a);
        const fb = fold(b);
        return fa < fb ? -1 : fa > fb ? 1 : 0;
      };
  }
}

/**
 * Sort, reverse, shuffle or dedupe a list of text values.
 *
 * The shuffle draws from `crypto.getRandomValues`, so it reseeds on every call
 * and cannot be predicted from a seed value.
 */
export function sortText(input: string, options: SortOptions): SortResult {
  const { mode, scope, caseSensitive, ignoreArticles, stripBlankLines, column } = options;

  let items = toItems(input, scope);
  const itemsIn = items.length;
  let removed = 0;

  if (stripBlankLines) {
    const kept = items.filter((item) => item.cells.some((cell) => cell.trim() !== ""));
    removed += items.length - kept.length;
    items = kept;
  }

  const keyOf = (item: SortItem): string => {
    const base = scope === "csv" ? (item.cells[Math.max(0, column - 1)] ?? "") : (item.cells[0] ?? "");
    const trimmed = base.trim();
    return ignoreArticles ? trimmed.replace(ARTICLE, "") : trimmed;
  };

  if (mode === "dedupe-sort") {
    const seen = new Set<string>();
    const kept: SortItem[] = [];
    for (const item of items) {
      const key = caseSensitive ? keyOf(item) : keyOf(item).toLowerCase();
      if (seen.has(key)) {
        removed += 1;
        continue;
      }
      seen.add(key);
      kept.push(item);
    }
    items = kept;
    const compare = compareBy("natural", caseSensitive);
    items.sort((a, b) => compare(keyOf(a), keyOf(b)));
  } else if (mode === "shuffle") {
    items = shuffleArray(items);
  } else if (mode === "reverse") {
    items = [...items].reverse();
  } else {
    const compare = compareBy(mode, caseSensitive);
    items.sort((a, b) => compare(keyOf(a), keyOf(b)));
  }

  const separator = scope === "commas" ? ", " : scope === "words" ? " " : "\n";
  return {
    text: items.map((item) => item.raw).join(separator),
    count: items.length,
    removed,
    itemsIn,
  };
}
