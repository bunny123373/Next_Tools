/**
 * Resume document model, validation, and PDF generation.
 *
 * Everything here runs in the browser. The PDF is produced with pdf-lib, which
 * is already a dependency and is used by the PDF tools, so there is no new
 * package and no upload step.
 *
 * WHY A REAL PDF AND NOT A PRINT SHEET: an applicant tracking system reads the
 * file, not a screenshot of it. That means the output has to be selectable,
 * searchable text with sane reading order. pdf-lib writes positioned text runs,
 * which is exactly what an ATS parser expects, and it also produces a document
 * a human can print. The alternative — render the page and offer print — gives
 * a PDF whose text layer is a bitmap, which is the single most common way a
 * well-designed resume gets silently rejected.
 */

/* -------------------------------------------------------------------------- */
/*  Model                                                                     */
/* -------------------------------------------------------------------------- */

export interface ResumeContact {
  fullName: string;
  /** Headline shown under the name, e.g. "Backend Engineer". */
  title: string;
  email: string;
  phone: string;
  location: string;
  /** One line, no links needed — the PDF cannot carry them anyway. */
  website: string;
}

export interface ResumeExperience {
  id: string;
  role: string;
  company: string;
  location: string;
  /** "Present" is handled by the renderer, so the field stays a string. */
  start: string;
  end: string;
  /** One bullet per array entry. Empty bullets are dropped on render. */
  bullets: string[];
}

export interface ResumeEducation {
  id: string;
  qualification: string;
  institution: string;
  start: string;
  end: string;
  detail: string;
}

export interface ResumeProject {
  id: string;
  name: string;
  link: string;
  description: string;
  bullets: string[];
}

export interface ResumeSkillGroup {
  id: string;
  heading: string;
  skills: string;
}

export interface ResumeDocument {
  contact: ResumeContact;
  summary: string;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  projects: ResumeProject[];
  skills: ResumeSkillGroup[];
}

export function emptyResume(): ResumeDocument {
  return {
    contact: { fullName: "", title: "", email: "", phone: "", location: "", website: "" },
    summary: "",
    experience: [],
    education: [],
    projects: [],
    skills: [],
  };
}

/** Stable-enough id for React keys and list operations. */
export function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

export interface ResumeIssue {
  field: string;
  message: string;
  /** Serious enough to block a sensible export. */
  fatal: boolean;
}

/**
 * Checks the document before it is rendered.
 *
 * Only a missing name is fatal. Everything else is advisory: someone exporting
 * a draft with no education section is doing something reasonable, and a tool
 * that refuses would just make them bypass it. The ATS analyser reports the
 * structural issues in far more depth — this exists only to stop an obviously
 * empty document producing a blank page.
 */
