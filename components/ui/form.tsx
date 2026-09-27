"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ */
/*  Field wrapper — label + hint + error, wired for screen readers      */
/* ------------------------------------------------------------------ */

export interface FieldProps {
  label: React.ReactNode;
  /** Renders a small hint under the label. */
  hint?: React.ReactNode;
  /** Renders the control as a child function receiving the generated ids. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
  error?: string | null;
  className?: string;
  /** Extra node on the right of the label row (e.g. a "Reset" link). */
  action?: React.ReactNode;
}

export function Field({ label, hint, children, error, className, action }: FieldProps) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-[var(--text-ink)]">
          {label}
        </label>
        {action}
      </div>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-brand-500">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlBase = cn(
  "w-full rounded-[10px] border bg-[var(--surface-card-2)] px-3 text-sm text-[var(--text-ink)]",
  "placeholder:text-[var(--text-ink-dim,color-mix(in_srgb,var(--text-muted)_70%,transparent))]",
  "transition-colors duration-150",
  "hover:border-[var(--surface-line-strong)]",
  "focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-brand-500 aria-[invalid=true]:ring-brand-500/25",
);

function borderTone(invalid?: boolean) {
  return invalid
    ? "border-brand-500"
    : "border-[var(--surface-line)]";
}

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Optional adornment rendered inside the field on the right. */
  suffix?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, suffix, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      className={cn(
        controlBase,
        borderTone(invalid),
        "h-10",
        suffix && "pr-16",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
  if (!suffix) return input;
  return (
    <div className="relative">
      {input}
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-[var(--text-muted)]">
        {suffix}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Textarea                                                           */
/* ------------------------------------------------------------------ */

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(controlBase, borderTone(invalid), "resize-y py-2.5 leading-relaxed", className)}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ */
/*  Select (native — best mobile behaviour and accessibility)          */
/* ------------------------------------------------------------------ */

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          controlBase,
          borderTone(invalid),
          "h-10 cursor-pointer appearance-none pr-9",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
      />
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Checkbox / Switch                                                  */
/* ------------------------------------------------------------------ */

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id, ...props },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const descId = description ? `${inputId}-desc` : undefined;

  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="peer sr-only"
        aria-describedby={descId}
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border",
          "border-[var(--surface-line-strong)] bg-[var(--surface-card-2)]",
          "transition-colors duration-150",
          "peer-checked:border-brand-500 peer-checked:bg-brand-500",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--surface-canvas)]",
        )}
      >
        <Check className="size-3 text-white opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={3.5} />
      </span>
      <label htmlFor={inputId} className="cursor-pointer select-none text-sm leading-5">
        <span className="text-[var(--text-ink)]">{label}</span>
        {description ? (
          <span id={descId} className="mt-0.5 block text-xs text-[var(--text-muted)]">
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
});

export function Switch({ label, ...props }: CheckboxProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={props.id} className="text-sm text-[var(--text-ink)]">
        {label}
      </label>
      <input ref={undefined} type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-200",
          "border-[var(--surface-line-strong)] bg-[var(--surface-card-2)]",
          "peer-checked:border-brand-500 peer-checked:bg-brand-500",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[var(--surface-canvas)]",
          "after:absolute after:left-0.5 after:top-0.5 after:size-4.5 after:rounded-full",
          "after:bg-[var(--text-ink)] after:transition-transform after:duration-200",
          "peer-checked:after:translate-x-5 peer-checked:after:bg-white",
        )}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Slider (native range)                                              */
/* ------------------------------------------------------------------ */

export interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="range"
      className={cn(
        "h-6 w-full cursor-pointer appearance-none bg-transparent",
        "accent-brand-500",
        "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full",
        "[&::-webkit-slider-runnable-track]:bg-[var(--surface-line-strong)]",
        "[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-5",
        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
        "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-500",
        "[&::-webkit-slider-thumb]:bg-[var(--surface-card)]",
        "[&::-webkit-slider-thumb]:shadow-[0_1px_6px_rgba(0,0,0,0.5)]",
        "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full",
        "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-500",
        "[&::-moz-range-thumb]:bg-[var(--surface-card)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ */
/*  Segmented control                                                  */
/* ------------------------------------------------------------------ */

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex w-full flex-wrap gap-1 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-1",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
              active
                ? "bg-brand-500 text-white"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-line)] hover:text-[var(--text-ink)]",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Static key/value readout                                           */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "brand" | "success";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3.5 py-3",
        className,
      )}
    >
      <dt className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 font-mono text-[15px] font-semibold tabular-nums",
          tone === "brand" && "text-brand-500",
          tone === "success" && "text-emerald-500",
          tone === "default" && "text-[var(--text-ink)]",
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}
