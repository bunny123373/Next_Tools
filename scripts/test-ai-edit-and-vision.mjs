/**
 * Probes the two remaining unknowns:
 *
 *  1. Does `openai/gpt-image-2.5` — the model xkiro itself names as the one
 *     that supports editing — actually work on /images/edits here, and does it
 *     answer synchronously or with an async job?
 *  2. Why does the in-app image analyzer fail, when a direct vision call to
 *     the same model succeeds?
 *
 *   AI_API_KEY=... node scripts/test-ai-edit-and-vision.mjs
 */
import { readFileSync } from "node:fs";

const GATEWAY = "https://api.xkiro.com/v1";
const APP = process.env.BASE_URL ?? "http://localhost:3000";
const key = process.env.AI_API_KEY;
if (!key) {
  console.error("AI_API_KEY is not set.");
  process.exit(1);
}

const bytes = readFileSync("public/icons/icon-192.png");
const b64 = bytes.toString("base64");

/* -- 1. the edit model xkiro recommends ------------------------------- */

console.log("=== POST /images/edits with openai/gpt-image-2.5 ===\n");
const form = new FormData();
form.set("model", "openai/gpt-image-2.5");
form.set("prompt", "Replace the background with a plain white colour.");
form.set("n", "1");
form.set("image", new Blob([bytes], { type: "image/png" }), "input.png");

try {
  const response = await fetch(`${GATEWAY}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message ?? text;
    } catch {}
    console.log(`  HTTP ${response.status}  ${String(message).slice(0, 300)}\n`);
  } else {
    const json = await response.json();
    const first = json.data?.[0];
    console.log(`  HTTP 200  type=${type}`);
    console.log(`  object=${json.object}  status=${json.status ?? "n/a"}  id=${json.id ?? "n/a"}`);
    console.log(
      `  payload: ${first?.b64_json ? `b64_json (${Math.round((first.b64_json.length * 0.75) / 1024)}KB)` : first?.url ? `url ${first.url}` : "none"}`,
    );
    if (json.status === "processing" && json.id) {
      console.log("\n  -> asynchronous. Polling…");
      for (let i = 1; i <= 20; i += 1) {
        await new Promise((r) => setTimeout(r, 4000));
        const poll = await fetch(`${GATEWAY}/images/generations/${json.id}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(30_000),
        });
        if (!poll.ok) {
          console.log(`     poll ${i}: HTTP ${poll.status}`);
          break;
        }
        const job = await poll.json();
        console.log(`     poll ${i}: status=${job.status}`);
        if (job.status !== "processing") {
          const out = job.data?.[0];
          console.log(
            `     -> ${out?.url ? `url ${out.url}` : out?.b64_json ? "b64_json" : "no payload"}`,
          );
          break;
        }
      }
    }
  }
} catch (error) {
  console.log(`  FAILED  ${error.message}`);
}

/* -- 2. the app's own vision route ----------------------------------- */

console.log("\n=== POST /api/ai/vision (the image analyzer's route) ===\n");
try {
  const response = await fetch(`${APP}/api/ai/vision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task: "image-analyzer",
      prompt: "Describe this image.",
      image: { mime: "image/png", base64: b64 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  console.log(`  HTTP ${response.status}`);
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    if (json.ok) {
      console.log(`  ok  model=${json.model}  output=${JSON.stringify(String(json.output).slice(0, 160))}`);
    } else {
      console.log(`  error  ${json.error?.code}  ${json.error?.message}`);
    }
  } catch {
    console.log(`  body: ${text.slice(0, 400)}`);
  }
} catch (error) {
  console.log(`  FAILED  ${error.message}`);
}

/* -- 3. what the analyzer's model reports ---------------------------- */

console.log("\n=== GET /api/ai/status ===\n");
try {
  const response = await fetch(`${APP}/api/ai/status`, { cache: "no-store" });
  console.log(`  ${JSON.stringify(await response.json())}`);
} catch (error) {
  console.log(`  FAILED  ${error.message}`);
}
