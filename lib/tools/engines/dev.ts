/**
 * Pure transforms behind the Developer tools.
 *
 * Everything here is dependency-free and React-free: the workspaces own the
 * UI, this file owns the logic. Optional heavy dependencies (`@noble/hashes`,
 * `qrcode`) are pulled in with `await import()` so they never land in a shared
 * bundle.
 *
 * The rule that outranks tidiness: when this file reports an error it reports
 * a *position*. "Invalid JSON" is not a message anyone can act on.
 */

/* ------------------------------------------------------------------ */
/*  Shared primitives                                                 */
/* ------------------------------------------------------------------ */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Web Crypto's `BufferSource` wants a definite `ArrayBuffer`, and the DOM lib
 * types our `Uint8Array` as possibly view-backed. Copying once keeps the rest
 * of this file free of generic ArrayBuffer noise.
 */
function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function utf8Encode(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) out += (bytes[i] & 0xff).toString(16).padStart(2, "0");
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url → bytes. Tolerates missing padding; rejects invalid characters. */
export function base64UrlToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

/** `performance.now()` with enough resolution to show a sub-millisecond digest. */
export function formatPreciseMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms <= 0) return "< 0.001 ms";
  if (ms < 1) return `${ms.toFixed(3)} ms`;
  return `${ms.toFixed(2)} ms`;
}

export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** The shape workspaces map onto `TextToolResult`. */
export interface TextOutcome {
  text: string;
  error?: string;
  errorDetail?: string;
  stats?: { label: string; value: string; tone?: "default" | "brand" | "success" }[];
  notes?: string[];
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/* ------------------------------------------------------------------ */
/*  Line/column mapping — shared by every parser that reports positions */
/* ------------------------------------------------------------------ */

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export function positionAt(source: string, offset: number): SourcePosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i += 1) {
    if (source.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1, offset: clamped };
}

export interface SourceSnippet {
  context: string;
  caret: number;
  line: number;
  column: number;
  /** Rendered block: the source line with a caret underneath. */
  preview: string;
}

/** A single-line window of `width` characters centred on `offset`. */
export function snippetAt(source: string, offset: number, width = 60): SourceSnippet {
  const pos = positionAt(source, offset);
  const lineStart = source.lastIndexOf("\n", Math.max(0, pos.offset - 1)) + 1;
  let lineEnd = source.indexOf("\n", pos.offset);
  if (lineEnd === -1) lineEnd = source.length;

  const raw = source.slice(lineStart, lineEnd).replace(/\r$/, "");
  const localCaret = pos.offset - lineStart;
  const half = Math.floor(width / 2);
  let from = localCaret - half;
  let prefix = "";
  if (from > 0) {
    prefix = "…";
    from -= 1;
  }
  let to = from + width;
  let suffix = "";
  if (to < raw.length) {
    suffix = "…";
    to += 1;
  }
  const context = `${prefix}${raw.slice(Math.max(0, from), Math.max(0, to))}${suffix}`;
  const caret = prefix.length + (localCaret - Math.max(0, from));
  const padding = " ".repeat(Math.max(0, caret));
  return {
    context,
    caret,
    line: pos.line,
    column: pos.column,
    preview: `${context}\n${padding}^`,
  };
}

/* ------------------------------------------------------------------ */
/*  JSON — a real, position-tracking parser                            */
/* ------------------------------------------------------------------ */

export interface JsonPosition {
  path: string;
  offset: number;
  line: number;
  column: number;
}

export interface JsonErrorInfo {
  message: string;
  offset: number;
  line: number;
  column: number;
  context: string;
  caret: number;
  preview: string;
  /** The browser's own SyntaxError text, when the engine offered one. */
  engineMessage?: string;
  engineOffset?: number;
}

export interface JsonScan {
  value: unknown;
  keys: number;
  depth: number;
  arrays: number;
  values: number;
  duplicateKeys: JsonPosition[];
  /** Non-fatal oddities: BOM, control characters in strings, very deep nesting. */
  warnings: { message: string; offset: number }[];
}

const JSON_MAX_DEPTH = 512;

function buildJsonError(
  source: string,
  message: string,
  offset: number,
  engineMessage?: string,
): JsonErrorInfo {
  const snippet = snippetAt(source, offset);
  let engineOffset: number | undefined;
  if (engineMessage) {
    const atPosition = /at position (\d+)/.exec(engineMessage);
    if (atPosition) engineOffset = Number(atPosition[1]);
  }
  return {
    message,
    offset,
    line: snippet.line,
    column: snippet.column,
    context: snippet.context,
    caret: snippet.caret,
    preview: snippet.preview,
    engineMessage,
    engineOffset,
  };
}

/** The offset V8 puts in its SyntaxError text, when the version in use has one. */
function engineJsonError(input: string): { message: string; offset?: number } | null {
  try {
    JSON.parse(input);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The JSON could not be parsed.";
    const atPosition = /at position (\d+)/.exec(message);
    if (atPosition) return { message, offset: Number(atPosition[1]) };
    const atLineColumn = /at line (\d+) column (\d+)/.exec(message);
    if (atLineColumn) return { message };
    return { message };
  }
}

/**
 * A complete RFC 8259 parser that records offsets.
 *
 * `JSON.parse` is the authority on *validity*, but Chrome removed the character
 * offset from its error message in 2023, so a position cannot be relied on from
 * the engine alone. Parsing here gives every failure an exact line and column on
 * every browser, and lets duplicate keys and oddities be collected in the same
 * pass instead of a second, weaker scan.
 */
export function parseJsonDetailed(
  input: string,
): { ok: true; scan: JsonScan } | { ok: false; error: JsonErrorInfo } {
  const engine = engineJsonError(input);
  const n = input.length;
  let i = 0;
  let keys = 0;
  let maxDepth = 0;
  let arrays = 0;
  let values = 0;
  const duplicateKeys: JsonPosition[] = [];
  const warnings: { message: string; offset: number }[] = [];

  const fail = (message: string, at: number): { ok: false; error: JsonErrorInfo } => ({
    ok: false,
    error: buildJsonError(input, message, at, engine?.message),
  });

  if (n === 0) return fail("The input is empty — there is nothing to parse.", 0);

  if (input.charCodeAt(0) === 0xfeff) {
    return fail(
      "The text starts with a UTF-8 byte order mark (U+FEFF). Most parsers, including JSON.parse, reject it. Remove the BOM and retry.",
      0,
    );
  }

  const describeChar = (ch: string): string => {
    if (ch === " ") return "a space";
    if (ch === "\t") return "a tab";
    if (ch === "\n") return "the end of the line";
    if (ch === "\r") return "a carriage return";
    return `"${ch}"`;
  };

  const skipWhitespace = (): void => {
    while (i < n) {
      const code = input.charCodeAt(i);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) i += 1;
      else break;
    }
  };

  const readString = (): string => {
    const start = i;
    i += 1; // opening quote
    let out = "";
    while (i < n) {
      const ch = input[i]!;
      const code = input.charCodeAt(i);
      if (ch === '"') {
        i += 1;
        return out;
      }
      if (ch === "\\") {
        const esc = input[i + 1];
        if (esc === undefined) throw { at: start, message: "The string ends with a dangling backslash." };
        if (esc === "u") {
          const hex = input.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw { at: i, message: `A \\u escape needs exactly four hex digits — found "${hex}".` };
          }
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        if (!'"\\/bfnrt'.includes(esc)) {
          throw {
            at: i,
            message: `\\${esc} is not a valid JSON escape. Legal escapes are \\" \\\\ \\/ \\b \\f \\n \\r \\t and \\uXXXX.`,
          };
        }
        out += esc;
        i += 2;
        continue;
      }
      if (code < 0x20) {
        throw {
          at: i,
          message: `A raw control character (U+${code.toString(16).padStart(4, "0").toUpperCase()}) is not allowed inside a JSON string. It has to be escaped.`,
        };
      }
      out += ch;
      i += 1;
    }
    throw { at: start, message: "This string is never closed — there is no closing quote." };
  };

  const readNumber = (): number => {
    const start = i;
    if (input[i] === "-") i += 1;
    if (input[i] === "0") {
      i += 1;
    } else if (/[1-9]/.test(input[i] ?? "")) {
      while (i < n && /[0-9]/.test(input[i]!)) i += 1;
    } else {
      throw { at: i, message: "A number cannot start here." };
    }
    if (input[i] === ".") {
      i += 1;
      if (!/[0-9]/.test(input[i] ?? "")) throw { at: i, message: "A decimal point must be followed by at least one digit." };
      while (i < n && /[0-9]/.test(input[i]!)) i += 1;
    }
    if (input[i] === "e" || input[i] === "E") {
      i += 1;
      if (input[i] === "+" || input[i] === "-") i += 1;
      if (!/[0-9]/.test(input[i] ?? "")) throw { at: i, message: "An exponent needs at least one digit after the e." };
      while (i < n && /[0-9]/.test(input[i]!)) i += 1;
    }
    return Number(input.slice(start, i));
  };

  const readLiteral = (word: string, value: unknown): unknown => {
    if (input.slice(i, i + word.length) !== word) {
      const found = /[A-Za-z]+/.exec(input.slice(i, i + 8))?.[0] ?? describeChar(input[i] ?? "");
      throw { at: i, message: `Expected ${word} but found ${found}.` };
    }
    i += word.length;
    return value;
  };

  const readKey = (): string => {
    if (input[i] === '"') return readString();
    if (input[i] === "'") {
      throw { at: i, message: "JSON keys must use double quotes. A single-quoted string is JavaScript, not JSON." };
    }
    const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(input.slice(i));
    if (word) {
      throw { at: i, message: `The key "${word[0]}" is not quoted. JSON requires double quotes around every key.` };
    }
    throw { at: i, message: `Expected a key but found ${describeChar(input[i] ?? "the end of the input")}.` };
  };

  const parseValue = (path: string, depth: number): unknown => {
    if (depth > JSON_MAX_DEPTH) {
      throw {
        at: i,
        message: `The document is nested more than ${JSON_MAX_DEPTH} levels deep, which is past what this parser will walk.`,
      };
    }
    if (depth > maxDepth) maxDepth = depth;
    values += 1;
    skipWhitespace();
    if (i >= n) throw { at: i, message: "The document ends where a value was expected." };

    const ch = input[i]!;
    if (ch === "{") return readObject(path, depth);
    if (ch === "[") return readArray(path, depth);
    if (ch === '"') return readString();
    if (ch === "-" || (ch >= "0" && ch <= "9")) return readNumber();
    if (ch === "t") return readLiteral("true", true);
    if (ch === "f") return readLiteral("false", false);
    if (ch === "n") return readLiteral("null", null);
    if (ch === "N") throw { at: i, message: "NaN is not valid JSON. Use null." };
    if (ch === "I") throw { at: i, message: "Infinity is not valid JSON. Use null or a large finite number." };
    if (ch === "'") throw { at: i, message: "JSON uses double-quoted strings only." };
    if (ch === "U" && input.slice(i, i + 8) === "undefined") {
      throw { at: i, message: "undefined is not valid JSON. Use null." };
    }
    if (input.slice(i, i + 2) === "//") {
      throw { at: i, message: "Comments are not valid JSON. This looks like a JavaScript comment." };
    }
    if (input.slice(i, i + 2) === "/*") {
      throw { at: i, message: "Block comments are not valid JSON." };
    }
    if (ch === "]" || ch === "}") {
      throw { at: i, message: `Found ${describeChar(ch)} where a value was expected — this is an extra closing bracket.` };
    }
    if (ch === "'" || ch === "=") {
      throw { at: i, message: `${describeChar(ch)} has no meaning in JSON.` };
    }
    throw { at: i, message: `Unexpected ${describeChar(ch)} where a value was expected.` };
  };

  const readObject = (path: string, depth: number): Record<string, unknown> => {
    i += 1; // {
    const out: Record<string, unknown> = {};
    const seen = new Map<string, number>();
    skipWhitespace();
    if (input[i] === "}") {
      i += 1;
      return out;
    }
    for (;;) {
      skipWhitespace();
      if (i >= n) throw { at: i, message: "The object is never closed — there is no matching }." };
      if (input[i] === "}") throw { at: i, message: "This } is unexpected: the previous entry needs a comma." };
      const keyAt = i;
      const key = readKey();
      keys += 1;
      const previous = seen.get(key);
      if (previous !== undefined) {
        const at = positionAt(input, keyAt);
        duplicateKeys.push({ path: `${path}/${key}`, offset: keyAt, line: at.line, column: at.column });
      }
      seen.set(key, keyAt);
      skipWhitespace();
      if (input[i] !== ":") {
        throw {
          at: i,
          message: `The key "${key}" is missing a colon after it.`,
        };
      }
      i += 1;
      out[key] = parseValue(`${path}/${escapePointerToken(key)}`, depth + 1);
      skipWhitespace();
      if (input[i] === ",") {
        i += 1;
        skipWhitespace();
        if (input[i] === "}") {
          throw { at: i, message: "Trailing comma: a JSON object cannot end with a comma before }." };
        }
        continue;
      }
      if (input[i] === "}") {
        i += 1;
        return out;
      }
      if (i >= n) throw { at: i, message: "The object is never closed — there is no matching }." };
      throw {
        at: i,
        message: `Expected a comma or } after the value for "${key}" but found ${describeChar(input[i]!)}.`,
      };
    }
  };

  const readArray = (path: string, depth: number): unknown[] => {
    i += 1; // [
    const out: unknown[] = [];
    arrays += 1;
    skipWhitespace();
    if (input[i] === "]") {
      i += 1;
      return out;
    }
    for (;;) {
      skipWhitespace();
      if (i >= n) throw { at: i, message: "The array is never closed — there is no matching ]." };
      if (input[i] === "]") throw { at: i, message: "This ] is unexpected: the previous item needs a comma." };
      out.push(parseValue(`${path}/${out.length}`, depth + 1));
      skipWhitespace();
      if (input[i] === ",") {
        i += 1;
        skipWhitespace();
        if (input[i] === "]") {
          throw { at: i, message: "Trailing comma: a JSON array cannot end with a comma before ]." };
        }
        continue;
      }
      if (input[i] === "]") {
        i += 1;
        return out;
      }
      if (i >= n) throw { at: i, message: "The array is never closed — there is no matching ]." };
      throw {
        at: i,
        message: `Expected a comma or ] after the array item but found ${describeChar(input[i]!)}.`,
      };
    }
  };

  try {
    skipWhitespace();
    const value = parseValue("", 0);
    skipWhitespace();
    if (i < n) {
      const next = /^[A-Za-z]+\s*:/.exec(input.slice(i));
      if (next) {
        throw {
          at: i,
          message: `"${next[0].trim()}" looks like JavaScript object syntax. JSON needs the whole value wrapped in { } or [ ].`,
        };
      }
      throw { at: i, message: `Unexpected ${describeChar(input[i]!)} after the end of the JSON value.` };
    }
    return {
      ok: true,
      scan: { value, keys, depth: maxDepth, arrays, values, duplicateKeys, warnings },
    };
  } catch (caught) {
    const problem = caught as { at: number; message: string };
    return fail(problem.message, problem.at);
  }
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

export interface JsonFormatOptions {
  indent: "2" | "4" | "tab" | "min";
  sortKeys: boolean;
  trailingNewline: boolean;
}

function sortJsonKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeysDeep);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      out[key] = sortJsonKeysDeep(source[key]);
    }
    return out;
  }
  return value;
}

export function formatJson(input: string, options: JsonFormatOptions): TextOutcome {
  const started = nowMs();
  const parsed = parseJsonDetailed(input);
  const parseMs = nowMs() - started;
  if (!parsed.ok) {
    const { error } = parsed;
    return {
      text: "",
      error: `Line ${error.line}, column ${error.column} — ${error.message}`,
      errorDetail: error.preview,
    };
  }

  const prepared = options.sortKeys ? sortJsonKeysDeep(parsed.scan.value) : parsed.scan.value;
  const indent =
    options.indent === "min" ? 0 : options.indent === "tab" ? "\t" : Number(options.indent);
  const startedOut = nowMs();
  let text = JSON.stringify(prepared, null, indent as number);
  const outputMs = nowMs() - startedOut;
  if (options.trailingNewline) text += "\n";

  const inBytes = new Blob([input]).size;
  const outBytes = new Blob([text]).size;
  return {
    text,
    stats: [
      { label: "Keys", value: parsed.scan.keys.toLocaleString("en") },
      { label: "Max depth", value: String(parsed.scan.depth) },
      { label: "Values", value: parsed.scan.values.toLocaleString("en") },
      { label: "Size in", value: formatByteLabel(inBytes) },
      { label: "Size out", value: formatByteLabel(outBytes) },
      { label: "Parse time", value: formatPreciseMs(parseMs + outputMs) },
    ],
    notes:
      parsed.scan.duplicateKeys.length > 0
        ? [
            `This document has ${parsed.scan.duplicateKeys.length} duplicate key${
              parsed.scan.duplicateKeys.length === 1 ? "" : "s"
            }. The last value for each duplicate wins, exactly as JSON.parse behaves.`,
          ]
        : undefined,
  };
}

function formatByteLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export interface JsonMinifyOptions {
  sortKeys: boolean;
  stripControlChars: boolean;
}

