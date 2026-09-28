/**
 * Finds out which AI image routes the configured gateway actually supports.
 *
 * The app depends on two of them:
 *   POST /v1/images/generations  — image-generator (verified working)
 *   POST /v1/images/edits        — background-remover, background-generator,
 *                                  image-enhancer, image-upscaler
 *
 * The app also has a vision route for image-analyzer, which is a *chat*
 * model with a vision capability rather than an image model.
 *
 *   node scripts/test-ai-image-routes.mjs
 */
import { readFileSync } from "node:fs";

const BASE = "https://api.xkiro.com/v1";
const key = process.env.AI_API_KEY;
if (!key) {
  console.error("AI_API_KEY is not set in the environment. Run with it exported.");
  process.exit(1);
}

const imageBytes = readFileSync("public/icons/icon-192.png");
console.log(`test image: ${imageBytes.length} bytes\n`);

async function report(label, path, body, isForm) {
  const headers = { Authorization: `Bearer ${key}` };
  const init = { method: "POST", headers, signal: AbortSignal.timeout(120_000) };
  if (isForm) {
    init.body = body;
  } else {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${BASE}${path}`, init);
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        message = JSON.parse(text)?.error?.message ?? text;
      } catch {
        /* not JSON */
      }
      console.log(`  ${label}\n    HTTP ${response.status}  ${String(message).slice(0, 300)}\n`);
      return { ok: false, status: response.status, message: String(message) };
    }

    if (type.includes("json")) {
      const json = await response.json();
      const first = json.data?.[0];
      const shape = first?.b64_json
        ? `b64_json ${Math.round((first.b64_json.length * 0.75) / 1024)}KB`
        : first?.url
          ? `url ${first.url}`
          : `object=${json.object} status=${json.status ?? "n/a"} id=${json.id ?? "n/a"}`;
      console.log(`  ${label}\n    HTTP 200  ${shape}\n`);
      return { ok: true, json };
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    console.log(
      `  ${label}\n    HTTP 200  ${type}  ${Math.round(buffer.length / 1024)}KB  magic=${[...buffer.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("")}\n`,
    );
    return { ok: true, buffer };
  } catch (error) {
    console.log(`  ${label}\n    FAILED  ${error.message}\n`);
    return { ok: false, message: error.message };
  }
}

const IMAGE_MODEL = process.env.AI_IMAGE_MODEL ?? "sensenova/sensenova-u1.5-lite";
const CHAT_MODEL = process.env.AI_MODEL ?? "qwen/qwen3.7-flash:free";

function form(model, prompt) {
  const data = new FormData();
  data.set("model", model);
  data.set("prompt", prompt);
  data.set("image", new Blob([imageBytes], { type: "image/png" }), "test.png");
  return data;
}

console.log(`image model: ${IMAGE_MODEL}`);
console.log(`chat model : ${CHAT_MODEL}\n`);

console.log("POST /images/generations (no response_format) — what the app sends now");
await report("generate", "/images/generations", {
  model: IMAGE_MODEL,
  prompt: "a red circle on white",
  n: 1,
});

console.log("POST /images/generations with response_format=b64_json — what the app USED to send");
await report("generate + b64", "/images/generations", {
  model: IMAGE_MODEL,
  prompt: "a red circle on white",
  n: 1,
  response_format: "b64_json",
});

console.log("POST /images/edits, multipart, no response_format");
await report("edit", "/images/edits", form(IMAGE_MODEL, "remove the background"), true);

console.log("POST /images/edits, multipart, response_format=b64_json");
const withFormat = form(IMAGE_MODEL, "remove the background");
withFormat.set("response_format", "b64_json");
await report("edit + b64", "/images/edits", withFormat, true);

console.log("POST /chat/completions with an image — what image-analyzer uses");
const vision = await report("vision", "/chat/completions", {
  model: CHAT_MODEL,
  max_tokens: 60,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Describe this image in five words." },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${imageBytes.toString("base64")}` },
        },
      ],
    },
  ],
});
if (vision.ok && vision.json) {
  console.log(`    reply: ${JSON.stringify(vision.json.choices?.[0]?.message?.content)}`);
}
