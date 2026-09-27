/**
 * Groups the dev server's recent errors by distinct message.
 *
 * A 500 tells you a route broke; this tells you how many *kinds* of breakage
 * there are, so a fix pass targets causes instead of symptoms.
 *
 *   node scripts/check-errors.mjs [lines]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const LOG = resolve(".next/dev/logs/next-development.log");
const TAIL = Number(process.argv[2] ?? 4000);

if (!existsSync(LOG)) {
  console.error(`no log at ${LOG} — is the dev server running?`);
  process.exit(0);
}

const lines = readFileSync(LOG, "utf8").split("\n").slice(-TAIL);

/** Pull a human-readable cause out of a log line, or null if it isn't an error. */
function cause(line) {
  if (!line.includes('"level":"ERROR"')) return null;

  // Structured ReferenceError / TypeError messages are the useful ones.
  const direct = line.match(/message":"(.*?)"\}?\s*$/);
  const refError = line.match(/(ReferenceError|TypeError|RangeError|SyntaxError): [^\\"]+/);
  if (refError) return refError[0].trim();
  if (direct) {
    const message = direct[1].replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
    if (message && message.length < 300) return message;
  }
  return line.slice(0, 160);
}

const groups = new Map();
for (const line of lines) {
  const key = cause(line);
  if (!key) continue;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}

if (groups.size === 0) {
  console.log(`✓ no errors in the last ${TAIL} log lines`);
  process.exit(0);
}

const sorted = [...groups.entries()].sort((a, b) => b[1] - a[1]);
console.log(`${sorted.length} distinct error(s) in the last ${TAIL} log lines:\n`);
for (const [message, count] of sorted.slice(0, 20)) {
  console.log(`${String(count).padStart(4)}x  ${message}`);
}