export function minifyJson(input: string, options: JsonMinifyOptions): TextOutcome {
  const parsed = parseJsonDetailed(input);
  if (!parsed.ok) {
    return {
      text: "",
      error: `Line ${parsed.error.line}, column ${parsed.error.column} — ${parsed.error.message}`,
      errorDetail: parsed.error.preview,
    };
  }
  const prepared = options.sortKeys ? sortJsonKeysDeep(parsed.scan.value) : parsed.scan.value;
  let text = JSON.stringify(prepared);
  let stripped = 0;
  if (options.stripControlChars) {
    const next = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, (ch) => {
      stripped += 1;
      return ch === "\u0000" ? "" : ch;
    });
    text = next;
  }

  const before = new Blob([input]).size;
  const after = new Blob([text]).size;
  const saved = before > 0 ? ((before - after) / before) * 100 : 0;

  return {
    text,
    stats: [
      { label: "Before", value: formatByteLabel(before) },
      { label: "After", value: formatByteLabel(after) },
      { label: "Saved", value: `${saved.toFixed(1)}%`, tone: "success" },
      { label: "Bytes removed", value: (before - after).toLocaleString("en"), tone: "brand" },
      { label: "Keys", value: parsed.scan.keys.toLocaleString("en") },
      { label: "Lines", value: String(input.split("\n").length) },
    ],
    notes:
      stripped > 0
        ? [
            `${stripped} control character${stripped === 1 ? "" : "s"} were removed from the output. U+007F is the only one allowed through.`,
          ]
        : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  JSON linting — "common issues" the parser cannot see              */
/* ------------------------------------------------------------------ */

export type FindingSeverity = "error" | "warning" | "info";

export interface JsonFinding {
  severity: FindingSeverity;
  message: string;
  offset: number;
  line: number;
  column: number;
}

/**
 * Scans the raw text for the things that quietly break a JSON pipeline:
 * duplicate keys, trailing commas, BOMs, `NaN`, single quotes, comments and
 * unquoted keys. Each finding carries a position, because "your JSON has a
 * trailing comma" is only useful with a line number.
 */
export function lintJson(input: string): JsonFinding[] {
  const findings: JsonFinding[] = [];
  const n = input.length;
  const add = (severity: FindingSeverity, message: string, offset: number): void => {
    const at = positionAt(input, offset);
    findings.push({ severity, message, offset, line: at.line, column: at.column });
  };

  if (n === 0) return findings;
  if (input.charCodeAt(0) === 0xfeff) {
    add("error", "A UTF-8 byte order mark (U+FEFF) sits at the very start. It is not whitespace in JSON and JSON.parse rejects the whole file because of it.", 0);
  }

  // Identifier-ish literals that JS accepts and JSON does not.
  const forbidden = /\b(NaN|Infinity|-Infinity|undefined)\b/g;
  for (let m = forbidden.exec(input); m; m = forbidden.exec(input)) {
    add("error", `"${m[0]}" is not a JSON value. JavaScript accepts it; JSON does not. Use null instead.`, m.index);
  }

  const stack: { keys: Map<string, number>; isObject: boolean }[] = [];
  let i = 0;
  let lastMeaningful = "";

  while (i < n) {
    const ch = input[i]!;
    const code = input.charCodeAt(i);

    if (ch === '"') {
      const start = i;
      i += 1;
      while (i < n) {
        const c = input[i]!;
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') {
          i += 1;
          break;
        }
        if (input.charCodeAt(i) < 0x20) {
          add("warning", "An unescaped control character inside this string will be rejected by strict parsers.", i);
        }
        i += 1;
      }
      const raw = input.slice(start, i);
      const isKey = input[i] === ":" && stack.length > 0;
      if (isKey) {
        let key = raw;
        try {
          key = JSON.parse(raw) as string;
        } catch {
          key = raw.slice(1, -1);
        }
        const frame = stack[stack.length - 1];
        if (frame?.isObject) {
          const previous = frame.keys.get(key);
          if (previous !== undefined) {
            add("warning", `Duplicate key "${key}" — the first one is on line ${positionAt(input, previous).line}. Only the last value survives parsing.`, start);
          } else {
            frame.keys.set(key, start);
          }
        }
      }
      lastMeaningful = "value";
      continue;
    }

    if (ch === "'") {
      add("error", "Single-quoted string. JSON only allows double quotes.", i);
      i += 1;
      while (i < n && input[i] !== "'" && input[i] !== "\n") {
        if (input[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      lastMeaningful = "value";
      continue;
    }

    if (ch === "/" && input[i + 1] === "/") {
      add("error", "A // comment. JSON has no comment syntax — strip it before parsing.", i);
      while (i < n && input[i] !== "\n") i += 1;
      continue;
    }

    if (ch === "/" && input[i + 1] === "*") {
      add("error", "A /* */ comment. JSON has no comment syntax — strip it before parsing.", i);
      i += 2;
      while (i < n && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push({ keys: new Map(), isObject: ch === "{" });
      lastMeaningful = "open";
      i += 1;
      continue;
    }

    if (ch === "}" || ch === "]") {
      const frame = stack.pop();
      if (input[i + 1] === ",") {
        add("error", `Trailing comma before ${ch}. A JSON collection cannot end with a comma.`, i);
      }
      if (ch === "}" && frame && frame.keys.size === 0) lastMeaningful = "value";
      else lastMeaningful = "close";
      i += 1;
      continue;
    }

    if (ch === ",") {
      lastMeaningful = "comma";
      i += 1;
      continue;
    }

    if (ch === ":") {
      lastMeaningful = "colon";
      i += 1;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const word = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(input.slice(i))![0];
      if (lastMeaningful === "open" || lastMeaningful === "comma") {
        add("error", `Unquoted key "${word}". JSON requires double quotes around every property name.`, i);
      } else if (word !== "true" && word !== "false" && word !== "null") {
        add("error", `"${word}" is not a JSON literal. Only true, false and null are allowed.`, i);
      }
      i += word.length;
      lastMeaningful = "value";
      continue;
    }

    if (code === 0x0a || code === 0x0d || code === 0x20 || code === 0x09) {
      i += 1;
      continue;
    }

    if (!"+-.eE0123456789".includes(ch)) {
      add("error", `The character "${ch}" is not allowed outside a JSON string.`, i);
    }
    i += 1;
    lastMeaningful = "value";
  }

  if (stack.length > 0) {
    add("error", `${stack.length} collection${stack.length === 1 ? " is" : "s are"} never closed.`, n);
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/*  JSON Schema — the subset we actually implement                    */
/* ------------------------------------------------------------------ */

export interface SchemaViolation {
  /** RFC 6901 JSON pointer to the offending value. */
  pointer: string;
  keyword: string;
  message: string;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(value: unknown, expected: string): boolean {
  const actual = typeOf(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  if (expected === "integer") return actual === "integer";
  return actual === expected;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const kind = typeOf(value);
  return kind === "object" ? "an object" : `a ${kind}`;
}

function joinPointer(pointer: string, token: string): string {
  return `${pointer}/${escapePointerToken(token)}`;
}

/**
 * A JSON Schema subset validator written from scratch — no library.
 *
 * Supported: `type`, `required`, `properties`, `items`, `enum`, `const`,
 * `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`,
 * `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`,
 * `uniqueItems`, `additionalProperties`, `propertyNames`, and `$ref` into
 * `#/$defs/*`. Unknown keywords are ignored rather than silently "passing" a
 * rule the visitor might assume is enforced.
 */
export function validateJsonSchema(instance: unknown, schema: unknown): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  const report = (pointer: string, keyword: string, message: string): void => {
    if (violations.length < 200) violations.push({ pointer: pointer || "/", keyword, message });
  };

  const walk = (value: unknown, node: unknown, pointer: string, depth: number): void => {
    if (!isRecord(node)) return;
    if (depth > 40) {
      report(pointer, "$ref", "Stopped validating at 40 levels of nesting.");
      return;
    }

    if (typeof node.$ref === "string") {
      const ref = node.$ref;
      if (ref.startsWith("#/$defs/")) {
        const defName = ref.slice("#/$defs/".length);
        const defs = isRecord(schema) && isRecord(schema.$defs) ? schema.$defs : undefined;
        const target = defs ? defs[defName] : undefined;
        if (target === undefined) {
          report(pointer, "$ref", `The schema references ${ref} but that definition does not exist.`);
          return;
        }
        walk(value, target, pointer, depth + 1);
      } else {
        report(pointer, "$ref", `Only local references of the form "#/$defs/name" are supported, not "${ref}".`);
      }
      return;
    }

    if (node.type !== undefined) {
      const expected = Array.isArray(node.type) ? node.type.map(String) : [String(node.type)];
      if (!expected.some((candidate) => typeMatches(value, candidate))) {
        report(
          pointer,
          "type",
          `Expected ${expected.join(" or ")} but found ${describeType(value)}.`,
        );
        return;
      }
    }

    if (Array.isArray(node.enum) && !node.enum.some((candidate) => deepEqual(candidate, value))) {
      report(
        pointer,
        "enum",
        `${JSON.stringify(value)} is not one of the ${node.enum.length} allowed values.`,
      );
    }

    if (node.const !== undefined && !deepEqual(node.const, value)) {
      report(pointer, "const", `This value must always be ${JSON.stringify(node.const)}.`);
    }

    if (typeof value === "number") {
      if (typeof node.minimum === "number" && value < node.minimum) {
        report(pointer, "minimum", `${value} is below the minimum of ${node.minimum}.`);
      }
      if (typeof node.maximum === "number" && value > node.maximum) {
        report(pointer, "maximum", `${value} is above the maximum of ${node.maximum}.`);
      }
      if (typeof node.exclusiveMinimum === "number" && value <= node.exclusiveMinimum) {
        report(pointer, "exclusiveMinimum", `${value} must be greater than ${node.exclusiveMinimum}.`);
      }
      if (typeof node.exclusiveMaximum === "number" && value >= node.exclusiveMaximum) {
        report(pointer, "exclusiveMaximum", `${value} must be less than ${node.exclusiveMaximum}.`);
      }
      if (typeof node.multipleOf === "number" && node.multipleOf > 0) {
        const ratio = value / node.multipleOf;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
          report(pointer, "multipleOf", `${value} is not a multiple of ${node.multipleOf}.`);
        }
      }
    }

    if (typeof value === "string") {
      const length = [...value].length;
      if (typeof node.minLength === "number" && length < node.minLength) {
        report(pointer, "minLength", `This string is ${length} characters, the minimum is ${node.minLength}.`);
      }
      if (typeof node.maxLength === "number" && length > node.maxLength) {
        report(pointer, "maxLength", `This string is ${length} characters, the maximum is ${node.maxLength}.`);
      }
      if (typeof node.pattern === "string") {
        let regex: RegExp | null = null;
        try {
          regex = new RegExp(node.pattern, "u");
        } catch {
          try {
            regex = new RegExp(node.pattern);
          } catch {
            report(pointer, "pattern", `The schema's own pattern is not a valid regular expression: ${node.pattern}`);
          }
        }
        if (regex && !regex.test(value)) {
          report(pointer, "pattern", `This string does not match the required pattern ${node.pattern}.`);
        }
      }
    }

    if (Array.isArray(value)) {
      if (typeof node.minItems === "number" && value.length < node.minItems) {
        report(pointer, "minItems", `This array has ${value.length} items, the minimum is ${node.minItems}.`);
      }
      if (typeof node.maxItems === "number" && value.length > node.maxItems) {
        report(pointer, "maxItems", `This array has ${value.length} items, the maximum is ${node.maxItems}.`);
      }
      if (node.uniqueItems === true) {
        for (let a = 0; a < value.length; a += 1) {
          for (let b = a + 1; b < value.length; b += 1) {
            if (deepEqual(value[a], value[b])) {
              report(joinPointer(pointer, String(a)), "uniqueItems", `This item repeats the one at index ${a}.`);
            }
          }
        }
      }
      if (node.items !== undefined) {
        const itemsSchema = node.items;
        if (Array.isArray(itemsSchema)) {
          // Tuple form.
          value.forEach((item, index) => {
            if (index < itemsSchema.length) {
              walk(item, itemsSchema[index], joinPointer(pointer, String(index)), depth + 1);
            } else if (node.additionalItems === false) {
              report(joinPointer(pointer, String(index)), "additionalItems", "The schema does not allow items past this position.");
            }
          });
        } else {
          value.forEach((item, index) => walk(item, itemsSchema, joinPointer(pointer, String(index)), depth + 1));
        }
      }
    }

    if (isRecord(value)) {
      if (Array.isArray(node.required)) {
        for (const key of node.required) {
          const name = String(key);
          if (!(name in value)) {
            report(pointer, "required", `The required property "${name}" is missing.`);
          }
        }
      }
      const properties = isRecord(node.properties) ? node.properties : undefined;
      for (const [key, child] of Object.entries(value)) {
        if (properties && key in properties) {
          walk(child, properties[key], joinPointer(pointer, key), depth + 1);
          continue;
        }
        if (isRecord(node.propertyNames)) {
          walk(key, node.propertyNames, joinPointer(pointer, key), depth + 1);
        }
        if (node.additionalProperties === false) {
          report(joinPointer(pointer, key), "additionalProperties", `"${key}" is not listed in properties and the schema forbids extra properties.`);
        } else if (isRecord(node.additionalProperties)) {
          walk(child, node.additionalProperties, joinPointer(pointer, key), depth + 1);
        }
      }
    }
  };

  walk(instance, schema, "", 0);
  return violations;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

export const SCHEMA_SUPPORTED_KEYWORDS = [
  "type",
  "required",
  "properties",
  "items",
  "enum",
  "const",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "additionalProperties",
  "propertyNames",
  "$ref → #/$defs/*",
] as const;

/* ------------------------------------------------------------------ */
/*  Markdown → HTML                                                   */
/* ------------------------------------------------------------------ */

export interface MarkdownOptions {
  allowRawHtml: boolean;
  fullDocument: boolean;
  includeCss: boolean;
  title: string;
  taskLists: boolean;
}

export interface MarkdownResult {
  body: string;
  html: string;
  comment: string;
  stats: { label: string; value: string }[];
}

const SANITISED_POLICY_NOTE = `Sanitisation policy applied by Balu Tools:
  * Text is HTML-escaped, so pasted content can never inject markup.
  * <script>, <style>, <iframe>, <object>, <embed>, <form> and friends are removed.
  * Every on* event-handler attribute is stripped.
  * javascript:, vbscript: and data: URLs in links and images are replaced with "#".`;

const DANGEROUS_ELEMENTS =
  "script|iframe|object|embed|form|input|button|select|textarea|link|meta|base|style|svg|math|template|noscript|frame|frameset|applet|audio|video|source|track";

export function sanitiseRawHtml(html: string): string {
  let out = html;
  out = out.replace(new RegExp(`<\\s*(${DANGEROUS_ELEMENTS})\\b[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, "gi"), "");
  out = out.replace(new RegExp(`<\\s*(?:${DANGEROUS_ELEMENTS})\\b[^>]*>`, "gi"), "");
  out = out.replace(new RegExp(`<\\s*\\/\\s*(?:${DANGEROUS_ELEMENTS})\\s*>`, "gi"), "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(
    /\s+(href|src|xlink:href|action|formaction|poster)\s*=\s*(?:"\s*(?:javascript|vbscript|data|file|blob):[^"]*"?|'[^']*'|[^\s>]+)/gi,
    ' $1="#"',
  );
  return out;
}

function safeUrl(raw: string): string {
  const cleaned = raw.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  const probe = cleaned.toLowerCase();
  if (/^(javascript|vbscript|file|blob):/.test(probe)) return "#";
  if (probe.startsWith("data:")) {
    return /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(cleaned) ? cleaned : "#";
  }
  return cleaned;
}

interface InlineContext {
  allowRawHtml: boolean;
  allowTaskLists: boolean;
  counters: { headings: number; links: number; images: number; codeSpans: number };
}

function renderInline(source: string, ctx: InlineContext): string {
  const stash: string[] = [];
  const put = (html: string): string => {
    stash.push(html);
    return `\u0000${stash.length - 1}\u0000`;
  };

  let text = source;

  // 1. Backslash escapes — taken out first so nothing else can grab them.
  text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_match, ch: string) =>
    put(escapeHtml(ch)),
  );

  // 2. Code spans are opaque: their content is escaped and left alone.
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_match, _ticks: string, code: string) => {
    ctx.counters.codeSpans += 1;
    const inner = code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "" ? code.slice(1, -1) : code;
    return put(`<code>${escapeHtml(inner.replace(/\n/g, " "))}</code>`);
  });

  // 3. Images before links — the syntax only differs by the leading "!".
  const imageDestination = "((?:[^()\\s]|\\((?:[^()\\s])*\\))*)";
  text = text.replace(
    new RegExp(`!\\[([^\\]]*)\\]\\(\\s*<?${imageDestination}>?(?:\\s+["']([^"']*)["'])?\\s*\\)`, "g"),
    (_match, alt: string, href: string, title?: string) => {
      ctx.counters.images += 1;
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return put(`<img src="${escapeAttr(safeUrl(href))}" alt="${escapeAttr(alt)}"${titleAttr} />`);
    },
  );

  // 4. Inline links. The destination pattern allows one level of parentheses
  //    so `href="javascript:f(1)"` cannot be truncated mid-URL.
  const destination = "((?:[^()\\s]|\\((?:[^()\\s])*\\))*)";
  text = text.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(\\s*<?${destination}>?(?:\\s+["']([^"']*)["'])?\\s*\\)`, "g"),
    (_match, label: string, href: string, title?: string) => {
      ctx.counters.links += 1;
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      return put(`<a href="${escapeAttr(safeUrl(href))}"${titleAttr}>${label}</a>`);
    },
  );

  // 5. Autolinks: <https://example.com> and <someone@example.com>.
  text = text.replace(/<((?:https?|ftp|mailto):[^\s<>]+)>/gi, (_match, href: string) => {
    ctx.counters.links += 1;
    const url = safeUrl(href);
    return put(`<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`);
  });
  text = text.replace(
    /<([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>/g,
    (_match, mail: string) => {
      ctx.counters.links += 1;
      return put(`<a href="mailto:${escapeAttr(mail)}">${escapeHtml(mail)}</a>`);
    },
  );

  // 6. Strikethrough, then strong, then emphasis. Each of these only wraps the
  //    run in sentinel markers; the markers are resolved once at the very end,
  //    after escaping, so the tags they introduce are never escaped themselves.
  text = markEmphasis(text, "~");
  text = markEmphasis(text, "*");
  text = markEmphasis(text, "_");

  // 7. Hard line breaks: two trailing spaces or a trailing backslash.
  text = text.replace(/ {2,}\n/g, `${put("<br />")}\n`);

  // 8. Whatever is left is literal text.
  text = escapeHtml(text);

  // Two marker schemes are in play: \u0000N\u0000 for stashed HTML and
  // \u0001tag\u0001…\u0001/tag\u0001 for emphasis. They can nest inside each
  // other in either direction, so resolve until neither kind is left.
  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    text = text.replace(/\u0001([a-z]+)\u0001([\s\S]*?)\u0001\/\1\u0001/g, (_match, name: string, inner: string) =>
      `<${name}>${inner}</${name}>`,
    );
    text = text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => stash[Number(index)] ?? "");
    if (text === before) break;
  }

  return text;
}


/**
 * Wraps emphasis runs in sentinel markers, repeating until the text stops
 * changing so nested emphasis nests. `~` only ever means GFM strikethrough, so
 * it insists on a run of exactly two.
 */
function markEmphasis(input: string, marker: "*" | "_" | "~"): string {
  const escaped = escapeRegExp(marker);
  const wordSafe = marker === "_";
  const open = wordSafe ? "(?<![A-Za-z0-9_])" : "";
  const close = wordSafe ? "(?![A-Za-z0-9_])" : "";
  const run = marker === "~" ? "~~" : "(?:\\*{1,2}|_{1,2})";
  const pattern = new RegExp(`${open}(${run})(?=\\S)([\\s\\S]*?\\S)\\1${close}`, "g");

  let out = input;
  for (let pass = 0; pass < 6; pass += 1) {
    const next = out.replace(pattern, (_match, found: string, inner: string) => {
      const length = marker === "~" ? 2 : found.length;
      const name = length >= 2 ? (marker === "~" ? "del" : "strong") : "em";
      const content = length >= 2 ? inner.replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "") : inner;
      return `\u0001${name}\u0001${content}\u0001/${name}\u0001`;
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
}

interface MarkdownStats {
  headings: number;
  links: number;
  images: number;
  codeSpans: number;
  lists: number;
  codeBlocks: number;
  tables: number;
  words: number;
  lines: number;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\n]*)$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const BULLET_ITEM = /^( {0,7})([-+*])([ \t]+)(.*)$/;
const ORDERED_ITEM = /^( {0,7})(\d{1,9})([.)])([ \t]+)(.*)$/;
const BLOCKQUOTE = /^ {0,3}>[ ]?(.*)$/;
const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;

function isBlockStart(line: string): boolean {
  return (
    ATX_HEADING.test(line) ||
    FENCE.test(line) ||
    THEMATIC_BREAK.test(line) ||
    BULLET_ITEM.test(line) ||
    ORDERED_ITEM.test(line) ||
    BLOCKQUOTE.test(line) ||
    line.trim() === ""
  );
}

export function markdownToHtml(markdown: string, options: MarkdownOptions): MarkdownResult {
  const source = markdown.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = source.split("\n");
  const counters: MarkdownStats = {
    headings: 0,
    links: 0,
    images: 0,
    codeSpans: 0,
    lists: 0,
    codeBlocks: 0,
    tables: 0,
    words: 0,
    lines: lines.length,
  };
  const ctx: InlineContext = {
    allowRawHtml: options.allowRawHtml,
    allowTaskLists: options.taskLists,
    counters: { headings: 0, links: 0, images: 0, codeSpans: 0 },
  };
  const out: string[] = [];
  renderBlocks(lines, 0, lines.length, out, ctx, counters, options);
  const body = out.join("\n");

  const html = options.fullDocument ? buildDocument(body, options) : body;

  const comment = [
    "<!--",
    "  Generated by Balu Tools (Markdown → HTML).",
    `  Raw HTML is ${options.allowRawHtml ? "ENABLED and passed through the sanitiser below" : "DISABLED — every character of text was HTML-escaped"}.`,
    indentBlock(SANITISED_POLICY_NOTE, "  "),
    "-->",
  ].join("\n");

  return {
    body,
    html: options.fullDocument ? `${comment}\n${html}` : `${comment}\n${body}`,
    comment,
    stats: [
      { label: "Headings", value: String(counters.headings) },
      { label: "Links", value: String(ctx.counters.links) },
      { label: "Images", value: String(ctx.counters.images) },
      { label: "Code blocks", value: String(counters.codeBlocks) },
      { label: "Lists", value: String(counters.lists) },
      { label: "Tables", value: String(counters.tables) },
    ],
  };
}

function indentBlock(text: string, pad: string): string {
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

function buildDocument(body: string, options: MarkdownOptions): string {
  const css = options.includeCss
    ? `
    :root { color-scheme: light dark; }
    body { max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem;
           font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2rem 0 0.75rem; }
    h1 { font-size: 2rem; border-bottom: 1px solid #8884; padding-bottom: 0.3rem; }
    h2 { font-size: 1.5rem; } h3 { font-size: 1.2rem; }
    p, ul, ol, blockquote, table, pre { margin: 0 0 1rem; }
    a { color: #0b6bcb; }
    code { font: 0.875em/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
           background: #8881; border-radius: 4px; padding: 0.1em 0.35em; }
    pre { background: #8881; border-radius: 8px; padding: 0.9rem 1rem; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 3px solid #8886; margin-left: 0; padding: 0.1rem 0 0.1rem 1rem; color: #666; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #8884; padding: 0.45rem 0.7rem; text-align: left; }
    th { background: #8881; }
    img { max-width: 100%; height: auto; }
    hr { border: 0; border-top: 1px solid #8884; margin: 2rem 0; }
    li { margin-bottom: 0.25rem; }
    li input[type="checkbox"] { margin-right: 0.4rem; }`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="generator" content="Balu Tools — Markdown to HTML" />
<title>${escapeHtml(options.title || "Document")}</title>${css ? `\n<style>\n${css}\n</style>` : ""}
</head>
<body>
${body}
</body>
</html>`;
}

function renderBlocks(
  lines: string[],
  start: number,
  end: number,
  out: string[],
  ctx: InlineContext,
  counters: MarkdownStats,
  options: MarkdownOptions,
): void {
  let i = start;
  while (i < end) {
    const line = lines[i]!;

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2]!;
      const info = (fence[3] ?? "").trim();
      const openingIndent = fence[1]!.length;
      const body: string[] = [];
      i += 1;
      while (i < end) {
        const candidate = lines[i]!;
        const closing = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}[ \\t]*$`);
        if (closing.test(candidate)) {
          i += 1;
          break;
        }
        // Strip the opening fence's indentation, as CommonMark specifies.
        body.push(candidate.slice(0, openingIndent).trim() === "" ? candidate.slice(openingIndent) : candidate);
        i += 1;
      }
      counters.codeBlocks += 1;
      const lang = info.split(/\s+/)[0] ?? "";
      const cls = lang ? ` class="language-${escapeAttr(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}\n</code></pre>`);
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = (heading[2] ?? "").trim();
      ctx.counters.headings += 1;
      counters.headings += 1;
      out.push(`<h${level}>${renderInline(text, ctx)}</h${level}>`);
      i += 1;
      continue;
    }

    // Setext headings: a paragraph line followed by === or ---.
    if (i + 1 < end && line.trim() !== "" && /^ {0,3}(=+|-{2,})[ \t]*$/.test(lines[i + 1]!)) {
      const level = lines[i + 1]!.trim().startsWith("=") ? 1 : 2;
      ctx.counters.headings += 1;
      counters.headings += 1;
      out.push(`<h${level}>${renderInline(line.trim(), ctx)}</h${level}>`);
      i += 2;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      out.push("<hr />");
      i += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const inner: string[] = [];
      while (i < end) {
        const candidate = lines[i]!;
        const quoted = BLOCKQUOTE.exec(candidate);
        if (quoted) {
          inner.push(quoted[1] ?? "");
          i += 1;
          continue;
        }
        if (candidate.trim() === "" || isBlockStart(candidate)) break;
        inner.push(candidate);
        i += 1;
      }
      const nested: string[] = [];
      renderBlocks(inner, 0, inner.length, nested, ctx, counters, options);
      out.push(`<blockquote>\n${nested.join("\n")}\n</blockquote>`);
      continue;
    }

    if (BULLET_ITEM.test(line) || ORDERED_ITEM.test(line)) {
      i = renderList(lines, i, end, out, ctx, counters, options);
      continue;
    }

    if (line.includes("|") && i + 1 < end && TABLE_DELIMITER.test(lines[i + 1]!) && lines[i + 1]!.includes("-")) {
      i = renderTable(lines, i, end, out, ctx, counters);
      continue;
    }

    // Indented code block.
    if (/^ {4,}\S/.test(line) && (i === start || lines[i - 1]!.trim() === "")) {
      const body: string[] = [];
      while (i < end && (/^ {4,}/.test(lines[i]!) || lines[i]!.trim() === "")) {
        if (lines[i]!.trim() === "" && !/^ {4,}/.test(lines[i + 1] ?? "x")) break;
        body.push(lines[i]!.slice(4));
        i += 1;
      }
      counters.codeBlocks += 1;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}\n</code></pre>`);
      continue;
    }

    if (options.allowRawHtml && /^ {0,3}<[A-Za-z!/]/.test(line)) {
      const body: string[] = [];
      while (i < end && lines[i]!.trim() !== "") {
        body.push(lines[i]!);
        i += 1;
      }
      out.push(sanitiseRawHtml(body.join("\n")));
      continue;
    }

    // Paragraph.
    const paragraph: string[] = [];
    while (i < end && lines[i]!.trim() !== "" && !isBlockStart(lines[i]!)) {
      paragraph.push(lines[i]!.trim());
      i += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(lines[i]!.trim());
      i += 1;
    }
    counters.words += paragraph.join(" ").split(/\s+/).filter(Boolean).length;
    out.push(`<p>${renderInline(paragraph.join("\n"), ctx)}</p>`);
  }
}

function renderList(
  lines: string[],
  start: number,
  end: number,
  out: string[],
  ctx: InlineContext,
  counters: MarkdownStats,
  options: MarkdownOptions,
): number {
  const first = BULLET_ITEM.exec(lines[start]!) ?? ORDERED_ITEM.exec(lines[start]!)!;
  const ordered = !BULLET_ITEM.test(lines[start]!);
  const baseIndent = first[1]!.length;
  const startNumber = ordered ? Number(first[2]) : 1;

  const items: string[][] = [];
  let i = start;
  let loose = false;

  while (i < end) {
    const line = lines[i]!;

    if (line.trim() === "") {
      // A run of two or more blank lines always ends the list. A single blank
      // line only continues it when more of this list follows.
      let look = i;
      while (look < end && lines[look]!.trim() === "") look += 1;
      if (look - i >= 2) break;
      const next = lines[look];
      if (next === undefined) break;
      const nextIndent = next.length - next.trimStart().length;
      if (nextIndent > baseIndent) {
        items[items.length - 1]?.push("");
        loose = true;
        i = look + 1;
        continue;
      }
      const nextBullet = BULLET_ITEM.exec(next);
      const nextNumbered = ORDERED_ITEM.exec(next);
      if (nextBullet || nextNumbered) {
        if (Boolean(nextNumbered) === ordered) {
          loose = true;
          i = look + 1;
          continue;
        }
      }
      break;
    }

    const bullet = BULLET_ITEM.exec(line);
    const numbered = ORDERED_ITEM.exec(line);
    const marker = bullet ?? numbered;
    const indent = marker ? marker[1]!.length : -1;

    if (marker && indent === baseIndent) {
      const isOrdered = Boolean(numbered);
      if (isOrdered !== ordered) break;
      const body = bullet ? bullet[4]! : numbered![5]!;
      const markerWidth = bullet
        ? bullet[2]!.length + bullet[3]!.length
        : numbered![2]!.length + numbered![3]!.length + numbered![4]!.length;
      const contentIndent = indent + markerWidth;
      const content: string[] = [body];
      i += 1;
      while (i < end) {
        const candidate = lines[i]!;
        if (candidate.trim() === "") {
          let look = i;
          while (look < end && lines[look]!.trim() === "") look += 1;
          const next = lines[look];
          if (next === undefined) break;
          const nextIndent = next.length - next.trimStart().length;
          if (nextIndent >= contentIndent) {
            for (let k = i; k <= look; k += 1) content.push("");
            loose = true;
            i = look + 1;
            continue;
          }
          break;
        }
        const candidateIndent = candidate.length - candidate.trimStart().length;
        if (candidateIndent < contentIndent) break;
        if (
          candidateIndent === baseIndent &&
          (BULLET_ITEM.test(candidate) || ORDERED_ITEM.test(candidate))
        ) {
          break;
        }
        content.push(candidate.slice(contentIndent));
        i += 1;
      }
      items.push(content);
      continue;
    }

    if (indent > baseIndent || (items.length > 0 && indent === -1 && !marker)) {
      // Continuation of the previous item.
      const last = items[items.length - 1];
      if (!last) break;
      last.push(line.slice(Math.min(indent, line.length - line.trimStart().length)));
      i += 1;
      continue;
    }
    break;
  }

  counters.lists += 1;
  const rendered = items
    .map((content) => {
      let body = content.slice();
      let task = "";
      const head = body[0] ?? "";
      const taskMatch = options.taskLists ? /^\[([ xX])\][ \t]+([\s\S]*)$/.exec(head) : null;
      if (taskMatch) {
        const checked = taskMatch[1]!.toLowerCase() === "x";
        task = `<input type="checkbox" disabled${checked ? " checked" : ""} /> `;
        body = [taskMatch[2]!, ...body.slice(1)];
      }
      const nested: string[] = [];
      renderBlocks(body, 0, body.length, nested, ctx, counters, options);
      let inner = nested.join("\n");
      // A tight list drops the paragraph wrapper renderBlocks added; a loose
      // list keeps the <p> elements because its items are separated by blanks.
      if (!loose) {
        const unwrapped = /^<p>([\s\S]*?)<\/p>\n?([\s\S]*)$/.exec(inner);
        if (unwrapped && !unwrapped[2]!.includes("<p>")) {
          inner = unwrapped[2] ? `${unwrapped[1]}\n${unwrapped[2]}` : unwrapped[1]!;
        }
      }
      return `<li>${task}${inner}</li>`;
    })
    .join("\n");

  const tag = ordered ? "ol" : "ul";
  const startAttr = ordered && startNumber !== 1 ? ` start="${startNumber}"` : "";
  out.push(`<${tag}${startAttr}>\n${rendered}\n</${tag}>`);
  return i;
}

function renderTable(
  lines: string[],
  start: number,
  end: number,
  out: string[],
  ctx: InlineContext,
  counters: MarkdownStats,
): number {
  const splitRow = (row: string): string[] => {
    const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells: string[] = [];
    let current = "";
    for (let i = 0; i < trimmed.length; i += 1) {
      const ch = trimmed[i]!;
      if (ch === "\\" && trimmed[i + 1] === "|") {
        current += "\\|";
        i += 1;
        continue;
      }
      if (ch === "|") {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  };

  const header = splitRow(lines[start]!);
  const delimiter = splitRow(lines[start + 1]!);
  const aligns = delimiter.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });

  let i = start + 2;
  const body: string[][] = [];
  while (i < end && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
    body.push(splitRow(lines[i]!));
    i += 1;
  }

  counters.tables += 1;
  const cell = (tag: "th" | "td", text: string, index: number): string => {
    const align = aligns[index] ? ` style="text-align:${aligns[index]}"` : "";
    const scope = tag === "th" ? ' scope="col"' : "";
    return `<${tag}${scope}${align}>${renderInline(text, ctx)}</${tag}>`;
  };

  const head = `<tr>\n${header.map((text, index) => `  ${cell("th", text, index)}`).join("\n")}\n</tr>`;
  const rows = body
    .map(
      (row) =>
        `<tr>\n${header
          .map((_unused, index) => `  ${cell("td", row[index] ?? "", index)}`)
          .join("\n")}\n</tr>`,
    )
    .join("\n");

  out.push(`<table>\n<thead>\n${head}\n</thead>\n${rows ? `<tbody>\n${rows}\n</tbody>` : ""}\n</table>`);
  return i;
}

/* ------------------------------------------------------------------ */
/*  XML — parsed with the browser's own spec-compliant DOMParser       */
/* ------------------------------------------------------------------ */

export interface XmlFormatOptions {
  indent: number;
  indentWithTab: boolean;
  wrapAttributes: boolean;
  selfCloseEmpty: boolean;
  preserveCdata: boolean;
  sortAttributes: boolean;
  declaration: "keep" | "drop" | "ensure";
}

function xmlPad(depth: number, options: XmlFormatOptions): string {
  return options.indentWithTab ? "\t".repeat(depth) : " ".repeat(depth * options.indent);
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;");
}

/** Pull a real position and a readable message out of a parsererror node. */
function readParserError(doc: Document, source: string): { message: string; offset: number } {
  const node =
    doc.getElementsByTagName("parsererror")[0] ??
    doc.documentElement?.tagName === "parsererror"
      ? doc.documentElement
      : null;
  const raw = (node?.textContent ?? "").trim();
  const lineColumn = /line\s+(\d+)\s*(?:at\s*column|,?\s*Column)\s*(\d+)/i.exec(raw);
  let message = raw
    .replace(/^This page contains the following errors:\s*/i, "")
    .replace(/^\d+\.\s*/gm, "")
    .replace(/^XML Parsing Error:\s*/i, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^Location:/i.test(line) && !/^Line Number/i.test(line))
    .join(" ");
  if (!message) message = "The document is not well-formed XML.";

  if (lineColumn) {
    const line = Number(lineColumn[1]);
    const column = Number(lineColumn[2]);
    const lines = source.split("\n");
    const offset = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0) + (column - 1);
    return { message, offset: Math.max(0, Math.min(offset, source.length)) };
  }
  return { message, offset: 0 };
}

function xmlOpenTag(element: Element, depth: number, options: XmlFormatOptions, selfClose: boolean): string {
  const attrs = Array.from(element.attributes);
  if (options.sortAttributes) attrs.sort((a, b) => a.name.localeCompare(b.name));
  const head = `<${element.tagName}`;
  if (attrs.length === 0) return selfClose ? `${head} />` : `${head}>`;

  const inline = `${head}${attrs.map((a) => ` ${a.name}="${escapeXmlAttribute(a.value)}"`).join("")}${selfClose ? " />" : ">"}`;
  const longEnough =
    options.wrapAttributes && attrs.length >= 2 && xmlPad(depth, options).length + inline.length > 78;
  if (!longEnough) return inline;

  const alignment = " ".repeat(xmlPad(depth, options).length + head.length + 1);
  return [
    head,
    ...attrs.map((a) => `${alignment}${a.name}="${escapeXmlAttribute(a.value)}"`),
    selfClose ? " />" : ">",
  ].join("\n");
}

function renderXmlElement(element: Element, depth: number, options: XmlFormatOptions): string[] {
  const hasElementChild = Array.from(element.childNodes).some((node) => node.nodeType === 1);
  const pad = xmlPad(depth, options);

  const parts: { node: Node; lines: string[] }[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3 && hasElementChild && !(child.nodeValue ?? "").trim()) continue;
    if (child.nodeType === 1) {
      parts.push({ node: child, lines: renderXmlElement(child as Element, depth + 1, options) });
      continue;
    }
    parts.push({ node: child, lines: [renderXmlInlineNode(child, options)] });
  }

  if (parts.length === 0) {
    return [`${pad}${xmlOpenTag(element, depth, options, true)}`];
  }

  const allSingleLine = parts.every((part) => part.lines.length === 1);
  const openTag = xmlOpenTag(element, depth, options, false);
  if (allSingleLine && !openTag.includes("\n")) {
    const inner = parts.map((part) => part.lines[0]!).join("");
    const single = `${pad}${openTag}${inner}</${element.tagName}>`;
    if (single.length <= 96) return [single];
  }

  return [
    `${pad}${openTag}`,
    ...parts.flatMap((part) => part.lines),
    `${pad}</${element.tagName}>`,
  ];
}

function renderXmlInlineNode(node: Node, options: XmlFormatOptions): string {
  switch (node.nodeType) {
    case 3:
      return escapeXmlText(node.nodeValue ?? "");
    case 4: {
      const data = node.nodeValue ?? "";
      return options.preserveCdata
        ? `<![CDATA[${data.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`
        : escapeXmlText(data);
    }
    case 8:
      return `<!--${node.nodeValue ?? ""}-->`;
    case 7:
      return `<?${(node as ProcessingInstruction).target} ${node.nodeValue ?? ""}`.trimEnd() + "?>";
    default:
      return escapeXmlText(node.nodeValue ?? "");
  }
}

/**
 * Returns the browser's `DOMParser`, or null when there isn't one.
 *
 * These formatters are Client Components, but Next still renders them on the
 * server for the initial HTML. A workspace that preloads a sample value will
 * therefore call `formatXml` during SSR, where `DOMParser` does not exist and a
 * bare `new DOMParser()` throws a ReferenceError that takes the whole page to a
 * 500. Callers degrade to a readable message instead.
 */
function getDomParser(): DOMParser | null {
  return typeof DOMParser === "undefined" ? null : new DOMParser();
}

export function formatXml(input: string, options: XmlFormatOptions): TextOutcome {
  if (input.trim() === "") return { text: "", error: "Paste some XML to format." };
  const parser = getDomParser();
  if (!parser) {
    return {
      text: "",
      error:
        "XML formatting needs a browser parser, so it runs after this page finishes loading. " +
        "Reload to use it.",
    };
  }
  const doc = parser.parseFromString(input, "application/xml");
  const errorNode = doc.getElementsByTagName("parsererror")[0];
  if (errorNode) {
    const { message, offset } = readParserError(doc, input);
    const snippet = snippetAt(input, offset);
    return {
      text: "",
      error: `Line ${snippet.line}, column ${snippet.column} — ${message}`,
      errorDetail: snippet.preview,
    };
  }

  const out: string[] = [];
  const root = doc.documentElement;
  if (!root) return { text: "", error: "The document parsed but has no root element." };

  const isXmlDeclaration = (node: Node): boolean =>
    node.nodeType === 7 && (node as ProcessingInstruction).target.toLowerCase() === "xml";

  const declarationNode = Array.from(doc.childNodes).find(
    (node): node is ProcessingInstruction => node.nodeType === 7 && isXmlDeclaration(node),
  );
  if (options.declaration !== "drop") {
    if (declarationNode) {
      out.push(`<?${declarationNode.target} ${declarationNode.nodeValue ?? ""}?>`.replace(/\s+\?>/, "?>"));
    } else if (options.declaration === "ensure") {
      out.push('<?xml version="1.0" encoding="UTF-8"?>');
    }
  }

  for (const node of Array.from(doc.childNodes)) {
    if (isXmlDeclaration(node)) continue;
    if (node === root) continue;
    const lines = node.nodeType === 1 ? renderXmlElement(node as Element, 0, options) : [renderXmlInlineNode(node, options)];
    out.push(...lines);
  }
  out.push(...renderXmlElement(root, 0, options));

  const text = `${out.join("\n")}\n`;
  const elements = doc.getElementsByTagName("*").length;
  return {
    text,
    stats: [
      { label: "Elements", value: (elements + 1).toLocaleString("en") },
      { label: "Depth", value: String(xmlDepth(root)) },
      { label: "Size in", value: formatByteLabel(new Blob([input]).size) },
      { label: "Size out", value: formatByteLabel(new Blob([text]).size) },
    ],
    notes: [
      "Whitespace-only text nodes between elements are dropped, because every pretty printer does that and the result is no longer byte-identical to the input.",
      "Entity references are decoded by the parser and re-escaped on output (&amp; stays &amp;), so the meaning is preserved even though the spelling may change.",
    ],
  };
}

function xmlDepth(element: Element): number {
  let deepest = 1;
  for (const child of Array.from(element.children)) {
    deepest = Math.max(deepest, 1 + xmlDepth(child));
  }
  return deepest;
}

/* ------------------------------------------------------------------ */
/*  HTML — parsed with DOMParser, printed from the node tree           */
/* ------------------------------------------------------------------ */

export interface HtmlFormatOptions {
  indent: number;
  indentWithTab: boolean;
  wrapAttributes: boolean;
  collapseEmpty: boolean;
  sortAttributes: boolean;
}

const HTML_VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

const HTML_RAW_TEXT = new Set([
  "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext",
]);

const HTML_INLINE = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark", "q",
  "rp", "rt", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

function htmlPad(depth: number, options: HtmlFormatOptions): string {
  return options.indentWithTab ? "\t".repeat(depth) : " ".repeat(depth * options.indent);
}

function htmlOpenTag(element: Element, depth: number, options: HtmlFormatOptions, selfClose: boolean): string {
  const attrs = Array.from(element.attributes);
  if (options.sortAttributes) attrs.sort((a, b) => a.name.localeCompare(b.name));
  const name = element.tagName.toLowerCase();
  const head = `<${name}`;
  if (attrs.length === 0) return selfClose ? `${head} />` : `${head}>`;

  const inline = `${head}${attrs.map((a) => ` ${a.name}="${escapeHtml(a.value)}"`).join("")}${selfClose ? " />" : ">"}`;
  if (!options.wrapAttributes || attrs.length < 2 || htmlPad(depth, options).length + inline.length <= 78) {
    return inline;
  }
  const alignment = " ".repeat(htmlPad(depth, options).length + head.length + 1);
  return [
    head,
    ...attrs.map((a) => `${alignment}${a.name}="${escapeHtml(a.value)}"`),
    selfClose ? " />" : ">",
  ].join("\n");
}

function renderHtmlElement(
  element: Element,
  depth: number,
  options: HtmlFormatOptions,
  stats: { elements: number; comments: number },
): string[] {
  stats.elements += 1;
  const pad = htmlPad(depth, options);
  const name = element.tagName.toLowerCase();

  if (HTML_VOID.has(name)) {
    return [`${pad}${htmlOpenTag(element, depth, options, true)}`];
  }

  if (HTML_RAW_TEXT.has(name)) {
    const verbatim = name === "script" || name === "style" ? (element.textContent ?? "") : escapeHtml(element.textContent ?? "");
    return [`${pad}${htmlOpenTag(element, depth, options, false)}${verbatim}</${name}>`];
  }

  if (name === "pre") {
    return [`${pad}${htmlOpenTag(element, depth, options, false)}${element.textContent ?? ""}</pre>`];
  }

  const hasElementChild = Array.from(element.childNodes).some((node) => node.nodeType === 1);
  const parts: { lines: string[]; inline: boolean }[] = [];

  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3) {
      const raw = child.nodeValue ?? "";
      if (hasElementChild && !raw.trim()) continue;
      parts.push({ lines: [escapeHtml(raw)], inline: true });
      continue;
    }
    if (child.nodeType === 8) {
      stats.comments += 1;
      parts.push({ lines: [`<!--${child.nodeValue ?? ""}-->`], inline: true });
      continue;
    }
    if (child.nodeType === 1) {
      const childLines = renderHtmlElement(child as Element, depth + 1, options, stats);
      const childName = (child as Element).tagName.toLowerCase();
      parts.push({ lines: childLines, inline: childLines.length === 1 && HTML_INLINE.has(childName) });
      continue;
    }
    parts.push({ lines: [escapeHtml(child.nodeValue ?? "")], inline: true });
  }

  if (parts.length === 0) {
    return [`${pad}${htmlOpenTag(element, depth, options, false)}</${name}>`];
  }

  const openTag = htmlOpenTag(element, depth, options, false);
  const allInline = parts.every((part) => part.inline);
  if (allInline && !openTag.includes("\n") && !hasElementChild) {
    const single = `${pad}${openTag}${parts.map((part) => part.lines[0]!).join("")}</${name}>`;
    if (single.length <= 100) return [single];
  }

  return [
    `${pad}${openTag}`,
    ...parts.flatMap((part) => part.lines),
    `${pad}</${name}>`,
  ];
}

export function formatHtml(input: string, options: HtmlFormatOptions): TextOutcome {
  if (input.trim() === "") return { text: "", error: "Paste some HTML to format." };
  const parser = getDomParser();
  if (!parser) {
    return {
      text: "",
      error:
        "HTML formatting needs a browser parser, so it runs after this page finishes loading. " +
        "Reload to use it.",
    };
  }
  const doc = parser.parseFromString(input, "text/html");

  const stats = { elements: 0, comments: 0 };
  const out: string[] = [];
  const doctype = doc.doctype;
  if (doctype) {
    out.push(
      `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : ""}${
        doctype.systemId ? ` "${doctype.systemId}"` : ""
      }>`,
    );
  }
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === 8) {
      stats.comments += 1;
      out.push(`<!--${node.nodeValue ?? ""}-->`);
      continue;
    }
    if (node.nodeType === 1) {
      out.push(...renderHtmlElement(node as Element, 0, options, stats));
    }
  }

  const text = `${out.join("\n")}\n`;
  return {
    text,
    stats: [
      { label: "Elements", value: stats.elements.toLocaleString("en") },
      { label: "Comments", value: String(stats.comments) },
      { label: "Doctype", value: doctype ? doctype.name : "none", tone: doctype ? "default" : "brand" },
      { label: "Size in", value: formatByteLabel(new Blob([input]).size) },
      { label: "Size out", value: formatByteLabel(new Blob([text]).size) },
    ],
    notes: [
      "This is a formatter, not a validator. The browser's HTML parser repairs malformed markup before it reaches this printer, so broken input comes back tidy rather than rejected.",
      "Content inside <script>, <style>, <pre> and <textarea> is emitted byte for byte and never reflowed.",
      "HTML5 says a newline placed immediately after <pre> is ignored when parsing, so that newline does not survive a round trip.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  CSS — a hand-written tokeniser + printer                           */
/* ------------------------------------------------------------------ */

/**
 * Splits CSS into runs of *code* and opaque runs (strings and comments), so a
 * spacing transform can be applied to code without ever touching the inside of
 * a quoted string or a comment body. This is the whole reason the printer is
 * safe: no spacing rule can reach inside `"a,  b"` or a comment.
 */
function mapCssSegments(text: string, mapper: (code: string) => string): string {
  let out = "";
  let code = "";
  let i = 0;
  /**
   * Strings keep their original adjacency to the surrounding code — inserting a
   * space there would be noise. Comments are always separated by at least one
   * space, because `red` followed by a comment is easy to misread and the space
   * changes nothing.
   */
  const appendOpaque = (segment: string, pad: boolean): void => {
    if (pad && out !== "" && !/\s$/.test(out)) out += " ";
    out += segment;
  };
  const flush = (): void => {
    if (code) {
      out += mapper(code);
      code = "";
    }
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      flush();
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === ch) {
          j += 1;
          break;
        }
        j += 1;
      }
      appendOpaque(text.slice(i, j), false);
      i = j;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      flush();
      const end = text.indexOf("*/", i + 2);
      const j = end === -1 ? text.length : end + 2;
      appendOpaque(text.slice(i, j), true);
      i = j;
      continue;
    }
    code += ch;
    i += 1;
  }
  flush();
  return out;
}

type CssNode =
  | { kind: "rule"; prelude: string; children: CssNode[] }
  | { kind: "at-block"; name: string; prelude: string; children: CssNode[] }
  | { kind: "at-statement"; text: string }
  | { kind: "declaration"; text: string }
  | { kind: "comment"; text: string };

interface CssChunk {
  text: string;
  terminator: "{" | ";" | "}" | "eof";
  next: number;
}

function readCssChunk(source: string, from: number): CssChunk {
  let i = from;
  let depth = 0;
  let text = "";
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === ch) {
          i += 1;
          break;
        }
        i += 1;
      }
      text += source.slice(start, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      text += source.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "]") {
      depth -= 1;
    } else if (depth <= 0 && (ch === "{" || ch === ";" || ch === "}")) {
      return { text, terminator: ch, next: i + 1 };
    }
    text += ch;
    i += 1;
  }
  return { text, terminator: "eof", next: i };
}

function parseCssNodes(source: string, from: number, keepComments: boolean): { nodes: CssNode[]; next: number } {
  const nodes: CssNode[] = [];
  let i = from;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
    if (i >= source.length) break;
    if (source[i] === "}") {
      i += 1;
      break;
    }

    // A comment has to be recognised *before* a chunk is read, otherwise the
    // chunk reader swallows the selector that follows the comment.
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      if (keepComments) nodes.push({ kind: "comment", text: source.slice(i, stop) });
      i = stop;
      continue;
    }

    const chunk = readCssChunk(source, i);
    const raw = chunk.text.trim();

    if (raw === "") {
      i = chunk.next;
      continue;
    }

    if (raw.startsWith("/*") && raw.endsWith("*/")) {
      if (keepComments) nodes.push({ kind: "comment", text: raw });
      i = chunk.next;
      continue;
    }

    if (chunk.terminator === "{") {
      if (raw.startsWith("@")) {
        const match = /^@([\w-]+)\s*([\s\S]*)$/.exec(raw)!;
        const children = parseCssNodes(source, chunk.next, keepComments);
        nodes.push({ kind: "at-block", name: match[1]!, prelude: normaliseAtPrelude(match[2] ?? ""), children: children.nodes });
        i = children.next;
        continue;
      }
      const children = parseCssNodes(source, chunk.next, keepComments);
      nodes.push({ kind: "rule", prelude: normaliseSelector(raw), children: children.nodes });
      i = children.next;
      continue;
    }

    if (raw.startsWith("@")) {
      const match = /^@([\w-]+)\s*([\s\S]*)$/.exec(raw)!;
      nodes.push({ kind: "at-statement", text: `@${match[1]!}${match[2] ? ` ${normaliseAtPrelude(match[2])}` : ""};` });
    } else {
      nodes.push({ kind: "declaration", text: normaliseDeclaration(raw) });
    }
    i = chunk.next;
  }
  return { nodes, next: i };
}

function normaliseSelector(text: string): string {
  return mapCssSegments(text, (code) =>
    code
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s*([>+~])\s*/g, " $1 "),
  ).trim();
}

function normaliseAtPrelude(text: string): string {
  return mapCssSegments(text, (code) =>
    code
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s*:\s*/g, ": "),
  ).trim();
}

function normaliseDeclaration(text: string): string {
  const found = findTopLevelColon(text);
  if (found === -1) return mapCssSegments(text, (code) => code.replace(/\s+/g, " ")).trim();
  const property = text.slice(0, found).trim();
  const value = text.slice(found + 1).trim();
  return `${property}: ${normaliseValue(value)}`;
}

function findTopLevelColon(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

function normaliseValue(value: string): string {
  return mapCssSegments(value, (code) =>
    code
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")"),
  ).trim();
}

export interface CssFormatOptions {
  indent: number;
  indentWithTab: boolean;
  oneDeclarationPerLine: boolean;
  preserveComments: boolean;
}

function emitCss(
  nodes: CssNode[],
  depth: number,
  options: CssFormatOptions,
  out: string[],
  stats: { rules: number; declarations: number; comments: number },
): void {
  const pad = options.indentWithTab ? "\t".repeat(depth) : " ".repeat(depth * options.indent);
  let declarations: string[] = [];
  const flush = (): void => {
    if (declarations.length === 0) return;
    if (options.oneDeclarationPerLine) {
      for (const declaration of declarations) out.push(`${pad}${declaration};`);
    } else {
      out.push(`${pad}${declarations.join(" ")};`);
    }
    declarations = [];
  };

  for (const node of nodes) {
    if (node.kind === "declaration") {
      declarations.push(node.text);
      stats.declarations += 1;
      continue;
    }
    flush();
    if (node.kind === "comment") {
      stats.comments += 1;
      out.push(...node.text.split("\n").map((line) => (line ? `${pad}${line}` : line)));
      continue;
    }
    if (node.kind === "at-statement") {
      out.push(`${pad}${node.text}`);
      continue;
    }
    stats.rules += 1;
    if (node.kind === "rule") {
      out.push(`${pad}${node.prelude} {`);
      emitCss(node.children, depth + 1, options, out, stats);
      out.push(`${pad}}`);
    } else {
      out.push(`${pad}@${node.name}${node.prelude ? ` ${node.prelude}` : ""} {`);
      emitCss(node.children, depth + 1, options, out, stats);
      out.push(`${pad}}`);
    }
  }
  flush();
}

export function formatCss(input: string, options: CssFormatOptions): TextOutcome {
  if (input.trim() === "") return { text: "", error: "Paste some CSS to format." };
  const parsed = parseCssNodes(input, 0, options.preserveComments);
  const stats = { rules: 0, declarations: 0, comments: 0 };
  const out: string[] = [];
  emitCss(parsed.nodes, 0, options, out, stats);
  const text = `${out.join("\n")}\n`;
  return {
    text,
    stats: [
      { label: "Rules", value: stats.rules.toLocaleString("en") },
      { label: "Declarations", value: stats.declarations.toLocaleString("en") },
      { label: "Comments", value: String(stats.comments) },
      { label: "Size in", value: formatByteLabel(new Blob([input]).size) },
      { label: "Size out", value: formatByteLabel(new Blob([text]).size) },
    ],
    notes: options.preserveComments
      ? ["Comments are preserved verbatim, including their original internal line breaks."]
      : ["Comments are stripped. The comment bodies are never re-indented either way — they are copied through untouched."],
  };
}

/* ------------------------------------------------------------------ */
/*  JavaScript — token-based, line-oriented, honestly limited          */
/* ------------------------------------------------------------------ */

export type JsTokenType =
  | "ws"
  | "nl"
  | "comment"
  | "string"
  | "template"
  | "regex"
  | "number"
  | "name"
  | "punct";

export interface JsToken {
  t: JsTokenType;
  v: string;
  /** True when whitespace (or a comment) separated this token from the previous one. */
  ws: boolean;
  /** `{` → block/object, `(` → control header. Used for semicolon inference. */
  meta?: "block" | "object" | "control";
}

export interface JsFormatOptions {
  indent: number;
  indentWithTab: boolean;
  semicolons: "keep" | "ensure";
  quoteStyle: "preserve" | "double" | "single";
}

const JS_CONTROL_HEADERS = new Set(["if", "for", "while", "switch", "catch", "with"]);
const JS_REGEX_PRECEDING = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await", "default",
]);
const JS_BLOCK_INTRODUCERS = new Set([
  "else", "do", "try", "finally", "catch", "function", "class", "switch", "default", "case",
]);
const JS_PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=",
  "%=", "&=", "|=", "^=", "**", "<<", ">>",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^",
  "!", "~", "?", ":", "=", ".",
];

const JS_NO_SPACE_BEFORE = new Set([")", "]", ",", ";", ".", "?.", "..."]);
const JS_NO_SPACE_AFTER = new Set(["(", "[", ".", "?.", "...", "!", "~"]);
const JS_UNARY_OPS = new Set(["!", "~", "+", "-", "++", "--"]);
const JS_BINARY_WORDS = new Set(["instanceof", "in", "of"]);

export interface JsProblem {
  message: string;
  offset: number;
}

export function tokenizeJs(source: string): { tokens: JsToken[]; problems: JsProblem[] } {
  const tokens: JsToken[] = [];
  const problems: JsProblem[] = [];
  const n = source.length;
  let i = 0;
  let lastSignificant: JsToken | null = null;
  const parenStack: string[] = [];
  const braceStack: ("block" | "object")[] = [];
  let sawWhitespace = false;

  const push = (t: JsTokenType, v: string, meta?: JsToken["meta"]): JsToken => {
    const token: JsToken = meta ? { t, v, ws: sawWhitespace, meta } : { t, v, ws: sawWhitespace };
    tokens.push(token);
    sawWhitespace = false;
    if (t !== "ws" && t !== "nl" && t !== "comment") lastSignificant = token;
    return token;
  };

  const previousValue = (): string => lastSignificant?.v ?? "";

  const regexAllowed = (): boolean => {
    if (!lastSignificant) return true;
    const { t, v } = lastSignificant;
    if (t === "number" || t === "string" || t === "template" || t === "regex") return false;
    if (t === "name") return JS_REGEX_PRECEDING.has(v);
    if (t !== "punct") return true;
    if (v === ")") {
      const opener = parenStack[parenStack.length - 1];
      return opener !== undefined && JS_CONTROL_HEADERS.has(opener);
    }
    if (v === "]" || v === "++" || v === "--") return false;
    if (v === "}") return braceStack[braceStack.length - 1] !== "object";
    return true;
  };

  const readString = (): void => {
    const start = i;
    const quote = source[i]!;
    i += 1;
    while (i < n) {
      const ch = source[i]!;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) {
        i += 1;
        push("string", source.slice(start, i));
        return;
      }
      if (ch === "\n") break;
      i += 1;
    }
    i = Math.min(i, n);
    problems.push({ message: "This string literal is never closed.", offset: start });
    push("string", source.slice(start, i));
  };

  const readTemplate = (): void => {
    const start = i;
    i += 1;
    while (i < n) {
      const ch = source[i]!;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        i += 1;
        push("template", source.slice(start, i));
        return;
      }
      if (ch === "$" && source[i + 1] === "{") {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const c = source[i]!;
          if (c === "\\") {
            i += 2;
            continue;
          }
          if (c === '"' || c === "'") {
            const inner = c;
            i += 1;
            while (i < n && source[i] !== inner) {
              if (source[i] === "\\") i += 1;
              i += 1;
            }
            i += 1;
            continue;
          }
          if (c === "`") {
            readTemplate();
            continue;
          }
          if (c === "{" || c === "(" || c === "[") depth += 1;
          else if (c === "}" || c === ")" || c === "]") depth -= 1;
          i += 1;
        }
        continue;
      }
      i += 1;
    }
    i = n;
    problems.push({ message: "This template literal is never closed.", offset: start });
    push("template", source.slice(start, i));
  };

  const readRegex = (): void => {
    const start = i;
    i += 1;
    let inClass = false;
    while (i < n) {
      const ch = source[i]!;
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "\n") break;
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) {
        i += 1;
        while (i < n && /[a-z]/.test(source[i]!)) i += 1;
        push("regex", source.slice(start, i));
        return;
      }
      i += 1;
    }
    i = Math.min(i, n);
    problems.push({ message: "This regular expression literal is never closed.", offset: start });
    push("regex", source.slice(start, i));
  };

  while (i < n) {
    const ch = source[i]!;

    if (ch === "\n") {
      push("nl", "\n");
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v" || ch === " " || ch === "﻿") {
      i += 1;
      sawWhitespace = true;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      const start = i;
      while (i < n && source[i] !== "\n") i += 1;
      push("comment", source.slice(start, i));
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      if (end === -1) problems.push({ message: "This block comment is never closed.", offset: start });
      push("comment", source.slice(start, i));
      continue;
    }
    if (ch === '"' || ch === "'") {
      readString();
      continue;
    }
    if (ch === "`") {
      readTemplate();
      continue;
    }
    if (ch === "/" && regexAllowed()) {
      readRegex();
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      const start = i;
      while (i < n && /[0-9a-fA-FxXoObBnE_.+-]/.test(source[i]!)) {
        if ((source[i] === "+" || source[i] === "-") && !/[eE]/.test(source[i - 1] ?? "")) break;
        i += 1;
      }
      push("number", source.slice(start, i));
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(source[i]!)) i += 1;
      push("name", source.slice(start, i));
      continue;
    }
    if (ch.charCodeAt(0) > 0x7f && /[\p{L}\p{Nd}_$]/u.test(ch)) {
      const start = i;
      while (i < n && (source[i]!.charCodeAt(0) > 0x7f || /[A-Za-z0-9_$]/.test(source[i]!))) i += 1;
      push("name", source.slice(start, i));
      continue;
    }

    const punctuator = JS_PUNCTUATORS.find((candidate) => source.startsWith(candidate, i));
    if (punctuator) {
      i += punctuator.length;
      if (punctuator === "{") {
        const kind: "block" | "object" = braceKindFor(lastSignificant);
        braceStack.push(kind);
        push("punct", punctuator, kind);
        continue;
      }
      if (punctuator === "}") {
        braceStack.pop();
        push("punct", punctuator);
        continue;
      }
      if (punctuator === "(") {
        const control = JS_CONTROL_HEADERS.has(previousValue());
        parenStack.push(control ? previousValue() : "");
        push("punct", punctuator, control ? "control" : undefined);
        continue;
      }
      if (punctuator === ")") parenStack.pop();
      push("punct", punctuator);
      continue;
    }

    i += 1;
    sawWhitespace = true;
  }

  return { tokens, problems };
}

