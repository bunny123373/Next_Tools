/**
 * Exercises the app's own AI routes end to end, so the full path is verified:
 * client → Zod validation → provider → gateway → response.
 *
 *   node scripts/test-ai-routes.mjs
 *
 * Reads .env.local indirectly (the dev server already has it), never the key.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function post(path, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: response.status, payload, raw: text };
  } finally {
    clearTimeout(timer);
  }
}

function show(label, result) {
  if (result.status >= 200 && result.status < 300) {
    const p = result.payload ?? {};
    if (p.image?.base64) {
      const bytes = Buffer.from(p.image.base64, "base64");
      const magic = bytes.subarray(0, 4).toString("hex");
      console.log(
        `✓ ${label}  ${result.status}  mime=${p.image.mime}  ${Math.round(bytes.length / 1024)} KB  magic=${magic}`,
      );
    } else {
      console.log(`✓ ${label}  ${result.status}  output=${JSON.stringify(p.output ?? p).slice(0, 90)}`);
    }
    return true;
  }
  console.log(`✗ ${label}  HTTP ${result.status}`);
  const body = result.payload?.error?.message ?? result.raw;
  console.log(`   ${String(body).slice(0, 400)}`);
  return false;
}

/* 1. status -------------------------------------------------------------- */
const status = await (await fetch(`${BASE}/api/ai/status`)).json();
console.log(
  `configured=${status.configured} provider=${status.provider} model=${status.model} image=${status.imageModel}\n`,
);

/* 2. chat --------------------------------------------------------------- */
show("chat/summarizer", await post("/api/ai/chat", {
  task: "summarizer",
  prompt: "Reply with exactly: PIPELINE OK",
}, 90_000));

/* 3. image generation --------------------------------------------------- */
show(
  "image/image-generator",
  await post(
    "/api/ai/image",
    {
      task: "image-generator",
      prompt: "A single red circle centred on a plain white background, flat vector icon",
    },
    240_000,
  ),
);
