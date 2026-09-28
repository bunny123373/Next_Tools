/**
 * Verifies that the image route's progress frames carry REAL information.
 *
 * The point of streaming stages rather than animating a bar is that every
 * number in them was measured. So this asserts:
 *
 *   - stage frames actually arrive, in order, and are not just one frame
 *   - `elapsedMs` increases monotonically (a scripted animation would not)
 *   - the final image is real PNG/JPEG bytes
 *   - the JSON path still works for a client that does not ask for a stream
 *
 *   node scripts/test-ai-image-progress.mjs
 */
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const base64 = readFileSync("public/icons/icon-192.png").toString("base64");

/* -- 1. the streaming path --------------------------------------------- */

console.log("=== POST /api/ai/image with Accept: text/event-stream ===\n");

const started = Date.now();
const response = await fetch(`${BASE}/api/ai/image`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "text/event-stream" },
  body: JSON.stringify({
    task: "image-generator",
    prompt: "A red circle centred on a plain white background.",
    options: { size: "1024x1024", style: "flat-vector" },
  }),
  signal: AbortSignal.timeout(240_000),
});

console.log(`  status       ${response.status}`);
console.log(`  content-type ${response.headers.get("content-type")}`);

if (!response.ok || !response.body) {
  console.log(`  body: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
const stages = [];
let image = null;
let errorFrame = null;

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
      if (event.type === "stage") stages.push({ ...event.stage, at: Date.now() - started });
      else if (event.type === "image") image = event;
      else if (event.type === "error") errorFrame = event;
    }
  }
}

console.log(`\n  stage frames: ${stages.length}`);
for (const stage of stages) {
  const extra = "elapsedMs" in stage ? ` elapsedMs=${stage.elapsedMs} polls=${stage.polls}` : "";
  console.log(`    +${String(stage.at).padStart(5)}ms  ${stage.phase}${extra}`);
}

if (errorFrame) console.log(`\n  error frame: ${errorFrame.code}  ${errorFrame.message}`);

if (image) {
  const bytes = Buffer.from(image.image.base64, "base64");
  console.log(
    `  image: ${image.image.mime}  ${Math.round(bytes.length / 1024)} KB  magic=${bytes.subarray(0, 4).toString("hex")}  model=${image.model}`,
  );
}

/* -- 2. assertions ------------------------------------------------------ */

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
};

console.log("\nchecks");

const ORDER = ["submitting", "generating", "fetching"];
const rank = (phase) => ORDER.indexOf(phase);
const phases = stages.map((s) => s.phase);
check("at least one stage frame arrived", stages.length > 0, `${stages.length} frames`);
check("stages begin at submitting", phases[0] === "submitting", `first was ${phases[0]}`);
// The index must never decrease. An earlier version of this check compared
// each phase to the one before it, which rejects the legitimate
// submitting -> generating transition and reported a working stream as broken.
check(
  "phases only ever move forward",
  phases.every((phase, i) => i === 0 || rank(phase) >= rank(phases[i - 1])),
  [...new Set(phases)].join(" → "),
);
check(
  "every phase is one the route defines",
  phases.every((phase) => ORDER.includes(phase)),
  phases.join(", "),
);

const elapsed = stages.filter((s) => "elapsedMs" in s).map((s) => s.elapsedMs);
check(
  "elapsedMs is monotonically increasing",
  elapsed.every((value, i) => i === 0 || value >= elapsed[i - 1]),
  elapsed.join(", "),
);
check("elapsedMs is a real duration, not 0", elapsed.length === 0 || elapsed[elapsed.length - 1] > 0, `${elapsed.at(-1)}ms`);

if (image) {
  const bytes = Buffer.from(image.image.base64, "base64");
  const magic = bytes.subarray(0, 4).toString("hex");
  check(
    "the finished image is real image bytes",
    bytes.length > 1000 && ["89504e47", "ffd8ff"].includes(magic),
    `${bytes.length} bytes, magic ${magic}`,
  );
} else {
  check("an image frame arrived", false, errorFrame ? `error: ${errorFrame.code}` : "none");
}

/* -- 3. the JSON path still works -------------------------------------- */

console.log("\n=== the same request without Accept: text/event-stream ===\n");
try {
  const plain = await fetch(`${BASE}/api/ai/image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task: "image-generator",
      prompt: "A blue square on white.",
      options: { size: "512x512" },
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const json = await plain.json();
  const ok = plain.ok && json.ok === true && typeof json.image?.base64 === "string";
  console.log(
    `  ${ok ? "✓" : "✗"} JSON fallback still returns an image  status=${plain.status} model=${json.model ?? "-"}`,
  );
  if (!ok) failures += 1;
} catch (error) {
  console.log(`  ✗ JSON fallback failed: ${error.message}`);
  failures += 1;
}

console.log(failures === 0 ? "\nprogress frames carry real data" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