function braceKindFor(previous: JsToken | null): "block" | "object" {
  if (!previous) return "object";
  if (previous.t === "name") return JS_BLOCK_INTRODUCERS.has(previous.v) ? "block" : "object";
  if (previous.t === "punct") {
    if (previous.v === ")" || previous.v === "{" || previous.v === "}" || previous.v === ";" || previous.v === "=>") {
      return "block";
    }
  }
  return "object";
}

function prevIsJsValue(token: JsToken): boolean {
  if (token.t === "number" || token.t === "string" || token.t === "template" || token.t === "regex") return true;
  if (token.t === "name") return !JS_CONTROL_HEADERS.has(token.v);
  if (token.t === "punct") return token.v === ")" || token.v === "]" || token.v === "}";
  return false;
}

function jsBinaryLike(token: JsToken): boolean {
  if (token.t === "name") return JS_BINARY_WORDS.has(token.v);
  if (token.t !== "punct") return false;
  return !JS_UNARY_OPS.has(token.v) && /^[+\-*/%<>=!&|^~?:]+$/.test(token.v);
}

function previousJsToken(tokens: JsToken[], index: number): JsToken | null {
  for (let k = index - 1; k >= 0; k -= 1) {
    if (tokens[k]!.t !== "ws" && tokens[k]!.t !== "nl") return tokens[k]!;
  }
  return null;
}

