"use client";

/**
 * Resume Analyser.
 *
 * Registry line:
 *   "resume-analyser": dynamic(() => import("./text/ResumeAnalyser")),
 *
 * Two sources: a pasted/uploaded PDF or text, plus an optional job advert to
 * compare against. Everything local is measured; the optional AI critique is
 * labelled as opinion and is additive — the report is complete without it.
 */

import * as React from "react";
import {
  FileText, Sparkles, Target, TriangleAlert, Type, Upload,
} from "lucide-react";

import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Textarea, Stat } from "@/components/ui/form";
import { fetchAiStatus, runChat, type AiAvailability } from "@/components/tools/workspaces/ai/ai-client";
import { toast } from "@/lib/utils/toast";
import { extractPdfText, type TextExtractionOptions } from "@/lib/tools/engines/pdf";
import {
  analyseResumeText,
  matchJobDescription,
  type AtFinding,
  type MatchResult,
  type ResumeReport,
} from "@/lib/tools/engines/resume-analyse";

const SEVERITY_STYLE = {
  blocker: "border-brand-500/30 bg-brand-500/[0.06] text-brand-500",
  warning: "border-amber-500/30 bg-amber-500/[0.06] text-amber-500",
  note: "border-[var(--surface-line)] bg-[var(--surface-card-2)] text-[var(--text-muted)]",
} as const;

