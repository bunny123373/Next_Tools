"use client";

import * as React from "react";
import { Check, Contrast, Copy, Eraser, FlaskConical, ImageDown, Palette, TriangleAlert, X } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Slider, Stat } from "@/components/ui/form";
import { CopyButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { clamp } from "@/lib/utils/format";
import {
  cmykToRgb,
  compositeOn,
  contrastRatio,
  hslToRgb,
  hsvToRgb,
  oklchToRgb,
  paletteFromPixels,
  parseHexColor,
  rgbaToCss,
  rgbaToHex,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
  rgbToOklch,
  wcagVerdict,
  type PaletteEntry,
  type Rgba,
} from "@/lib/tools/engines/dev";

type Background = "light" | "custom" | "dark";

const DEFAULT_DARK: Rgba = { r: 13, g: 13, b: 13, a: 1 };
const LIGHT: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** A handful of seed swatches so the picker is useful before anything is typed. */
const SEEDS: string[] = [
  "#FF3B30", "#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#5AC8FA", "#FFFFFF", "#8A8A8A", "#242424", "#0D0D0D",
];

export default function ColorPickerWorkspace() {
  const [hue, setHue] = React.useState(4);
  const [saturation, setSaturation] = React.useState(100);
  const [value, setValue] = React.useState(100);
  const [alpha, setAlpha] = React.useState(1);
  const [hexDraft, setHexDraft] = React.useState("#FF3B30");
  const [rgbDraft, setRgbDraft] = React.useState({ r: "255", g: "59", b: "48" });
  const [hslDraft, setHslDraft] = React.useState({ h: "4", s: "100", l: "59" });
  const [hsvDraft, setHsvDraft] = React.useState({ h: "4", s: "100", v: "100" });
  const [cmykDraft, setCmykDraft] = React.useState({ c: "0", m: "77", y: "81", k: "0" });
  const [oklchDraft, setOklchDraft] = React.useState({ l: "62.8", c: "25.8", h: "29.2" });
  const [background, setBackground] = React.useState<Background>("light");
  const [backgroundHex, setBackgroundHex] = React.useState("#FFFFFF");
  const [recent, setRecent] = React.useState<string[]>([...SEEDS]);
  const [palette, setPalette] = React.useState<PaletteEntry[]>([]);
  const [paletteError, setPaletteError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const base = React.useMemo<Rgba>(
    () => ({ ...hsvToRgb(hue, saturation, value), a: alpha }),
    [hue, saturation, value, alpha],
  );


  const backdrop = React.useMemo<Rgba>(() => {
    if (background === "dark") return DEFAULT_DARK;
    if (background === "light") return LIGHT;
    return parseHexColor(backgroundHex) ?? LIGHT;
  }, [background, backgroundHex]);

  const flat = React.useMemo(() => compositeOn(base, backdrop), [base, backdrop]);
  const ratio = React.useMemo(() => contrastRatio(flat, backdrop), [flat, backdrop]);
  const verdict = React.useMemo(() => wcagVerdict(ratio), [ratio]);

  /**
   * One entry point for every colour change. HSV is the source of truth, and
   * each of the other five fields is rewritten from it in the same call — so
   * there is never a window where two formats disagree, and no effect needed to
   * reconcile them.
   */
  const pushRgb = React.useCallback((rgb: { r: number; g: number; b: number }, alphaValue: number): void => {
    const color: Rgba = { ...rgb, a: alphaValue };
    const hsv = rgbToHsv(color);
    setHue(hsv.h);
    setSaturation(hsv.s);
    setValue(hsv.v);
    setAlpha(alphaValue);
    setHexDraft(rgbaToHex(color, alphaValue < 1));
    setRgbDraft({ r: String(Math.round(rgb.r)), g: String(Math.round(rgb.g)), b: String(Math.round(rgb.b)) });
    const hsl = rgbToHsl(color);
    setHslDraft({ h: hsl.h.toFixed(1), s: hsl.s.toFixed(1), l: hsl.l.toFixed(1) });
    setHsvDraft({ h: hsv.h.toFixed(1), s: hsv.s.toFixed(1), v: hsv.v.toFixed(1) });
    const cmyk = rgbToCmyk(color);
    setCmykDraft({
      c: cmyk.c.toFixed(1),
      m: cmyk.m.toFixed(1),
      y: cmyk.y.toFixed(1),
      k: cmyk.k.toFixed(1),
    });
    const oklch = rgbToOklch(color);
    setOklchDraft({ l: oklch.l.toFixed(2), c: oklch.c.toFixed(2), h: oklch.h.toFixed(1) });
  }, []);

  const remember = React.useCallback((color: Rgba) => {
    setRecent((current) => {
      const hex = rgbaToHex(color);
      return [hex, ...current.filter((entry) => entry !== hex)].slice(0, 12);
    });
  }, []);

  /** Any settled change also lands in the recent swatches. */
  const commit = React.useCallback(
    (rgb: { r: number; g: number; b: number }, alphaValue: number) => {
      pushRgb(rgb, alphaValue);
      remember({ ...rgb, a: alphaValue });
    },
    [pushRgb, remember],
  );

  const setFromHsv = React.useCallback(
    (nextHue: number, nextSaturation: number, nextValue: number): void => {
      pushRgb(hsvToRgb(nextHue, nextSaturation, nextValue), alpha);
    },
    [pushRgb, alpha],
  );

  const fromHex = (raw: string): void => {
    const parsed = parseHexColor(raw);
    if (!parsed) {
      toast.warning("Not a hex colour", "Use 3, 4, 6 or 8 hex digits, for example #1a2b3c.");
      return;
    }
    commit(parsed, parsed.a);
  };

  const fromRgb = (raw: { r: string; g: string; b: string }): void => {
    const [r, g, b] = [raw.r, raw.g, raw.b].map((entry) => Number(entry));
    if (![r, g, b].every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 255)) return;
    pushRgb({ r, g, b }, alpha);
  };

  const fromHsl = (raw: { h: string; s: string; l: string }): void => {
    const h = Number(raw.h);
    const s = Number(raw.s);
    const l = Number(raw.l);
    if (![h, s, l].every(Number.isFinite)) return;
    pushRgb(hslToRgb(h, clamp(s, 0, 100), clamp(l, 0, 100)), alpha);
  };

  const fromCmyk = (raw: { c: string; m: string; y: string; k: string }): void => {
    const [c, m, y, k] = [raw.c, raw.m, raw.y, raw.k].map((entry) => Number(entry));
    if (![c, m, y, k].every(Number.isFinite)) return;
    pushRgb(cmykToRgb(clamp(c, 0, 100), clamp(m, 0, 100), clamp(y, 0, 100), clamp(k, 0, 100)), alpha);
  };

  const fromOklch = (raw: { l: string; c: string; h: string }): void => {
    const l = Number(raw.l);
    const c = Number(raw.c);
    const h = Number(raw.h);
    if (![l, c, h].every(Number.isFinite)) return;
    pushRgb(oklchToRgb(l, c, h), alpha);
  };

  const reset = (): void => {
    setHue(0);
    setSaturation(0);
    setValue(100);
    setAlpha(1);
    commit({ r: 255, g: 255, b: 255 }, 1);
  };

  const onDrop = async (file: File): Promise<void> => {
    setPaletteError(null);
    if (!file.type.startsWith("image/")) {
      setPaletteError(`"${file.name}" is not an image, so there is nothing to sample from it.`);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 160 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setPaletteError("This browser would not give the page a 2D canvas to read pixels from.");
        bitmap.close();
        return;
      }
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      bitmap.close();
      const found = paletteFromPixels(pixels, 8);
      if (found.length === 0) {
        setPaletteError("That image is entirely transparent, so there is no colour to sample.");
        return;
      }
      setPalette(found);
    } catch {
      setPaletteError("The browser could not decode that image. It may be a format it does not support.");
    }
  };

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Saturation and brightness</span>
              <div
                className="relative aspect-square w-full touch-none overflow-hidden rounded-[10px] border border-[var(--surface-line)]"
                style={{
                  background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${Math.round(hue)} 100% 50%))`,
                }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragging(true);
                  const element = event.currentTarget;
                  const apply = (clientX: number, clientY: number): void => {
                    const rect = element.getBoundingClientRect();
                    const x = (clientX - rect.left) / rect.width;
                    const y = (clientY - rect.top) / rect.height;
                    setFromHsv(hue, clamp(x, 0, 1) * 100, clamp(1 - y, 0, 1) * 100);
                  };
                  apply(event.clientX, event.clientY);
                  const onMove = (pointerEvent: PointerEvent): void => apply(pointerEvent.clientX, pointerEvent.clientY);
                  const onUp = (): void => {
                    setDragging(false);
                    commit(hsvToRgb(hue, saturation, value), alpha);
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                }}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 10 : 2;
                  if (event.key === "ArrowRight") setFromHsv(hue, clamp(saturation + step, 0, 100), value);
                  if (event.key === "ArrowLeft") setFromHsv(hue, clamp(saturation - step, 0, 100), value);
                  if (event.key === "ArrowUp") setFromHsv(hue, saturation, clamp(value + step, 0, 100));
                  if (event.key === "ArrowDown") setFromHsv(hue, saturation, clamp(value - step, 0, 100));
                }}
                role="application"
                tabIndex={0}
                aria-label={`Saturation and brightness area, currently ${Math.round(saturation)} percent saturation and ${Math.round(value)} percent brightness. Use the arrow keys to adjust.`}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                  style={{ left: `${saturation}%`, top: `${100 - value}%` }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="flex items-center justify-between text-[13px] font-medium text-[var(--text-ink)]">
                Hue
                <span className="font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
                  {Math.round(hue)}°
                </span>
              </span>
              <div
                className="relative h-8 w-full rounded-[10px]"
                style={{
                  background:
                    "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
                }}
              >
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={hue}
                  onChange={(event) => setFromHsv(Number(event.target.value), saturation, value)}
                  aria-label="Hue"
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent accent-[var(--color-brand-500,#FF3B30)] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white"
                />
              </div>
            </div>

            <Field label={`Alpha — ${Math.round(alpha * 100)}%`} hint="Alpha is composited over the background for the contrast maths below.">
              {({ id, describedBy }) => (
                <Slider
                  id={id}
                  aria-describedby={describedBy}
                  min={0}
                  max={100}
                  value={Math.round(alpha * 100)}
                  onChange={(event) => pushRgb(hsvToRgb(hue, saturation, value), Number(event.target.value) / 100)}
                />
              )}
            </Field>

            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-[var(--text-ink)]">Swatches</span>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => fromHex(hex)}
                    title={hex}
                    aria-label={`Use ${hex}`}
                    className={cn(
                      "size-7 rounded-lg border transition-transform duration-150 hover:scale-110",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                      rgbaToHex(base) === hex.replace(/^#/, "#").toLowerCase()
                        ? "border-brand-500"
                        : "border-[var(--surface-line-strong)]",
                    )}
                    style={{ background: hex }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div
              className="flex min-h-[8rem] items-end rounded-[10px] border border-[var(--surface-line)] p-4"
              style={{ background: rgbaToCss(backdrop) }}
            >
              <div className="min-w-0">
                <p
                  className="truncate font-mono text-[15px] font-semibold"
                  style={{ color: rgbaToCss(flat) }}
                >
                  {rgbaToHex(base, alpha < 1).toUpperCase()}
                </p>
                <p className="mt-0.5 text-[12px]" style={{ color: rgbaToCss(flat) }}>
                  {alpha < 1 ? `at ${Math.round(alpha * 100)}% alpha` : "opaque"} on{" "}
                  {rgbaToHex(backdrop).toUpperCase()}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="HEX" hint="3, 4, 6 or 8 digits. The 8-digit form carries alpha.">
                {({ id, describedBy }) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      value={hexDraft}
                      onChange={(event) => {
                        setHexDraft(event.target.value);
                        fromHex(event.target.value);
                      }}
                      onBlur={() => fromHex(hexDraft)}
                      spellCheck={false}
                      className="font-mono uppercase"
                    />
                    <span aria-hidden="true" className="size-9 shrink-0 rounded-lg border border-[var(--surface-line)]" style={{ background: rgbaToCss(base) }} />
                  </div>
                )}
              </Field>

              <Field label="RGB" hint="0–255 per channel.">
                {({ id, describedBy }) => (
                  <div id={id} aria-describedby={describedBy} className="flex items-center gap-2">
                    {(["r", "R", "g", "G", "b", "B"] as const).map((channel) => (
                      <React.Fragment key={channel}>
                        <input
                          value={channel === "r" ? rgbDraft.r : channel === "R" ? String(Math.round(base.r)) : channel === "g" ? rgbDraft.g : channel === "G" ? String(Math.round(base.g)) : rgbDraft.b}
                          onChange={(event) => {
                            const next = { ...rgbDraft, [channel.toLowerCase()]: event.target.value };
                            setRgbDraft(next);
                            fromRgb(next);
                          }}
                          type="number"
                          min={0}
                          max={255}
                          aria-label={`${channel === "r" || channel === "R" ? "red" : channel === "g" || channel === "G" ? "green" : "blue"} channel`}
                          className="h-10 w-full min-w-0 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2.5 font-mono text-sm text-[var(--text-ink)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                        />
                        {channel === "R" || channel === "G" ? <span className="text-[var(--text-muted)]">,</span> : null}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="HSL" hint="Hue 0–360°, saturation and lightness 0–100%.">
                {({ id }) => (
                  <div id={id} className="flex items-center gap-2">
                    {(["h", "s", "l"] as const).map((key) => (
                      <React.Fragment key={key}>
                        <input
                          value={hslDraft[key]}
                          onChange={(event) => {
                            const next = { ...hslDraft, [key]: event.target.value };
                            setHslDraft(next);
                            fromHsl(next);
                          }}
                          type="number"
                          min={0}
                          max={key === "h" ? 360 : 100}
                          aria-label={`${key === "h" ? "hue" : key === "s" ? "saturation" : "lightness"} in HSL`}
                          className="h-10 w-full min-w-0 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2.5 font-mono text-sm text-[var(--text-ink)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                        />
                        {key !== "l" ? <span className="text-[var(--text-muted)]">,</span> : null}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="HSV / HSB" hint="Value is what designers mean by brightness.">
                {({ id }) => (
                  <div id={id} className="flex items-center gap-2">
                    {(["h", "s", "v"] as const).map((key) => (
                      <React.Fragment key={key}>
                        <input
                          value={hsvDraft[key]}
                          onChange={(event) => {
                            const next = { ...hsvDraft, [key]: event.target.value };
                            setHsvDraft(next);
                            const h = Number(next.h);
                            const s = Number(next.s);
                            const v = Number(next.v);
                            if ([h, s, v].every(Number.isFinite)) setFromHsv(h, clamp(s, 0, 100), clamp(v, 0, 100));
                          }}
                          type="number"
                          min={0}
                          max={key === "h" ? 360 : 100}
                          aria-label={`${key === "h" ? "hue" : key === "s" ? "saturation" : "value"} in HSV`}
                          className="h-10 w-full min-w-0 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2.5 font-mono text-sm text-[var(--text-ink)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                        />
                        {key !== "v" ? <span className="text-[var(--text-muted)]">,</span> : null}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="CMYK" hint="Printing convention, 0–100% each. Rounding is why it will not look perfectly exact.">
                {({ id }) => (
                  <div id={id} className="flex items-center gap-2">
                    {(["c", "m", "y", "k"] as const).map((key) => (
                      <React.Fragment key={key}>
                        <input
                          value={cmykDraft[key]}
                          onChange={(event) => {
                            const next = { ...cmykDraft, [key]: event.target.value };
                            setCmykDraft(next);
                            fromCmyk(next);
                          }}
                          type="number"
                          min={0}
                          max={100}
                          aria-label={`${key.toUpperCase()} in CMYK`}
                          className="h-10 w-full min-w-0 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2.5 font-mono text-sm text-[var(--text-ink)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                        />
                        {key !== "k" ? <span className="text-[var(--text-muted)]">,</span> : null}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </Field>

              <Field label="OKLCH" hint="Perceptually uniform, so equal numeric steps look like equal steps.">
                {({ id }) => (
                  <div id={id} className="flex items-center gap-2">
                    {(["l", "c", "h"] as const).map((key) => (
                      <React.Fragment key={key}>
                        <input
                          value={oklchDraft[key]}
                          onChange={(event) => {
                            const next = { ...oklchDraft, [key]: event.target.value };
                            setOklchDraft(next);
                            fromOklch(next);
                          }}
                          type="number"
                          min={0}
                          max={key === "h" ? 360 : 400}
                          step={key === "c" ? 0.01 : 0.1}
                          aria-label={`${key === "l" ? "lightness" : key === "c" ? "chroma" : "hue"} in OKLCH`}
                          className="h-10 w-full min-w-0 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-2.5 font-mono text-sm text-[var(--text-ink)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                        />
                        {key !== "h" ? <span className="text-[var(--text-muted)]">,</span> : null}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <CopyButton value={rgbaToHex(base, alpha < 1).toUpperCase()} what="HEX copied" size="sm" variant="secondary" />
              <CopyButton value={rgbaToCss(base)} what="CSS copied" size="sm" variant="secondary" />
              <Button size="sm" variant="ghost" onClick={reset}>
                <Eraser aria-hidden="true" className="size-3.5" />
                Reset to white
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => commit(hsvToRgb(4, 100, 100), 1)}
              >
                <FlaskConical aria-hidden="true" className="size-3.5" />
                Brand red
              </Button>
            </div>
          </div>
        </div>

        <section aria-label="Contrast" className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
              <Contrast aria-hidden="true" className="size-3.5" />
              WCAG contrast
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {(["light", "custom", "dark"] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={background === option ? "primary" : "secondary"}
                  onClick={() => setBackground(option)}
                >
                  {option === "light" ? "White bg" : option === "dark" ? "Dark bg" : "Custom bg"}
                </Button>
              ))}
            </div>
          </div>

          {background === "custom" ? (
            <Field label="Background colour" hint="Alpha is flattened over white, as a browser would.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={backgroundHex}
                  onChange={(event) => setBackgroundHex(event.target.value)}
                  spellCheck={false}
                  className="font-mono uppercase"
                />
              )}
            </Field>
          ) : null}

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Ratio" value={`${verdict.ratio} : 1`} tone="brand" />
            <Stat
              label="AA normal"
              value={verdict.aaNormal ? "pass" : "fail"}
              tone={verdict.aaNormal ? "success" : "default"}
            />
            <Stat
              label="AA large text"
              value={verdict.aaLarge ? "pass" : "fail"}
              tone={verdict.aaLarge ? "success" : "default"}
            />
            <Stat
              label="AAA normal"
              value={verdict.aaaNormal ? "pass" : "fail"}
              tone={verdict.aaaNormal ? "success" : "default"}
            />
          </dl>

          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium",
                verdict.aaaNormal
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                  : verdict.aaNormal
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                    : "border-brand-500/30 bg-brand-500/10 text-brand-500",
              )}
            >
              {verdict.aaaNormal ? <Check className="size-3" /> : verdict.aaNormal ? <Check className="size-3" /> : <X className="size-3" />}
              {verdict.aaaNormal
                ? "AAA for body text"
                : verdict.aaNormal
                  ? "AA for body text"
                  : verdict.aaLarge
                    ? "Large text only (18.66px bold or 24px)"
                    : "Fails every WCAG level"}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-[var(--text-muted)]">
            The ratio uses the WCAG 2.1 relative-luminance formula on the sRGB channels, with any alpha first
            composited over the background. AAA for body text needs 7:1, AA needs 4.5:1, and large text
            (24&nbsp;px, or 18.66&nbsp;px bold) is the 3:1 threshold.
          </p>
        </section>

        <section
          aria-label="Palette from an image"
          className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void onDrop(file);
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-ink)]">
              <ImageDown aria-hidden="true" className="size-3.5" />
              Extract a palette from an image
            </span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-ink)] transition-colors hover:border-[var(--surface-line-strong)] focus-within:ring-2 focus-within:ring-brand-500/40">
              <Palette aria-hidden="true" className="size-3.5" />
              Choose an image
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onDrop(file);
                }}
              />
            </label>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Drop an image here, or choose one. It is decoded with the browser&apos;s own image reader and
            sampled on a canvas in this tab — the file is never uploaded.
          </p>
          {paletteError ? (
            <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
              {paletteError}
            </Notice>
          ) : null}
          {palette.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {palette.map((entry) => (
                <li key={entry.hex} className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => fromHex(entry.hex)}
                    title={`Use ${entry.hex}`}
                    className="h-14 w-full rounded-[10px] border border-[var(--surface-line-strong)] transition-transform duration-150 hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                    style={{ background: entry.hex }}
                  >
                    <span className="sr-only">Use {entry.hex}</span>
                  </button>
                  <span className="flex items-center justify-between gap-1">
                    <code className="font-mono text-[11px] text-[var(--text-ink)]">{entry.hex.toUpperCase()}</code>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {entry.share.toFixed(1)}%
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {dragging ? (
          <Notice tone="info">
            Release the pointer to set the colour.
          </Notice>
        ) : null}

        <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Copy aria-hidden="true" className="size-3" />
          Every format updates from the one you type in, and each can be copied directly.
        </p>
      </div>
    </ToolShell>
  );
}
