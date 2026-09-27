"use client";

import * as React from "react";
import { Copy, Download, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select, Stat } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice } from "@/components/tools/states";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/lib/utils/toast";
import { formatBytes, formatNumber } from "@/lib/utils/format";
import { parseHexColor } from "@/lib/tools/engines/dev";

const SAMPLE = "https://balu.tools";

/** Above this many characters a QR code gets too dense for a phone to read. */
const DENSITY_WARNING = 300;
const HARD_LIMIT = 1800;

type Level = "low" | "medium" | "quartile" | "high";
type Format = "png" | "svg";

const LEVEL_LABEL: Record<Level, string> = {
  low: "L",
  medium: "M",
  quartile: "Q",
  high: "H",
};

export default function QrGeneratorWorkspace() {
  const [text, setText] = React.useState(SAMPLE);
  const [size, setSize] = React.useState(320);
  const [level, setLevel] = React.useState<Level>("medium");
  const [margin, setMargin] = React.useState(4);
  const [foreground, setForeground] = React.useState("#000000");
  const [background, setBackground] = React.useState("#FFFFFF");
  const [format, setFormat] = React.useState<Format>("png");
  const [svg, setSvg] = React.useState("");
  const [version, setVersion] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const foregroundOk = parseHexColor(foreground) !== null;
  const backgroundOk = parseHexColor(background) !== null;
  const tooDense = text.length > DENSITY_WARNING;
  const tooLong = text.length > HARD_LIMIT;

  const run = React.useCallback(async () => {
    if (text === "") {
      setSvg("");
      setVersion(null);
      setError(null);
      return;
    }
    if (!foregroundOk || !backgroundOk) {
      setError("One of the colours is not a valid hex value, so there is nothing to draw.");
      setSvg("");
      setVersion(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { default: QRCode } = await import("qrcode");
      const options = {
        errorCorrectionLevel: level,
        margin,
        color: { dark: toRgba(foreground), light: toRgba(background) },
        width: size,
      } as const;
      const created = QRCode.create(text, { errorCorrectionLevel: level });
      setVersion(created.version);
      const source = await QRCode.toString(text, { ...options, type: "svg" });
      setSvg(source);
    } catch (caught) {
      setSvg("");
      setVersion(null);
      setError(
        caught instanceof Error
          ? `The QR encoder could not handle that content: ${caught.message}`
          : "The QR encoder could not handle that content.",
      );
    } finally {
      setBusy(false);
    }
  }, [text, level, margin, size, foreground, background, foregroundOk, backgroundOk]);

  React.useEffect(() => {
    // Debounced: re-encoding on every keystroke is wasteful, and the QR is
    // derived state — nothing is lost by waiting a moment.
    const timer = setTimeout(() => {
      void run();
    }, 180);
    return () => clearTimeout(timer);
  }, [run]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void run();
    }
  };

  const downloadPng = async (): Promise<void> => {
    if (svg === "") return;
    setBusy(true);
    try {
      const { default: QRCode } = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(text, {
        errorCorrectionLevel: level,
        margin,
        color: { dark: toRgba(foreground), light: toRgba(background) },
        width: size,
        type: "image/png",
      });
      const { downloadDataUrl } = await import("@/lib/utils/files");
      downloadDataUrl(dataUrl, "qr-code.png");
      toast.downloadReady("qr-code.png");
    } catch (caught) {
      toast.error("Couldn't build the PNG", caught instanceof Error ? caught.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell>
      <div
        className="flex flex-col gap-4"
        onKeyDown={onKeyDown}
        role="group"
        aria-label="QR code generator"
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,18rem)]">
          <div className="flex flex-col gap-3">
            <Field label="Content" hint="A URL, plain text, a Wi-Fi string, anything a scanner can read.">
              {({ id, describedBy }) => (
                <textarea
                  id={id}
                  aria-describedby={describedBy}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={4}
                  spellCheck={false}
                  placeholder="https://example.dev"
                  className="w-full resize-y rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] px-3 py-2.5 font-mono text-[13px] leading-relaxed text-[var(--text-ink)] placeholder:text-[var(--text-muted)] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
                />
              )}
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Size in pixels" hint="The SVG scales, so this only affects the PNG.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min={128}
                    max={2048}
                    step={8}
                    value={size}
                    onChange={(event) => setSize(clampNumber(Number(event.target.value), 128, 2048))}
                  />
                )}
              </Field>
              <Field
                label="Error correction"
                hint="Higher levels survive more damage but hold less data."
              >
                {({ id, describedBy }) => (
                  <Select
                    id={id}
                    aria-describedby={describedBy}
                    value={level}
                    onChange={(event) => setLevel(event.target.value as Level)}
                  >
                    <option value="L">L — 7% recovery</option>
                    <option value="M">M — 15% recovery (default)</option>
                    <option value="Q">Q — 25% recovery</option>
                    <option value="H">H — 30% recovery, least capacity</option>
                  </Select>
                )}
              </Field>
              <Field label="Quiet zone" hint="Modules of blank margin. Below 2 many scanners fail.">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    type="number"
                    min={0}
                    max={16}
                    value={margin}
                    onChange={(event) => setMargin(clampNumber(Number(event.target.value), 0, 16))}
                  />
                )}
              </Field>
              <Field label="Foreground" error={foregroundOk ? null : "Not a valid hex colour."}>
                {({ id, describedBy, invalid }) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={foreground}
                      onChange={(event) => setForeground(event.target.value)}
                      spellCheck={false}
                      className="font-mono uppercase"
                    />
                    <span
                      aria-hidden="true"
                      className="size-10 shrink-0 rounded-lg border border-[var(--surface-line)]"
                      style={{ background: foregroundOk ? foreground : "transparent" }}
                    />
                  </div>
                )}
              </Field>
              <Field label="Background" error={backgroundOk ? null : "Not a valid hex colour."}>
                {({ id, describedBy, invalid }) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={background}
                      onChange={(event) => setBackground(event.target.value)}
                      spellCheck={false}
                      className="font-mono uppercase"
                    />
                    <span
                      aria-hidden="true"
                      className="size-10 shrink-0 rounded-lg border border-[var(--surface-line)]"
                      style={{ background: backgroundOk ? background : "transparent" }}
                    />
                  </div>
                )}
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => void run()} loading={busy}>
                Generate
              </Button>
              <span className="text-[11px] text-[var(--text-muted)]">
                or press{" "}
                <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">
                  Ctrl + Enter
                </kbd>
              </span>
              <div className="ml-auto">
                <Segmented
                  label="Output format"
                  size="sm"
                  value={format}
                  onChange={setFormat}
                  options={[
                    { value: "png", label: "PNG" },
                    { value: "svg", label: "SVG" },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-center rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
              {text === "" ? (
                <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
                  Type something to generate a code.
                </p>
              ) : error ? (
                <p className="py-8 text-center text-[13px] text-brand-500">{error}</p>
              ) : svg === "" ? (
                <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">Working…</p>
              ) : (
                <div
                  className={cn("w-full", format === "png" ? "max-w-[18rem]" : "max-w-full")}
                  // The SVG is generated by the `qrcode` encoder from the text
                  // above, never from remote content, and is inlined so it
                  // downloads as a real vector file.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              )}
            </div>
            <p className="text-center text-[11px] text-[var(--text-muted)]">
              Scan it with a phone camera to check. Nothing was uploaded — the encoder ran here.
            </p>
          </div>
        </div>

        {tooLong ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="This is too much content for a QR code.">
            {formatNumber(text.length)} characters exceeds the ~{HARD_LIMIT} a QR code holds even at the
            lowest error-correction level. A scanner cannot read it, and no amount of resizing will help.
            Use a link that points at the content instead.
          </Notice>
        ) : tooDense ? (
          <Notice tone="warning" icon={<TriangleAlert className="size-4" />} title="Dense code — test before you rely on it.">
            {formatNumber(text.length)} characters pushes the module count up, and a dense code needs to be
            printed large and viewed square-on. Raise the size, keep the quiet zone, and check it with more
            than one phone. A short link will scan far more reliably.
          </Notice>
        ) : null}

        {text !== "" && !error ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Characters" value={formatNumber(text.length)} tone="brand" />
              <Stat label="QR version" value={version === null ? "—" : String(version)} hint="of 40" />
              <Stat label="Error correction" value={LEVEL_LABEL[level]} />
              <Stat label="Quiet zone" value={`${margin} modules`} />
            </dl>

            <div className="flex flex-wrap items-center gap-2">
              {format === "png" ? (
                <Button variant="primary" onClick={() => void downloadPng()} loading={busy} disabled={svg === ""}>
                  <Download aria-hidden="true" className="size-4" />
                  Download PNG
                </Button>
              ) : (
                <DownloadButton
                  text={svg}
                  filename="qr-code.svg"
                  mime="image/svg+xml"
                  label="Download SVG"
                  size="md"
                  variant="primary"
                />
              )}
              <CopyButton
                value={format === "svg" ? svg : null}
                what="SVG source copied"
                variant="secondary"
              />
              {format === "png" ? (
                <Button
                  size="md"
                  variant="secondary"
                  onClick={() => {
                    setFormat("svg");
                    toast.info("Switched to SVG so you can copy the source");
                  }}
                >
                  <Copy aria-hidden="true" className="size-4" />
                  Copy SVG source
                </Button>
              ) : null}
            </div>

            <details className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-[var(--text-ink)]">
                SVG source ({formatBytes(new Blob([svg]).size)})
              </summary>
              <pre className="mt-2.5 max-h-64 overflow-auto rounded-lg border border-[var(--surface-line)] bg-[var(--surface-card)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--text-muted)]">
                {svg}
              </pre>
            </details>
          </>
        ) : null}
      </div>
    </ToolShell>
  );
}

/** `qrcode` wants eight-digit hex; the picker is six. */
function toRgba(hex: string): string {
  const parsed = parseHexColor(hex);
  if (!parsed) return "#000000ff";
  const channel = (value: number): string => Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(parsed.r)}${channel(parsed.g)}${channel(parsed.b)}ff`;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