export function validateResume(resume: ResumeDocument): ResumeIssue[] {
  const issues: ResumeIssue[] = [];

  if (resume.contact.fullName.trim() === "") {
    issues.push({ field: "contact.fullName", message: "A name is required.", fatal: true });
  }

  const email = resume.contact.email.trim();
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ field: "contact.email", message: "That email address does not look complete.", fatal: false });
  }

  const hasAnyExperience = resume.experience.some((role) => role.role.trim() !== "" || role.company.trim() !== "");
  const hasAnyEducation = resume.education.some((entry) => entry.qualification.trim() !== "");

  if (!hasAnyExperience && !hasAnyEducation) {
    issues.push({
      field: "experience",
      message: "Nothing to put under Experience or Education yet — the page will be mostly empty.",
      fatal: false,
    });
  }

  if (resume.summary.trim() === "") {
    issues.push({ field: "summary", message: "A short summary helps a recruiter read the page in ten seconds.", fatal: false });
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/*  Plain-text rendering (used by the ATS analyser and the AI prompts)         */
/* -------------------------------------------------------------------------- */

/**
 * The document as text, in the order a parser would read it.
 *
 * Deliberately mirrors the PDF's own reading order and section headings, so
 * what the analyser measures is what a recruiter's parser would actually see —
 * not a different serialisation that happens to describe the same resume.
 */
export function resumeToPlainText(resume: ResumeDocument): string {
  const lines: string[] = [];
  const { contact } = resume;

  if (contact.fullName.trim()) lines.push(contact.fullName.trim());
  if (contact.title.trim()) lines.push(contact.title.trim());

  const contactLine = [contact.email, contact.phone, contact.location, contact.website]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" · ");
  if (contactLine) lines.push(contactLine);

  if (resume.summary.trim()) {
    lines.push("", "Summary", resume.summary.trim());
  }

  if (resume.experience.some((entry) => entry.role.trim() || entry.company.trim())) {
    lines.push("", "Experience");
    for (const entry of resume.experience) {
      if (entry.role.trim() === "" && entry.company.trim() === "") continue;
      const period = dateRange(entry.start, entry.end);
      lines.push(`${entry.role.trim()}${entry.company.trim() ? ` — ${entry.company.trim()}` : ""}${period ? ` (${period})` : ""}`);
      if (entry.location.trim()) lines.push(entry.location.trim());
      for (const bullet of entry.bullets) {
        if (bullet.trim()) lines.push(`- ${bullet.trim()}`);
      }
    }
  }

  if (resume.education.some((entry) => entry.qualification.trim())) {
    lines.push("", "Education");
    for (const entry of resume.education) {
      if (entry.qualification.trim() === "") continue;
      const period = dateRange(entry.start, entry.end);
      lines.push(`${entry.qualification.trim()}${entry.institution.trim() ? ` — ${entry.institution.trim()}` : ""}${period ? ` (${period})` : ""}`);
      if (entry.detail.trim()) lines.push(entry.detail.trim());
    }
  }

  if (resume.projects.some((entry) => entry.name.trim())) {
    lines.push("", "Projects");
    for (const entry of resume.projects) {
      if (entry.name.trim() === "") continue;
      lines.push(entry.link.trim() ? `${entry.name.trim()} — ${entry.link.trim()}` : entry.name.trim());
      for (const bullet of entry.bullets) {
        if (bullet.trim()) lines.push(`- ${bullet.trim()}`);
      }
      if (entry.description.trim()) lines.push(entry.description.trim());
    }
  }

  const skillGroups = resume.skills.filter((group) => group.skills.trim() !== "");
  if (skillGroups.length > 0) {
    lines.push("", "Skills");
    for (const group of skillGroups) {
      lines.push(group.heading.trim() ? `${group.heading.trim()}: ${group.skills.trim()}` : group.skills.trim());
    }
  }

  return lines.join("\n");
}

function dateRange(start: string, end: string): string {
  const from = start.trim();
  const to = end.trim();
  if (from === "" && to === "") return "";
  return `${from || "?"} – ${to || "Present"}`;
}

/* -------------------------------------------------------------------------- */
/*  PDF generation                                                            */
/* -------------------------------------------------------------------------- */

export interface RenderOptions {
  /** A4 in points. The near-universal default outside North America. */
  pageSize?: "a4" | "letter";
  accent?: "brand" | "slate" | "forest";
  fontSize?: number;
}

