/**
 * Guards the mobile-layout invariants that have actually broken.
 *
 * Each check here corresponds to a bug that shipped, not a style preference:
 *
 *  1. The layout sets `viewport-fit=cover`, so fixed elements have to clear the
 *     notch and home indicator. A flat `bottom-5 right-5` puts the launcher
 *     half under the iOS gesture bar.
 *  2. `position: sticky` silently stops working inside an `overflow: hidden`
 *     ancestor, because that ancestor becomes the scroll container. The chat
 *     composer is sticky and its shell was `flush` (which is `overflow-hidden`).
 *  3. iOS Safari zooms when a focused field computes below 16px, and does not
 *     zoom back out. A 13.5px composer leaves the reader stuck magnified.
 *  4. The auto-grow effect writes an inline height while a `max-h` class caps it
 *     in CSS. When those two numbers disagree the textarea is clipped short of
 *     its own scroll point.
 *  5. Tap targets below ~40px are hard to hit with a thumb.
 *
 *   node scripts/check-mobile.mjs
 */
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const css = read("app/globals.css");
const layout = read("app/layout.tsx");
const agent = read("components/layout/FloatingAgent.tsx");
const panel = read("components/layout/AgentPanel.tsx");
const chat = read("components/tools/workspaces/ai/AiChatWorkspace.tsx");

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  — ${detail}` : ""}`);
}

console.log("safe-area handling");
check(
  "viewport-fit=cover is set (so insets are required)",
  /viewportFit:\s*"cover"/.test(layout),
);
for (const side of ["top", "right", "bottom", "left"]) {
  check(`--safe-${side} token defined`, new RegExp(`--safe-${side}\\s*:`).test(css));
}
check(
  "launcher uses the bottom inset, not a flat bottom-*",
  /bottom-\[max\(/.test(agent) && /right-\[max\(/.test(agent),
);
check("full-bleed panel pads for the notch", /pt-\[var\(--safe-top\)\]/.test(agent));
check("full-bleed panel pads for the home indicator", /pb-\[var\(--safe-bottom\)\]/.test(agent));
check("toasts clear the home indicator", /var\(--safe-bottom\)/.test(read("components/ui/toaster.tsx")));

console.log("\nsticky composer");
check(
  "chat shell overrides ToolShell's overflow-hidden",
  /<ToolShell flush className="overflow-visible"/.test(chat),
  "without this the sticky composer never sticks",
);

console.log("\niOS zoom on focus (fields must be >= 16px on a phone)");
for (const [name, source] of [
  ["bot panel", panel],
  ["ai chat", chat],
]) {
  const textareas = source.match(/<Textarea[\s\S]*?\/>/g) ?? [];
  for (const node of textareas) {
    const id = node.match(/id="([^"]+)"/)?.[1] ?? "(unnamed)";
    const hasMobile16 = /\btext-base\b/.test(node);
    // The smaller desktop size is allowed to be expressed either way round, so
    // match the `sm:` override itself rather than its position.
    const hasSmallWithSm = /sm:text-\[[\d.]+px\]/.test(node) || /\bsm:text-sm\b/.test(node);
    check(
      `${name} #${id} is 16px on mobile`,
      hasMobile16 && hasSmallWithSm,
      hasMobile16 ? "" : "needs text-base with a smaller sm: size",
    );
  }
}

console.log("\nhorizontal overflow (source-level)");
// Read the `html { … }` block by brace balance. A fixed character window is
// wrong here: the rule carries a long explanatory comment, so the property
// being asserted on can sit well past any arbitrary cut-off.
function cssBlock(selector) {
  const start = css.indexOf(selector);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  return css.slice(open, open + 2000);
}

const htmlRule = cssBlock("html {");
// Strip comments first. The rule documents the removed guard by name, so a
// naive match flags its own explanation as the thing it forbids.
const htmlCode = htmlRule.replace(/\/\*[\s\S]*?\*\//g, "");
check(
  "the root has no overflow-x band-aid",
  !/overflow-x:\s*(clip|hidden)/.test(htmlCode),
  "a root guard hides overflow from scrollWidth instead of fixing it; check:mobile:scroll measures it",
);
check(
  "the root never uses overflow-x: hidden",
  !/overflow-x:\s*hidden/.test(htmlRule),
  "hidden makes the root a scroll container, which breaks every position: sticky descendant",
);

// The measured check in check:mobile:scroll is what actually proves this. The
// tooltip is the element that broke it, so assert it is not laid out at rest.
const tooltip = read("components/ui/tooltip.tsx");
check(
  "the tooltip bubble is not rendered while hidden",
  /\{open \? \(/.test(tooltip) && !/\bopacity-0\b/.test(tooltip),
  "an absolutely positioned w-max bubble contributes page width even at opacity 0 or visibility hidden",
);

// A table with a min-width wider than a 320px phone pushes the page sideways
// unless something gives it its own horizontal scroll. Check each one is wrapped.
const tableFiles = [
  "app/admin/settings/page.tsx",
  "app/admin/tools/page.tsx",
  "app/api-docs/page.tsx",
];
for (const file of tableFiles) {
  const source = read(file);
  const lines = source.split("\n");
  const unwrapped = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /min-w-\[\d{3}px\]/.test(line))
    .filter(({ i }) => !/overflow-x-auto/.test(lines[i - 1] ?? ""));
  check(
    `${file}: every min-w table can scroll on its own`,
    unwrapped.length === 0,
    unwrapped.length ? `line ${unwrapped[0].i + 1} has no overflow-x-auto wrapper` : "",
  );
}

console.log("\ncomposer auto-grow ceiling");
for (const [name, source, rows] of [
  ["bot panel", panel, 6],
  ["ai chat", chat, 8],
]) {
  const expected = rows * 24 + 24;
  const declared = source.match(/const MAX_COMPOSER_PX = MAX_COMPOSER_ROWS \* 24 \+ 24;/);
  const cssCap = source.match(/max-h-\[(\d+)px\]/);
  const inlineUse = source.includes("MAX_COMPOSER_PX");
  check(
    `${name}: JS ceiling and CSS cap agree`,
    Boolean(declared) && inlineUse && cssCap !== null && Number(cssCap[1]) === expected,
    `expected max-h-[${expected}px]${cssCap ? `, found ${cssCap[1]}` : ""}`,
  );
}

console.log("\ntap targets in the bot panel");
const bareSize8 = /className="grid size-8 (?:shrink-0 )?place-items-center/.test(panel);
check(
  "no interactive button is a bare 32px size-8",
  !bareSize8,
  bareSize8 ? "a control is still 32px on touch" : "",
);

console.log();
if (failures > 0) {
  console.log(`✗ ${failures} mobile invariant(s) broken`);
  process.exit(1);
}
console.log("✓ all mobile invariants hold");
