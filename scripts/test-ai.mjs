/**
 * Live smoke test for the configured AI provider.
 *
 * Reads `.env.local` so the credential never appears on a command line or in
 * shell history. Makes real, billed requests — keep them minimal.
 *
 *   node scripts/test-ai.mjs            # chat only
 *   node scripts/test-ai.mjs --image    # also probe image generation
 *
 * Exits non-zero if chat is unavailable. Image generation is reported
 * separately, because a gateway can serve chat and refuse images.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const wantImage = process.argv.includes("--image");

/* ---------------------------------------------------------------- */
/*  Load .env.local (and .env as a fallback)                         */
/* ---------------------------------------------------------------- */

/**
 * Load one env file.
 *
 * `override` controls precedence. `.env` is loaded first and does not
 * overwrite values already present in the real process environment (so CI and
 * shell exports win). `.env.local` is loaded second and *does* overwrite
 * anything `.env` set — which is the Next.js precedence rule, and getting it
 * backwards silently tests the wrong host.
 */
function loadEnvFile(file, override) {
  if (!existsSync(file)) return new Set();
  const set = new Set();

  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
      set.add(key);
    }
  }
  return set;
}

const fromEnv = loadEnvFile(resolve(".env"), false);
loadEnvFile(resolve(".env.local"), true);
void fromEnv;

const BASE = (process.env.AI_BASE_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.AI_API_KEY ?? "";
const MODEL = process.env.AI_MODEL ?? "";
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL ?? "";

if (!BASE) {
  console.error("✗ AI_BASE_URL is not set. Configure .env.local first.");
  process.exit(1);
}

/** Never print the key. Show only shape, which is enough to catch a bad paste. */
function keyShape() {
  if (!KEY) return "(empty)";
  return `${KEY.slice(0, 3)}…${KEY.slice(-4)} (${KEY.length} chars)`;
}

console.log(`base    ${BASE}`);
console.log(`model   ${MODEL || "(unset)"}`);
console.log(`key     ${keyShape()}`);
console.log(`image   ${IMAGE_MODEL || "(unset)"}\n`);

/* ---------------------------------------------------------------- */
/*  Chat                                                            */
/* ---------------------------------------------------------------- */

async function testChat() {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!response.ok) {
    console.log(`✗ chat  HTTP ${response.status} ${response.statusText}`);
    const detail = body?.error?.message ?? text.slice(0, 200);
    console.log(`  ${String(detail).replace(KEY, "«redacted»")}`);
    return false;
  }

  const content = body?.choices?.[0]?.message?.content ?? "";
  const usage = body?.usage;
  console.log(`✓ chat  ${response.status} — "${String(content).trim().slice(0, 60)}"`);
  if (usage) {
    console.log(
      `  tokens prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"}`,
    );
  }
  return true;
}

/* ---------------------------------------------------------------- */
/*  Images                                                          */
/* ---------------------------------------------------------------- */

async function testImages() {
  const model = IMAGE_MODEL || MODEL;

  for (const endpoint of ["images/generations", "images/edits"]) {
    const isEdits = endpoint.endsWith("edits");
    // `edits` is multipart and needs a file; only probe `generations` unless an
    // image model is explicitly configured, where `edits` is worth trying.
    if (isEdits && !IMAGE_MODEL) continue;

    const init = isEdits
      ? { method: "POST", headers: { authorization: `Bearer ${KEY}` } }
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
          },
          body: JSON.stringify({
            model,
            prompt: "A small red circle on white",
            n: 1,
            size: "256x256",
          }),
        };

    try {
      const response = await fetch(`${BASE}/${endpoint}`, {
        ...init,
        signal: AbortSignal.timeout(90_000),
      });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* non-JSON error page */
      }

      const label = `image ${isEdits ? "edits" : "generations"}`;
      if (!response.ok) {
        const detail = String(
          body?.error?.message ?? text.slice(0, 160),
        ).replace(KEY, "«redacted»");
        console.log(`✗ ${label}  HTTP ${response.status} — ${detail}`);
        continue;
      }

      const first = body?.data?.[0];
      const kind = first?.b64_json
        ? `base64 (${Math.round((first.b64_json.length * 3) / 4 / 1024)} KB)`
        : first?.url
          ? `url: ${String(first.url).slice(0, 60)}…`
          : "unknown shape";
      console.log(`✓ ${label}  ${response.status} — ${kind}`);

      if (first?.b64_json) {
        const bytes = Buffer.from(first.b64_json, "base64");
        console.log(`  decoded ${bytes.length} bytes, magic=${bytes.subarray(0, 4).toString("hex")}`);
      }
    } catch (error) {
      console.log(`✗ image ${isEdits ? "edits" : "generations"}  ${error.message}`);
    }
  }
}

/* ---------------------------------------------------------------- */

const chatOk = await testChat();
if (wantImage) await testImages();

console.log(
  chatOk
    ? "\nChat works. If images failed, set AI_IMAGE_MODEL only if the gateway actually serves one — /v1/models listed none."
    : "\nChat failed. Every AI tool will surface this error rather than pretending to work.",
);
process.exit(chatOk ? 0 : 1);
