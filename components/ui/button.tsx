import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset] disabled:hover:bg-brand-500",
  secondary:
    "bg-[var(--surface-card-2)] text-[var(--text-ink)] border border-[var(--surface-line)] hover:bg-[var(--surface-line)] hover:border-[var(--surface-line-strong)]",
  outline:
    "border border-[var(--surface-line-strong)] bg-transparent text-[var(--text-ink)] hover:bg-[var(--surface-card-2)]",
  ghost: "bg-transparent text-[var(--text-muted)] hover:text-[var(--text-ink)] hover:bg-[var(--surface-card-2)]",
  danger: "bg-transparent text-brand-500 border border-brand-500/40 hover:bg-brand-500/10",
  link: "bg-transparent text-brand-500 underline-offset-4 hover:underline p-0 h-auto",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-10 w-10 rounded-[10px] justify-center",
  "icon-sm": "h-8 w-8 rounded-lg justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables interaction. */
  loading?: boolean;
  /** Renders a stretched <a> for links. Pass `href` and it becomes navigation. */
  href?: string;
  /** Marks a destructive/irreversible action. Exposed as `data-destructive`
   *  for styling and test hooks — there is deliberately no `aria-destructive`,
   *  because ARIA defines no such attribute. The accessible name carries the
   *  meaning instead ("Delete request", "Clear favourites"). */
  destructive?: boolean;
  /** Only meaningful with `href`. Adds `rel="noopener noreferrer"` for _blank. */
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    href,
    destructive,
    disabled,
    children,
    type,
    target,
    rel,
    ...props
  },
  ref,
) {
  const classes = cn(
    "inline-flex items-center font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,transform,opacity] duration-150",
    "active:scale-[0.985] motion-reduce:active:scale-100",
    "disabled:opacity-45 disabled:pointer-events-none",
    VARIANTS[variant],
    SIZES[size],
    className,
  );

  const content = (
    <>
      {loading && <Spinner className="size-4 shrink-0" />}
      {children}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        className={classes}
        {...(target === "_blank" ? { target: "_blank", rel: rel ?? "noopener noreferrer" } : null)}
        {...(target && target !== "_blank" ? { target, ...(rel ? { rel } : {}) } : null)}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-destructive={destructive || undefined}
      {...props}
    >
      {content}
    </button>
  );
});
