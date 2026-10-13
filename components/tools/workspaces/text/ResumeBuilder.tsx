"use client";

/**
 * Resume Builder.
 *
 * Registry line:
 *   "resume-builder": dynamic(() => import("./text/ResumeBuilder")),
 *
 * Everything except the optional AI helpers runs offline: the form is React
 * state, the preview is the same document model, and the PDF is generated in the
 * tab with pdf-lib. The AI buttons are an addition to a tool that already works
 * without them, so a deployment with no provider configured still gets a
 * complete resume builder rather than a dead page.
 */

import * as React from "react";
import {
  Download, FileText, Plus, Sparkles, Trash2, TriangleAlert, Wand2, X,
} from "lucide-react";

import { ToolShell, PrivacyNote } from "@/components/tools/ToolShell";
import { Notice, ToolEmptyState } from "@/components/tools/states";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Textarea } from "@/components/ui/form";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { toast } from "@/lib/utils/toast";
import { fetchAiStatus, runChat, type AiAvailability } from "@/components/tools/workspaces/ai/ai-client";
import {
  clearResumeDraft,
  emptyResume,
  loadResumeDraft,
  makeId,
  renderResumePdf,
  resumeToPlainText,
  saveResumeDraft,
  validateResume,
  type RenderOptions,
  type ResumeDocument,
} from "@/lib/tools/engines/resume";
import type { AiOptions } from "@/lib/ai/schemas";

const ACCENTS: { value: RenderOptions["accent"]; label: string }[] = [
  { value: "brand", label: "Red" },
  { value: "slate", label: "Slate" },
  { value: "forest", label: "Forest" },
];

