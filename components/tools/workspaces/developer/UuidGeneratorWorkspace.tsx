"use client";

import * as React from "react";
import { Copy, Dices, Trash2 } from "lucide-react";
import { ToolShell } from "@/components/tools/ToolShell";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Segmented, Select, Stat } from "@/components/ui/form";
import { CopyButton, DownloadButton } from "@/components/tools/DownloadButton";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { toast } from "@/lib/utils/toast";
import { formatNumber } from "@/lib/utils/format";
import {
  MAX_UUIDS,
  generateUuids,
  uuidsToCsv,
  type UuidOptions,
  type UuidVersion,
} from "@/lib/tools/engines/dev";

const COUNTS = ["1", "5", "10", "25", "50", "100", "250", "500", "1000"];

export default function UuidGeneratorWorkspace() {
  const [count, setCount] = React.useState(10);
  const [version, setVersion] = React.useState<UuidVersion>("4");
  const [uppercase, setUppercase] = React.useState(false);
  const [hyphens, setHyphens] = React.useState(true);
  const [uuids, setUuids] = React.useState<string[]>([]);

  const generate = React.useCallback(() => {
    const options: UuidOptions = { version, uppercase, hyphens };
    setUuids(generateUuids(count, options));
  }, [count, version, uppercase, hyphens]);

  React.useEffect(() => {
    generate();
  }, [generate]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      generate();
    }
  };

  const text = uuids.join("\n");
  const first = uuids[0] ?? "";

  return (
    <ToolShell>
      <div
        className="flex flex-col gap-4"
        onKeyDown={onKeyDown}
        role="group"
        aria-label="UUID generator"
      >
        <div className="grid gap-3 rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3 sm:grid-cols-3">
          <Field label="How many" hint={`Between 1 and ${MAX_UUIDS.toLocaleString("en")}.`}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={String(count)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setCount(next);
                }}
              >
                {COUNTS.map((entry) => (
                  <option key={entry} value={entry}>
                    {Number(entry).toLocaleString("en")}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Version" hint={version === "4" ? "Random, from crypto.randomUUID()." : "Unix-millisecond prefix, so it sorts by time."}>
            {({ id, describedBy }) => (
              <Segmented
                label="Version"
                value={version}
                onChange={setVersion}
                options={[
                  { value: "4", label: "v4 random", title: "122 random bits. The safe default." },
                  { value: "7", label: "v7 ordered", title: "A 48-bit millisecond prefix plus 74 random bits (RFC 9562)" },
                ]}
              />
            )}
          </Field>

          <div className="flex flex-col justify-center gap-2">
            <Checkbox
              label="Uppercase"
              checked={uppercase}
              onChange={(event) => setUppercase(event.target.checked)}
            />
            <Checkbox
              label="Keep hyphens"
              description="Unchecked gives 32 bare hex characters."
              checked={hyphens}
              onChange={(event) => setHyphens(event.target.checked)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={generate}>
            <Dices aria-hidden="true" className="size-4" />
            Generate {formatNumber(count)}
          </Button>
          <span className="text-[11px] text-[var(--text-muted)]">
            or press{" "}
            <kbd className="rounded border border-[var(--surface-line-strong)] bg-[var(--surface-card-2)] px-1 py-0.5 font-mono text-[10px]">
              Ctrl + Enter
            </kbd>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <CopyButton value={text || null} what={`${uuids.length} UUIDs copied`} size="sm" variant="secondary" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setUuids([]);
                toast.info("Cleared — press Generate for a new batch");
              }}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              Clear
            </Button>
          </div>
        </div>

        {uuids.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)]">
            <ToolEmptyState
              title="Click Generate to get started."
              description={`Produces ${formatNumber(count)} identifiers in this tab, from the browser's cryptographic random source.`}
            />
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Generated" value={formatNumber(uuids.length)} tone="brand" />
              <Stat label="Unique" value={formatNumber(new Set(uuids).size)} />
              <Stat label="Version" value={version === "4" ? "uuid v4" : "uuid v7"} />
              <Stat label="Characters" value={formatNumber(first.length)} hint="per identifier" />
            </dl>

            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--text-ink)]">Output</span>
                <span className="font-mono text-[11px] text-[var(--text-muted)]">{first}</span>
              </div>
              <ul
                className="max-h-[28rem] overflow-auto rounded-[10px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-2"
                aria-label={`${uuids.length} generated UUIDs`}
              >
                {uuids.map((uuid, index) => (
                  <li
                    key={`${uuid}-${index}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-[var(--surface-line)]"
                  >
                    <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                      {index + 1}
                    </span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text-ink)]">
                      {uuid}
                    </code>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Copy UUID ${index + 1}`}
                      onClick={() => void toast.copy(uuid, "UUID copied")}
                    >
                      <Copy aria-hidden="true" className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <DownloadButton
                text={text}
                filename="uuids.txt"
                mime="text/plain;charset=utf-8"
                label="Download .txt"
                size="sm"
                variant="secondary"
              />
              <DownloadButton
                text={uuidsToCsv(uuids)}
                filename="uuids.csv"
                mime="text/csv;charset=utf-8"
                label="Download .csv"
                size="sm"
                variant="secondary"
              />
            </div>

            <Notice tone="success" icon={<ShieldCheck className="size-4" />} title="Where the randomness comes from.">
              {version === "4"
                ? "crypto.randomUUID() draws from the platform CSPRNG — the same source your browser uses for TLS keys. Nothing here is seeded, derived from the clock, or guessable from a previous value."
                : "A 48-bit big-endian millisecond timestamp followed by 74 random bits from crypto.getRandomValues, with the version and variant bits set exactly as RFC 9562 specifies. It is still unguessable; the timestamp just makes keys sort in creation order, which is good for a database primary key."}
            </Notice>
          </>
        )}
      </div>
    </ToolShell>
  );
}
