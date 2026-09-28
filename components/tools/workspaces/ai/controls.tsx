"use client";

/**
 * The control vocabulary shared by the AI workspaces.
 *
 * A tool declares *what* its controls are — a `select` of formats, a `segmented`
 * row of sizes, a creativity slider — and the workspaces render them. The
 * declared values are exactly the enums in `lib/ai/schemas.ts`, so a typo is a
 * TypeScript error rather than a 400 from the server, and the server rejects any
 * key the tool's task does not accept.
 *
 * The rendered result is a flat `Record<string, string | number | boolean>` that
 * is sent as the request's `options`.
 */

import { cn } from "@/lib/utils/cn";
import { Checkbox, Field, Input, Segmented, Select, Slider } from "@/components/ui/form";
import type { AiChoiceKey, AiTextKey } from "@/lib/ai/schemas";

export type { AiChoiceKey, AiTextKey };

export interface AiChoice {
  value: string;
  label: string;
}

interface AiControlBase {
  key: string;
  label: string;
  /** Rendered under the control, in `var(--text-muted)`. */
  hint?: string;
  className?: string;
}

export type AiControlValue = string | number | boolean;
export type AiControlValues = Record<string, AiControlValue>;

export type AiControl =
  | (AiControlBase & {
      kind: "select";
      key: AiChoiceKey;
      default: string;
      options: readonly AiChoice[];
    })
  | (AiControlBase & {
      kind: "segmented";
      key: AiChoiceKey;
      default: string;
      options: readonly AiChoice[];
    })
  /**
   * A canvas picker that draws each option at its own aspect ratio.
   *
   * A `segmented` row of "Square 1024 / Portrait 1024 / Landscape 1024" makes
   * the reader work out the shape from the words. Drawing each box to scale
   * removes that translation. The ratio is a plain declaration of the
   * option's own proportions, not a preview of what the model will produce.
   */
  | (AiControlBase & {
      kind: "ratio";
      key: "size";
      default: string;
      options: readonly AiChoice[];
    })
  /**
   * A chip row for a small closed set of named styles.
   *
   * Deliberately unillustrated. A coloured swatch per style would look like a
   * preview of the result and be a guess; the honest affordance is the name the
   * model will actually be told.
   */
  | (AiControlBase & {
      kind: "style";
      key: "style";
      default: string;
      options: readonly AiChoice[];
    })
  | (AiControlBase & { kind: "slider"; key: "creativity"; default: number })
  | (AiControlBase & { kind: "checkbox"; key: "keepStructure"; default: boolean; description?: string })
  | (AiControlBase & {
      kind: "text";
      key: AiTextKey;
      default: string;
      placeholder: string;
      maxLength: number;
    });

/** The initial value map for a tool's controls. */
export function defaultControlValues(controls: readonly AiControl[]): AiControlValues {
  const values: AiControlValues = {};
  for (const control of controls) values[control.key] = control.default;
  return values;
}

export interface AiControlsProps {
  controls: readonly AiControl[];
  values: AiControlValues;
  onChange: (values: AiControlValues) => void;
  disabled?: boolean;
  className?: string;
}