export default function ResumeBuilderWorkspace() {
  const [resume, setResume] = React.useState<ResumeDocument>(emptyResume);
  const [ready, setReady] = React.useState(false);
  const [pageSize, setPageSize] = React.useState<"a4" | "letter">("a4");
  const [accent, setAccent] = React.useState<RenderOptions["accent"]>("brand");
  const [pdf, setPdf] = React.useState<{ blob: Blob; name: string; pages: number } | null>(null);
  const [building, setBuilding] = React.useState(false);
  const [ai, setAi] = React.useState<AiAvailability | null>(null);
  const [rewriting, setRewriting] = React.useState(false);
  const [openSection, setOpenSection] = React.useState<"contact" | "summary" | "experience" | "education" | "projects" | "skills">("contact");

  /* Draft restore happens after mount so the server-rendered HTML and the first
   * client render agree — reading localStorage during render would be a
   * hydration mismatch, and a resume silently reappearing is not worth it. */
  React.useEffect(() => {
    const draft = loadResumeDraft();
    if (draft) setResume(draft);
    setReady(true);
  }, []);

  React.useEffect(() => {
    if (ready) saveResumeDraft(resume);
  }, [resume, ready]);

  React.useEffect(() => {
    let alive = true;
    void fetchAiStatus().then((status) => { if (alive) setAi(status); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const patchContact = React.useCallback(<K extends keyof ResumeDocument["contact"]>(key: K, value: ResumeDocument["contact"][K]) => {
    setResume((prev) => ({ ...prev, contact: { ...prev.contact, [key]: value } }));
    setPdf(null);
  }, []);

  const issues = React.useMemo(() => validateResume(resume), [resume]);
  const blocking = issues.filter((issue) => issue.fatal);

  const plainText = React.useMemo(() => resumeToPlainText(resume), [resume]);
  const isEmpty = plainText.trim().length === 0;

  /* ---- PDF export ---- */
  const buildPdf = React.useCallback(async () => {
    setBuilding(true);
    try {
      const pdfLib = await import("pdf-lib");
      const bytes = await renderResumePdf(pdfLib, resume, { pageSize, accent });
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const name = `${resume.contact.fullName.trim().replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "resume"}.pdf`;
      setPdf({ blob, name, pages: countPages(bytes) });
      toast.success("PDF ready", "Generated in your browser — nothing was uploaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The PDF could not be built.");
    } finally {
      setBuilding(false);
    }
  }, [resume, pageSize, accent]);

  /* ---- AI: rewrite a bullet ---- */
  const rewriteBullet = React.useCallback(async (experienceId: string, index: number, original: string) => {
    if (ai?.state !== "ready" || original.trim() === "") return;
    setRewriting(true);
    try {
      const options: AiOptions = {
        tone: "confident",
        length: "short",
        format: "bullet-list",
        purpose: "a resume achievement bullet",
        instructions: "Keep every fact. Do not invent employers, dates or numbers.",
      };
      const response = await runChat({
        task: "rewriter",
        prompt: original,
        options,
        extraInstructions:
          "Rewrite this resume bullet. Start with a past-tense action verb. Keep every fact the original states and invent nothing. If it contains no measurable result, say so in one short sentence rather than inventing one. Return only the rewritten bullet.",
      });
      const improved = response.output.trim().split("\n")[0]?.trim() ?? "";
      if (!improved) throw new Error("empty");
      setResume((prev) => ({
        ...prev,
        experience: prev.experience.map((entry) =>
          entry.id !== experienceId
            ? entry
            : { ...entry, bullets: entry.bullets.map((bullet, i) => (i === index ? improved : bullet)) },
        ),
      }));
      setPdf(null);
      toast.success("Bullet rewritten", "Check it still says only what you know to be true.");
    } catch {
      toast.error("The rewrite did not come back. Try again in a moment.");
    } finally {
      setRewriting(false);
    }
  }, [ai]);

  const writeSummary = React.useCallback(async () => {
    if (ai?.state !== "ready") return;
    setRewriting(true);
    try {
      const response = await runChat({
        task: "summarizer",
        prompt: plainText,
        options: { tone: "formal", length: "short", purpose: "a professional summary for a resume" },
        extraInstructions:
          "Write a three-sentence professional summary from this resume. Use only what is stated. Do not invent employers, dates, skills or achievements.",
      });
      const text = response.output.trim();
      if (!text) throw new Error("empty");
      setResume((prev) => ({ ...prev, summary: text }));
      setPdf(null);
      toast.success("Summary written");
    } catch {
      toast.error("The summary did not come back. Try again in a moment.");
    } finally {
      setRewriting(false);
    }
  }, [ai, plainText]);

  const updateExperience = (id: string, patch: Partial<ResumeDocument["experience"][number]>) =>
    setResume((prev) => ({ ...prev, experience: prev.experience.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const updateEducation = (id: string, patch: Partial<ResumeDocument["education"][number]>) =>
    setResume((prev) => ({ ...prev, education: prev.education.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  return (
    <ToolShell>
      <div className="flex flex-col gap-5">
        {isEmpty ? (
          <ToolEmptyState
            icon={<FileText className="size-5" />}
            title="Start with your name."
            description="Build a resume here and export it as a real, selectable-text PDF. Your draft is saved in this browser only and never uploaded."
          />
        ) : null}

        {/* ---- style controls ---- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Page size" hint="A4 outside North America, Letter in it.">
            {() => (
              <Segmented
                label="Page size"
                value={pageSize}
                onChange={(value) => { setPageSize(value as "a4" | "letter"); setPdf(null); }}
                options={[{ value: "a4", label: "A4" }, { value: "letter", label: "Letter" }]}
              />
            )}
          </Field>
          <Field label="Accent colour">
            {() => (
              <div className="flex gap-2">
                {ACCENTS.map((entry) => (
                  <Button
                    key={entry.value}
                    size="sm"
                    variant={accent === entry.value ? "primary" : "secondary"}
                    onClick={() => { setAccent(entry.value); setPdf(null); }}
                  >
                    {entry.label}
                  </Button>
                ))}
              </div>
            )}
          </Field>
        </div>

        {/* ---- contact ---- */}
        <Section title="Contact" open={openSection === "contact"} onToggle={() => setOpenSection(openSection === "contact" ? "summary" : "contact")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              {({ id }) => <Input id={id} value={resume.contact.fullName} onChange={(e) => patchContact("fullName", e.target.value)} placeholder="Alex Morgan" />}
            </Field>
            <Field label="Job title" hint="The line under your name.">
              {({ id }) => <Input id={id} value={resume.contact.title} onChange={(e) => patchContact("title", e.target.value)} placeholder="Backend Engineer" />}
            </Field>
            <Field label="Email" hint="Plain text — not an image or an icon, which a parser cannot read.">
              {({ id }) => <Input id={id} type="email" value={resume.contact.email} onChange={(e) => patchContact("email", e.target.value)} placeholder="you@example.com" />}
            </Field>
            <Field label="Phone">
              {({ id }) => <Input id={id} value={resume.contact.phone} onChange={(e) => patchContact("phone", e.target.value)} placeholder="+44 7700 900123" />}
            </Field>
            <Field label="Location">
              {({ id }) => <Input id={id} value={resume.contact.location} onChange={(e) => patchContact("location", e.target.value)} placeholder="Manchester, UK" />}
            </Field>
            <Field label="Website or portfolio">
              {({ id }) => <Input id={id} value={resume.contact.website} onChange={(e) => patchContact("website", e.target.value)} placeholder="example.com" />}
            </Field>
          </div>
        </Section>

        {/* ---- summary ---- */}
        <Section title="Summary" open={openSection === "summary"} onToggle={() => setOpenSection(openSection === "summary" ? "experience" : "summary")}>
          {ai?.state === "ready" ? (
            <div className="mb-2">
              <Button size="sm" variant="secondary" loading={rewriting} onClick={() => void writeSummary()}>
                <Wand2 className="mr-1.5 inline size-3.5" aria-hidden="true" />
                Write a summary from what is here
              </Button>
            </div>
          ) : null}
          <Textarea
            aria-label="Summary"
            rows={4}
            value={resume.summary}
            onChange={(e) => { setResume((p) => ({ ...p, summary: e.target.value })); setPdf(null); }}
            placeholder="Two or three lines on what you do and what you are good at."
          />
        </Section>

        {/* ---- experience ---- */}
        <Section
          title={`Experience (${resume.experience.length})`}
          open={openSection === "experience"}
          onToggle={() => setOpenSection(openSection === "experience" ? "education" : "experience")}
          action={
            <Button size="sm" variant="secondary" onClick={() => {
              setResume((p) => ({ ...p, experience: [...p.experience, { id: makeId("exp"), role: "", company: "", location: "", start: "", end: "", bullets: [""] }] }));
              setPdf(null);
            }}
            >
              <Plus className="mr-1 inline size-3.5" aria-hidden="true" /> Add role
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            {resume.experience.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <Field label="Role">
                      {({ id }) => <Input id={id} value={entry.role} onChange={(e) => { updateExperience(entry.id, { role: e.target.value }); setPdf(null); }} />}
                    </Field>
                    <Field label="Company">
                      {({ id }) => <Input id={id} value={entry.company} onChange={(e) => { updateExperience(entry.id, { company: e.target.value }); setPdf(null); }} />}
                    </Field>
                    <Field label="From">
                      {({ id }) => <Input id={id} value={entry.start} onChange={(e) => { updateExperience(entry.id, { start: e.target.value }); setPdf(null); }} placeholder="2022" />}
                    </Field>
                    <Field label="To" hint="Leave blank for Present.">
                      {({ id }) => <Input id={id} value={entry.end} onChange={(e) => { updateExperience(entry.id, { end: e.target.value }); setPdf(null); }} placeholder="Present" />}
                    </Field>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove this role"
                    onClick={() => { setResume((p) => ({ ...p, experience: p.experience.filter((e) => e.id !== entry.id) })); setPdf(null); }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">Achievements</p>
                  {entry.bullets.map((bullet, index) => (
                    <div key={index} className="flex items-start gap-1.5">
                      <Input
                        aria-label={`Achievement ${index + 1}`}
                        value={bullet}
                        onChange={(e) => {
                          const next = [...entry.bullets];
                          next[index] = e.target.value;
                          updateExperience(entry.id, { bullets: next });
                          setPdf(null);
                        }}
                        placeholder="Cut build time by 40% by switching to incremental caching"
                      />
                      {ai?.state === "ready" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Rewrite this bullet"
                          disabled={rewriting || bullet.trim() === ""}
                          onClick={() => void rewriteBullet(entry.id, index, bullet)}
                        >
                          <Sparkles className="size-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" className="w-fit" onClick={() => { updateExperience(entry.id, { bullets: [...entry.bullets, ""] }); setPdf(null); }}>
                    <Plus className="mr-1 inline size-3" aria-hidden="true" /> Add bullet
                  </Button>
                </div>
              </div>
            ))}
            {resume.experience.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No roles yet.</p>
            ) : null}
          </div>
        </Section>

        {/* ---- education ---- */}
        <Section
          title={`Education (${resume.education.length})`}
          open={openSection === "education"}
          onToggle={() => setOpenSection(openSection === "education" ? "projects" : "education")}
          action={
            <Button size="sm" variant="secondary" onClick={() => {
              setResume((p) => ({ ...p, education: [...p.education, { id: makeId("edu"), qualification: "", institution: "", start: "", end: "", detail: "" }] }));
              setPdf(null);
            }}
            >
              <Plus className="mr-1 inline size-3.5" aria-hidden="true" /> Add
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            {resume.education.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2">
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  <Field label="Qualification">
                    {({ id }) => <Input id={id} value={entry.qualification} onChange={(e) => { updateEducation(entry.id, { qualification: e.target.value }); setPdf(null); }} placeholder="BSc Computer Science" />}
                  </Field>
                  <Field label="Institution">
                    {({ id }) => <Input id={id} value={entry.institution} onChange={(e) => { updateEducation(entry.id, { institution: e.target.value }); setPdf(null); }} />}
                  </Field>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove this entry"
                  onClick={() => { setResume((p) => ({ ...p, education: p.education.filter((e) => e.id !== entry.id) })); setPdf(null); }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        </Section>

        {/* ---- projects ---- */}
        <Section
          title={`Projects (${resume.projects.length})`}
          open={openSection === "projects"}
          onToggle={() => setOpenSection(openSection === "projects" ? "skills" : "projects")}
          action={
            <Button size="sm" variant="secondary" onClick={() => {
              setResume((p) => ({ ...p, projects: [...p.projects, { id: makeId("prj"), name: "", link: "", description: "", bullets: [] }] }));
              setPdf(null);
            }}
            >
              <Plus className="mr-1 inline size-3.5" aria-hidden="true" /> Add
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            {resume.projects.map((entry) => (
              <div key={entry.id} className="grid gap-2 sm:grid-cols-2">
                <Field label="Name">
                  {({ id }) => <Input id={id} value={entry.name} onChange={(e) => { setResume((p) => ({ ...p, projects: p.projects.map((x) => x.id === entry.id ? { ...x, name: e.target.value } : x) })); setPdf(null); }} />}
                </Field>
                <Field label="Link">
                  {({ id }) => <Input id={id} value={entry.link} onChange={(e) => { setResume((p) => ({ ...p, projects: p.projects.map((x) => x.id === entry.id ? { ...x, link: e.target.value } : x) })); setPdf(null); }} />}
                </Field>
                <div className="sm:col-span-2">
                  <Button size="sm" variant="ghost" onClick={() => { setResume((p) => ({ ...p, projects: p.projects.filter((x) => x.id !== entry.id) })); setPdf(null); }}>
                    <X className="mr-1 inline size-3" aria-hidden="true" /> Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---- skills ---- */}
        <Section
          title={`Skills (${resume.skills.length})`}
          open={openSection === "skills"}
          onToggle={() => setOpenSection(openSection === "skills" ? "contact" : "skills")}
          action={
            <Button size="sm" variant="secondary" onClick={() => {
              setResume((p) => ({ ...p, skills: [...p.skills, { id: makeId("skl"), heading: "", skills: "" }] }));
              setPdf(null);
            }}
            >
              <Plus className="mr-1 inline size-3.5" aria-hidden="true" /> Add group
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            {resume.skills.map((group) => (
              <div key={group.id} className="grid gap-2 sm:grid-cols-3">
                <Field label="Heading">
                  {({ id }) => <Input id={id} value={group.heading} onChange={(e) => { setResume((p) => ({ ...p, skills: p.skills.map((x) => x.id === group.id ? { ...x, heading: e.target.value } : x) })); setPdf(null); }} placeholder="Languages" />}
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Skills" hint="Comma separated.">
                    {({ id }) => <Input id={id} value={group.skills} onChange={(e) => { setResume((p) => ({ ...p, skills: p.skills.map((x) => x.id === group.id ? { ...x, skills: e.target.value } : x) })); setPdf(null); }} placeholder="TypeScript, Go, PostgreSQL" />}
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ---- export ---- */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card-2)] p-3">
          <Button variant="primary" onClick={() => void buildPdf()} loading={building} disabled={blocking.length > 0 || isEmpty}>
            <Download className="mr-1.5 inline size-4" aria-hidden="true" />
            Build PDF
          </Button>
          {pdf ? (
            <>
              <DownloadButton blob={pdf.blob} filename={pdf.name} label="Download" mime="application/pdf" />
              <span className="text-xs text-[var(--text-muted)]">
                {pdf.pages} page{pdf.pages === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => { setResume(emptyResume()); setPdf(null); clearResumeDraft(); }}
          >
            Start over
          </Button>
        </div>

        {issues.length > 0 ? (
          <Notice tone={blocking.length > 0 ? "warning" : "info"} icon={<TriangleAlert className="size-4" />}>
            <ul className="flex flex-col gap-1">
              {issues.map((issue) => (
                <li key={issue.field + issue.message}>{issue.message}</li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {ai?.state === "unavailable" ? (
          <Notice tone="info" icon={<Sparkles className="size-4" />}>
            {ai.reason} Everything else on this page — the form, the draft, and the PDF export — works without it.
          </Notice>
        ) : null}

        <Notice tone="info" icon={<FileText className="size-4" />}>
          The PDF contains real selectable text, not a picture of one. That matters: applicant tracking
          systems read the text layer, and a scanned resume is silently discarded by most of them.
        </Notice>

        <PrivacyNote mode="local" detailed />
      </div>
    </ToolShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Local bits                                                                */
/* -------------------------------------------------------------------------- */

function Section({
  title, open, onToggle, action, children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-card)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex-1 text-left text-[13px] font-semibold text-[var(--text-ink)]"
        >
          {open ? "▾" : "▸"} {title}
        </button>
        {action}
      </div>
      {open ? <div className="border-t border-[var(--surface-line)] px-3 py-3">{children}</div> : null}
    </div>
  );
}

/**
 * Page count from the generated PDF.
 *
 * Read from the real object rather than estimated from the layout: pdf-lib
 * gives back the bytes, and the `/Type /Page` count is the honest number. A
 * guess here would be exactly the kind of invented figure this repo avoids.
 */
function countPages(bytes: Uint8Array): number {
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}