function transformJsToken(token: JsToken, options: JsFormatOptions): string {
  if (token.t !== "string") return token.v;
  const raw = token.v;
  // Only flip quotes for strings with no escapes at all: anything with a
  // backslash may contain the target quote, and guessing would corrupt it.
  if (raw.includes("\\")) return raw;
  const quote = raw[0];
  if (quote !== '"' && quote !== "'") return raw;
  const want = options.quoteStyle === "preserve" ? quote : options.quoteStyle === "double" ? '"' : "'";
  if (want === quote) return raw;
  return `${want}${raw.slice(1, -1)}${want}`;
}

function needsJsSpace(
  previous: JsToken,
  next: JsToken,
  previousIsUnary: boolean,
  ternaryDepth: number,
): boolean {
  const p = previous.v;
  const n = next.v;
  const pPunct = previous.t === "punct";
  const nPunct = next.t === "punct";

  if (nPunct && JS_NO_SPACE_BEFORE.has(n)) return false;
  if (pPunct && JS_NO_SPACE_AFTER.has(p)) return false;
  if (nPunct && (n === "++" || n === "--")) return !prevIsJsValue(previous);
  if (nPunct && (n === "(" || n === "[")) return JS_CONTROL_HEADERS.has(p);
  if (nPunct && n === ":") return ternaryDepth > 0;
  if (nPunct && (n === "?" || n === "{" || n === "}")) return true;
  if (pPunct && (p === "{" || p === "}" || p === "," || p === ":")) return true;
  if (pPunct && JS_UNARY_OPS.has(p) && previousIsUnary) return false;
  // A binary operator already spaced itself from the token before it; it still
  // needs a space on its right-hand side.
  if (pPunct && jsBinaryLike(previous) && !previousIsUnary) return true;
  if (jsBinaryLike(next)) return true;
  return next.ws;
}

export function formatJs(input: string, options: JsFormatOptions): TextOutcome {
  if (input.trim() === "") return { text: "", error: "Paste some JavaScript to format." };
  const { tokens, problems } = tokenizeJs(input);
  if (problems.length > 0) {
    const first = problems[0]!;
    const snippet = snippetAt(input, first.offset);
    return {
      text: "",
      error: `Line ${snippet.line}, column ${snippet.column} — ${first.message}`,
      errorDetail: snippet.preview,
      notes:
        problems.length > 1
          ? [`${problems.length - 1} further problem${problems.length === 2 ? "" : "s"} found after this one.`]
          : undefined,
    };
  }

  const lines: JsToken[][] = [[]];
  for (const token of tokens) {
    if (token.t === "nl") {
      lines.push([]);
      continue;
    }
    if (token.t === "ws") continue;
    lines[lines.length - 1]!.push(token);
  }

  const unit = options.indentWithTab ? "\t" : " ".repeat(options.indent);
  const out: string[] = [];
  const braceKinds: ("block" | "object")[] = [];
  let depth = 0;
  let previousBlank = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) {
      if (!previousBlank && out.length > 0) out.push("");
      previousBlank = true;
      continue;
    }

    const meaningful = line.filter((token) => token.t !== "comment");
    const firstToken = meaningful[0] ?? line[0]!;
    const dedent = firstToken.t === "punct" && firstToken.v === "}" ? 1 : 0;
    const lineDepth = Math.max(0, depth - dedent);
    const pad = unit.repeat(lineDepth);

    // A class body reads as a block for semicolon purposes even though the
    // brace after the class name looks like an object literal.
    const isClassHeader = line.some(
      (token) => token.t === "name" && (token.v === "class" || token.v === "interface" || token.v === "enum"),
    );
    const lineBraceKinds: ("block" | "object")[] = [];
    for (const token of line) {
      if (token.t === "punct" && token.v === "{") {
        lineBraceKinds.push(token.meta === "object" && isClassHeader ? "block" : (token.meta === "block" ? "block" : "object"));
      }
    }

    const unaryFlags = line.map((token, k) => {
      if (token.t !== "punct" || !JS_UNARY_OPS.has(token.v)) return false;
      const previous = previousJsToken(line, k);
      return !(previous !== null && prevIsJsValue(previous));
    });

    let text = "";
    let ternary = 0;
    let previous: JsToken | null = null;
    let previousUnary = false;
    for (let k = 0; k < line.length; k += 1) {
      const token = line[k]!;
      if (previous) {
        if (needsJsSpace(previous, token, previousUnary, ternary)) text += " ";
      }
      text += transformJsToken(token, options);
      if (token.t === "punct" && token.v === "?") ternary += 1;
      if (token.t === "punct" && token.v === ":" && ternary > 0) ternary -= 1;
      previous = token;
      previousUnary = unaryFlags[k] === true;
    }

    const innermost = braceKinds[braceKinds.length - 1];
    const inBlock = innermost === undefined || innermost === "block";
    let suffix = "";
    if (options.semicolons === "ensure" && shouldAddSemicolon(line, inBlock, lines[index + 1])) {
      suffix = ";";
    }

    out.push(`${pad}${text}${suffix}`.replace(/[ \t]+$/, ""));
    previousBlank = false;

    for (const kind of lineBraceKinds) braceKinds.push(kind);
    for (const token of line) {
      if (token.t === "punct" && token.v === "}") braceKinds.pop();
    }
    depth = braceKinds.length;
  }

  while (out.length > 0 && out[0] === "") out.shift();
  while (out.length > 0 && out[out.length - 1] === "") out.pop();

  const text = `${out.join("\n")}\n`;
  const longest = out.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    text,
    stats: [
      { label: "Lines", value: String(out.length) },
      { label: "Longest line", value: `${longest} chars` },
      { label: "Tokens", value: tokens.length.toLocaleString("en") },
      { label: "Size in", value: formatByteLabel(new Blob([input]).size) },
      { label: "Size out", value: formatByteLabel(new Blob([text]).size) },
    ],
    notes: [
      "Line breaks are preserved exactly as you wrote them — only indentation and horizontal spacing are normalised. Joining or splitting statements needs a real parser, and this is not one.",
      "Template literals and block comments are single tokens here, so their contents are copied through byte for byte and are never re-indented.",
      "Quote style only rewrites strings that contain no backslash escape, because flipping quotes inside an escape sequence would change the value.",
    ],
  };
}

function shouldAddSemicolon(
  line: JsToken[],
  inBlock: boolean,
  nextLine: JsToken[] | undefined,
): boolean {
  const last = line[line.length - 1];
  if (!last) return false;
  if (last.t === "comment") return false;
  if (last.t === "punct" && (last.v === "{" || last.v === "}" || last.v === ";" || last.v === "," || last.v === ":" || last.v === "(" || last.v === "[")) {
    return false;
  }
  if (last.t === "punct" && (last.v === "++" || last.v === "--")) return false;

  // Only inside a real block (not an object literal) and outside any bracket.
  if (!inBlock) return false;

  let parenDepth = 0;
  let bracketDepth = 0;
  for (let k = 0; k < line.length; k += 1) {
    const token = line[k]!;
    if (token.t !== "punct") continue;
    if (token.v === "(") parenDepth += 1;
    else if (token.v === ")") parenDepth -= 1;
    else if (token.v === "[") bracketDepth += 1;
    else if (token.v === "]") bracketDepth -= 1;
  }
  if (parenDepth !== 0 || bracketDepth !== 0) return false;

  const next = nextLine?.filter((token) => token.t !== "comment")[0];
  if (next && next.t === "name" && ["else", "catch", "finally", "while"].includes(next.v)) return false;
  if (next && next.t === "punct" && [")", "]", ",", ".", "?.", ":", "?"].includes(next.v)) return false;
  if (next && next.t === "punct" && jsBinaryLike(next) && !JS_UNARY_OPS.has(next.v)) return false;

  if (last.t === "name" && JS_CONTROL_HEADERS.has(last.v)) return false;
  return prevIsJsValue(last) || last.t === "name";
}


/* ------------------------------------------------------------------ */
/*  SQL — keyword-aware, string/comment safe                           */
/* ------------------------------------------------------------------ */

export const SQL_DIALECTS = ["standard", "postgres", "mysql", "sqlite"] as const;
export type SqlDialect = (typeof SQL_DIALECTS)[number];

export interface SqlFormatOptions {
  dialect: SqlDialect;
  indent: number;
  indentWithTab: boolean;
  keywordCase: "upper" | "lower" | "preserve";
  oneColumnPerLine: boolean;
}

const SQL_KEYWORDS: Record<SqlDialect, ReadonlySet<string>> = {
  standard: new Set([
    "add", "all", "alter", "and", "any", "as", "asc", "begin", "between", "by", "case", "cast", "check",
    "collate", "column", "commit", "constraint", "create", "cross", "current", "default", "delete", "desc",
    "distinct", "drop", "else", "end", "escape", "except", "exists", "fetch", "for", "foreign", "from",
    "full", "grant", "group", "having", "in", "index", "inner", "insert", "intersect", "into", "is", "join",
    "key", "left", "like", "limit", "natural", "not", "null", "offset", "on", "only", "or", "order", "outer",
    "primary", "references", "returning", "right", "rollback", "select", "set", "table", "then", "to",
    "transaction", "union", "unique", "update", "using", "values", "view", "when", "where", "with",
  ]),
  postgres: new Set([
    "add", "all", "alter", "analyze", "and", "any", "array", "as", "asc", "bigserial", "both", "by",
    "case", "cast", "coalesce", "collate", "column", "conflict", "constraint", "create", "cross",
    "current_timestamp", "default", "deferrable", "delete", "desc", "distinct", "do", "drop", "else", "end",
    "except", "exists", "explain", "extract", "false", "fetch", "filter", "for", "foreign", "from", "full",
    "grant", "greatest", "group", "having", "ilike", "in", "index", "inner", "insert", "intersect",
    "interval", "into", "is", "join", "key", "lateral", "least", "left", "like", "limit", "not", "null",
    "offset", "on", "only", "or", "order", "outer", "over", "partition", "primary", "range", "recursive",
    "references", "rename", "replace", "returning", "right", "rollback", "select", "serial", "set", "some",
    "table", "then", "to", "transaction", "trigger", "true", "union", "unique", "update", "using",
    "values", "view", "when", "where", "window", "with",
  ]),
  mysql: new Set([
    "add", "all", "alter", "and", "any", "as", "asc", "auto_increment", "begin", "between", "binary",
    "by", "case", "cast", "change", "collate", "column", "commit", "constraint", "create", "cross",
    "current_date", "current_time", "current_timestamp", "database", "default", "delete", "desc",
    "distinct", "div", "drop", "duplicate", "else", "end", "engine", "escape", "except", "exists",
    "explain", "foreign", "from", "full", "group", "having", "if", "ignore", "in", "index", "inner",
    "insert", "intersect", "into", "is", "join", "key", "left", "like", "limit", "lock", "mod",
    "natural", "not", "null", "offset", "on", "only", "or", "order", "outer", "primary", "references",
    "replace", "restrict", "right", "rollback", "select", "set", "show", "table", "then", "to",
    "transaction", "union", "unique", "unlock", "update", "using", "values", "view", "when", "where",
    "with",
  ]),
  sqlite: new Set([
    "abort", "action", "add", "after", "all", "alter", "analyze", "and", "as", "asc", "attach",
    "autoincrement", "before", "begin", "between", "by", "cascade", "case", "cast", "check", "collate",
    "column", "commit", "conflict", "constraint", "create", "cross", "current_date", "current_time",
    "current_timestamp", "database", "default", "deferrable", "delete", "desc", "detach", "distinct",
    "drop", "else", "end", "escape", "except", "exclusive", "exists", "explain", "fail", "foreign",
    "from", "full", "glob", "group", "having", "if", "ignore", "immediate", "in", "index", "inner",
    "insert", "intersect", "into", "is", "isnull", "join", "key", "left", "like", "limit", "match",
    "natural", "no", "not", "notnull", "null", "of", "offset", "on", "or", "order", "outer", "plan",
    "pragma", "primary", "query", "raise", "recursive", "references", "regexp", "reindex", "release",
    "rename", "replace", "restrict", "right", "rollback", "row", "select", "set", "table", "temp",
    "temporary", "then", "to", "transaction", "trigger", "union", "unique", "update", "using", "vacuum",
    "values", "view", "virtual", "when", "where", "with", "without",
  ]),
};

/** Longest-first so "GROUP BY" wins over "GROUP". */
const SQL_PHRASES: readonly string[] = [
  "delete from", "insert into", "left outer join", "right outer join", "full outer join",
  "group by", "order by", "partition by", "union all", "inner join", "left join", "right join",
  "full join", "cross join", "on duplicate key", "create table", "drop table", "alter table",
  "is not null", "not null", "primary key", "foreign key", "with recursive", "select distinct",
  "natural join", "natural left", "natural right", "returning", "limit", "offset", "fetch",
  "values", "set", "select", "from", "where", "group", "order", "having", "union", "except",
  "intersect", "join", "on", "and", "or", "when", "then", "else", "end", "case", "using", "into",
  "with", "as", "distinct", "by", "all", "asc", "desc",
];

type SqlAtomKind = "clause" | "keyword" | "identifier" | "operator" | "literal" | "comment";

interface SqlAtom {
  /** Original text, ready to print. */
  text: string;
  kind: SqlAtomKind;
  /** Lowercase multi-word phrase for clause matching, e.g. "group by". */
  canonical: string;
  /** True when the next atom is `(` — the word is a function call. */
  isFunctionName: boolean;
}

interface SqlToken {
  t: "word" | "string" | "quoted" | "comment" | "punct" | "space" | "nl";
  v: string;
}

function tokenizeSql(source: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\r") {
      tokens.push({ t: "space", v: " " });
      i += 1;
      continue;
    }
    if (ch === "\n") {
      tokens.push({ t: "nl", v: "\n" });
      i += 1;
      continue;
    }
    if (ch === "-" && source[i + 1] === "-") {
      const start = i;
      while (i < n && source[i] !== "\n") i += 1;
      tokens.push({ t: "comment", v: source.slice(start, i) });
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      tokens.push({ t: "comment", v: source.slice(start, i) });
      continue;
    }
    if (ch === "'") {
      const start = i;
      i += 1;
      while (i < n) {
        if (source[i] === "'" && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (source[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      tokens.push({ t: "string", v: source.slice(start, i) });
      continue;
    }
    if (ch === '"' || ch === "`") {
      const quote = ch;
      const start = i;
      i += 1;
      while (i < n) {
        if (source[i] === quote) {
          i += 1;
          if (source[i] === quote) {
            i += 1;
            continue;
          }
          break;
        }
        i += 1;
      }
      tokens.push({ t: "quoted", v: source.slice(start, i) });
      continue;
    }
    if (ch === "$" && /^\$\d/.test(source.slice(i, i + 3))) {
      const start = i;
      i += 1;
      while (i < n && /\d/.test(source[i]!)) i += 1;
      tokens.push({ t: "quoted", v: source.slice(start, i) });
      continue;
    }
    if (/[A-Za-z_-￿]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$-￿]/.test(source[i]!)) i += 1;
      tokens.push({ t: "word", v: source.slice(start, i) });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < n && /[0-9a-fA-FxX.eE+-]/.test(source[i]!)) i += 1;
      tokens.push({ t: "word", v: source.slice(start, i) });
      continue;
    }
    tokens.push({ t: "punct", v: ch });
    i += 1;
  }
  return tokens;
}

const SQL_CLAUSES = new Set([
  "select", "from", "where", "group by", "order by", "having", "limit", "offset", "values", "set",
  "union", "union all", "except", "intersect", "join", "inner join", "left join", "right join",
  "full join", "cross join", "natural join", "on", "and", "or", "when", "else", "into", "with",
  "returning", "fetch", "using", "insert into", "delete from", "create table", "drop table",
  "alter table", "partition by", "on duplicate key", "on conflict",
]);

/**
 * Groups the token stream into printable atoms, merging multi-word keyword
 * phrases ("group by", "left outer join") into one atom so the emitter never
 * has to remember that a clause is two words long.
 */
