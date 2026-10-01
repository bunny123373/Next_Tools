/**
 * Lists what `validateRegistry()` complains about, per tool.
 *
 * The public health endpoint reports only a COUNT, by design — it must not
 * enumerate tool internals to anonymous callers. That makes a number like
 * "21 registry problems" unattributable from outside, which is exactly the
 * situation when a deployed site reports `status: degraded`.
 *
 * This parses the definition files directly and applies the same rules as
 * validateRegistry(), so the count can be traced to named tools. It is a
 * diagnostic, not a second source of truth: if it ever disagrees with
 * validateRegistry, trust validateRegistry.
 *
 *   node scripts/check-registry.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFINITIONS = "lib/tools/definitions";
const VALID_CATEGORIES = ["image", "pdf", "video", "audio", "text", "developer", "ai"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Splits a definitions file into one chunk per tool entry. */
function splitTools(source) {
  // Entries begin with a 4-space-indented `id:` and run to the next one.
  const starts = [...source.matchAll(/^ {4}id: "([^"]+)",$/gm)].map((m) => ({
    id: m[1],
    index: m.index,
  }));
  return starts.map((start, i) => ({
    id: start.id,
    block: source.slice(start.index, starts[i + 1]?.index ?? source.length),
  }));
}

const field = (block, name) => {
  const m = new RegExp(`^ {4}${name}: "([^"]*)",`, "m").exec(block);
  return m ? m[1] : undefined;
};

const ids = new Set();
const routes = new Set();
const allIds = new Set();
const problems = [];

const files = readdirSync(DEFINITIONS).filter((f) => f.endsWith(".ts") && f !== "index.ts");

for (const file of files) {
  const source = readFileSync(join(DEFINITIONS, file), "utf8");
  for (const tool of splitTools(source)) {
    allIds.add(tool.id);

    const slug = field(tool.block, "slug");
    const route = field(tool.block, "route");
    const status = field(tool.block, "status");

    // `category:` is indented differently inside these entries, so match loosely.
    const category = /\bcategory:\s*"([^"]+)"/.exec(tool.block)?.[1];

    if (ids.has(tool.id)) problems.push(["duplicate-id", tool.id]);
    ids.add(tool.id);

    if (route) {
      if (routes.has(route)) problems.push(["duplicate-route", route]);
      routes.add(route);
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      problems.push(["unknown-category", `${tool.id} → ${category}`]);
    }
    if (slug && !SLUG.test(slug)) problems.push(["bad-slug", `${tool.id} → ${slug}`]);

    const faqBlock = /\bfaq:\s*\[([\s\S]*?)\n {4}\],/.exec(tool.block)?.[1] ?? "";
    const faqCount = (faqBlock.match(/\bquestion:/g) ?? []).length;
    if (faqCount < 3) problems.push(["faq-too-short", `${tool.id} → ${faqCount} entries`]);

    const relatedBlock = /\brelated:\s*\[([^\]]*)\]/.exec(tool.block)?.[1] ?? "";
    for (const m of relatedBlock.matchAll(/"([^"]+)"/g)) {
      if (!allIds.has(m[1])) problems.push(["unknown-related", `${tool.id} → ${m[1]}`]);
    }
  }
}

// `related` was checked against an id set built in pass order, so a forward
// reference to a later file is a false positive here. Re-check bidirectionally.
const allText = files
  .map((f) => readFileSync(join(DEFINITIONS, f), "utf8"))
  .join("\n");
const knownIds = new Set([...allText.matchAll(/^ {4}id: "([^"]+)",$/gm)].map((m) => m[1]));
const real = problems.filter(
  (p) => p[0] !== "unknown-related" || !knownIds.has(p[1].split("→ ")[1] ?? ""),
);

const byKind = new Map();
for (const [kind, detail] of real) {
  if (!byKind.has(kind)) byKind.set(kind, []);
  byKind.get(kind).push(detail);
}

console.log(`${allIds.size} tools parsed from ${files.length} definition files`);
console.log(`${real.length} problem(s)\n`);
for (const [kind, details] of byKind) {
  console.log(`${kind}  (${details.length})`);
  for (const detail of details) console.log(`    ${detail}`);
  console.log("");
}
process.exit(real.length === 0 ? 0 : 1);