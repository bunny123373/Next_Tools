/**
 * Checks that the floating assistant is a *website* assistant, not a generic
 * chat wearing the site's name.
 *
 * Two things are asserted:
 *  1. With `withSiteContext`, an answer about this site names a tool that
 *     actually exists in the registry. A generic model would answer from
 *     general knowledge and could invent a tool.
 *  2. A question the inventory cannot cover is refused rather than invented.
 *
 * Also prints the token usage from the `done` frame, because the inventory is
 * resent on every turn and that cost is real.
 *
 *   node scripts/test-ai-site-context.mjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function ask(question, withSiteContext) {
  const response = await fetch(`${BASE}/api/ai/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: question }],
      ...(withSiteContext ? { withSiteContext: true } : {}),
    }),
  });
  if (!response.ok || !response.body) {
    return { error: `HTTP ${response.status} ${(await response.text()).slice(0, 200)}` };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = null;

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
        if (event.type === "delta") text += event.text;
        if (event.type === "done" && event.usage) usage = event.usage;
        if (event.type === "error") return { error: `${event.code}: ${event.message}` };
      }
    }
  }
  return { text, usage };
}

/* Load the real tool names so we can check the answer is not invented. */
const registry = await (await fetch(`${BASE}/api/tools?limit=200`)).json();
const realNames = new Set(
  (registry.tools ?? []).map((tool) => String(tool.name).toLowerCase()),
);
console.log(`registry reports ${realNames.size} tool names\n`);

const cases = [
  {
    label: "names a real tool for a site question",
    question: "Which tool on this site compresses a video? Name it.",
    expect: (text) => {
      const lower = text.toLowerCase();
      const hit = [...realNames].filter(
        (name) => name.length > 6 && lower.includes(name),
      );
      if (hit.length === 0) return { ok: false, why: "named no known tool" };
      return { ok: true, why: `named "${hit[0]}"` };
    },
  },
  {
    label: "refuses a tool the site does not have",
    question: "Which tool here converts a HEIC file to a sprite sheet? Name it.",
    expect: (text) => {
      // Look for an explicit refusal anywhere in the answer. The phrasing varies
      // ("none of the tools", "there is no", "doesn't"), so match the family of
      // ways a model declines rather than one exact string.
      const refused =
        /\bnone of\b|\bno (such |such|tool|one|not)\b|\bthere (is|'s) no\b|\bdoes ?n[o']t\b|\bdo ?n[o']t\b|\bcannot\b|\bcan'?t\b|\bnot (available|offered|supported|listed)\b|\bdoes not (exist|have|list|support)\b/i.test(
          text,
        );
      // A refusal that also names a real tool is a good answer, not a bad one.
      const lower = text.toLowerCase();
      const hit = [...realNames].filter((name) => name.length > 6 && lower.includes(name));
      return refused
        ? { ok: true, why: `declined${hit.length ? `, offered "${hit[0]}"` : ""}` }
        : { ok: false, why: "no refusal language found — may have invented a tool" };
    },
  },
];

let failures = 0;
for (const testCase of cases) {
  const result = await ask(testCase.question, true);
  if (result.error) {
    console.log(`✗ ${testCase.label}\n   ${result.error}`);
    failures += 1;
    continue;
  }
  const verdict = testCase.expect(result.text);
  console.log(`${verdict.ok ? "✓" : "✗"} ${testCase.label} — ${verdict.why}`);
  console.log(`   ${result.text.slice(0, 170).replace(/\n/g, " ")}`);
  if (result.usage) {
    console.log(
      `   tokens: ${result.usage.total_tokens ?? "?"} (prompt ${result.usage.prompt_tokens ?? "?"})`,
    );
  }
  if (!verdict.ok) failures += 1;
}

/* Control: the same question with no site context should know less. */
const control = await ask("Which tool on this site compresses a video? Name it.", false);
if (control.text) {
  const lower = control.text.toLowerCase();
  const hit = [...realNames].filter((name) => name.length > 6 && lower.includes(name));
  console.log(
    `\ncontrol (no site context): ${hit.length > 0 ? `still named "${hit[0]}"` : "named no known tool"}`,
  );
  if (control.usage) {
    console.log(`control tokens: ${control.usage.total_tokens ?? "?"}`);
  }
}

console.log(failures === 0 ? "\nsite context verified" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