function buildSqlAtoms(tokens: SqlToken[], dialect: SqlDialect): SqlAtom[] {
  const keywords = SQL_KEYWORDS[dialect];
  const significant = tokens.filter((token) => token.t !== "space" && token.t !== "nl");
  const atoms: SqlAtom[] = [];

  for (let index = 0; index < significant.length; index += 1) {
    const token = significant[index]!;

    if (token.t === "string" || token.t === "quoted") {
      atoms.push({ text: token.v, kind: "literal", canonical: "", isFunctionName: false });
      continue;
    }
    if (token.t === "comment") {
      atoms.push({ text: token.v, kind: "comment", canonical: "", isFunctionName: false });
      continue;
    }
    if (token.t === "punct") {
      atoms.push({ text: token.v, kind: "operator", canonical: token.v, isFunctionName: false });
      continue;
    }

    const lower = token.v.toLowerCase();
    if (!keywords.has(lower) && !/^\d/.test(token.v)) {
      const next = significant[index + 1];
      atoms.push({
        text: token.v,
        kind: "identifier",
        canonical: lower,
        isFunctionName: next?.t === "punct" && next.v === "(",
      });
      continue;
    }

    let consumed = 1;
    let canonical = lower;
    for (let size = 4; size >= 2; size -= 1) {
      const words: string[] = [];
      for (let k = 0; k < size; k += 1) {
        const candidate = significant[index + k];
        if (!candidate || candidate.t !== "word") {
          words.length = 0;
          break;
        }
        words.push(candidate.v.toLowerCase());
      }
      const candidate = words.join(" ");
      if (words.length === size && SQL_PHRASES.includes(candidate)) {
        canonical = candidate;
        consumed = size;
        break;
      }
    }

    // Keep the author's original casing, only collapsing the gap between words.
    const original = significant
      .slice(index, index + consumed)
      .map((part) => part.v)
      .join(" ");
    atoms.push({
      text: original,
      kind: SQL_CLAUSES.has(canonical) ? "clause" : "keyword",
      canonical,
      isFunctionName: false,
    });
    index += consumed - 1;
  }

  return atoms;
}

/** Clauses that end a SELECT list, so a following comma starts a new column. */
const SQL_LIST_ENDERS = new Set([
  "from", "where", "group by", "order by", "having", "limit", "offset", "union", "union all",
  "except", "intersect", "join", "inner join", "left join", "right join", "full join",
  "cross join", "on", "and", "or", "when", "else", "into", "with", "returning", "fetch",
  "using", "delete from", "on duplicate key", "on conflict", "set",
]);

/** Words after which `(` is punctuation rather than a function call. */
const SQL_PAREN_PRECEDERS = new Set([
  "in", "and", "or", "not", "on", "where", "having", "values", "by", "between", "like", "ilike",
  "exists", "all", "any", "some", "distinct", "case", "when", "then", "else", "end", "using",
  "as", "from", "select", "union", "except", "intersect", "returning", "into", "set", "limit",
  "offset", "do", "escape", "glob", "match", "regexp", "is", "partition by", "with",
]);

function sqlCase(text: string, options: SqlFormatOptions): string {
  if (options.keywordCase === "preserve") return text;
  return options.keywordCase === "upper" ? text.toUpperCase() : text.toLowerCase();
}

