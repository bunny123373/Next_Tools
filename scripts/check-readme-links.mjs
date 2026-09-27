/**
 * Checks the README's table-of-contents links against GitHub's slug rules.
 *
 * A broken anchor in a README is a small thing that looks sloppy, and the rules
 * are easy to get wrong: github-slugger lowercases, drops anything that is not
 * alphanumeric/space/hyphen/underscore (so an emoji vanishes but the space after
 * it becomes a leading hyphen), then turns spaces into hyphens.
 *
 *   node scripts/check-readme-links.mjs
 */
import { readFileSync } from "node:fs";

/**
 * github-slugger, reduced to what a heading can contain.
 *
 * Note the absence of a `trim()`. That is deliberate and it is the whole reason
 * emoji headings are awkward: the emoji is a symbol, so it is removed, but the
 * space *after* it survives and is then turned into a hyphen. `## 📦 What's
 * inside` therefore slugs to `-whats-inside`, with a leading hyphen. Trimming
 * first would "fix" that to `whats-inside`, which is not what GitHub produces
 * and would make every such link 404.
 */
function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

const markdown = readFileSync("README.md", "utf8");

const headings = [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1].trim());
const anchors = new Set(headings.map(slug));

// Only same-page links matter; external URLs are not ours to verify.
const links = [...markdown.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);

console.log(`headings: ${headings.length}   same-page links: ${links.length}\n`);

let broken = 0;
for (const link of links) {
  const ok = anchors.has(link);
  if (!ok) broken += 1;
  console.log(`  ${ok ? "✓" : "✗"} #${link}`);
}

if (broken > 0) {
  console.log(`\nknown slugs:\n  ${[...anchors].join("\n  ")}`);
  console.log(`\n✗ ${broken} broken anchor(s)`);
  process.exit(1);
}
console.log("\n✓ every table-of-contents link resolves to a real heading");
