"use client";

import * as React from "react";
import { MoveHorizontal } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { clamp, formatBytes, percentSaved } from "@/lib/utils/format";
import { Stat } from "@/components/ui/form";
import { useObjectUrl } from "@/lib/hooks";

/* ------------------------------------------------------------------ */
/*  Dimensions + size comparison table                                 */
/* ------------------------------------------------------------------ */

export interface SizeComparison {
  beforeBytes: number;
  afterBytes: number;
  beforeWidth?: number;
  beforeHeight?: number;
  afterWidth?: number;
  afterHeight?: number;
}

/**
 * The "before / after" readout required for every image tool: original
 * dimensions and size on the left, result on the right, with the percentage
 * saved called out explicitly.
 */
export function SizeComparisonStats({
  beforeBytes,
  afterBytes,
  beforeWidth,
  beforeHeight,
  afterWidth,
  afterHeight,
  className,
}: SizeComparison & { className?: string }) {
  const saved = percentSaved(beforeBytes, afterBytes);
  const grew = afterBytes > beforeBytes;

  return (
    <dl className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4", className)}>
      <Stat
        label="Original"
        value={formatBytes(beforeBytes)}
        hint={beforeWidth && beforeHeight ? `${beforeWidth} × ${beforeHeight}px` : undefined}
      />
      <Stat
        label="Result"
        value={formatBytes(afterBytes)}
        hint={afterWidth && afterHeight ? `${afterWidth} × ${afterHeight}px` : undefined}
        tone={grew ? "default" : "success"}
      />
      <Stat
        label={grew ? "Increase" : "Saved"}
        value={`${saved.toFixed(1)}%`}
        hint={grew ? "result is larger" : "of the original size"}
        tone={grew ? "default" : "success"}
      />
      <Stat
        label="Difference"
        value={`${grew ? "+" : "−"}${formatBytes(Math.abs(beforeBytes - afterBytes))}`}
        hint={grew ? "larger than input" : "smaller than input"}
      />
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/*  Draggable comparison slider                                        */
/* ------------------------------------------------------------------ */

export interface BeforeAfterSliderProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  /** Natural size of the "after" image, for the stats strip. */
  className?: string;
  height?: number | string;
}

/**
 * Two images stacked with a clip-path driven by a draggable divider.
 * Fully keyboard operable: the divider is a real `role="slider"`.
 */
export function BeforeAfterSlider({
  beforeSrc,
  afterSrc,
  beforeLabel = "Before",
  afterLabel = "After",
  className,
  height = 320,
}: BeforeAfterSliderProps) {
  const [position, setPosition] = React.useState(50);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const dragging = React.useRef(false);

  const setFromClientX = React.useCallback((clientX: number) => {
    const node = frameRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100));
  }, []);

  React.useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      event.preventDefault();
      setFromClientX(event.clientX);
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [setFromClientX]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPosition((p) => clamp(p - step, 0, 100));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setPosition((p) => clamp(p + step, 0, 100));
    } else if (event.key === "Home") {
      event.preventDefault();
      setPosition(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setPosition(100);
    }
  };

  return (
    <div
      className={cn(
        "relative select-none overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)]",
        className,
      )}
      style={{ height }}
    >
      {/* After image fills the frame. */}
      <img
        src={afterSrc}
        alt={afterLabel}
        draggable={false}
        className="absolute inset-0 size-full object-contain"
      />

      {/* Before image is clipped to the left of the divider. */}
      <div
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        aria-hidden="true"
      >
        <img
          src={beforeSrc}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      </div>

      {/* Labels */}
      <span
        className={cn(
          "pointer-events-none absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm",
          position < 22 && "opacity-0",
          "transition-opacity duration-150",
        )}
      >
        {beforeLabel}
      </span>
      <span
        className={cn(
          "pointer-events-none absolute right-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm",
          position > 78 && "opacity-0",
          "transition-opacity duration-150",
        )}
      >
        {afterLabel}
      </span>

      {/* Divider + grab handle */}
      <div
        ref={frameRef}
        onPointerDown={(event) => {
          dragging.current = true;
          setFromClientX(event.clientX);
        }}
        className="absolute inset-0 cursor-ew-resize"
        role="presentation"
      >
        <div
          className="absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{ left: `${position}%` }}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Comparison position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${Math.round(position)}% ${beforeLabel}`}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.stopPropagation();
            dragging.current = true;
          }}
          className="absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border-2 border-white bg-black/70 text-white shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          style={{ left: `${position}%` }}
        >
          <MoveHorizontal className="size-4" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Combined: stats + optional slider                                  */
/* ------------------------------------------------------------------ */

export function BeforeAfter({
  beforeBlob,
  afterBlob,
  beforeWidth,
  beforeHeight,
  afterWidth,
  afterHeight,
  beforeLabel = "Original",
  afterLabel = "Processed",
  slider = true,
  className,
}: SizeComparison & {
  beforeBlob: Blob;
  afterBlob: Blob;
  beforeLabel?: string;
  afterLabel?: string;
  /** Set false to show the two images side by side instead. */
  slider?: boolean;
  className?: string;
}) {
  const beforeUrl = useObjectUrl(beforeBlob);
  const afterUrl = useObjectUrl(afterBlob);

  if (!beforeUrl || !afterUrl) return null;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <SizeComparisonStats
        beforeBytes={beforeBlob.size}
        afterBytes={afterBlob.size}
        beforeWidth={beforeWidth}
        beforeHeight={beforeHeight}
        afterWidth={afterWidth}
        afterHeight={afterHeight}
      />

      {slider ? (
        <BeforeAfterSlider
          beforeSrc={beforeUrl}
          afterSrc={afterUrl}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="m-0 flex flex-col gap-1.5">
            <div className="checkerboard flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
              <img src={beforeUrl} alt={beforeLabel} className="max-h-64 w-auto max-w-full object-contain" />
            </div>
            <figcaption className="text-center text-xs text-[var(--text-muted)]">{beforeLabel}</figcaption>
          </figure>
          <figure className="m-0 flex flex-col gap-1.5">
            <div className="checkerboard flex min-h-32 items-center justify-center overflow-hidden rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
              <img src={afterUrl} alt={afterLabel} className="max-h-64 w-auto max-w-full object-contain" />
            </div>
            <figcaption className="text-center text-xs text-[var(--text-muted)]">{afterLabel}</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