export function formatSql(input: string, options: SqlFormatOptions): TextOutcome {
  if (input.trim() === "") return { text: "", error: "Paste a SQL query to format." };
  const tokens = tokenizeSql(input);
  const atoms = buildSqlAtoms(tokens, options.dialect);
  const unit = options.indentWithTab ? "\t" : " ".repeat(options.indent);

  // Pair up brackets up front so the emitter never has to scan backwards.
  const openFor: number[] = [];
  const blockOpen = new Set<number>();
  const parenStack: number[] = [];
  for (let i = 0; i < atoms.length; i += 1) {
    if (atoms[i]!.text === "(") parenStack.push(i);
    else if (atoms[i]!.text === ")") {
      const open = parenStack.pop();
      if (open !== undefined) openFor[i] = open;
    }
  }
  // A paren is "block" when it wraps a whole query or VALUES list.
  for (let i = 0; i < atoms.length; i += 1) {
    if (atoms[i]!.text !== "(") continue;
    let depth = 0;
    for (let k = i; k < atoms.length; k += 1) {
      const text = atoms[k]!.text;
      if (text === "(") {
        depth += 1;
        continue;
      }
      if (text === ")") {
        depth -= 1;
        if (depth === 0) break;
        continue;
      }
      if (
        depth === 1 &&
        atoms[k]!.kind === "clause" &&
        ["select", "values", "with", "insert into", "update", "delete from"].includes(atoms[k]!.canonical)
      ) {
        blockOpen.add(i);
        break;
      }
    }
  }

  const lines: string[] = [];
  let current = "";
  let indent = 0;
  let parenDepth = 0;
  const selectList: boolean[] = [false];

  const pushLine = (line: string): void => {
    const trimmed = line.replace(/\s+$/, "");
    if (trimmed !== "") lines.push(trimmed);
  };
  const newline = (): void => {
    pushLine(current);
    current = unit.repeat(indent);
  };
  const needsSpaceBefore = (): boolean => current !== "" && !/[\s(.,]$/.test(current);
  const append = (text: string): void => {
    if (needsSpaceBefore()) current += " ";
    current += text;
  };

  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i]!;
    const previous = i > 0 ? atoms[i - 1]! : null;

    if (atom.kind === "comment") {
      if (atom.text.startsWith("--") || atom.text.includes("\n")) {
        newline();
        pushLine(current);
        for (const line of atom.text.split("\n")) pushLine(unit.repeat(indent) + line);
        current = unit.repeat(indent);
      } else {
        append(atom.text);
      }
      continue;
    }

    if (atom.text === "(") {
      const isCall = previous?.isFunctionName === true;
      if (!isCall && (previous === null || !/[\s(,]$/.test(current))) {
        const parenKeyword =
          previous?.kind === "clause" || previous?.kind === "keyword"
            ? SQL_PAREN_PRECEDERS.has(previous.canonical)
            : false;
        if (parenKeyword) current += " ";
      }
      current += "(";
      parenDepth += 1;
      selectList[parenDepth] = false;
      if (blockOpen.has(i)) {
        indent += 1;
        newline();
      }
      continue;
    }

    if (atom.text === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      selectList.length = Math.max(1, selectList.length - 1);
      if (blockOpen.has(openFor[i] ?? -1)) {
        indent = Math.max(0, indent - 1);
        newline();
      }
      current = current.replace(/\s+$/, "");
      current += ")";
      continue;
    }

    if (atom.text === ",") {
      current += ",";
      if (selectList[parenDepth] === true && options.oneColumnPerLine) {
        newline();
      } else {
        current += " ";
      }
      continue;
    }

    if (atom.text === "." || atom.text === "::") {
      current += atom.text;
      continue;
    }

    if (atom.text === ";") {
      current += ";";
      newline();
      continue;
    }

    if (atom.kind === "literal") {
      append(atom.text);
      continue;
    }

    if (atom.kind === "clause") {
      const clause = atom.canonical;
      if (clause === "case") {
        append(sqlCase(atom.text, options));
        indent += 1;
        newline();
        continue;
      }
      if (clause === "end") {
        indent = Math.max(0, indent - 1);
        newline();
        current += sqlCase(atom.text, options);
        continue;
      }
      if (clause === "when" || clause === "else") {
        newline();
        current += sqlCase(atom.text, options);
        continue;
      }
      if (clause === "then") {
        append(sqlCase(atom.text, options));
        continue;
      }
      newline();
      current += sqlCase(atom.text, options);
      if (clause === "select" || clause === "insert into") selectList[parenDepth] = true;
      else if (clause === "values" || clause === "set") selectList[parenDepth] = true;
      else if (SQL_LIST_ENDERS.has(clause)) selectList[parenDepth] = false;
      if (selectList[parenDepth] === true && options.oneColumnPerLine) newline();
      continue;
    }

    if (atom.kind === "operator") {
      append(atom.text);
      continue;
    }

    // Identifiers keep the case the author wrote; only real keywords change.
    append(atom.kind === "identifier" ? atom.text : sqlCase(atom.text, options));
  }

  pushLine(current);
  while (lines.length > 0 && lines[0] === "") lines.shift();

  const text = `${lines.join("\n")}\n`;
  const statements = atoms.filter((atom) => atom.text === ";").length;
  return {
    text,
    stats: [
      { label: "Lines", value: String(lines.length) },
      { label: "Atoms", value: atoms.length.toLocaleString("en") },
      { label: "Statements", value: String(statements) },
      { label: "Dialect", value: options.dialect },
      { label: "Size in", value: formatByteLabel(new Blob([input]).size) },
      { label: "Size out", value: formatByteLabel(new Blob([text]).size) },
    ],
    notes: [
      "String literals, quoted identifiers and both comment styles are copied through untouched — nothing inside them is ever re-spaced or re-cased.",
      "Column names, table names and function names keep the case you wrote; only keywords the chosen dialect recognises change case.",
      "A parenthesised group is broken across lines when it wraps a query or a VALUES list. Everything else stays inline, so function calls are not exploded.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  Base64                                                             */
/* ------------------------------------------------------------------ */

export type Base64Variant = "standard" | "url";

export interface Base64EncodeOptions {
  variant: Base64Variant;
  /** 0 disables line wrapping. */
  lineWidth: number;
}

export function encodeBase64(input: string, options: Base64EncodeOptions): string {
  let text = bytesToBase64(utf8Encode(input));
  if (options.variant === "url") {
    text = text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  if (options.lineWidth > 0) {
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += options.lineWidth) parts.push(text.slice(i, i + options.lineWidth));
    text = parts.join("\n");
  }
  return text;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface Base64DecodeOk {
  ok: true;
  bytes: Uint8Array;
  text: string;
  binary: boolean;
  mime: string | null;
  strippedWhitespace: number;
  paddingAdded: number;
  usedUrlAlphabet: boolean;
}

export interface Base64DecodeError {
  ok: false;
  error: string;
  offset: number | null;
  line: number;
  column: number;
  preview: string;
}

const MAGIC_NUMBERS: readonly { mime: string; bytes: number[] }[] = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/bmp", bytes: [0x42, 0x4d] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { mime: "application/octet-stream", bytes: [0x00, 0x61, 0x73, 0x6d] },
];

export function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  for (const entry of MAGIC_NUMBERS) {
    if (bytes.length >= entry.bytes.length && entry.bytes.every((byte, index) => bytes[index] === byte)) {
      return entry.mime;
    }
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/**
 * Decodes by hand rather than calling `atob`, because `atob` silently ignores
 * characters it does not recognise. Reporting "invalid Base64" without a
 * position is not actionable, so the exact offset of the first bad character is
 * returned.
 */
export function decodeBase64(input: string): Base64DecodeOk | Base64DecodeError {
  const chars: string[] = [];
  const offsets: number[] = [];
  let strippedWhitespace = 0;
  let usedUrlAlphabet = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      strippedWhitespace += 1;
      continue;
    }
    if (ch === "=") break; // padding always terminates the payload
    if (ch === "-" || ch === "_") usedUrlAlphabet = true;
    chars.push(ch);
    offsets.push(i);
  }

  const fail = (message: string, offset: number | null): Base64DecodeError => {
    if (offset === null) {
      return { ok: false, error: message, offset: null, line: 1, column: 1, preview: "" };
    }
    const snippet = snippetAt(input, offset);
    return {
      ok: false,
      error: message,
      offset,
      line: snippet.line,
      column: snippet.column,
      preview: snippet.preview,
    };
  };

  if (chars.length === 0) return fail("There is no Base64 data here — only whitespace.", null);

  for (let k = 0; k < chars.length; k += 1) {
    const ch = chars[k]!;
    if (BASE64_ALPHABET.includes(ch) || ch === "-" || ch === "_") continue;
    const printable = /^[\x20-\x7e]$/.test(ch) ? `"${ch}"` : `U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`;
    return fail(`${printable} is not a Base64 character.`, offsets[k]!);
  }

  if (chars.length % 4 === 1) {
    return fail(
      `A Base64 group cannot be a single character — this input has ${chars.length} character${
        chars.length === 1 ? "" : "s"
      } before padding, which is 1 more than a multiple of 4. A character is probably missing or extra.`,
      offsets[chars.length - 1]!,
    );
  }

  const bytes = new Uint8Array(Math.floor((chars.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let out = 0;
  for (const raw of chars) {
    const ch = raw === "-" ? "+" : raw === "_" ? "/" : raw;
    buffer = (buffer << 6) | BASE64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = (buffer >> bits) & 0xff;
      out += 1;
    }
  }

  let text = "";
  let binary = false;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    binary = true;
    text = "";
  }
  if (!binary) {
    // Control characters mean this is not text even if it decoded.
    for (const byte of bytes) {
      if (byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
        binary = true;
        text = "";
        break;
      }
    }
  }

  return {
    ok: true,
    bytes,
    text,
    binary,
    mime: binary ? sniffMime(bytes) : "text/plain;charset=utf-8",
    strippedWhitespace,
    paddingAdded: (4 - (chars.length % 4)) % 4,
    usedUrlAlphabet,
  };
}

export function hexDump(bytes: Uint8Array, limit = 512): string {
  const shown = bytes.subarray(0, limit);
  const lines: string[] = [];
  for (let offset = 0; offset < shown.length; offset += 16) {
    const slice = shown.subarray(offset, offset + 16);
    const hex: string[] = [];
    const ascii: string[] = [];
    for (let i = 0; i < 16; i += 1) {
      if (i < slice.length) {
        hex.push((slice[i]! & 0xff).toString(16).padStart(2, "0"));
        ascii.push(slice[i]! >= 0x20 && slice[i]! < 0x7f ? String.fromCharCode(slice[i]!) : ".");
      } else {
        hex.push("  ");
        ascii.push(" ");
      }
    }
    const gutter = offset.toString(16).padStart(8, "0");
    const groupA = hex.slice(0, 8).join(" ");
    const groupB = hex.slice(8).join(" ");
    lines.push(`${gutter}  ${groupA}  ${groupB}  |${ascii.join("")}|`);
  }
  if (bytes.length > limit) {
    lines.push(`… ${bytes.length - limit} more byte${bytes.length - limit === 1 ? "" : "s"} not shown`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  URLs                                                               */
/* ------------------------------------------------------------------ */

export type UrlEncodeMode = "component" | "uri" | "query";

export const URL_ENCODE_MODES: ReadonlyArray<{ value: UrlEncodeMode; label: string; hint: string }> = [
  { value: "component", label: "Component", hint: "encodeURIComponent — escapes everything except A-Z a-z 0-9 - _ . ! ~ * ' ( )" },
  { value: "uri", label: "Full URI", hint: "encodeURI — keeps / : ; , ? @ & = + $ # so a URL stays a URL" },
  { value: "query", label: "Query string", hint: "Like a component, but spaces become + as a form does" },
];

export function encodeUrl(text: string, mode: UrlEncodeMode): string {
  if (mode === "component") return encodeURIComponent(text);
  if (mode === "uri") return encodeURI(text);
  return encodeURIComponent(text).replace(/%20/g, "+");
}

export type UrlDecodeResult =
  | { ok: true; text: string }
  | { ok: false; error: string; offset: number; preview: string };

export function decodeUrl(text: string): UrlDecodeResult {
  // `+` only means a space inside a query string, and a space in a path is
  // illegal — so try the query reading first, then the plain one.
  const withPlus = text.replace(/\+/g, " ");
  try {
    return { ok: true, text: decodeURIComponent(withPlus) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The input is not valid percent-encoding.";
    const indexMatch = /at (\d+)/.exec(message);
    if (!indexMatch) {
      return { ok: false, error: "This is not valid percent-encoding: an escape is missing its hex digits.", offset: 0, preview: "" };
    }
    const offset = Math.min(text.length, Number(indexMatch[1]));
    const snippet = snippetAt(text, offset);
    return {
      ok: false,
      error: `This is not valid percent-encoding — the escape at character ${offset + 1} is incomplete or is not two hex digits.`,
      offset,
      preview: snippet.preview,
    };
  }
}

export interface UrlPart {
  label: string;
  raw: string;
  decoded: string;
  note?: string;
}

export interface UrlQueryParam {
  name: string;
  decodedName: string;
  value: string;
  decodedValue: string;
}

export type UrlAnalysis =
  | {
      ok: true;
      parts: UrlPart[];
      query: UrlQueryParam[];
      assumedProtocol: boolean;
      hostname: string;
      port: string;
      origin: string;
    }
  | { ok: false; error: string };

function safeDecodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function analyzeUrl(raw: string): UrlAnalysis {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Paste a URL first." };

  let url: URL | null = null;
  let assumedProtocol = false;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      url = new URL(`https://${trimmed}`);
      assumedProtocol = true;
    } catch {
      return {
        ok: false,
        error:
          "That is not a URL the browser can parse. It needs a scheme (https://, http://, mailto:…) or at least a host name.",
      };
    }
  }

  const password = url!.password ? url!.password : "";
  const segments = url!.pathname.split("/").filter((segment) => segment !== "");
  const query: UrlQueryParam[] = [];
  for (const pair of url!.searchParams) {
    query.push({
      name: pair[0],
      decodedName: pair[0],
      value: pair[1],
      decodedValue: safeDecodeComponent(pair[1]),
    });
  }

  const parts: UrlPart[] = [
    { label: "Scheme", raw: url!.protocol.replace(":", ""), decoded: url!.protocol.replace(":", "") },
    { label: "Username", raw: url!.username, decoded: url!.username, note: url!.username ? undefined : "not set" },
    { label: "Password", raw: password ? "••••••" : "", decoded: password ? "present" : "", note: password ? "present in the URL" : "not set" },
    { label: "Host", raw: url!.hostname, decoded: url!.hostname },
    { label: "Port", raw: url!.port, decoded: url!.port, note: url!.port ? undefined : "default for this scheme" },
    {
      label: "Path",
      raw: url!.pathname,
      decoded: safeDecodeComponent(url!.pathname),
      note: segments.length > 0 ? `${segments.length} segment${segments.length === 1 ? "" : "s"}` : "root",
    },
    ...segments.map((segment, index) => ({
      label: `Path ${index + 1}`,
      raw: segment,
      decoded: safeDecodeComponent(segment),
    })),
    { label: "Query", raw: url!.search.replace("?", ""), decoded: url!.searchParams.toString(), note: query.length > 0 ? `${query.length} parameter${query.length === 1 ? "" : "s"}` : "empty" },
    { label: "Fragment", raw: url!.hash.replace("#", ""), decoded: safeDecodeComponent(url!.hash.replace("#", "")), note: url!.hash ? undefined : "not set" },
  ];

  return { ok: true, parts, query, assumedProtocol, hostname: url!.hostname, port: url!.port, origin: url!.origin };
}

/* ------------------------------------------------------------------ */
/*  UUID                                                               */
/* ------------------------------------------------------------------ */

export type UuidVersion = "4" | "7";

export interface UuidOptions {
  version: UuidVersion;
  uppercase: boolean;
  hyphens: boolean;
}

export const MAX_UUIDS = 1000;

/**
 * v4 from `crypto.randomUUID()`, v7 built from a 48-bit millisecond timestamp
 * followed by random bits (RFC 9562). Both use `crypto.getRandomValues`, so no
 * identifier here is guessable.
 */
export function generateUuids(count: number, options: UuidOptions): string[] {
  const total = Math.max(1, Math.min(MAX_UUIDS, Math.floor(count)));
  const out: string[] = [];

  for (let i = 0; i < total; i += 1) {
    if (options.version === "4") {
      out.push(shapeUuid(crypto.randomUUID(), options));
      continue;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const stamp = Date.now();
    bytes[0] = (stamp / 2 ** 40) & 0xff;
    bytes[1] = (stamp / 2 ** 32) & 0xff;
    bytes[2] = (stamp / 2 ** 24) & 0xff;
    bytes[3] = (stamp / 2 ** 16) & 0xff;
    bytes[4] = (stamp / 2 ** 8) & 0xff;
    bytes[5] = stamp & 0xff;
    bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
    const hex = Array.from(bytes, (byte) => (byte & 0xff).toString(16).padStart(2, "0")).join("");
    out.push(hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5").toUpperCase());
  }

  if (options.version === "7") return out.map((uuid) => (options.hyphens ? uuid : uuid.replace(/-/g, "")));
  return out;
}

function shapeUuid(uuid: string, options: UuidOptions): string {
  const bare = uuid.replace(/-/g, "");
  const shaped = options.hyphens
    ? `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`
    : bare;
  return options.uppercase ? shaped.toUpperCase() : shaped.toLowerCase();
}

export function uuidsToCsv(uuids: readonly string[]): string {
  const rows = uuids.map((uuid) => {
    const version = uuid.replace(/-/g, "")[14] ?? "?";
    const variant = "89ab".includes(uuid.replace(/-/g, "")[16]?.toLowerCase() ?? "") ? "RFC 4122" : "unknown";
    return `"${uuid}",${version === "7" ? "uuid v7" : "uuid v4"},${variant}`;
  });
  return ["uuid,kind,variant", ...rows].join("\n");
}

/* ------------------------------------------------------------------ */
/*  Hashes                                                             */
/* ------------------------------------------------------------------ */

export type HashId =
  | "md5"
  | "sha1"
  | "sha256"
  | "sha384"
  | "sha512"
  | "sha512-256"
  | "sha3-256"
  | "sha3-512"
  | "blake2b-256"
  | "blake2s-256"
  | "crc32";

export interface HashAlgorithm {
  id: HashId;
  label: string;
  bits: number;
  source: string;
  /** Broken for collision resistance — fine for checksums, wrong for security. */
  legacy?: boolean;
  /** Not a cryptographic hash at all. */
  checksum?: boolean;
}

export const HASH_ALGORITHMS: readonly HashAlgorithm[] = [
  { id: "md5", label: "MD5", bits: 128, source: "@noble/hashes", legacy: true },
  { id: "sha1", label: "SHA-1", bits: 160, source: "Web Crypto", legacy: true },
  { id: "sha256", label: "SHA-256", bits: 256, source: "Web Crypto" },
  { id: "sha384", label: "SHA-384", bits: 384, source: "Web Crypto" },
  { id: "sha512", label: "SHA-512", bits: 512, source: "Web Crypto" },
  { id: "sha512-256", label: "SHA-512/256", bits: 256, source: "@noble/hashes" },
  { id: "sha3-256", label: "SHA3-256", bits: 256, source: "@noble/hashes" },
  { id: "sha3-512", label: "SHA3-512", bits: 512, source: "@noble/hashes" },
  { id: "blake2b-256", label: "BLAKE2b-256", bits: 256, source: "@noble/hashes" },
  { id: "blake2s-256", label: "BLAKE2s-256", bits: 256, source: "@noble/hashes" },
  { id: "crc32", label: "CRC-32", bits: 32, source: "built-in table", checksum: true },
];

interface NobleHashes {
  md5: HashFn;
  sha1: HashFn;
  sha512_256: HashFn;
  sha3_256: HashFn;
  sha3_512: HashFn;
  blake2b: (message: Uint8Array, options?: { dkLen?: number }) => Uint8Array;
  blake2s: (message: Uint8Array, options?: { dkLen?: number }) => Uint8Array;
}

type HashFn = (message: Uint8Array) => Uint8Array;

/**
 * `@noble/hashes` parameterises its byte types by ArrayBuffer flavour, which
 * does not line up with the DOM lib's `Uint8Array`. These functions are pure
 * and typed identically, so a single narrow assertion at the boundary is safe
 * and keeps the call sites clean.
 */
const asHashFn = (fn: unknown): HashFn => fn as HashFn;

let nobleHashes: Promise<NobleHashes> | null = null;

/** Loaded on first use so the module never lands in a page that skips hashing. */
function loadNobleHashes(): Promise<NobleHashes> {
  if (!nobleHashes) {
    nobleHashes = (async () => {
      const [legacy, sha2, sha3, blake2] = await Promise.all([
        import("@noble/hashes/legacy.js"),
        import("@noble/hashes/sha2.js"),
        import("@noble/hashes/sha3.js"),
        import("@noble/hashes/blake2.js"),
      ]);
      return {
        md5: asHashFn(legacy.md5),
        sha1: asHashFn(legacy.sha1),
        sha512_256: asHashFn(sha2.sha512_256),
        sha3_256: asHashFn(sha3.sha3_256),
        sha3_512: asHashFn(sha3.sha3_512),
        blake2b: asHashFn(blake2.blake2b) as NobleHashes["blake2b"],
        blake2s: asHashFn(blake2.blake2s) as NobleHashes["blake2s"],
      };
    })();
  }
  return nobleHashes;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): Uint8Array {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC32_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  return new Uint8Array([(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
}

type SubtleHashName = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

async function subtleDigest(algorithm: SubtleHashName, bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(algorithm, toBufferSource(bytes));
  return new Uint8Array(digest);
}

export async function computeDigest(id: HashId, bytes: Uint8Array): Promise<Uint8Array> {
  switch (id) {
    case "md5":
      return (await loadNobleHashes()).md5(bytes);
    case "sha1":
      return (await loadNobleHashes()).sha1(bytes);
    case "sha256":
      return subtleDigest("SHA-256", bytes);
    case "sha384":
      return subtleDigest("SHA-384", bytes);
    case "sha512":
      return subtleDigest("SHA-512", bytes);
    case "sha512-256":
      return (await loadNobleHashes()).sha512_256(bytes);
    case "sha3-256":
      return (await loadNobleHashes()).sha3_256(bytes);
    case "sha3-512":
      return (await loadNobleHashes()).sha3_512(bytes);
    case "blake2b-256":
      return (await loadNobleHashes()).blake2b(bytes, { dkLen: 32 });
    case "blake2s-256":
      return (await loadNobleHashes()).blake2s(bytes, { dkLen: 32 });
    case "crc32":
      return crc32(bytes);
  }
}

export interface HashResult {
  id: HashId;
  label: string;
  bits: number;
  hex: string;
  base64: string;
  /** Time spent in the digest itself, from performance.now(). */
  ms: number;
  error?: string;
}

export async function computeHashes(ids: readonly HashId[], bytes: Uint8Array): Promise<HashResult[]> {
  const out: HashResult[] = [];
  for (const id of ids) {
    const algorithm = HASH_ALGORITHMS.find((entry) => entry.id === id);
    if (!algorithm) continue;
    // Warm the module cache outside the measurement so the first digest does
    // not report import time as hashing time.
    if (id === "md5" || id === "sha1" || id === "sha512-256" || id.startsWith("sha3") || id.startsWith("blake2")) {
      await loadNobleHashes();
    }
    const started = nowMs();
    try {
      const digest = await computeDigest(id, bytes);
      const ms = nowMs() - started;
      out.push({
        id,
        label: algorithm.label,
        bits: algorithm.bits,
        hex: bytesToHex(digest),
        base64: bytesToBase64(digest),
        ms,
      });
    } catch (error) {
      out.push({
        id,
        label: algorithm.label,
        bits: algorithm.bits,
        hex: "",
        base64: "",
        ms: nowMs() - started,
        error: error instanceof Error ? error.message : "This algorithm failed in this browser.",
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  JWT                                                                */
/* ------------------------------------------------------------------ */

export interface JwtSegment {
  text: string;
  decoded: Record<string, unknown> | null;
  error: string | null;
  /** Pretty-printed when the segment is JSON, otherwise the raw text. */
  formatted: string;
}

export interface JwtDecoded {
  header: JwtSegment;
  payload: JwtSegment;
  signature: string;
  signatureBytes: Uint8Array;
  signingInput: string;
  alg: string;
  warnings: string[];
  claims: { key: string; label: string; value: string; kind: "time" | "text" | "other" }[];
}

export type JwtDecodeResult = { ok: true; jwt: JwtDecoded } | { ok: false; error: string };

export const JWT_CLAIM_LABELS: Readonly<Record<string, string>> = {
  iss: "Issuer",
  sub: "Subject",
  aud: "Audience",
  exp: "Expires at",
  nbf: "Not valid before",
  iat: "Issued at",
  jti: "JWT ID",
  name: "Name",
  given_name: "Given name",
  family_name: "Family name",
  email: "Email",
  email_verified: "Email verified",
  scope: "Scope",
  roles: "Roles",
  aud_type: "Audience type",
  azp: "Authorised party",
  nonce: "Nonce",
};

const HMAC_HASHES: Readonly<Record<string, string>> = {
  HS256: "SHA-256",
  HS384: "SHA-384",
  HS512: "SHA-512",
};

export function isHmacAlg(alg: string): boolean {
  return alg in HMAC_HASHES;
}

function decodeSegment(segment: string, name: string): JwtSegment {
  if (segment === "") return { text: segment, decoded: null, error: `${name} is empty.`, formatted: "" };
  let json: string;
  try {
    json = utf8Decode(base64UrlToBytes(segment));
  } catch {
    return {
      text: segment,
      decoded: null,
      error: `${name} is not valid base64url. JWT segments use the URL-safe alphabet and no padding.`,
      formatted: "",
    };
  }
  try {
    const value = JSON.parse(json) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { text: segment, decoded: null, error: `${name} decoded to JSON but is not an object.`, formatted: json };
    }
    return { text: segment, decoded: value as Record<string, unknown>, error: null, formatted: JSON.stringify(value, null, 2) };
  } catch (error) {
    return {
      text: segment,
      decoded: null,
      error: `${name} is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}.`,
      formatted: json,
    };
  }
}

function describeClaimValue(key: string, value: unknown): { value: string; kind: "time" | "text" | "other" } {
  if (typeof value === "number" && ["exp", "nbf", "iat"].includes(key)) {
    return { value: new Date(value * 1000).toISOString(), kind: "time" };
  }
  if (Array.isArray(value)) return { value: value.map((item) => String(item)).join(", "), kind: "text" };
  if (typeof value === "object" && value !== null) return { value: JSON.stringify(value), kind: "other" };
  return { value: String(value), kind: "text" };
}

export function decodeJwt(token: string): JwtDecodeResult {
  const trimmed = token.trim().replace(/^Bearer\s+/i, "");
  if (!trimmed) return { ok: false, error: "Paste a JWT to decode." };

  const parts = trimmed.split(".");
  if (parts.length < 2 || parts.length > 3) {
    return {
      ok: false,
      error: `A JWT has three dot-separated parts (header.payload.signature). This input has ${parts.length}.`,
    };
  }
  if (parts[0] === "" || parts[1] === "") {
    return { ok: false, error: "One of the two leading segments is empty." };
  }

  const header = decodeSegment(parts[0]!, "The header");
  const payload = decodeSegment(parts[1]!, "The payload");
  const signature = parts[2] ?? "";
  const warnings: string[] = [
    "The payload is base64, not encryption. Anyone holding this token can read every claim, and nothing here proves the token came from who it claims to.",
  ];

  const alg = typeof header.decoded?.alg === "string" ? header.decoded.alg : "";
  if (!alg) warnings.push("The header has no `alg`, so the signing algorithm is unknown.");
  if (alg === "none") warnings.push("`alg` is `none`. That means the token is unsigned, and no signature can protect it.");
  if (header.decoded?.crit) warnings.push("The header declares `crit` (critical extensions). Nothing here understands them.");

  const claims: JwtDecoded["claims"] = [];
  for (const [key, value] of Object.entries(payload.decoded ?? {})) {
    const described = describeClaimValue(key, value);
    claims.push({ key, label: JWT_CLAIM_LABELS[key] ?? key, value: described.value, kind: described.kind });
  }

  let signatureBytes: Uint8Array = new Uint8Array(0);
  if (signature) {
    try {
      signatureBytes = base64UrlToBytes(signature);
    } catch {
      warnings.push("The signature segment is not valid base64url.");
    }
  }

  if (header.error) return { ok: false, error: header.error };
  if (payload.error) return { ok: false, error: payload.error };

  return {
    ok: true,
    jwt: {
      header,
      payload,
      signature,
      signatureBytes,
      signingInput: `${parts[0]}.${parts[1]}`,
      alg,
      warnings,
      claims,
    },
  };
}

/** Length-independent, data-independent comparison. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export type JwtVerification =
  | { status: "valid"; message: string }
  | { status: "invalid"; message: string }
  | { status: "unsupported"; message: string }
  | { status: "not-attempted" };

export async function verifyJwtHmac(
  jwt: JwtDecoded,
  secret: string,
): Promise<JwtVerification> {
  if (!secret) return { status: "not-attempted" };
  const hash = HMAC_HASHES[jwt.alg];
  if (!hash) {
    return {
      status: "unsupported",
      message: `${jwt.alg || "That algorithm"} is not an HMAC, so a shared secret cannot verify it. RS256, ES256, PS256 and EdDSA need the issuer's public key, and a browser page has nowhere safe to keep one.`,
    };
  }
  if (jwt.signatureBytes.length === 0) {
    return { status: "invalid", message: "The token carries no signature at all." };
  }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      toBufferSource(utf8Encode(secret)),
      { name: "HMAC", hash },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, toBufferSource(utf8Encode(jwt.signingInput))),
    );
    return constantTimeEqual(expected, jwt.signatureBytes)
      ? {
          status: "valid",
          message: `The signature matches a new ${jwt.alg} HMAC of header.payload computed with the secret you entered. The token has not expired or been tampered with.`,
        }
      : {
          status: "invalid",
          message: "The signature does not match. Either the secret is wrong, or the token has been altered since it was signed.",
        };
  } catch (error) {
    return {
      status: "invalid",
      message: `This browser could not compute the HMAC: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

export interface JwtCountdown {
  label: string;
  timestamp: number;
  secondsRemaining: number;
  verdict: "valid" | "expired" | "not-yet" | "informational";
  text: string;
}

export function jwtCountdowns(jwt: JwtDecoded, now: number): JwtCountdown[] {
  const out: JwtCountdown[] = [];
  const payload = jwt.payload.decoded ?? {};

  for (const key of ["exp", "nbf", "iat"] as const) {
    const value = payload[key];
    if (typeof value !== "number") continue;
    const seconds = value - Math.floor(now / 1000);
    const absolute = Math.abs(seconds);
    const parts: string[] = [];
    if (absolute >= 86_400) parts.push(`${Math.round(absolute / 86_400)} day${Math.round(absolute / 86_400) === 1 ? "" : "s"}`);
    else if (absolute >= 3_600) parts.push(`${Math.round(absolute / 3_600)} h ${Math.round((absolute % 3_600) / 60)} min`);
    else if (absolute >= 60) parts.push(`${Math.round(absolute / 60)} min ${absolute % 60} s`);
    else parts.push(`${absolute} s`);

    let verdict: JwtCountdown["verdict"] = "informational";
    let prefix = "";
    if (key === "exp") {
      if (seconds <= 0) {
        verdict = "expired";
        prefix = "Expired ";
      } else {
        verdict = "valid";
        prefix = "Expires in ";
      }
    } else if (key === "nbf") {
      if (seconds > 0) {
        verdict = "not-yet";
        prefix = "Valid in ";
      } else {
        verdict = "valid";
        prefix = "Became valid ";
      }
    } else {
      prefix = "Issued ";
    }
    out.push({
      label: JWT_CLAIM_LABELS[key] ?? key,
      timestamp: value * 1000,
      secondsRemaining: seconds,
      verdict,
      text: `${prefix}${parts.join(" ")}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Regular expressions                                                */
/* ------------------------------------------------------------------ */

export interface RegexAtom {
  text: string;
  kind: "anchor" | "group" | "class" | "escape" | "quantifier" | "alternation" | "literal" | "dot" | "backreference";
  detail: string;
}

const CLASS_ESCAPES: Readonly<Record<string, string>> = {
  d: "any digit, 0 to 9",
  D: "any character that is not a digit",
  w: "any word character — a letter, a digit or an underscore",
  W: "any character that is not a letter, digit or underscore",
  s: "any whitespace character — space, tab, newline, carriage return, form feed",
  S: "any character that is not whitespace",
  b: "a word boundary, where a word character meets a non-word character",
  B: "a position that is not a word boundary",
  n: "a newline",
  r: "a carriage return",
  t: "a tab",
  f: "a form feed",
  v: "a vertical tab",
  "0": "the NUL character",
};

function describeEscape(ch: string, negated: boolean): string {
  const base = CLASS_ESCAPES[ch];
  if (base === undefined) return `a literal "${ch}"`;
  return negated ? base.replace(/^any /, "no ") : base;
}

/**
 * A real recursive-descent parse of the pattern, so the explanation names the
 * parts of *this* pattern instead of describing regexes in general.
 */
export function explainRegex(pattern: string): { atoms: RegexAtom[]; error: string | null } {
  const atoms: RegexAtom[] = [];
  let i = 0;
  let error: string | null = null;
  const n = pattern.length;

  const push = (text: string, kind: RegexAtom["kind"], detail: string): void => {
    atoms.push({ text, kind, detail });
  };

  const readClass = (): void => {
    const start = i;
    i += 1;
    let negated = false;
    if (pattern[i] === "^") {
      negated = true;
      i += 1;
    }
    const members: string[] = [];
    let first = true;
    while (i < n && (pattern[i] !== "]" || first)) {
      first = false;
      if (pattern[i] === "\\") {
        const next = pattern[i + 1] ?? "";
        members.push(describeEscape(next, negated));
        if (next && !/[dDwWsSb]/.test(next)) members[members.length - 1] = `the literal "${next}"`;
        i += 2;
        continue;
      }
      members.push(`"${pattern[i]}"`);
      i += 1;
    }
    if (pattern[i] === "]") i += 1;
    else error = `The character class starting at position ${start + 1} is never closed with ].`;
    const shown = members.slice(0, 6).join(", ");
    const more = members.length > 6 ? `, and ${members.length - 6} more` : "";
    push(
      pattern.slice(start, i),
      "class",
      `${negated ? "one character that is NOT any of" : "one character from"} ${shown}${more}`,
    );
  };

  const readGroup = (): void => {
    const start = i;
    i += 1;
    let detail = "a capture group — its match is stored as $1, $2, …";
    if (pattern[i] === "?") {
      const pair = pattern.slice(i, i + 2);
      if (pair === "?:") {
        detail = "a non-capturing group — it groups without storing a match";
        i += 2;
      } else if (pair === "?=") {
        detail = "a lookahead — the text inside must match next, but it is not consumed";
        i += 2;
      } else if (pair === "?!") {
        detail = "a negative lookahead — the text inside must NOT match next";
        i += 2;
      } else if (pair === "?<" && (pattern[i + 2] === "=" || pattern[i + 2] === "!")) {
        detail =
          pattern[i + 2] === "="
            ? "a lookbehind — the text before this position must match what is inside"
            : "a negative lookbehind — the text before this position must not match what is inside";
        i += 3;
      } else if (pattern[i + 2] !== "=" && pattern[i + 2] !== "!") {
        // `?<` with neither `=` nor `!` after it is a named group; the body can
        // be anything, including an escape such as `(?<year>\d{4})`.
        const close = pattern.indexOf(">", i + 2);
        const name = close === -1 ? "" : pattern.slice(i + 2, close);
        if (close !== -1 && /^[A-Za-z_$][\w$]*$/.test(name)) {
          detail = `a named capture group called "${name}", read back as $«${name}»`;
          i = close + 1;
        } else {
          detail = "a modifier group such as (?i) or (?x)";
          i += 1;
        }
      }
    }
    push("(", "group", detail);
    parseAlternation();
    if (pattern[i] === ")") {
      push(")", "group", "end of the group");
      i += 1;
    } else {
      error = `The group opened at position ${start + 1} is never closed with ).`;
      push("…)", "group", "end of the group (missing)");
    }
  };

  const readQuantifier = (): void => {
    const start = i;
    let text = pattern[i]!;
    i += 1;
    let detail = "";
    if (text === "*") detail = "zero or more times, greedily";
    else if (text === "+") detail = "one or more times, greedily";
    else if (text === "?") detail = "zero or one time (optional)";
    else if (text === "{") {
      const close = pattern.indexOf("}", i);
      if (close === -1) {
        push("{", "literal", "a literal \"{\" — a quantifier would need a closing }");
        return;
      }
      const body = pattern.slice(i, close);
      i = close + 1;
      if (!/^\d+(,\d*)?$/.test(body)) {
        push(pattern.slice(start, i), "literal", `the literal text "${body}" — a quantifier needs digits, like {2} or {2,5}`);
        return;
      }
      const parts = body.split(",");
      if (parts.length === 1) detail = `exactly ${parts[0]} time${parts[0] === "1" ? "" : "s"}`;
      else if (parts[0] === "") detail = `${parts[1]} or more times`;
      else if (parts[1] === "") detail = `between ${parts[0]} and ${parts[1]} times`;
      else detail = `between ${parts[0]} and ${parts[1]} times`;
    }
    text = pattern.slice(start, i);
    if (pattern[i] === "?") {
      text += "?";
      i += 1;
      detail = `${detail}, but as few times as possible (lazy)`;
    } else if (pattern[i] === "+") {
      text += "+";
      i += 1;
      detail = `${detail}, and it must not match zero times (possessive)`;
    }
    push(text, "quantifier", detail);
  };

  const readAtom = (): void => {
    const ch = pattern[i]!;
    if (ch === "(") {
      readGroup();
      return;
    }
    if (ch === "[") {
      readClass();
      return;
    }
    if (ch === "\\") {
      const start = i;
      const next = pattern[i + 1] ?? "";
      if (/[1-9]/.test(next)) {
        i += 2;
        while (i < n && /[0-9]/.test(pattern[i]!)) i += 1;
        push(pattern.slice(start, i), "backreference", "the same text that the referenced group matched");
        return;
      }
      if (next === "k" && pattern[i + 2] === "<") {
        const close = pattern.indexOf(">", i + 3);
        const name = pattern.slice(i + 3, close === -1 ? n : close);
        i = close === -1 ? n : close + 1;
        push(pattern.slice(start, i), "backreference", `the same text the group named "${name}" matched`);
        return;
      }
      i += 2;
      if (next === "b" || next === "B") {
        push(pattern.slice(start, i), "escape", describeEscape(next, false));
        return;
      }
      if (/[dDwWsS]/.test(next)) {
        push(pattern.slice(start, i), "escape", describeEscape(next, false));
        return;
      }
      const punctuation = /[\\^$.|?*+()[\]{}\/-]/.test(next);
      push(
        pattern.slice(start, i),
        "escape",
        punctuation ? `a literal "${next}"` : next === "n" ? describeEscape("n", false) : describeEscape(next, false),
      );
      return;
    }
    if (ch === "^") {
      i += 1;
      push("^", "anchor", "the start of the string, or the start of a line when the m flag is on");
      return;
    }
    if (ch === "$") {
      i += 1;
      push("$", "anchor", "the end of the string, or the end of a line when the m flag is on");
      return;
    }
    if (ch === ".") {
      i += 1;
      push(".", "dot", "any single character except a line break (a line break too when the s flag is on)");
      return;
    }
    if (ch === "|") {
      i += 1;
      push("|", "alternation", "or — match the text before it or the text after it");
      return;
    }
    i += 1;
    push(ch, "literal", `the literal character "${ch}"`);
  };

  const parseTerm = (): void => {
    if (i >= n) return;
    readAtom();
    if (i < n && /[*+?{]/.test(pattern[i]!)) readQuantifier();
  };

  const parseSequence = (): void => {
    while (i < n && pattern[i] !== "|" && pattern[i] !== ")") parseTerm();
  };

  const parseAlternation = (): void => {
    parseSequence();
    while (i < n && pattern[i] === "|") {
      push("|", "alternation", "or — match the text before it or the text after it");
      i += 1;
      parseSequence();
    }
  };

  parseAlternation();
  if (i < n) {
    error = `There is an unmatched "${pattern[i]}" at position ${i + 1}.`;
  }
  return { atoms, error };
}

export function regexSummary(atoms: readonly RegexAtom[]): string {
  if (atoms.length === 0) return "This pattern is empty, so it matches an empty string.";
  const parts: string[] = [];
  const anchors = atoms.filter((atom) => atom.kind === "anchor");
  if (anchors.some((atom) => atom.text === "^")) parts.push("anchored at the start");
  if (anchors.some((atom) => atom.text === "$")) parts.push("anchored at the end");
  const groups = atoms.filter((atom) => atom.text === "(").length;
  if (groups > 0) parts.push(`${groups} capturing group${groups === 1 ? "" : "s"}`);
  const alternations = atoms.filter((atom) => atom.kind === "alternation").length;
  if (alternations > 0) parts.push(`${alternations} alternation${alternations === 1 ? "" : "s"}`);
  const quantifiers = atoms.filter((atom) => atom.kind === "quantifier").length;
  if (quantifiers > 0) parts.push(`${quantifiers} quantifier${quantifiers === 1 ? "" : "s"}`);
  return parts.length > 0 ? `This pattern is ${parts.join(", ")}.` : "This pattern has no anchors, so it can match anywhere in the text.";
}

export interface RegexSnippet {
  label: string;
  pattern: string;
  note: string;
}

export const REGEX_SNIPPETS: readonly RegexSnippet[] = [
  { label: "Email", pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}", note: "Practical, not RFC 5322 complete — no quoted local parts or IP domains." },
  { label: "URL", pattern: "https?://[^\\s<>\"']+", note: "Stops at whitespace and the characters that would end an attribute." },
  { label: "IPv4", pattern: "\\b(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\b", note: "Validates each octet's range, not just the digit count." },
  { label: "Date", pattern: "\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])", note: "ISO-style calendar date with a shape check, no calendar validation." },
  { label: "Hex colour", pattern: "#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b", note: "Matches 3, 6 and 8 digit forms, with or without the leading hash." },
  { label: "Digits", pattern: "\\d+", note: "One or more digits." },
  { label: "Words", pattern: "\\b\\w+\\b", note: "Whole words only, bounded so partial words do not match." },
  { label: "Whitespace run", pattern: "\\s+", note: "One or more whitespace characters." },
  { label: "Duplicate word", pattern: "\\b(\\w+)\\s+\\1\\b", note: "Finds a word repeated immediately — needs the i flag for case-insensitive matching." },
];

/** A static heuristic for the classic `(a+)+` blow-up. Not a proof, but useful. */
export function regexBacktrackWarning(pattern: string): string | null {
  const nested = /\((?:\?[:=!]|<[=!])?[^(){}]*(?:[+*]|\{\d+,\d*\}|\\d[+*])[^(){}]*\)\s*(?:[+*]|\{\d+,\d*\})/;
  if (nested.test(pattern)) {
    return "This pattern nests a repetition inside another repetition, which is the shape that causes catastrophic backtracking. On a long input that fails to match, the browser can hang for minutes.";
  }
  if (/\([^()]*[+*][^()]*\)\s*[+*]/.test(pattern) && !/\[[^\]]*\]/.test(pattern)) {
    return "A group that can repeat is itself repeated, with no character class to break the ambiguity. Expect slow matching on inputs that almost match.";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Timestamps                                                         */
/* ------------------------------------------------------------------ */

export const COMMON_TIMEZONES: readonly { id: string; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Dublin", label: "Dublin" },
  { id: "Europe/Lisbon", label: "Lisbon" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Madrid", label: "Madrid" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Amsterdam", label: "Amsterdam" },
  { id: "Europe/Stockholm", label: "Stockholm" },
  { id: "Europe/Warsaw", label: "Warsaw" },
  { id: "Europe/Athens", label: "Athens" },
  { id: "Europe/Kyiv", label: "Kyiv" },
  { id: "Europe/Istanbul", label: "Istanbul" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Africa/Cairo", label: "Cairo" },
  { id: "Africa/Lagos", label: "Lagos" },
  { id: "Africa/Nairobi", label: "Nairobi" },
  { id: "Africa/Johannesburg", label: "Johannesburg" },
  { id: "Asia/Jerusalem", label: "Jerusalem" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "Kolkata" },
  { id: "Asia/Dhaka", label: "Dhaka" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Jakarta", label: "Jakarta" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Hong_Kong", label: "Hong Kong" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Australia/Perth", label: "Perth" },
  { id: "Australia/Adelaide", label: "Adelaide" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
  { id: "Pacific/Honolulu", label: "Honolulu" },
];

/** 1899-12-30 is Excel's day zero; the 1900 leap-year bug is baked into it. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
/** .NET counts 100-nanosecond ticks from 0001-01-01. */
const DOTNET_EPOCH_TICKS = 621_355_968_000_000_000n;

function pad(value: number, size = 2): string {
  return String(Math.abs(value)).padStart(size, "0");
}

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  millisecond: string;
}

function formatInZone(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  const parts = formatter.formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = part.value;
  return {
    year: out.year ?? "0000",
    month: out.month ?? "01",
    day: out.day ?? "01",
    hour: out.hour === "24" ? "00" : (out.hour ?? "00"),
    minute: out.minute ?? "00",
    second: out.second ?? "00",
    millisecond: (out.fractionalSecond ?? "000").padEnd(3, "0").slice(0, 3),
  };
}

function zoneOffsetLabel(date: Date, timeZone: string): string {
  const parts = formatInZone(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMinutes = Math.round((asUtc - date.getTime() - date.getMilliseconds()) / 60_000);
  if (offsetMinutes === 0) return "UTC+00:00";
  const sign = offsetMinutes < 0 ? "-" : "+";
  return `UTC${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
}

function humanRelative(target: number, now: number): string {
  const diff = target - now;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 1000],
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
    ["week", 604_800_000],
    ["month", 2_592_000_000],
    ["year", 31_536_000_000],
  ];
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const [unit, ms] = units[i]!;
    if (Math.abs(diff) >= ms || unit === "second") {
      return rtf.format(Math.round(diff / ms), unit);
    }
  }
  return "now";
}

export interface TimestampRow {
  label: string;
  value: string;
  note?: string;
}

export function formatTimestampRows(ms: number, timeZone: string, now: number): TimestampRow[] {
  if (!Number.isFinite(ms)) return [];
  const date = new Date(ms);
  const zoned = formatInZone(date, timeZone);
  const offset = zoneOffsetLabel(date, timeZone);
  const sqlLocal = `${zoned.year}-${zoned.month}-${zoned.day} ${zoned.hour}:${zoned.minute}:${zoned.second}.${zoned.millisecond}${offset.slice(3)}`;
  const excel = (ms - EXCEL_EPOCH_UTC) / 86_400_000;
  const ticks = BigInt(ms) * 10_000n + DOTNET_EPOCH_TICKS;
  const dayOfYear = Math.floor((ms - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][date.getUTCDay()];

  return [
    { label: "ISO 8601 (UTC)", value: date.toISOString(), note: "The unambiguous one. Use this in APIs." },
    { label: "RFC 2822", value: new Date(ms).toUTCString(), note: "The format e-mail headers use." },
    { label: "Unix (seconds)", value: String(Math.floor(ms / 1000)), note: "Seconds since 1970-01-01T00:00:00Z" },
    { label: "Unix (milliseconds)", value: String(ms), note: "Seconds × 1000" },
    {
      label: "Local to this device",
      value: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
      note: "Whatever the visitor's machine is set to",
    },
    {
      label: timeZone === "UTC" ? "UTC" : `In ${timeZone}`,
      value: `${zoned.year}-${zoned.month}-${zoned.day} ${zoned.hour}:${zoned.minute}:${zoned.second}.${zoned.millisecond}`,
      note: offset,
    },
    { label: "SQL AT TIME ZONE", value: `TIMESTAMP '${zoned.year}-${zoned.month}-${zoned.day} ${zoned.hour}:${zoned.minute}:${zoned.second}' AT TIME ZONE '${timeZone}'`, note: "Postgres / Oracle form" },
    { label: "SQL local", value: sqlLocal, note: "A plain timestamp plus its offset" },
    { label: ".NET ticks", value: ticks.toString(), note: "100 ns intervals since 0001-01-01" },
    { label: "Excel serial", value: excel.toFixed(6), note: `Day ${dayOfYear} of ${date.getUTCFullYear()} (${weekday})` },
    { label: "Relative", value: humanRelative(ms, now), note: now === 0 ? undefined : "Compared with the time on this device right now" },
  ];
}

export type TimestampParse =
  | { ok: true; ms: number; detected: "unix-seconds" | "unix-milliseconds" | "date-string" }
  | { ok: false; error: string; preview?: string };

export function parseTimestampInput(raw: string, unit: "auto" | "seconds" | "milliseconds"): TimestampParse {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Paste a Unix timestamp or a date string." };

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    let detected: "unix-seconds" | "unix-milliseconds";
    if (unit === "seconds") detected = "unix-seconds";
    else if (unit === "milliseconds") detected = "unix-milliseconds";
    else {
      const digits = trimmed.replace("-", "").replace(".", "").length;
      // Ten digits or fewer cannot be milliseconds for any plausible modern date.
      detected = digits <= 10 ? "unix-seconds" : "unix-milliseconds";
    }
    const ms = detected === "unix-seconds" ? Math.round(numeric * 1000) : Math.round(numeric);
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `${trimmed} is too large to be a ${detected === "unix-seconds" ? "second" : "millisecond"} timestamp.` };
    }
    if (Math.abs(ms) > 8.64e15) {
      return { ok: false, error: "That timestamp is outside the range a JavaScript Date can represent (about ±8.64 × 10¹⁵ ms, i.e. the years ±273,790)." };
    }
    return { ok: true, ms, detected };
  }

  const normalised = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00` : trimmed;
  const ms = Date.parse(normalised);
  if (Number.isNaN(ms)) {
    return {
      ok: false,
      error: "This is not a date the browser can read. ISO 8601 (`2026-02-16T09:30:00Z`) is the safest format to paste.",
    };
  }
  return { ok: true, ms, detected: "date-string" };
}

/* ------------------------------------------------------------------ */
/*  Cron                                                               */
/* ------------------------------------------------------------------ */

export interface CronFieldSpec {
  label: string;
  min: number;
  max: number;
  names?: Record<string, number>;
}

export const CRON_FIELDS: readonly CronFieldSpec[] = [
  { label: "minute", min: 0, max: 59 },
  { label: "hour", min: 0, max: 23 },
  { label: "day of month", min: 1, max: 31 },
  {
    label: "month",
    min: 1,
    max: 12,
    names: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
  },
  { label: "day of week", min: 0, max: 6, names: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 } },
];

export const CRON_FIELDS_WITH_SECONDS: readonly CronFieldSpec[] = [
  { label: "second", min: 0, max: 59 },
  ...CRON_FIELDS,
];

export interface CronPreset {
  label: string;
  expression: string;
  note: string;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: "Every minute", expression: "* * * * *", note: "Fires on every minute boundary, all day." },
  { label: "Every 5 minutes", expression: "*/5 * * * *", note: "Minute 0, 5, 10, 15 … of every hour." },
  { label: "Every 15 minutes", expression: "*/15 * * * *", note: "Quarter-hourly, the most common polling interval." },
  { label: "Hourly", expression: "0 * * * *", note: "At second 0 of every hour." },
  { label: "Daily at midnight", expression: "0 0 * * *", note: "Start of every day, server local time." },
  { label: "Weekdays at 09:00", expression: "0 9 * * 1-5", note: "Monday to Friday mornings." },
  { label: "Twice a day", expression: "0 9,17 * * *", note: "09:00 and 17:00." },
  { label: "Weekly on Monday", expression: "0 0 * * 1", note: "Midnight at the start of Monday." },
  { label: "Monthly on the 1st", expression: "0 0 1 * *", note: "First day of the month at midnight." },
  { label: "Every 30 seconds", expression: "*/30 * * * * *", note: "Six-field syntax, with a seconds column." },
];

export interface ParsedCron {
  fields: string[];
  hasSeconds: boolean;
  /** Bit sets indexed like the fields, 1 = matches. */
  masks: number[][];
  domRestricted: boolean;
  dowRestricted: boolean;
}

export type CronParse = { ok: true; cron: ParsedCron } | { ok: false; error: string };

function parseCronValues(
  field: string,
  spec: CronFieldSpec,
  fieldIndex: number,
): { mask: number[]; restricted: boolean } | { error: string } {
  const mask = new Array<number>(spec.max - spec.min + 1).fill(0);
  const normalised = field.trim().toLowerCase();
  if (normalised === "") {
    return { error: `Field ${fieldIndex + 1} (${spec.label}) is empty.` };
  }
  const parts = normalised.split(",");
  let restricted = normalised !== "*" && normalised !== "?";

  for (const part of parts) {
    if (part === "") return { error: `Field ${fieldIndex + 1} (${spec.label}) has an empty entry in its list.` };
    const [rangePart, stepPart] = part.split("/");
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) {
        return { error: `Field ${fieldIndex + 1} (${spec.label}) has the step "${stepPart}". A step must be a whole number of 1 or more.` };
      }
    }
    const step = stepPart === undefined ? 1 : Number(stepPart);

    let start: number;
    let end: number;
    if (rangePart === "*" || rangePart === "?") {
      start = spec.min;
      end = spec.max;
    } else if (rangePart!.includes("-")) {
      const [rawStart, rawEnd] = rangePart!.split("-");
      const resolve = (value: string): number | null => {
        if (/^\d+$/.test(value)) return Number(value);
        if (spec.names && spec.names[value] !== undefined) return spec.names[value]!;
        return null;
      };
      const low = resolve(rawStart ?? "");
      const high = resolve(rawEnd ?? "");
      if (low === null) return { error: `Field ${fieldIndex + 1} (${spec.label}) has "${rawStart}", which is not a value in ${spec.min}–${spec.max}.` };
      if (high === null) return { error: `Field ${fieldIndex + 1} (${spec.label}) has "${rawEnd}", which is not a value in ${spec.min}–${spec.max}.` };
      if (spec.label === "day of week" && high === 7) {
        restricted = true;
        return { error: `Field ${fieldIndex + 1} (day of week) uses 7. Use 0 for Sunday — some cron dialects also accept 7, and this tool does not.` };
      }
      if (low > high) return { error: `Field ${fieldIndex + 1} (${spec.label}) runs from ${low} to ${high}, which is backwards.` };
      start = low;
      end = high;
    } else {
      const single = /^\d+$/.test(rangePart!) ? Number(rangePart) : spec.names?.[rangePart!];
      if (single === undefined) {
        return {
          error: `Field ${fieldIndex + 1} (${spec.label}) has "${rangePart}", which is not a number in ${spec.min}–${spec.max}.${
            spec.names ? ` Names allowed: ${Object.keys(spec.names).join(", ")}.` : ""
          }`,
        };
      }
      if (single < spec.min || single > spec.max) {
        return {
          error: `Field ${fieldIndex + 1} (${spec.label}) has the value ${single}. The allowed range is ${spec.min}–${spec.max}.`,
        };
      }
      start = single;
      end = stepPart === undefined ? single : spec.max;
    }

    if (start < spec.min || end > spec.max) {
      return {
        error: `Field ${fieldIndex + 1} (${spec.label}) has the range ${start}–${end}. The allowed range is ${spec.min}–${spec.max}.`,
      };
    }
    for (let value = start; value <= end; value += step) mask[value - spec.min] = 1;
  }

  if (mask.every((bit) => bit === 0)) {
    return { error: `Field ${fieldIndex + 1} (${spec.label}) matches nothing in "${field}". Check the step and the range.` };
  }
  return { mask, restricted };
}

export function parseCron(expression: string): CronParse {
  const trimmed = expression.trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: false, error: "Enter a cron expression first." };
  const fields = trimmed.split(" ");
  const hasSeconds = fields.length === 6;
  if (fields.length !== 5 && fields.length !== 6) {
    return {
      ok: false,
      error: `A cron expression has 5 fields (minute hour day-of-month month day-of-week) or 6 with a leading seconds field. "${trimmed}" has ${fields.length}.`,
    };
  }
  const specs = hasSeconds ? CRON_FIELDS_WITH_SECONDS : CRON_FIELDS;
  const masks: number[][] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const result = parseCronValues(fields[i]!, specs[i]!, i);
    if ("error" in result) return { ok: false, error: result.error };
    masks.push(result.mask);
  }
  return {
    ok: true,
    cron: {
      fields,
      hasSeconds,
      masks,
      domRestricted: masks[hasSeconds ? 2 : 1]!.some((bit, index) => bit === 1 && index !== 0) || fields[hasSeconds ? 2 : 1] !== "*",
      dowRestricted: fields[4] !== "*",
    },
  };
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function namedCronValue(value: string, spec: CronFieldSpec): string {
  if (spec.label === "day of week") {
    if (/^\d+$/.test(value)) {
      const index = Number(value) % 7;
      return WEEKDAY_NAMES[index]!;
    }
    const named = spec.names?.[value];
    return named === undefined ? value : WEEKDAY_NAMES[named]!;
  }
  if (spec.label === "month") {
    if (/^\d+$/.test(value)) return MONTH_NAMES[Number(value)] ?? value;
    const named = spec.names?.[value];
    return named === undefined ? value : (MONTH_NAMES[named] ?? value);
  }
  return value;
}

function describeField(field: string, spec: CronFieldSpec): string {
  const normalised = field.toLowerCase();
  if (normalised === "*" || normalised === "?") return `every ${spec.label}`;

  const segments = normalised.split(",").map((part) => {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? null : Number(stepPart);

    if (rangePart === "*" || rangePart === "?") {
      if (step === null) {
        if (spec.label === "day of week") return "every day";
        return `every ${spec.label}`;
      }
      return `every ${step} ${spec.label}s`;
    }
    if (rangePart!.includes("-")) {
      const [low, high] = rangePart!.split("-");
      return step === null
        ? `${namedCronValue(low!, spec)} to ${namedCronValue(high!, spec)}`
        : `every ${step} ${spec.label}s from ${namedCronValue(low!, spec)} to ${namedCronValue(high!, spec)}`;
    }
    return step === null
      ? namedCronValue(rangePart!, spec)
      : `every ${step} ${spec.label}s starting at ${namedCronValue(rangePart!, spec)}`;
  });
  if (segments.length === 1) return segments[0]!;
  if (spec.label === "day of week") return `${segments.slice(0, -1).join(", ")} and ${segments[segments.length - 1]}`;
  return segments.join(", ");
}

export function describeCron(expression: string): string {
  const parsed = parseCron(expression);
  if (!parsed.ok) return parsed.error;
  const { fields, hasSeconds } = parsed.cron;
  const specs = hasSeconds ? CRON_FIELDS_WITH_SECONDS : CRON_FIELDS;

  const secondRaw = hasSeconds ? fields[0]! : null;
  const minuteRaw = fields[hasSeconds ? 1 : 0]!;
  const hourRaw = fields[hasSeconds ? 2 : 1]!;
  const domRaw = fields[hasSeconds ? 3 : 2]!;
  const monthRaw = fields[hasSeconds ? 4 : 3]!;
  const dowRaw = fields[hasSeconds ? 5 : 4]!;

  const minute = describeField(minuteRaw, specs[hasSeconds ? 1 : 0]!);
  const hour = describeField(hourRaw, specs[hasSeconds ? 2 : 1]!);
  const dom = describeField(domRaw, specs[hasSeconds ? 3 : 2]!);
  const month = describeField(monthRaw, specs[hasSeconds ? 4 : 3]!);
  const dow = describeField(dowRaw, specs[hasSeconds ? 5 : 4]!);

  const isAny = (field: string): boolean => field === "*" || field === "?";
  const stepOf = (field: string): number | null => (field.startsWith("*/") ? Number(field.slice(2)) : null);
  const single = (field: string): string | null => (/^\d+$/.test(field) ? field : null);

  const hourStep = stepOf(hourRaw);
  const minuteStep = stepOf(minuteRaw);
  const secondStep = secondRaw === null ? null : stepOf(secondRaw);
  const hourNumber = single(hourRaw);
  const minuteNumber = single(minuteRaw);
  const secondNumber = secondRaw === null ? null : single(secondRaw);

  const time: string[] = [];
  if (secondStep !== null) time.push(`every ${secondStep} seconds`);
  else if (secondRaw !== null && !isAny(secondRaw)) time.push(`at second ${secondRaw}`);

  if (hourStep !== null) {
    time.push(
      minuteStep !== null
        ? `every ${hourStep} hours and ${minuteStep} minutes`
        : isAny(minuteRaw)
          ? `every ${hourStep} hours`
          : `every ${hourStep} hours, ${minute}`,
    );
  } else if (minuteStep !== null) {
    time.push(isAny(hourRaw) ? `every ${minuteStep} minutes` : `every ${minuteStep} minutes, within ${hour}`);
  } else if (isAny(hourRaw) && isAny(minuteRaw)) {
    if (secondStep === null) time.push("every minute");
  } else if (hourNumber !== null && minuteNumber !== null) {
    time.push(
      secondNumber !== null
        ? `at ${hourNumber.padStart(2, "0")}:${minuteNumber.padStart(2, "0")}:${secondNumber.padStart(2, "0")}`
        : `at ${hourNumber.padStart(2, "0")}:${minuteNumber.padStart(2, "0")}`,
    );
  } else if (isAny(hourRaw)) {
    time.push(`every hour, ${minute}`);
  } else if (isAny(minuteRaw)) {
    time.push(`at ${hour}`);
  } else {
    time.push(`at ${hour}, ${minute}`);
  }

  const when: string[] = [];
  if (!isAny(domRaw)) when.push(`on day ${dom} of the month`);
  if (!isAny(monthRaw)) when.push(`in ${month}`);
  if (!isAny(dowRaw)) when.push(`on ${dow}`);

  const clauses = [...time, ...when].filter(Boolean);
  if (clauses.length === 0) return "Runs at every second of every minute of every hour, every day.";
  const sentence = clauses.join(", ");
  return `Runs ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}. Times are the scheduler's local time unless it is configured for UTC.`;
}

export type CronRuns =
  | { ok: true; runs: { ms: number; iso: string; label: string }[]; truncated: boolean }
  | { ok: false; error: string };

/**
 * Walks forward a second at a time but skips whole hours, days and months when
 * a coarser field does not match, so a monthly schedule resolves in a handful of
 * steps rather than a million.
 */
export function cronNextRuns(expression: string, count: number, from: Date): CronRuns {
  const parsed = parseCron(expression);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const { masks, hasSeconds } = parsed.cron;
  const secondMask = hasSeconds ? masks[0]! : null;
  const minuteMask = masks[hasSeconds ? 1 : 0]!;
  const hourMask = masks[hasSeconds ? 2 : 1]!;
  const domMask = masks[hasSeconds ? 3 : 2]!;
  const monthMask = masks[hasSeconds ? 4 : 3]!;
  const dowMask = masks[hasSeconds ? 5 : 4]!;
  const domRestricted = parsed.cron.domRestricted;
  const dowRestricted = parsed.cron.dowRestricted;

  const start = new Date(from.getTime());
  start.setMilliseconds(0);
  start.setSeconds(start.getSeconds() + 1);

  const runs: { ms: number; iso: string; label: string }[] = [];
  // A step cap guards against a schedule that can never fire, and a 40-year
  // horizon is what a `29 February` schedule needs to return a full decade of
  // runs. Coarse fields are skipped wholesale, so neither bound is expensive.
  const limit = 366 * 24 * 60 * (hasSeconds ? 60 : 1);
  const horizon = start.getTime() + 40 * 366 * 86_400_000;
  let steps = 0;

  while (runs.length < count && steps < limit) {
    steps += 1;
    if (start.getTime() > horizon) break;

    if (monthMask[start.getMonth() + 1 - 1] !== 1) {
      start.setMonth(start.getMonth() + 1, 1);
      start.setHours(0, 0, 0, 0);
      continue;
    }

    // Standard cron: when both day fields are restricted, either one matching
    // is enough. When only one is restricted, that one decides.
    const domHit = domMask[start.getDate() - 1] === 1;
    const dowHit = dowMask[start.getDay()] === 1;
    const dayOk = domRestricted && dowRestricted ? domHit || dowHit : domRestricted ? domHit : dowRestricted ? dowHit : true;
    if (!dayOk) {
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
      continue;
    }

    if (hourMask[start.getHours()] !== 1) {
      start.setHours(start.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (minuteMask[start.getMinutes()] !== 1) {
      start.setMinutes(start.getMinutes() + 1, 0, 0);
      continue;
    }
    if (secondMask && secondMask[start.getSeconds()] !== 1) {
      start.setSeconds(start.getSeconds() + 1, 0);
      continue;
    }

    runs.push({
      ms: start.getTime(),
      iso: start.toISOString(),
      label: start.toLocaleString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    });
    // With no seconds column the smallest unit is the minute, so a match is
    // followed by a whole minute rather than a single second.
    if (secondMask) start.setSeconds(start.getSeconds() + 1);
    else start.setMinutes(start.getMinutes() + 1, 0, 0);
  }

  return { ok: true, runs, truncated: runs.length < count };
}

/* ------------------------------------------------------------------ */
/*  Colour                                                             */
/* ------------------------------------------------------------------ */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clampChannel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

export function parseHexColor(input: string): Rgba | null {
  let hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split("").map((c) => c + c).join("");
  else if (/^[0-9a-fA-F]{4}$/.test(hex)) hex = hex.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(hex) && !/^[0-9a-fA-F]{8}$/.test(hex)) return null;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

export function rgbaToHex(color: Rgba, includeAlpha = false): string {
  const base = `#${[color.r, color.g, color.b].map((c) => clampChannel(c).toString(16).padStart(2, "0")).join("")}`;
  if (!includeAlpha) return base;
  const alpha = Math.round(Math.min(1, Math.max(0, color.a)) * 255);
  return `${base}${alpha.toString(16).padStart(2, "0")}`;
}

export function rgbaToCss(color: Rgba): string {
  if (color.a >= 1) return rgbaToHex(color);
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${Number(color.a.toFixed(3))})`;
}

/** `s` and `l` are 0–100, matching what `rgbToHsl` returns. */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s / 100));
  const light = Math.min(1, Math.max(0, l / 100));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const table: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[Math.floor(hue / 60) % 6]!;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbToHsl(color: Rgba): { h: number; s: number; l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return { h: (((h * 60) % 360) + 360) % 360, s: s * 100, l: l * 100 };
}

export function rgbToHsv(color: Rgba): { h: number; s: number; v: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, v: max * 100 };
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return { h: (((h * 60) % 360) + 360) % 360, s: (delta / max) * 100, v: max * 100 };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const sat = Math.min(1, Math.max(0, s / 100));
  const value = Math.min(1, Math.max(0, v / 100));
  const c = value * sat;
  const x = c * (1 - Math.abs((((h % 360) / 60) % 2) - 1));
  const m = value - c;
  const table: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r, g, b] = table[Math.floor(((h % 360) + 360) % 360 / 60) % 6]!;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function rgbToCmyk(color: Rgba): { c: number; m: number; y: number; k: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - r - k) / (1 - k)) * 100,
    m: ((1 - g - k) / (1 - k)) * 100,
    y: ((1 - b - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

export function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const cs = c / 100;
  const ms = m / 100;
  const ys = y / 100;
  const ks = k / 100;
  return { r: 255 * (1 - cs) * (1 - ks), g: 255 * (1 - ms) * (1 - ks), b: 255 * (1 - ys) * (1 - ks) };
}

/* sRGB → linear → XYZ (D65) → OKLab → OKLCH, and back. */
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const c = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
}

export function rgbToOklch(color: Rgba): { l: number; c: number; h: number } {
  const r = srgbToLinear(color.r);
  const g = srgbToLinear(color.g);
  const b = srgbToLinear(color.b);
  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const l = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  const bb = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;
  const chroma = Math.sqrt(a * a + bb * bb);
  const hue = chroma < 1e-6 ? 0 : (((Math.atan2(bb, a) * 180) / Math.PI) % 360 + 360) % 360;
  return { l: l * 100, c: chroma * 100, h: hue };
}

export function oklchToRgb(l: number, c: number, h: number): { r: number; g: number; b: number } {
  const lightness = l / 100;
  const chroma = c / 100;
  const radians = (h * Math.PI) / 180;
  const a = Math.cos(radians) * chroma;
  const bb = Math.sin(radians) * chroma;
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return {
    r: linearToSrgb(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    g: linearToSrgb(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    b: linearToSrgb(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  };
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(color: Rgba): number {
  return 0.2126 * srgbToLinear(color.r) + 0.7152 * srgbToLinear(color.g) + 0.0722 * srgbToLinear(color.b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export interface WcagVerdict {
  ratio: number;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  best: string;
}

export function wcagVerdict(ratio: number): WcagVerdict {
  const rounded = Math.round(ratio * 100) / 100;
  const aaNormal = ratio >= 4.5;
  const aaLarge = ratio >= 3;
  const aaaNormal = ratio >= 7;
  const aaaLarge = ratio >= 4.5;
  const best = aaaNormal ? "AAA" : aaNormal ? "AA" : aaLarge ? "AA large text only" : "fails";
  return { ratio: rounded, aaNormal, aaLarge, aaaNormal, aaaLarge, best };
}

/** Flatten an alpha channel over an opaque backdrop, as the browser would. */
export function compositeOn(color: Rgba, backdrop: Rgba): Rgba {
  if (color.a >= 1) return color;
  return {
    r: color.r * color.a + backdrop.r * (1 - color.a),
    g: color.g * color.a + backdrop.g * (1 - color.a),
    b: color.b * color.a + backdrop.b * (1 - color.a),
    a: 1,
  };
}

export interface PaletteEntry {
  hex: string;
  share: number;
  count: number;
}

export function paletteFromPixels(pixels: Uint8ClampedArray, count: number): PaletteEntry[] {
  // Quantise to 4 bits per channel, then repeatedly take the most common
  // bucket that is far enough from the colours already chosen.
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  const candidates = [...buckets.values()]
    .map((bucket) => ({
      count: bucket.count,
      r: bucket.r / bucket.count,
      g: bucket.g / bucket.count,
      b: bucket.b / bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const total = candidates.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const chosen: PaletteEntry[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    const tooClose = chosen.some((entry) => {
      const other = parseHexColor(entry.hex)!;
      const distance = Math.sqrt(
        (candidate.r - other.r) ** 2 + (candidate.g - other.g) ** 2 + (candidate.b - other.b) ** 2,
      );
      return distance < 48;
    });
    if (tooClose) continue;
    chosen.push({
      hex: rgbaToHex({ r: candidate.r, g: candidate.g, b: candidate.b, a: 1 }),
      count: candidate.count,
      share: (candidate.count / total) * 100,
    });
  }
  return chosen;
}

/* ------------------------------------------------------------------ */
/*  Diff                                                               */
/* ------------------------------------------------------------------ */

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffLine {
  op: DiffOp;
  text: string;
  oldIndex: number | null;
  newIndex: number | null;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  unchanged: number;
  /** True when the input was too large for an exact LCS and a fallback was used. */
  approximate: boolean;
}

const DIFF_CELL_BUDGET = 4_000_000;

export function diffLines(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.length === 0 ? [] : oldText.replace(/\n$/, "").split("\n");
  const newLines = newText.length === 0 ? [] : newText.replace(/\n$/, "").split("\n");

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  let approximate = false;

  for (let i = 0; i < prefix; i += 1) {
    lines.push({ op: "equal", text: oldLines[i]!, oldIndex: i, newIndex: i });
    unchanged += 1;
  }

  if (oldMiddle.length * newMiddle.length > DIFF_CELL_BUDGET) {
    approximate = true;
    for (const text of oldMiddle) {
      lines.push({ op: "delete", text, oldIndex: null, newIndex: null });
      removed += 1;
    }
    for (const text of newMiddle) {
      lines.push({ op: "insert", text, oldIndex: null, newIndex: null });
      added += 1;
    }
  } else {
    const rows = oldMiddle.length;
    const columns = newMiddle.length;
    const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
    for (let r = rows - 1; r >= 0; r -= 1) {
      for (let c = columns - 1; c >= 0; c -= 1) {
        table[r]![c] =
          oldMiddle[r] === newMiddle[c]
            ? table[r + 1]![c + 1]! + 1
            : Math.max(table[r + 1]![c]!, table[r]![c + 1]!);
      }
    }
    let r = 0;
    let c = 0;
    while (r < rows && c < columns) {
      if (oldMiddle[r] === newMiddle[c]) {
        lines.push({ op: "equal", text: oldMiddle[r]!, oldIndex: prefix + r, newIndex: prefix + c });
        unchanged += 1;
        r += 1;
        c += 1;
      } else if (table[r + 1]![c]! >= table[r]![c + 1]!) {
        lines.push({ op: "delete", text: oldMiddle[r]!, oldIndex: prefix + r, newIndex: null });
        removed += 1;
        r += 1;
      } else {
        lines.push({ op: "insert", text: newMiddle[c]!, oldIndex: null, newIndex: prefix + c });
        added += 1;
        c += 1;
      }
    }
    while (r < rows) {
      lines.push({ op: "delete", text: oldMiddle[r]!, oldIndex: prefix + r, newIndex: null });
      removed += 1;
      r += 1;
    }
    while (c < columns) {
      lines.push({ op: "insert", text: newMiddle[c]!, oldIndex: null, newIndex: prefix + c });
      added += 1;
      c += 1;
    }
  }

  for (let i = 0; i < suffix; i += 1) {
    lines.push({
      op: "equal",
      text: oldLines[oldLines.length - suffix + i]!,
      oldIndex: oldLines.length - suffix + i,
      newIndex: newLines.length - suffix + i,
    });
    unchanged += 1;
  }

  return { lines, added, removed, unchanged, approximate };
}

export interface WordChunk {
  op: DiffOp;
  text: string;
}

/** Character ranges that changed, used to tint a diff line. */
export function diffWords(oldText: string, newText: string): { left: WordChunk[]; right: WordChunk[] } {
  const tokenise = (text: string): string[] => text.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) ?? [];
  const a = tokenise(oldText);
  const b = tokenise(newText);
  const rows = a.length;
  const columns = b.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = columns - 1; c >= 0; c -= 1) {
      table[r]![c] = a[r] === b[c] ? table[r + 1]![c + 1]! + 1 : Math.max(table[r + 1]![c]!, table[r]![c + 1]!);
    }
  }
  const left: WordChunk[] = [];
  const right: WordChunk[] = [];
  let r = 0;
  let c = 0;
  const push = (into: WordChunk[], op: DiffOp, text: string): void => {
    const last = into[into.length - 1];
    if (last && last.op === op) last.text += text;
    else into.push({ op, text });
  };
  while (r < rows && c < columns) {
    if (a[r] === b[c]) {
      push(left, "equal", a[r]!);
      push(right, "equal", b[c]!);
      r += 1;
      c += 1;
    } else if (table[r + 1]![c]! >= table[r]![c + 1]!) {
      push(left, "delete", a[r]!);
      r += 1;
    } else {
      push(right, "insert", b[c]!);
      c += 1;
    }
  }
  while (r < rows) {
    push(left, "delete", a[r]!);
    r += 1;
  }
  while (c < columns) {
    push(right, "insert", b[c]!);
    c += 1;
  }
  return { left, right };
}

/* ------------------------------------------------------------------ */
/*  Syntax highlighting (hand-written, no library)                     */
/* ------------------------------------------------------------------ */

export type CodeLang = "plain" | "js" | "ts" | "json" | "css" | "html" | "python";

export type CodeTokenKind =
  | "plain"
  | "keyword"
  | "type"
  | "string"
  | "comment"
  | "number"
  | "punct"
  | "tag"
  | "attribute"
  | "selector"
  | "property";

export interface CodeToken {
  text: string;
  start: number;
  end: number;
  kind: CodeTokenKind;
}

const JS_KEYWORD_SET = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "of", "return",
  "set", "static", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while",
  "with", "yield", "true", "false", "null", "undefined",
]);

const TS_EXTRA_SET = new Set([
  "type", "enum", "namespace", "declare", "readonly", "keyof", "infer", "satisfies", "abstract",
  "public", "private", "protected", "override", "module", "any", "unknown", "never", "string",
  "number", "boolean", "object", "symbol", "bigint", "is", "asserts", "out",
]);

const PYTHON_KEYWORD_SET = new Set([
  "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda",
  "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield", "True",
  "False", "None", "self", "match", "case",
]);

const CSS_PROPERTY_HINT = new Set([
  "color", "background", "background-color", "margin", "padding", "border", "display", "position",
  "font", "font-size", "width", "height", "top", "left", "right", "bottom", "flex", "grid",
  "content", "opacity", "transform", "transition", "box-shadow", "z-index", "overflow",
]);

function pushToken(out: CodeToken[], text: string, start: number, kind: CodeTokenKind): void {
  if (text === "") return;
  out.push({ text, start, end: start + text.length, kind });
}

/**
 * A small, deliberately partial highlighter. It only has to be right about the
 * things it claims: strings and comments are read to their true end, so nothing
 * inside them is ever re-coloured.
 */
export function highlightCode(text: string, lang: CodeLang): CodeToken[] {
  if (lang === "plain") return [{ text, start: 0, end: text.length, kind: "plain" }];
  if (lang === "html") return highlightMarkup(text);
  if (lang === "css") return highlightCss(text);
  return highlightCLike(text, lang);
}

function highlightMarkup(text: string): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i);
      const stop = end === -1 ? text.length : end + 3;
      pushToken(out, text.slice(i, stop), i, "comment");
      i = stop;
      continue;
    }
    if (text[i] === "<") {
      const close = text.indexOf(">", i);
      const stop = close === -1 ? text.length : close + 1;
      emitTag(text.slice(i, stop), i, out);
      i = stop;
      continue;
    }
    const next = text.indexOf("<", i);
    const stop = next === -1 ? text.length : next;
    pushToken(out, text.slice(i, stop), i, "plain");
    i = stop;
  }
  return out;
}

function emitTag(tag: string, offset: number, out: CodeToken[]): void {
  let cursor = 0;
  const nameMatch = /^<\/?[A-Za-z][\w:-]*/.exec(tag);
  if (nameMatch) {
    pushToken(out, nameMatch[0], offset, "tag");
    cursor = nameMatch[0].length;
  }
  while (cursor < tag.length) {
    const rest = tag.slice(cursor);
    const attribute = /^\s+[\w:@.-]+/.exec(rest);
    if (attribute) {
      pushToken(out, attribute[0], offset + cursor, "attribute");
      cursor += attribute[0].length;
      continue;
    }
    const equals = /^\s*=\s*/.exec(rest);
    if (equals) {
      pushToken(out, equals[0], offset + cursor, "punct");
      cursor += equals[0].length;
      continue;
    }
    const value = /^("[^"]*"|'[^']*'|[^\s>]+)/.exec(rest);
    if (value) {
      pushToken(out, value[0], offset + cursor, value[0].startsWith("'") || value[0].startsWith('"') ? "string" : "plain");
      cursor += value[0].length;
      continue;
    }
    pushToken(out, tag[cursor]!, offset + cursor, "punct");
    cursor += 1;
  }
}

function highlightCss(text: string): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;
  let afterColon = false;
  let blockDepth = 0;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i);
      const stop = end === -1 ? text.length : end + 2;
      pushToken(out, text.slice(i, stop), i, "comment");
      i = stop;
      continue;
    }
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j += 1;
        j += 1;
      }
      pushToken(out, text.slice(i, Math.min(j + 1, text.length)), i, "string");
      i = j + 1;
      continue;
    }
    if (ch === "{") {
      blockDepth += 1;
      afterColon = false;
      pushToken(out, ch, i, "punct");
      i += 1;
      continue;
    }
    if (ch === "}") {
      blockDepth = Math.max(0, blockDepth - 1);
      afterColon = false;
      pushToken(out, ch, i, "punct");
      i += 1;
      continue;
    }
    if (ch === ":") {
      afterColon = true;
      pushToken(out, ch, i, "punct");
      i += 1;
      continue;
    }
    if (ch === ";") {
      afterColon = false;
      pushToken(out, ch, i, "punct");
      i += 1;
      continue;
    }
    if (ch === "@") {
      const name = /^@[\w-]+/.exec(text.slice(i))!;
      pushToken(out, name[0], i, "keyword");
      i += name[0].length;
      continue;
    }
    if (ch === "#" && /[0-9a-fA-F]/.test(text[i + 1] ?? "")) {
      const hex = /^#[\da-fA-F]{3,8}\b/.exec(text.slice(i))!;
      pushToken(out, hex[0], i, "number");
      i += hex[0].length;
      continue;
    }
    if (/\d/.test(ch)) {
      const number = /^-?[\d.]+[a-z%]*/.exec(text.slice(i))!;
      pushToken(out, number[0], i, "number");
      i += number[0].length;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      const word = /^[A-Za-z_-][\w-]*/.exec(text.slice(i))!;
      const isProperty = afterColon === false && blockDepth > 0 && CSS_PROPERTY_HINT.has(word[0].toLowerCase());
      pushToken(out, word[0], i, isProperty ? "property" : afterColon ? "plain" : "selector");
      i += word[0].length;
      continue;
    }
    pushToken(out, ch, i, "punct");
    i += 1;
  }
  return out;
}

function highlightCLike(text: string, lang: CodeLang): CodeToken[] {
  const out: CodeToken[] = [];
  const keywords =
    lang === "json"
      ? new Set(["true", "false", "null"])
      : lang === "python"
        ? PYTHON_KEYWORD_SET
        : lang === "ts"
          ? new Set([...JS_KEYWORD_SET, ...TS_EXTRA_SET])
          : JS_KEYWORD_SET;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const rest = text.slice(i);

    if (lang === "python" && ch === "#") {
      const stop = rest.indexOf("\n");
      const end = stop === -1 ? text.length : i + stop;
      pushToken(out, text.slice(i, end), i, "comment");
      i = end;
      continue;
    }
    if (lang !== "python" && rest.startsWith("//")) {
      const stop = rest.indexOf("\n");
      const end = stop === -1 ? text.length : i + stop;
      pushToken(out, text.slice(i, end), i, "comment");
      i = end;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      pushToken(out, text.slice(i, stop), i, "comment");
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j += 1;
        if (ch === "`" && text[j] === "$" && text[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < text.length && depth > 0) {
            if (text[j] === "{") depth += 1;
            else if (text[j] === "}") depth -= 1;
            j += 1;
          }
          continue;
        }
        j += 1;
      }
      pushToken(out, text.slice(i, Math.min(j + 1, text.length)), i, "string");
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(text[i + 1] ?? ""))) {
      const number = /^(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?)n?/.exec(rest)!;
      pushToken(out, number[0], i, "number");
      i += number[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(rest)!;
      const kind: CodeTokenKind = keywords.has(word[0])
        ? "keyword"
        : lang === "json"
          ? "plain"
          : /^[A-Z]/.test(word[0])
            ? "type"
            : "plain";
      pushToken(out, word[0], i, kind);
      i += word[0].length;
      continue;
    }
    if (/\s/.test(ch)) {
      const space = /^\s+/.exec(rest)!;
      pushToken(out, space[0], i, "plain");
      i += space[0].length;
      continue;
    }
    pushToken(out, ch, i, "punct");
    i += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  HTTP header blocks                                                 */
/* ------------------------------------------------------------------ */

export interface HeaderRow {
  name: string;
  value: string;
  line: number;
}

export interface HeaderProblem {
  severity: "error" | "warning" | "info";
  header: string;
  message: string;
  line: number;
}

export interface ParsedHeaderBlock {
  ok: boolean;
  requestLine: { method: string; target: string; version: string; raw: string } | null;
  headers: HeaderRow[];
  problems: HeaderProblem[];
  error: string | null;
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Parses a pasted raw header block — either a request with a request line or
 * a bare list of `Name: value` pairs — and reports the RFC 9110 problems that
 * actually break intermediaries.
 */
export function parseRawHeaderBlock(input: string): ParsedHeaderBlock {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const headers: HeaderRow[] = [];
  const problems: HeaderProblem[] = [];
  let requestLine: ParsedHeaderBlock["requestLine"] = null;
  let start = 0;

  const firstMeaningful = lines.findIndex((line) => line.trim() !== "");
  if (firstMeaningful === -1) {
    return { ok: false, requestLine: null, headers, problems, error: "Paste a header block first." };
  }

  const looksLikeRequestLine = /^[A-Z]+\s+\S+\s+HTTP\/1\.[01]$/.test(lines[firstMeaningful]!.trim());
  if (looksLikeRequestLine) {
    const raw = lines[firstMeaningful]!.trim();
    const match = /^([A-Z]+)\s+(\S+)\s+(HTTP\/1\.[01])$/.exec(raw)!;
    requestLine = { method: match[1]!, target: match[2]!, version: match[3]!, raw };
    start = firstMeaningful + 1;
  } else {
    start = firstMeaningful;
  }

  const seen = new Map<string, number>();
  for (let index = start; index < lines.length; index += 1) {
    const raw = lines[index]!;
    if (raw.trim() === "") continue;
    if (/^\s/.test(raw) && headers.length > 0) {
      problems.push({
        severity: "error",
        header: headers[headers.length - 1]!.name,
        message: "This line starts with whitespace, which is the old obsolete line-folding syntax. RFC 9110 removed it; send the whole value on one line instead.",
        line: index + 1,
      });
      headers[headers.length - 1]!.value += ` ${raw.trim()}`;
      continue;
    }

    const colon = raw.indexOf(":");
    if (colon === -1) {
      problems.push({
        severity: "error",
        header: "(unparseable line)",
        message: "There is no colon on this line, so it is not a header. Each header has to be `Name: value`.",
        line: index + 1,
      });
      continue;
    }

    const name = raw.slice(0, colon);
    const value = raw.slice(colon + 1);
    const trimmedName = name.trim();

    if (name !== trimmedName) {
      problems.push({
        severity: "warning",
        header: trimmedName || "(blank name)",
        message: "There is whitespace between the header name and the colon. That is a request-smuggling risk; the name has to end immediately before the colon.",
        line: index + 1,
      });
    }
    if (!TOKEN.test(trimmedName)) {
      problems.push({
        severity: "error",
        header: trimmedName || "(blank name)",
        message: `"${trimmedName}" is not a valid header name. Only letters, digits and !#$%&'*+-.^_\`|~ are allowed.`,
        line: index + 1,
      });
    }
    if (value.startsWith(" ") || value.startsWith("\t")) {
      const leading = /^([ \t]*)/.exec(value)?.[1] ?? "";
      if (leading.includes("\t") || leading.length > 1) {
        problems.push({
          severity: "info",
          header: trimmedName,
          message: `There are ${JSON.stringify(leading)} characters between the colon and the value. RFC 9110 expects at most a single space, and servers strip the rest, so the value you think you sent may not be the value that arrives.`,
          line: index + 1,
        });
      }
    }
    if (value.includes("\t")) {
      problems.push({
        severity: "warning",
        header: trimmedName,
        message: "This value contains a horizontal tab. Tabs inside a header value are legal but trip up some older parsers.",
        line: index + 1,
      });
    }

    const previous = seen.get(trimmedName.toLowerCase());
    if (previous !== undefined) {
      problems.push({
        severity: "warning",
        header: trimmedName,
        message: `This header appears more than once (also on line ${previous}). That is legal for list-valued headers such as Set-Cookie, but a bug for single-valued ones.`,
        line: index + 1,
      });
    } else {
      seen.set(trimmedName.toLowerCase(), index + 1);
    }

    headers.push({ name: trimmedName, value: value.trim(), line: index + 1 });
  }

  if (requestLine && requestLine.version === "HTTP/1.0") {
    problems.push({
      severity: "warning",
      header: "(request line)",
      message: "HTTP/1.0 has no host requirement and no chunked encoding. Most modern servers and every CDN expect HTTP/1.1 or later.",
      line: firstMeaningful + 1,
    });
  }
  if (requestLine && !headers.some((header) => header.name.toLowerCase() === "host")) {
    problems.push({
      severity: "error",
      header: "(missing)",
      message: "There is no Host header. HTTP/1.1 requires one, and without it the server does not know which site you meant.",
      line: 0,
    });
  }
  if (requestLine && !headers.some((header) => header.name.toLowerCase() === "content-length") && !headers.some((header) => header.name.toLowerCase() === "transfer-encoding")) {
    problems.push({
      severity: "info",
      header: "(missing)",
      message: "Neither Content-Length nor Transfer-Encoding is present. That is fine for a bodyless request; anything else is ambiguous.",
      line: 0,
    });
  }

  return { ok: headers.length > 0, requestLine, headers, problems, error: null };
}

export interface SecurityHeaderAudit {
  header: string;
  present: boolean;
  verdict: "good" | "partial" | "missing" | "info";
  finding: string;
  guidance: string;
}

interface SecurityHeaderSpec {
  header: string;
  verdict: SecurityHeaderAudit["verdict"];
  finding: string;
  guidance: string;
}

const SECURITY_HEADERS: readonly SecurityHeaderSpec[] = [
  {
    header: "Strict-Transport-Security",
    verdict: "good",
    guidance: "Ask for `max-age=31536000; includeSubDomains`. A preload needs `preload` too and a one-time submission.",
    finding: "HSTS is set, so browsers will refuse to reach this site over plain HTTP for the max-age window.",
  },
  {
    header: "Content-Security-Policy",
    verdict: "good",
    guidance: "Start with `default-src 'self'` and add only the origins each directive genuinely needs. Avoid `unsafe-inline` and `unsafe-eval`.",
    finding: "A Content-Security-Policy is present, so the browser has an explicit allow-list for scripts, styles and frames.",
  },
  {
    header: "X-Content-Type-Options",
    verdict: "good",
    guidance: "The only correct value is `nosniff`.",
    finding: "With nosniff set, a browser will not run a file as a script just because its extension says so.",
  },
  {
    header: "Referrer-Policy",
    verdict: "good",
    guidance: "`strict-origin-when-cross-origin` is the sensible default; `no-referrer` is stricter.",
    finding: "Referrer-Policy limits how much of the previous page's URL travels with requests and clicks.",
  },
  {
    header: "X-Frame-Options",
    verdict: "partial",
    guidance: "X-Frame-Options only does same-origin/deny. For a real policy use `frame-ancestors` in your CSP.",
    finding: "X-Frame-Options is set, which blocks framing by other origins in older browsers.",
  },
  {
    header: "Permissions-Policy",
    verdict: "good",
    guidance: "Turn off the powerful features you do not use, for example `geolocation=(), camera=(), microphone=()`.",
    finding: "Permissions-Policy delegates which browser features this page and its frames may use.",
  },
  {
    header: "Access-Control-Allow-Origin",
    verdict: "info",
    guidance: "A value of `*` together with credentials is rejected by browsers. Reflect the exact Origin instead of `*` when you allow credentials.",
    finding: "CORS is configured, so cross-origin JavaScript is allowed from the origins listed here.",
  },
  {
    header: "Access-Control-Allow-Credentials",
    verdict: "info",
    guidance: "Only useful alongside an explicit Access-Control-Allow-Origin. Never pair it with `*`.",
    finding: "Credentials are allowed cross-origin, which means cookies and TLS client certificates can be sent.",
  },
];

export function auditSecurityHeaders(headers: readonly HeaderRow[]): SecurityHeaderAudit[] {  const byName = new Map<string, string>();
  for (const header of headers) byName.set(header.name.toLowerCase(), header.value);

  return SECURITY_HEADERS.map((spec) => {
    const value = byName.get(spec.header.toLowerCase());
    const present = value !== undefined;
    let verdict = spec.verdict;
    let finding = spec.finding;
    const guidance = spec.guidance;

    if (!present) {
      verdict = spec.verdict === "info" ? "info" : "missing";
      finding =
        spec.verdict === "info"
          ? "Not set. This header only matters once a browser makes a cross-origin request to this response."
          : "Not set, so nothing in the browser enforces this protection.";
    } else if (spec.header === "Strict-Transport-Security" && !/max-age/i.test(value)) {
      verdict = "partial";
      finding = "HSTS is present but has no max-age, so the policy expires the moment the header stops being sent.";
    } else if (spec.header === "Content-Security-Policy" && /^default-src\s+\*|unsafe-inline|unsafe-eval/i.test(value)) {
      verdict = "partial";
      finding = "A Content-Security-Policy is present but it allows `*` or `unsafe-inline`, which gives up most of the protection it is for.";
    } else if (spec.header === "X-Content-Type-Options" && !/nosniff/i.test(value)) {
      verdict = "partial";
      finding = `X-Content-Type-Options is set to "${value}", but the only value that does anything is nosniff.`;
    } else if (spec.header === "Access-Control-Allow-Origin" && value === "*") {
      const credentials = byName.get("access-control-allow-credentials");
      if (credentials && /true/i.test(credentials)) {
        verdict = "partial";
        finding = "Access-Control-Allow-Origin is `*` while credentials are allowed. Browsers reject that combination, so credentialed requests will fail.";
      }
    } else if (spec.header === "Referrer-Policy" && !/no-referrer|same-origin|strict-origin|origin|no-referrer-when-downgrade|origin-when-cross-origin|strict-origin-when-cross-origin/i.test(value)) {
      verdict = "partial";
      finding = `Referrer-Policy is set to "${value}", which is not one of the values browsers understand, so it is ignored.`;
    }

    return { header: spec.header, present, verdict, finding, guidance };
  });
}
