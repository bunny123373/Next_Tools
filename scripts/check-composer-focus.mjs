/**
 * Proves the composer's focus ring is actually cancelled.
 *
 * The bug: the shared control's base class paints a red border and ring on
 * `focus:` and rounds to 10px. A `focus-visible:` override does not cancel it,
 * because that is a different variant. Whether a `focus:` override does cancel
 * it depends entirely on how tailwind-merge groups the two classes, which is
 * not safe to assume.
 *
 * So this runs the real merge the real component runs, and asserts the base's
 * red focus classes are gone from the output.
 *
 *   node scripts/check-composer-focus.mjs
 */
import { twMerge } from "tailwind-merge";
import { clsx } from "clsx";

/** Copied verbatim from controlBase in components/ui/form.tsx. */
const controlBase = clsx(
  "w-full rounded-[10px] border bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)]",
  "placeholder:text-[var(--text-ink-dim,color-mix(in_srgb,var(--text-muted)_70%,transparent))]",
  "transition-colors duration-150",
  "hover:border-[var(--surface-line-strong)]",
  "focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-brand-500 aria-[invalid=true]:ring-brand-500/25",
);

const borderTone = "border-[var(--surface-line)]";
const textAreaBase = "resize-y py-2.5 leading-relaxed";

/** What the composer passed BEFORE the fix. */
const broken =
  "max-h-[150px] min-h-[44px] w-full resize-none rounded-none border-0 bg-transparent px-3.5 pt-3 text-[13.5px] leading-6 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0";

/** What it passes now. */
const fixed =
  "max-h-[200px] min-h-[52px] w-full resize-none rounded-none border-0 border-transparent bg-transparent px-4 pt-3.5 text-[15px] leading-6 shadow-none hover:border-transparent focus:border-transparent focus:outline-none focus:ring-0 focus:ring-transparent focus:ring-offset-0 focus:shadow-none";

/** Classes that must not survive the merge, or the red box comes back. */
const MUST_NOT_SURVIVE = [
  "focus:border-brand-500",
  "focus:ring-2",
  "focus:ring-brand-500/25",
  "hover:border-[var(--surface-line-strong)]",
  "rounded-[10px]",
  "resize-y",
];

function report(label, override) {
  const merged = twMerge(clsx(controlBase, borderTone, textAreaBase, override));
  const classes = merged.split(/\s+/).filter(Boolean);
  const survivors = MUST_NOT_SURVIVE.filter((cls) => classes.includes(cls));
  const ringWidth = classes.find((c) => /^focus:ring-(0|2)$/.test(c));
  const radius = classes.find((c) => c.startsWith("rounded") && !c.includes("["));
  const resize = classes.find((c) => c.startsWith("resize-"));

  console.log(`\n--- ${label} ---`);
  console.log(`  focus ring width : ${ringWidth ?? "(none)"}`);
  console.log(`  radius           : ${radius ?? "(none)"}`);
  console.log(`  resize           : ${resize ?? "(none)"}`);
  if (survivors.length === 0) {
    console.log("  ✓ every base focus/radius class was cancelled");
  } else {
    console.log(`  ✗ survived the merge: ${survivors.join(", ")}`);
  }
  return survivors.length === 0;
}

console.log("base control paints a red focus ring:");
console.log("  brand-500 = #ff3b30 (red)");
console.log("  'focus-visible:ring-0' is a DIFFERENT variant, so it does not cancel 'focus:ring-2'");

const brokenOk = report("before the fix (focus-visible:ring-0)", broken);
const fixedOk = report("after the fix (focus:ring-0 + focus:border-transparent)", fixed);

console.log();
if (fixedOk && !brokenOk) {
  console.log("✓ confirmed: the old override left the red ring, the new one cancels it");
  process.exit(0);
}
if (!fixedOk) {
  console.log("✗ the fix does NOT cancel the red ring — needs a different approach");
  process.exit(1);
}
console.log("! the old override already worked; the report is wrong somewhere");
process.exit(1);
