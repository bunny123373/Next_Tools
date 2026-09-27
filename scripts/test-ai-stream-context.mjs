/**
 * Asserts the streaming route actually carries context between turns.
 *
 * Kept separate from the validation script because the validation cases consume
 * the per-minute rate budget, and running both back to back makes the
 * multi-turn leg fail with a 429 that has nothing to do with context.
 *
 *   node scripts/test-ai-stream-context.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const FACT = "My favourite colour is teal. Remember it and just say OK.";
const QUESTION = "What is my favourite colour? Answer with one word.";

async function post(messages) {
  const response = await fetch(`${BASE}/api/ai/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  return { ok: response.ok, status: response.status, body: await response.text() };
}

function replyOf(sseBody) {
  return sseBody
    .split("\n")
    .filter((line) => line.startsWith("data:") && line.includes('"delta"'))
    .map((line) => JSON.parse(line.slice(5).trim()))
    .filter((event) => event.type === "delta")
    .map((event) => event.text)
    .join("");
}

const first = await post([{ role: "user", content: FACT }]);
if (!first.ok) {
  console.log(`turn 1 refused: HTTP ${first.status} — ${first.body.slice(0, 220)}`);
  process.exit(1);
}
const firstReply = replyOf(first.body);
console.log(`turn 1: ${JSON.stringify(firstReply.slice(0, 80))}`);

const second = await post([
  { role: "user", content: FACT },
  { role: "assistant", content: firstReply || "OK" },
  { role: "user", content: QUESTION },
]);
if (!second.ok) {
  console.log(`turn 2 refused: HTTP ${second.status} — ${second.body.slice(0, 220)}`);
  process.exit(1);
}
const secondReply = replyOf(second.body);
console.log(`turn 2: ${JSON.stringify(secondReply.slice(0, 80))}`);

const remembered = /teal/i.test(secondReply);
console.log(
  remembered
    ? "\n✓ multi-turn context retained across turns"
    : "\n✗ context LOST — the model did not recall the earlier turn",
);
process.exit(remembered ? 0 : 1);
