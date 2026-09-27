"use client";

import * as React from "react";
import { Segmented } from "@/components/ui/form";
import { ToolShell } from "@/components/tools/ToolShell";
import {
  TextWorkbench,
  readingStats,
  speakingLabel,
  type TextToolResult,
} from "@/components/tools/workspaces/shared/TextWorkbench";
import { splitSentences } from "@/lib/tools/engines/text";
import { formatNumber } from "@/lib/utils/format";

type Speed = "slow" | "average" | "fast";

const SPEEDS: readonly { value: Speed; label: string; wpm: number }[] = [
  { value: "slow", label: "Slow · 150", wpm: 150 },
  { value: "average", label: "Average · 200", wpm: 200 },
  { value: "fast", label: "Fast · 250", wpm: 250 },
];

/** Speaking pace for reading aloud, and the assumed words on one screen. */
const SPEAKING_WPM = 130;
const SCREEN_WORDS = 400;
const SCREENS = [1, 2, 3, 4] as const;

/** "2 min 5 s" / "48 s" / "1 hr 4 min" — precise enough to be useful. */
function precise(minutes: number): string {
  if (minutes <= 0) return "0 s";
  const totalSeconds = Math.round(minutes * 60);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours} hr ${mins} min`;
  return secs === 0 ? `${mins} min` : `${mins} min ${secs} s`;
}

const SAMPLE = `The average adult reads about 200 words a minute on a screen, but the number moves a long way with the reader and the material. Dense technical prose is slower; a well-known story is faster. Publishing an estimate is only useful if you say which speed you assumed, which is why all three are here at once.`;

export default function ReadingTimeCalculator() {
  const [value, setValue] = React.useState("");
  const [speed, setSpeed] = React.useState<Speed>("average");

  const words = React.useMemo(() => readingStats(value).words, [value]);
  const sentences = React.useMemo(() => splitSentences(value).length, [value]);

  const selected = SPEEDS.find((item) => item.value === speed) ?? SPEEDS[1]!;

  const report = React.useMemo(() => {
    if (!value.trim()) return "";
    const lines = [
      `${formatNumber(words)} words · ${formatNumber([...value].length)} characters · ${formatNumber(sentences)} sentence${sentences === 1 ? "" : "s"}`,
      "",
      "Reading",
      ...SPEEDS.map((item) => {
        const minutes = words / item.wpm;
        const marker = item.value === speed ? " ← your selection" : "";
        return `  ${String(item.wpm).padStart(3, " ")} wpm  ${precise(minutes).padStart(10, " ")}${marker}`;
      }),
      `  ${String(SPEAKING_WPM).padStart(3, " ")} wpm  ${precise(words / SPEAKING_WPM).padStart(10, " ")}   speaking aloud`,
      "",
      `Time to read ${SCREEN_WORDS} words (one screen)`,
      ...SCREENS.map((count) => {
        const minutes = (SCREEN_WORDS * count) / selected.wpm;
        return `  ${count} screen${count === 1 ? " " : "s"}  ${precise(minutes).padStart(10, " ")}  at ${selected.wpm} wpm`;
      }),
    ];
    return lines.join("\n");
  }, [value, words, sentences, speed, selected.wpm]);

  const result = React.useMemo<TextToolResult | null>(
    () =>
      value.trim()
        ? {
            text: report,
            stats: [
              { label: "Words", value: formatNumber(words), tone: "brand" },
              { label: `@ ${selected.wpm} wpm`, value: precise(words / selected.wpm) },
              { label: "At 150 wpm", value: precise(words / 150) },
              { label: "At 250 wpm", value: precise(words / 250) },
              { label: "Speaking", value: speakingLabel(words / SPEAKING_WPM) },
              { label: "One screen", value: precise(SCREEN_WORDS / selected.wpm) },
            ],
          }
        : null,
    [value, report, words, selected.wpm],
  );

  return (
    <ToolShell>
      <TextWorkbench
        value={value}
        onChange={setValue}
        result={result}
        outputName="reading-time"
        extension="txt"
        mime="text/plain;charset=utf-8"
        inputLabel="Your text"
        outputLabel="Estimate"
        inputPlaceholder="Paste an article, a script or a chapter…"
        outputPlaceholder="Reading and speaking times appear here, at every speed."
        sample={SAMPLE}
        rows={16}
        hideDownload
        controls={
          <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5">
            <Segmented
              label="Reading speed"
              size="sm"
              value={speed}
              onChange={setSpeed}
              options={SPEEDS.map((item) => ({ value: item.value, label: item.label }))}
            />
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              One screen is taken as {SCREEN_WORDS} words of continuous prose. Times exclude images,
              diagrams and code, and the estimate does not account for re-reading.
            </p>
          </div>
        }
      />
    </ToolShell>
  );
}