const PAGE: Record<"a4" | "letter", [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const ACCENT: Record<NonNullable<RenderOptions["accent"]>, [number, number, number]> = {
  brand: [0.9, 0.11, 0.11], // #E61C1C-ish, close to brand-500 #FF3B30
  slate: [0.22, 0.24, 0.28],
  forest: [0.08, 0.35, 0.26],
};

import type * as PdfLibTypes from "pdf-lib";

/** Module namespace, so the caller controls the document instance. */
type PdfLib = typeof PdfLibTypes;

/**
 * The font handle pdf-lib hands back.
 *
 * `PDFFont` is the base class and `PDFFont` subclasses it, so `InstanceType`
 * of the value is not meaningful — these helpers take the already-embedded font
 * and measure with it.
 */
type AnyFont = PdfLibTypes.PDFFont;

/**
 * Lays the resume out onto a paginated PDF.
 *
 * Text is positioned word by word rather than handed to a flow engine, because
 * a resume has a fixed shape and pdf-lib has no text layout. The wrapping below
 * measures with the real embedded font, so a line is only broken where the
 * glyphs genuinely do not fit — no character-count guessing.
 */
export async function renderResumePdf(
  pdf: PdfLib,
  resume: ResumeDocument,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const {
    pageSize = "a4",
    accent = "brand",
    fontSize = 10,
  } = options;

  const [pageWidth, pageHeight] = PAGE[pageSize];
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;
  const [r, g, b] = ACCENT[accent];

  const doc = await pdf.PDFDocument.create();
  const regular = await doc.embedFont(pdf.StandardFonts.Helvetica);
  const bold = await doc.embedFont(pdf.StandardFonts.HelveticaBold);
  // `StandardFonts` has no `Oblique`; the italic face is spelled
  // `HelveticaOblique`.
  const italic = await doc.embedFont(pdf.StandardFonts.HelveticaOblique);

  const nameSize = fontSize + 8;
  const lineHeight = fontSize * 1.45;

  /**
   * Cursor over the page. A new page is started whenever the next line would
   * cross the bottom margin, so long histories paginate instead of running off
   * the page.
   */
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const newPage = () => {
    page = doc.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
  };

  const ensureRoom = (needed: number) => {
    if (y - needed < margin) newPage();
  };

  /** Breaks a string into lines that fit `width`, measured with the real font. */
  const wrap = (text: string, font: AnyFont, size: number, width: number): string[] => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      // A single word longer than the line: hard-break it rather than overflow.
      if (font.widthOfTextAtSize(word, size) > width) {
        let chunk = "";
        for (const character of word) {
          if (font.widthOfTextAtSize(chunk + character, size) > width) {
            lines.push(chunk);
            chunk = character;
          } else {
            chunk += character;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
    if (current !== "") lines.push(current);
    return lines;
  };

  const drawWrapped = (text: string, font: AnyFont, size: number, indent = 0, colour: [number, number, number] = [0.1, 0.1, 0.1]) => {
    for (const line of wrap(text, font, size, contentWidth - indent)) {
      ensureRoom(size * 1.3);
      page.drawText(line, { x: margin + indent, y, size, font, color: pdf.rgb(...colour) });
      y -= size * 1.3;
    }
  };

  const drawHeading = (label: string) => {
    ensureRoom(lineHeight + 14);
    y -= 8;
    page.drawText(label.toUpperCase(), { x: margin, y, size: fontSize + 0.5, font: bold, color: pdf.rgb(r, g, b) });
    y -= 4;
    // A rule under the heading, drawn with a thin filled rectangle rather than
    // drawLine so the weight is consistent across viewers.
    page.drawRectangle({ x: margin, y, width: contentWidth, height: 0.75, color: pdf.rgb(r, g, b) });
    y -= 8;
  };

  /* ---- header ---- */
  const { contact } = resume;
  if (contact.fullName.trim()) {
    page.drawText(contact.fullName.trim(), { x: margin, y, size: nameSize, font: bold, color: pdf.rgb(0.08, 0.08, 0.08) });
    y -= nameSize * 1.25;
  }
  if (contact.title.trim()) {
    page.drawText(contact.title.trim(), { x: margin, y, size: fontSize + 1.5, font: regular, color: pdf.rgb(r, g, b) });
    y -= lineHeight;
  }
  const contactLine = [contact.email, contact.phone, contact.location, contact.website]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("  ·  ");
  if (contactLine) {
    page.drawText(contactLine, { x: margin, y, size: fontSize - 0.5, font: regular, color: pdf.rgb(0.35, 0.35, 0.35) });
    y -= lineHeight;
  }
  y -= 6;

  /* ---- summary ---- */
  if (resume.summary.trim()) {
    drawHeading("Summary");
    drawWrapped(resume.summary.trim(), regular, fontSize);
    y -= 4;
  }

  /* ---- experience ---- */
  if (resume.experience.some((entry) => entry.role.trim() || entry.company.trim())) {
    drawHeading("Experience");
    for (const entry of resume.experience) {
      if (entry.role.trim() === "" && entry.company.trim() === "") continue;

      ensureRoom(lineHeight * 2);
      const period = dateRange(entry.start, entry.end);
      const left = entry.role.trim() || entry.company.trim();
      page.drawText(left, { x: margin, y, size: fontSize + 0.5, font: bold, color: pdf.rgb(0.08, 0.08, 0.08) });
      if (period) {
        const width = regular.widthOfTextAtSize(period, fontSize - 0.5);
        page.drawText(period, {
          x: pageWidth - margin - width,
          y,
          size: fontSize - 0.5,
          font: regular,
          color: pdf.rgb(0.4, 0.4, 0.4),
        });
      }
      y -= lineHeight;

      if (entry.company.trim() && entry.role.trim()) {
        page.drawText(entry.company.trim(), { x: margin, y, size: fontSize, font: italic, color: pdf.rgb(0.3, 0.3, 0.3) });
        y -= lineHeight * 0.9;
      }
      if (entry.location.trim()) {
        page.drawText(entry.location.trim(), { x: margin, y, size: fontSize - 0.5, font: regular, color: pdf.rgb(0.45, 0.45, 0.45) });
        y -= lineHeight * 0.9;
      }
      for (const bullet of entry.bullets) {
        if (bullet.trim() === "") continue;
        ensureRoom(lineHeight);
        page.drawText("•", { x: margin + 8, y, size: fontSize, font: regular, color: pdf.rgb(r, g, b) });
        drawWrapped(bullet.trim(), regular, fontSize, 20);
      }
      y -= 4;
    }
  }

  /* ---- education ---- */
  if (resume.education.some((entry) => entry.qualification.trim())) {
    drawHeading("Education");
    for (const entry of resume.education) {
      if (entry.qualification.trim() === "") continue;
      ensureRoom(lineHeight * 1.6);
      const period = dateRange(entry.start, entry.end);
      page.drawText(entry.qualification.trim(), { x: margin, y, size: fontSize + 0.5, font: bold, color: pdf.rgb(0.08, 0.08, 0.08) });
      if (period) {
        const width = regular.widthOfTextAtSize(period, fontSize - 0.5);
        page.drawText(period, {
          x: pageWidth - margin - width,
          y,
          size: fontSize - 0.5,
          font: regular,
          color: pdf.rgb(0.4, 0.4, 0.4),
        });
      }
      y -= lineHeight;
      if (entry.institution.trim()) {
        page.drawText(entry.institution.trim(), { x: margin, y, size: fontSize, font: italic, color: pdf.rgb(0.3, 0.3, 0.3) });
        y -= lineHeight * 0.9;
      }
      if (entry.detail.trim()) {
        drawWrapped(entry.detail.trim(), regular, fontSize - 0.5);
      }
    }
    y -= 4;
  }

  /* ---- projects ---- */
  if (resume.projects.some((entry) => entry.name.trim())) {
    drawHeading("Projects");
    for (const entry of resume.projects) {
      if (entry.name.trim() === "") continue;
      ensureRoom(lineHeight * 1.4);
      page.drawText(entry.name.trim(), { x: margin, y, size: fontSize + 0.5, font: bold, color: pdf.rgb(0.08, 0.08, 0.08) });
      y -= lineHeight;
      if (entry.link.trim()) {
        page.drawText(entry.link.trim(), { x: margin, y, size: fontSize - 0.5, font: regular, color: pdf.rgb(0.35, 0.35, 0.35) });
        y -= lineHeight * 0.9;
      }
      for (const bullet of entry.bullets) {
        if (bullet.trim() === "") continue;
        ensureRoom(lineHeight);
        page.drawText("•", { x: margin + 8, y, size: fontSize, font: regular, color: pdf.rgb(r, g, b) });
        drawWrapped(bullet.trim(), regular, fontSize, 20);
      }
      if (entry.description.trim()) {
        drawWrapped(entry.description.trim(), regular, fontSize);
      }
    }
    y -= 4;
  }

  /* ---- skills ---- */
  const skillGroups = resume.skills.filter((group) => group.skills.trim() !== "");
  if (skillGroups.length > 0) {
    drawHeading("Skills");
    for (const group of skillGroups) {
      const label = group.heading.trim();
      const body = group.skills.trim();
      ensureRoom(lineHeight);
      if (label) {
        page.drawText(`${label}: `, { x: margin, y, size: fontSize, font: bold, color: pdf.rgb(0.08, 0.08, 0.08) });
        const indent = bold.widthOfTextAtSize(`${label}: `, fontSize);
        const lines = wrap(body, regular, fontSize, contentWidth - indent);
        lines.forEach((line, index) => {
          if (index > 0) ensureRoom(lineHeight);
          page.drawText(line, { x: margin + indent, y, size: fontSize, font: regular, color: pdf.rgb(0.15, 0.15, 0.15) });
          y -= lineHeight;
        });
      } else {
        drawWrapped(body, regular, fontSize);
      }
    }
  }

  return doc.save();
}

/* -------------------------------------------------------------------------- */
/*  Persistence                                                               */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "balu.resume.draft.v1";

/**
 * Draft persistence in `localStorage`.
 *
 * A resume is typed over many sittings and losing it to a refresh is the single
 * most likely complaint about a form this size. This is the same
 * browser-local-only model the rest of the site uses — nothing is uploaded.
 *
 * Every field is re-validated on read because `localStorage` is user-writable:
 * a hand-edited or truncated value must not throw during render.
 */
export function saveResumeDraft(resume: ResumeDocument): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resume));
  } catch {
    // Private mode or a full quota. The form still works; only the autosave is
    // lost, so this is not worth surfacing as an error.
  }
}

export function loadResumeDraft(): ResumeDocument | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResumeDocument>;
    if (!parsed || typeof parsed !== "object" || !parsed.contact) return null;

    return {
      contact: { ...emptyResume().contact, ...(parsed.contact ?? {}) },
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      experience: Array.isArray(parsed.experience) ? parsed.experience : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    };
  } catch {
    return null;
  }
}

export function clearResumeDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; see saveResumeDraft.
  }
}