export default function ResumeAnalyserWorkspace() {
  const [text, setText] = React.useState("");
  const [job, setJob] = React.useState("");
  const [report, setReport] = React.useState<ResumeReport | null>(null);
  const [match, setMatch] = React.useState<MatchResult | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [critique, setCritique] = React.useState<string | null>(null);
  const [critiquing, setCritiquing] = React.useState(false);
  const [ai, setAi] = React.useState<AiAvailability | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let alive = true;
    void fetchAiStatus().then((status) => { if (alive) setAi(status); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /* Reads a PDF's text with the existing engine. A scanned page yields nothing,
   * and saying so clearly is the whole point — that is the "invisible resume". */
  const readPdf = React.useCallback(async (file: File) => {
    setScanning(true);
    setReport(null);
    setMatch(null);
    setCritique(null);
    try {
      /*
       * `pages` is declared required by `TextExtractionOptions` but the engine
       * treats it as optional — it reads `options.pages ?? everyIndex`. Passing
       * `[]` would be truthy and so process zero pages, returning empty text
       * and falsely reporting "this looks like a scan". The cast asks for the
       * behaviour the engine actually implements: no page list, all pages.
       */
      const options = { separator: "blank-line" } as TextExtractionOptions;
      const result = await extractPdfText(file, options);
      const combined = result.text.trim();
      if (!combined) {
        setText("");
        toast.error("No text found", "This PDF looks like a scan. An applicant tracking system will not read it either — that is worth fixing before you send it.");
        return;
      }
      setText(combined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That PDF could not be read.");
    } finally {
      setScanning(false);
    }
  }, []);

  const analyse = React.useCallback(() => {
    if (text.trim() === "") return;
    setReport(analyseResumeText(text));
    setCritique(null);
  }, [text]);

  const compare = React.useCallback(() => {
    if (text.trim() === "" || job.trim() === "") return;
    setMatch(matchJobDescription(text, job));
  }, [text, job]);

  const askAi = React.useCallback(async () => {
    if (ai?.state !== "ready" || !report) return;
    setCritiquing(true);
    try {
      const response = await runChat({
        task: "summarizer",
        prompt: text.slice(0, 12000),
        options: { tone: "direct", length: "medium", purpose: "critique of a job application" },
        extraInstructions:
          "You are a blunt but fair hiring manager. Give the three most important weaknesses in this resume and one specific fix for each. Be concrete. Do not invent facts about the candidate and do not praise.",
      });
      setCritique(response.output.trim());
    } catch {
      toast.error("The critique did not come back.");
    } finally {
      setCritiquing(false);
    }
  }, [ai, report, text]);

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        {!report ? (
          <ToolEmptyState
            icon={<Target className="size-5" />}
            title="Paste a resume, or drop in your PDF."
            description="You get a list of things an applicant tracking system looks for and cannot find, plus real measurements on your bullets. No score out of ten — see the note below for why."
          />
        ) : null}

        {/* ---- input ---- */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readPdf(file);
              event.target.value = "";
            }}
          />
          <Button variant="secondary" onClick={() => inputRef.current?.click()} loading={scanning}>
            <Upload className="mr-1.5 inline size-4" aria-hidden="true" />
            Read a PDF
          </Button>
          <Button variant="ghost" onClick={() => { setText(""); setReport(null); setMatch(null); setCritique(null); }}>
            Clear
          </Button>
          {text ? <span className="text-xs text-[var(--text-muted)]">{text.length.toLocaleString()} characters loaded</span> : null}
        </div>

        <Field label="Resume text" hint="Pasted directly, or extracted from a PDF above. A scanned image yields no text, which is itself a finding.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={10}
              value={text}
              onChange={(event) => { setText(event.target.value); setReport(null); }}
              placeholder="Paste your resume, or load the PDF above."
              className="font-mono text-[13px]"
            />
          )}
        </Field>

        <Button variant="primary" onClick={analyse} disabled={text.trim() === ""}>
          <FileText className="mr-1.5 inline size-4" aria-hidden="true" />
          Analyse
        </Button>

        {/* ---- results ---- */}
        {report ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">What was measured</p>
              <p className="mt-1.5 text-[15px] text-[var(--text-ink)]">{report.summary}</p>
            </div>

            {/* numbers */}
            <div>
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-ink)]">
                <Type className="size-3.5" aria-hidden="true" /> Measurements
              </h3>
              <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Words" value={report.text.words.toLocaleString()} />
                <Stat label="Sentences" value={report.text.sentences.toLocaleString()} hint={`avg ${report.text.averageSentenceLength} words`} />
                <Stat label="Reading ease" value={`${report.text.readingEase}`} hint="Flesch, 0–100 — an estimate" />
                <Stat label="Grade level" value={`${report.text.gradeLevel}`} hint="approximate" />
              </dl>
            </div>

            {/* bullets */}
            {report.bullets.total > 0 ? (
              <div>
                <h3 className="text-[13px] font-semibold text-[var(--text-ink)]">Bullets</h3>
                <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Total" value={String(report.bullets.total)} />
                  <Stat label="With a number" value={`${report.bullets.quantified}/${report.bullets.total}`} tone={report.bullets.quantified / report.bullets.total >= 0.4 ? "success" : "default"} />
                  <Stat label="Open with a verb" value={String(report.bullets.strong)} />
                  <Stat label="Over 160 characters" value={String(report.bullets.overLongCount)} />
                </dl>
              </div>
            ) : null}

            {/* ATS */}
            <div>
              <h3 className="text-[13px] font-semibold text-[var(--text-ink)]">
                What an applicant tracking system looks for
              </h3>
              {report.ats.findings.length === 0 ? (
                <Notice tone="success" icon={<FileText className="size-4" />}>
                  Nothing structural missing — the common fields and headings are all present.
                </Notice>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  {report.ats.findings.map((finding: AtFinding) => (
                    <div key={finding.id} className={`rounded-xl border px-3.5 py-3 text-[13px] ${SEVERITY_STYLE[finding.severity]}`}>
                      <p className="font-medium">{finding.title}</p>
                      <p className="mt-0.5 leading-relaxed opacity-90">{finding.detail}</p>
                      {finding.action ? <p className="mt-1 leading-relaxed opacity-80">Fix: {finding.action}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI */}
            {ai?.state === "ready" ? (
              <div>
                <Button variant="secondary" loading={critiquing} onClick={() => void askAi()}>
                  <Sparkles className="mr-1.5 inline size-4" aria-hidden="true" />
                  Get a written critique
                </Button>
                {critique ? (
                  <div className="mt-2 whitespace-pre-wrap rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3.5 text-[13px] leading-relaxed text-[var(--text-ink)]">
                    {critique}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ---- job match ---- */}
        <div className="rounded-[14px] border border-[var(--surface-line)] bg-[var(--surface-card)] p-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--text-ink)]">
            <Target className="size-3.5" aria-hidden="true" /> Compare with a job advert
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Bag-of-words overlap only — it does not read for meaning, so treat the number as a rough signal, not a verdict.
          </p>
          <div className="mt-3">
            <Field label="Job description">
              {({ id }) => (
                <Textarea id={id} rows={6} value={job} onChange={(event) => { setJob(event.target.value); setMatch(null); }} placeholder="Paste the job advert." className="font-mono text-[13px]" />
              )}
            </Field>
          </div>
          <Button className="mt-2" variant="secondary" onClick={compare} disabled={text.trim() === "" || job.trim() === ""}>
            Compare
          </Button>
          {match ? (
            <div className="mt-3">
              <Stat label="Advert terms present" value={`${match.covered}/${match.total}`} hint={`${match.matchPercent}% overlap`} tone={match.matchPercent >= 60 ? "success" : "default"} />
              {match.missing.length > 0 ? (
                <div className="mt-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">Missing from your resume</p>
                  <p className="mt-1 font-mono text-xs text-[var(--text-ink)]">{match.missing.slice(0, 40).join(", ")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <Notice tone="warning" icon={<TriangleAlert className="size-4" />}>
          There is no overall score here on purpose. A single number is a weighted opinion presented as a
          measurement, and people act on it — so instead you get specific findings you can check, and
          figures that came from counting your own text. Add a term the advert never mentioned and this will
          praise the resume; that is what bag-of-words matching does.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}