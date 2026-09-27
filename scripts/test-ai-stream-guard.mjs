/**
 * Checks that the streaming route refuses a malformed or oversized transcript.
 *
 * The transcript is browser-owned and resent every turn, so the caps on turn
 * count and characters are the only thing standing between a visitor and an
 * unbounded request. This asserts they actually bite.
 *
 * Every case here is expected to be REFUSED, so none of them reaches the model
 * or costs a token. They do consume rate-limit budget, which is why the
 * multi-turn leg lives in `test-ai-stream-context.mjs` instead — running both
 * back to back makes that leg fail with a 429 that is not about context.
 *
 *   node scripts/test-ai-stream-guard.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function post(body, timeoutMs = 90_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}/api/ai/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, type: response.headers.get("content-type") ?? "", text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

/* -- negative cases: each must be refused with a readable reason ---------- */

const cases = [
  ["no messages", { messages: [] }],
  ["assistant-first", { messages: [{ role: "assistant", content: "hi" }] }],
  ["unknown key", { messages: [{ role: "user", content: "hi" }], evil: true }],
  ["blank message", { messages: [{ role: "user", content: "   " }] }],
  ["bad role", { messages: [{ role: "robot", content: "hi" }] }],
  ["temperature out of range", { messages: [{ role: "user", content: "hi" }], temperature: 9 }],
  [
    "over character budget",
    {
      messages: [
        { role: "user", content: "x".repeat(9000) },
        { role: "assistant", content: "y".repeat(9000) },
        ...Array.from({ length: 10 }, () => ({ role: "user", content: "z".repeat(9000) })),
      ],
    },
  ],
  [
    "over turn count",
    { messages: Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "hi" })) },
  ],
];

let failures = 0;
for (const [label, body] of cases) {
  const result = await post(body, 20_000);
  const refused = result.status === 400;
  let reason = "";
  try {
    const parsed = JSON.parse(result.text);
    reason = parsed?.error?.message ?? "";
  } catch {
    reason = result.text.slice(0, 80);
  }
  console.log(`${refused ? "✓" : "✗"} ${label.padEnd(26)} HTTP ${result.status}  ${reason.slice(0, 88)}`);
  if (!refused) failures += 1;
}

/* -- multi-turn: see test-ai-stream-context.mjs --------------------------- */

if (failures > 0) {
  console.log(`\n${failures} case(s) were not refused`);
  process.exit(1);
}
console.log(`\nall ${cases.length} malformed or oversized transcripts refused`);
