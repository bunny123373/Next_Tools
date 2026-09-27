/**
 * Verifies the streaming chat route delivers text INCREMENTALLY, not buffered.
 *
 * Asserting only the final text would pass even if the server buffered the whole
 * reply and flushed it at the end, which is the failure that matters here. So
 * this records the wall-clock gap between the first and last delta and prints
 * the arrival timeline.
 *
 *   node scripts/test-ai-stream.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const started = Date.now();
const arrival = [];

const response = await fetch(`${BASE}/api/ai/chat/stream`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    messages: [
      { role: "user", content: "Count from 1 to 40, one number per line, nothing else." },
    ],
  }),
});

console.log(`status        ${response.status}`);
console.log(`content-type  ${response.headers.get("content-type")}`);
console.log(`cache-control ${response.headers.get("cache-control")}`);

if (!response.ok || !response.body) {
  console.log(`body: ${(await response.text()).slice(0, 400)}`);
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let reply = "";
let sawDone = false;
let errors = 0;

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  let boundary = buffer.indexOf("\n\n");
  while (boundary !== -1) {
    const frame = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    boundary = buffer.indexOf("\n\n");

    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") continue;
      const event = JSON.parse(raw);
      if (event.type === "delta") {
        arrival.push({ ms: Date.now() - started, text: event.text });
        reply += event.text;
      } else if (event.type === "done") {
        sawDone = true;
      } else if (event.type === "error") {
        errors += 1;
        console.log(`error frame: ${event.code} ${event.message}`);
      }
    }
  }
}

console.log(`\ndeltas        ${arrival.length}`);
console.log(`saw done      ${sawDone}`);
console.log(`error frames  ${errors}`);
console.log(`chars         ${reply.length}`);
console.log(`\narrival timeline (ms since request):`);
for (const item of arrival.slice(0, 12)) {
  console.log(`  +${String(item.ms).padStart(5)}ms  ${JSON.stringify(item.text.slice(0, 24))}`);
}
if (arrival.length > 12) console.log(`  … ${arrival.length - 12} more`);

const first = arrival[0]?.ms ?? 0;
const last = arrival[arrival.length - 1]?.ms ?? 0;
const spread = last - first;
console.log(`\nspan between first and last delta: ${spread}ms`);

// The whole point: deltas must be spread over time, not delivered at once.
const incremental = arrival.length > 3 && spread > 150;
console.log(incremental ? "\n✓ STREAMING — text arrived progressively" : "\n✗ BUFFERED — the reply came in one lump");
console.log(`\nreply preview:\n${reply.slice(0, 220)}`);

process.exit(incremental && sawDone && errors === 0 ? 0 : 1);