/** Renders a tool's declared controls. */
export function AiControls({ controls, values, onChange, disabled, className }: AiControlsProps) {
  if (controls.length === 0) return null;

  const set = (key: string, value: AiControlValue) => onChange({ ...values, [key]: value });

  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {controls.map((control) => {
        const value = values[control.key];

        switch (control.kind) {
          case "select":
            return (
              <Field key={control.key} label={control.label} hint={control.hint}>
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    disabled={disabled}
                    value={String(value ?? control.default)}
                    onChange={(event) => set(control.key, event.target.value)}
                  >
                    {control.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            );

          case "segmented":
            return (
              <Field key={control.key} label={control.label} hint={control.hint}>
                {() => (
                  <Segmented
                    label={control.label}
                    size="sm"
                    value={String(value ?? control.default)}
                    onChange={(next) => set(control.key, next)}
                    options={control.options.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))}
                  />
                )}
              </Field>
            );

          case "ratio":
            return (
              <Field
                key={control.key}
                label={control.label}
                hint={control.hint}
                className={cn("sm:col-span-2 lg:col-span-3", control.className)}
              >
                {({ id, describedBy }) => (
                  <div
                    id={id}
                    role="radiogroup"
                    aria-label={control.label}
                    aria-describedby={describedBy}
                    className="flex flex-wrap gap-2.5"
                  >
                    {control.options.map((option) => {
                      const selected = String(value ?? control.default) === option.value;
                      const [w, h] = option.value.split("x").map(Number);
                      const ratio = Number.isFinite(w) && Number.isFinite(h) && h > 0 ? w / h : 1;
                      // Fit every shape inside one box, keeping its proportions.
                      const boxW = ratio >= 1 ? 44 : Math.round(44 * ratio);
                      const boxH = ratio >= 1 ? Math.round(44 / ratio) : 44;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={disabled}
                          onClick={() => set(control.key, option.value)}
                          title={`${option.label} (${option.value.replace("x", " × ")})`}
                          className={cn(
                            "group flex w-[76px] flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                            selected
                              ? "border-brand-500 bg-brand-500/10"
                              : "border-[var(--surface-line)] bg-[var(--surface-card-2)] hover:border-[var(--surface-line-strong)]",
                            disabled && "cursor-not-allowed opacity-50",
                          )}
                        >
                          <span
                            className="grid place-items-center"
                            style={{ width: 44, height: 44 }}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "rounded-[3px] border transition-colors",
                                selected
                                  ? "border-brand-500 bg-brand-500/25"
                                  : "border-[var(--text-muted)] bg-[var(--surface-line)]",
                              )}
                              style={{ width: boxW, height: boxH }}
                            />
                          </span>
                          <span
                            className={cn(
                              "text-center text-[11px] leading-tight",
                              selected
                                ? "font-medium text-[var(--text-ink)]"
                                : "text-[var(--text-muted)]",
                            )}
                          >
                            {option.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
            );

          case "style":
            return (
              <Field
                key={control.key}
                label={control.label}
                hint={control.hint}
                className={cn("sm:col-span-2 lg:col-span-3", control.className)}
              >
                {({ id, describedBy }) => (
                  <div
                    id={id}
                    role="radiogroup"
                    aria-label={control.label}
                    aria-describedby={describedBy}
                    className="flex flex-wrap gap-2"
                  >
                    {control.options.map((option) => {
                      const selected = String(value ?? control.default) === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={disabled}
                          onClick={() => set(control.key, option.value)}
                          className={cn(
                            "rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                            selected
                              ? "border-brand-500 bg-brand-500/10 font-medium text-[var(--text-ink)]"
                              : "border-[var(--surface-line)] text-[var(--text-muted)] hover:border-[var(--surface-line-strong)] hover:text-[var(--text-ink)]",
                            disabled && "cursor-not-allowed opacity-50",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
            );

          case "slider": {
            const numeric = typeof value === "number" ? value : control.default;
            return (
              <Field
                key={control.key}
                label={control.label}
                hint={control.hint}
                action={
                  <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                    {numeric.toFixed(2)}
                  </span>
                }
              >
                {({ id, describedBy }) => (
                  <Slider
                    id={id}
                    aria-describedby={describedBy}
                    disabled={disabled}
                    min={0}
                    max={1}
                    step={0.05}
                    value={numeric}
                    onChange={(event) => set(control.key, Number(event.target.value))}
                  />
                )}
              </Field>
            );
          }

          case "checkbox":
            return (
              <div key={control.key} className={control.className}>
                <Checkbox
                  label={control.label}
                  {...(control.description ? { description: control.description } : {})}
                  checked={value === true}
                  disabled={disabled}
                  onChange={(event) => set(control.key, event.target.checked)}
                />
              </div>
            );

          case "text":
            return (
              <Field
                key={control.key}
                label={control.label}
                hint={control.hint}
                className={cn("sm:col-span-2 lg:col-span-3", control.className)}
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    disabled={disabled}
                    value={typeof value === "string" ? value : control.default}
                    maxLength={control.maxLength}
                    placeholder={control.placeholder}
                    onChange={(event) => set(control.key, event.target.value)}
                  />
                )}
              </Field>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ready-made option lists                                            */
/* ------------------------------------------------------------------ */

const pick = <T extends string>(pairs: readonly (readonly [T, string])[]): readonly AiChoice[] =>
  pairs.map(([value, label]) => ({ value, label }));

export const TONE_CHOICES = pick([
  ["neutral", "Neutral"],
  ["friendly", "Friendly"],
  ["formal", "Formal"],
  ["confident", "Confident"],
  ["playful", "Playful"],
  ["empathetic", "Empathetic"],
  ["direct", "Direct"],
  ["casual", "Casual"],
  ["persuasive", "Persuasive"],
  ["technical", "Technical"],
] as const);

export const LENGTH_CHOICES = pick([
  ["shorter", "Shorter"],
  ["short", "Short"],
  ["medium", "Medium"],
  ["long", "Long"],
  ["detailed", "Detailed"],
] as const);

export const COPY_FORMAT_CHOICES = pick([
  ["prose", "Prose"],
  ["short-paragraphs", "Short paragraphs"],
  ["bullet-list", "Bullet list"],
  ["markdown", "Markdown"],
  ["plain-text", "Plain text"],
] as const);

export const GENERATOR_FORMAT_CHOICES = pick([
  ["prose", "Prose"],
  ["short-paragraphs", "Short paragraphs"],
  ["bullet-list", "Bullet list"],
  ["blog-post", "Blog post"],
  ["business-email", "Business email"],
  ["step-by-step", "Step by step"],
  ["seo-meta", "SEO title + meta"],
  ["markdown", "Markdown"],
  ["plain-text", "Plain text"],
] as const);

export const SUMMARY_FORMAT_CHOICES = pick([
  ["short-paragraphs", "Short paragraphs"],
  ["bullet-list", "Bullet list"],
  ["prose", "Prose"],
  ["plain-text", "Plain text"],
  ["markdown", "Markdown"],
] as const);

export const TRANSLATION_FORMAT_CHOICES = pick([
  ["plain-text", "Plain text"],
  ["short-paragraphs", "Short paragraphs"],
  ["markdown", "Markdown"],
] as const);

export const PROMPT_FORMAT_CHOICES = pick([
  ["image-prompt", "Image prompt"],
  ["text-prompt", "Text prompt with slots"],
  ["agent-instruction", "Agent system prompt"],
  ["step-by-step", "Step-by-step task"],
  ["json-object", "JSON object"],
] as const);

export const STYLE_CHOICES = pick([
  ["photographic", "Photographic"],
  ["illustration", "Illustration"],
  ["flat-vector", "Flat vector"],
  ["3d-render", "3D render"],
  ["watercolour", "Watercolour"],
  ["line-art", "Line art"],
  ["studio-backdrop", "Studio backdrop"],
  ["abstract-gradient", "Abstract gradient"],
  ["solid-colour", "Solid colour"],
  ["pattern", "Pattern"],
  ["scene", "Scene"],
] as const);

export const BACKGROUND_STYLE_CHOICES = pick([
  ["studio-backdrop", "Studio backdrop"],
  ["abstract-gradient", "Abstract gradient"],
  ["solid-colour", "Solid colour"],
  ["pattern", "Pattern"],
  ["scene", "Scene"],
  ["line-art", "Line art"],
] as const);

/**
 * Canvas shapes for the `ratio` picker. The label leads with the shape and the
 * drawn box shows the proportions, so the reader never has to work out a ratio
 * from a pair of numbers. The value stays `WxH` because that is what the
 * provider expects.
 */
export const SIZE_CHOICES = pick([
  ["1024x1024", "Square"],
  ["1024x1536", "Portrait 2:3"],
  ["1536x1024", "Landscape 3:2"],
  ["1792x1024", "Wide 7:4"],
  ["512x512", "Small square"],
  ["256x256", "Thumbnail"],
] as const);

export const UPSCALE_SIZE_CHOICES = pick([
  ["1024x1024", "Square"],
  ["1024x1536", "Portrait 2:3"],
  ["1536x1024", "Landscape 3:2"],
  ["1792x1024", "Wide 7:4"],
  ["512x512", "Small square"],
] as const);

export const DETAIL_CHOICES = pick([
  ["medium", "Medium"],
  ["low", "Low"],
  ["high", "High"],
] as const);

export const STRENGTH_CHOICES = pick([
  ["moderate", "Moderate"],
  ["subtle", "Subtle"],
  ["strong", "Strong"],
  ["maximum", "Maximum"],
] as const);

export const BACKGROUND_HANDLING_CHOICES = pick([
  ["keep-transparent", "Keep transparent"],
  ["replace-with-white", "Replace with white"],
  ["replace-with-black", "Replace with black"],
] as const);

export const READOUT_CHOICES = pick([
  ["describe", "Short description"],
  ["detailed-description", "Detailed description"],
  ["alt-text", "Alt text"],
  ["ocr-text", "Read the text"],
  ["object-list", "List of objects"],
  ["key-value", "Labelled fields"],
] as const);
