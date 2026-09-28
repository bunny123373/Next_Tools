/**
 * Exercises the four image-editing tools through the app's own route, which is
 * the only way to know whether the whole path works: schema → provider →
 * gateway → async poll → CDN download → base64 → client.
 *
 *   node scripts/test-ai-edit-tools.mjs
 */
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const bytes = readFileSync("public/icons/icon-192.png");
const base64 = bytes.toString("base64");

/**
 * The tasks that need an uploaded image and go through /images/edits.
 *
 * `background-generator` is deliberately NOT here: it takes no upload and goes
 * through /images/generations like any other text-to-image tool. An earlier
 * version of this script uploaded an image for it and reported a spurious
 * failure, so the distinction is recorded here rather than assumed.
 */
const EDIT_TASKS = [
  ["background-remover", "Remove the background entirely, leaving only the logo."],
  ["image-enhancer", "Increase the sharpness and contrast."],
  ["image-upscaler", "Upscale the image and keep the edges clean."],
];

/** Text-to-image tasks, which take no upload. */
const GENERATE_TASKS = [
  ["background-generator", "A red circle centred on a plain white background."],
  ["image-generator", "A red circle centred on a plain white background."],
];

async function post(body, timeoutMs) {
  const response = await fetch(`${BASE}/api/ai/image`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, text: await response.text() };
}

const status = await (await fetch(`${BASE}/api/ai/status`)).json();
console.log(`image model : ${status.imageModel}`);
console.log(`edit model  : ${status.editModel ?? "(not set)"}\n`);

let worked = 0;
let total = 0;
let billing = 0;

async function run(label, task, prompt, withImage) {
  total += 1;
  const result = await post(
    {
      task,
      prompt,
      ...(withImage ? { image: { mime: "image/png", base64 } } : {}),
      options: {},
    },
    240_000,
  );

  if (result.status === 200) {
    const json = JSON.parse(result.text);
    const size = Math.round((json.image.base64.length * 0.75) / 1024);
    console.log(`✓ ${label.padEnd(22)} 200  ${json.image.mime}  ${size} KB  model=${json.model}`);
    worked += 1;
    return;
  }

  let code = "?";
  let message = result.text;
  try {
    const parsed = JSON.parse(result.text);
    code = parsed?.error?.code ?? "?";
    message = parsed?.error?.message ?? message;
  } catch {}
  if (code === "billing") billing += 1;
  console.log(`✗ ${label.padEnd(22)} ${result.status}  [${code}]  ${String(message).slice(0, 150)}`);
}

for (const [task, prompt] of EDIT_TASKS) await run(task, task, prompt, true);
for (const [task, prompt] of GENERATE_TASKS) await run(task, task, prompt, false);

console.log(`\n${worked}/${total} image tools working`);
if (billing > 0) {
  console.log(
    `${billing} failed for BILLING, not code: the provider account is out of credit.`,
  );
}
process.exit(worked === total ? 0 : 1);
