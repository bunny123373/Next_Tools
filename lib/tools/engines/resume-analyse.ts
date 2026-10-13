/**
 * Resume analysis.
 *
 * Everything measurable here is measured, never estimated. That is the whole
 * design constraint, and it is why there is no "resume score" out of ten.
 *
 * A single composite number is the thing resume-scoring sites sell and the
 * reason none of them mean anything: it is a weighted sum of the author's
 * private opinions, presented with a false precision that implies a measurement
 * nobody made. This module reports findings instead — each one a specific,
 * checkable observation about the document — and says how many there are rather
 * than collapsing them into a grade.
 *
 * The ATS section is likewise a list of concrete structural facts a parser is
 * known to struggle with, not a pass/fail verdict on an unnamed "ATS".
 */

/* -------------------------------------------------------------------------- */
/*  Text measurement                                                          */
/* -------------------------------------------------------------------------- */

export interface TextStats {
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  /** Mean words per sentence, rounded to one decimal. */
  averageSentenceLength: number;
  /** Flesch Reading Ease, 0–100. Higher is easier. */
  readingEase: number;
  /** Flesch-Kincaid grade level, US-schooling scale. */
  gradeLevel: number;
  longestWord: number;
}

const SYLLABLES_PER_WORD: Record<string, number> = {};

/**
 * English syllable estimate.
 *
 * Counting vowel groups and subtracting silent trailing `e` is the standard
 * approximation, good to about a syllable for technical vocabulary. It is
 * labelled an estimate in the UI rather than presented as a measurement,
 * because for a document full of "Kubernetes" and "CI/CD" it genuinely is one.
 */
function countSyllables(word: string): number {
  const cached = SYLLABLES_PER_WORD[word];
  if (cached !== undefined) return cached;

  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (clean === "") {
    SYLLABLES_PER_WORD[word] = 0;
    return 0;
  }
  if (clean.length <= 3) {
    SYLLABLES_PER_WORD[word] = 1;
    return 1;
  }

  const trimmed = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  const count = Math.max(1, groups ? groups.length : 1);
  SYLLABLES_PER_WORD[word] = count;
  return count;
}

export function measureText(text: string): TextStats {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  // Sentence boundaries need punctuation followed by space/end; splitting on
  // ". " alone miscounts "3.5" and initials, so decimals are protected first.
  const sentenceSource = text.replace(/\b(\d+)\.(\d+)\b/g, "$1$2");
  const sentences = sentenceSource.split(/[.!?]+\s+/).filter((part) => part.trim().length > 0);

  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const wordCount = words.length;
  const sentenceCount = Math.max(1, sentences.length);

  // Standard Flesch formulas.
  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = wordCount === 0 ? 0 : syllables / wordCount;
  const readingEase =
    wordCount === 0 ? 0 : Math.max(0, Math.min(100, 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord));
  const gradeLevel =
    wordCount === 0 ? 0 : Math.max(0, 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59);

  return {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    words: wordCount,
    sentences: sentences.length,
    averageSentenceLength: Math.round(wordsPerSentence * 10) / 10,
    readingEase: Math.round(readingEase * 10) / 10,
    gradeLevel: Math.round(gradeLevel * 10) / 10,
    longestWord: words.reduce((longest, word) => Math.max(longest, word.length), 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Bullet analysis                                                           */
/* -------------------------------------------------------------------------- */

/** Openers that describe a result rather than a duty. */
const STRONG_OPENERS = new Set([
  "led", "built", "designed", "created", "developed", "implemented", "launched",
  "increased", "reduced", "improved", "grew", "saved", "cut", "delivered",
  "automated", "migrated", "scaled", "negotiated", "architected", "owned",
  "rewrote", "introduced", "drove", "generated", "reduced", "resolved",
  "streamlined", "spearheaded", "established", "optimised", "optimized",
]);

/** Openers that describe a duty rather than an outcome. */
const WEAK_OPENERS = new Set([
  "responsible", "helped", "assisted", "worked", "participated", "duties",
  "tasked", "involved", "attended", "supported", "assisted", "handled",
]);

export interface BulletFinding {
  text: string;
  verdict: "strong" | "weak" | "neutral";
  reason: string;
  quantified: boolean;
}

export interface BulletAnalysis {
  bullets: BulletFinding[];
  total: number;
  quantified: number;
  strong: number;
  weak: number;
  longestCharacters: number;
  averageCharacters: number;
  overLongCount: number;
}

/**
 * Reads the achievement bullets and reports what it can actually verify.
 *
 * "Quantified" means the bullet contains a digit — which is a fact about the
 * string, not a judgement about the work. Whether that number is the right one
 * is not something a regex can know, and the tool does not pretend otherwise.
 */
export function analyseBullets(bullets: readonly string[]): BulletAnalysis {
  const cleaned = bullets.map((bullet) => bullet.trim()).filter((bullet) => bullet !== "");

  const findings: BulletFinding[] = cleaned.map((bullet) => {
    /**
     * First word only, lower-cased, with surrounding punctuation removed.
     *
     * Stripping every non-letter instead — `replace(/[^a-z]/g, "")` — silently
     * turns "Led migration of 14 services" into "ledmigrationofs", which can
     * never match an opener set and makes the whole check report nothing. The
     * split has to happen first, then the cleanup is scoped to that one word.
     */
    const firstWord = bullet.split(/\s+/)[0]?.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "") ?? "";
    const quantified = /\d/.test(bullet);

    if (WEAK_OPENERS.has(firstWord)) {
      return { text: bullet, verdict: "weak", reason: "Starts with a duty phrase like “responsible for”, which describes the job rather than what you achieved.", quantified };
    }
    if (STRONG_OPENERS.has(firstWord)) {
      return { text: bullet, verdict: "strong", reason: quantified ? "Opens with an action verb and contains a number." : "Opens with an action verb. A number would make it concrete.", quantified };
    }
    return {
      text: bullet,
      verdict: "neutral",
      reason: quantified ? "Contains a number, but does not open with an action verb." : "Neither an action verb nor a number.",
      quantified,
    };
  });

  const lengths = cleaned.map((bullet) => bullet.length);

  return {
    bullets: findings,
    total: findings.length,
    quantified: findings.filter((finding) => finding.quantified).length,
    strong: findings.filter((finding) => finding.verdict === "strong").length,
    weak: findings.filter((finding) => finding.verdict === "weak").length,
    longestCharacters: lengths.reduce((longest, value) => Math.max(longest, value), 0),
    averageCharacters: lengths.length === 0 ? 0 : Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    overLongCount: lengths.filter((length) => length > 160).length,
  };
}

/* -------------------------------------------------------------------------- */
/*  ATS structure checks                                                      */
/* -------------------------------------------------------------------------- */

export type AtSeverity = "blocker" | "warning" | "note";

export interface AtFinding {
  id: string;
  severity: AtSeverity;
  title: string;
  detail: string;
  /** What the visitor can do about it, when there is an action. */
  action?: string;
}

export interface AtReport {
  findings: AtFinding[];
  blockers: number;
  warnings: number;
  /** Sections a parser would look for, and whether the text contains one. */
  sections: { name: string; found: boolean }[];
  /** Contact fields an ATS screens on before a human sees anything. */
  contact: { email: boolean; phone: boolean; location: boolean };
}

const SECTION_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "Summary or Profile", pattern: /\b(summary|profile|objective|about)\b/i },
  { name: "Experience or Work History", pattern: /\b(experience|employment|work history|professional background)\b/i },
  { name: "Education", pattern: /\b(education|academic|qualifications|training)\b/i },
  { name: "Skills", pattern: /\b(skills|competencies|technologies|technical skills)\b/i },
  { name: "Projects", pattern: /\b(projects|portfolio|selected work)\b/i },
  { name: "Certifications", pattern: /\b(certif|licen[cs]|accredit)\w*/i },
];

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/;

/**
 * Structural checks an applicant tracking system is known to care about.
 *
 * These are checks on the TEXT. Whether a given file is a text-layer PDF or a
 * scan of an image changes the answer completely, so the PDF tool reads the
 * extracted text first and reports a hard blocker when a page yields no text at
 * all — that is the case where a parser sees a blank document.
 */
export function analyseAts(text: string): AtReport {
  const findings: AtFinding[] = [];

  const sections = SECTION_PATTERNS.map((section) => ({
    name: section.name,
    found: section.pattern.test(text),
  }));

  const missingSections = sections.filter((section) => !section.found);
  if (missingSections.length > 0) {
    findings.push({
      id: "sections",
      severity: missingSections.length > 2 ? "blocker" : "warning",
      title: `${missingSections.length} standard section${missingSections.length === 1 ? "" : "s"} not found`,
      detail: `No heading matching: ${missingSections.map((section) => section.name).join(", ")}.`,
      action: "Add the heading in plain words. Parsers look for these labels literally, not for clever alternatives.",
    });
  }

  const hasEmail = EMAIL.test(text);
  const hasPhone = PHONE.test(text);
  const hasLocation = /\b([A-Z][a-z]+\s*,\s*[A-Z]{2}\b|[A-Z][a-z]+\s+[A-Z][a-z]+\b)/.test(text);

  if (!hasEmail) {
    findings.push({
      id: "email",
      severity: "blocker",
      title: "No email address found",
      detail: "Recruiter systems index on email more than anything else.",
      action: "Put a plain email address in the header, not inside an image or a contact icon.",
    });
  }
  if (!hasPhone) {
    findings.push({
      id: "phone",
      severity: "warning",
      title: "No phone number found",
      detail: "Many filters discard applications without one.",
    });
  }
  if (!hasLocation) {
    findings.push({
      id: "location",
      severity: "note",
      title: "No location found",
      detail: "Some searches filter by city or country.",
    });
  }

  const analysis = analyseBullets(collectBullets(text));

  if (analysis.total === 0) {
    findings.push({
      id: "no-bullets",
      severity: "warning",
      title: "No bullet points detected",
      detail: "Nothing on the page starts with a dash or bullet character.",
      action: "Achievements are far easier to scan as bullets than as prose paragraphs.",
    });
  } else {
    if (analysis.quantified === 0) {
      findings.push({
        id: "no-numbers",
        severity: "warning",
        title: `None of the ${analysis.total} bullets contain a number`,
        detail: "A figure — a percentage, a count, a size — is what makes an achievement checkable.",
      });
    } else if (analysis.quantified / analysis.total < 0.4) {
      findings.push({
        id: "few-numbers",
        severity: "note",
        title: `${analysis.quantified} of ${analysis.total} bullets contain a number`,
        detail: "Most quantified, which reads as evidence rather than description.",
      });
    }
    if (analysis.weak > 0) {
      findings.push({
        id: "weak-openers",
        severity: "warning",
        title: `${analysis.weak} bullet${analysis.weak === 1 ? "" : "s"} start with a duty phrase`,
        detail: "“Responsible for…” and “Helped with…” describe the job, not what you did to it.",
      });
    }
  }

  if (text.length > 12000) {
    findings.push({
      id: "long",
      severity: "note",
      title: `Document text is ${Math.round(text.length / 1000)}k characters`,
      detail: "Long single-column resumes often get truncated by parsers and rarely get read to the end.",
    });
  }

  const blockers = findings.filter((finding) => finding.severity === "blocker").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;

  return {
    findings,
    blockers,
    warnings,
    sections,
    contact: { email: hasEmail, phone: hasPhone, location: hasLocation },
  };
}

/**
 * Pulls bullet lines out of plain text.
 *
 * Looks for the three conventions that survive a PDF export: a leading dash, a
 * leading bullet glyph, or a leading asterisk. Anything else is treated as a
 * prose line and ignored, which under-counts rather than inventing bullets.
 */
function collectBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-•*]\s+/.test(line))
    .map((line) => line.replace(/^[-•*]\s+/, ""));
}

/* -------------------------------------------------------------------------- */
/*  Combined report                                                           */
/* -------------------------------------------------------------------------- */

export interface ResumeReport {
  text: TextStats;
  bullets: BulletAnalysis;
  ats: AtReport;
  /** Everything countable, stated plainly. No composite grade. */
  summary: string;
}

export function analyseResumeText(text: string): ResumeReport {
  const textStats = measureText(text);
  const bullets = analyseBullets(collectBullets(text));
  const ats = analyseAts(text);

  const parts: string[] = [];
  parts.push(`${textStats.words.toLocaleString()} words`);
  if (bullets.total > 0) {
    parts.push(`${bullets.quantified} of ${bullets.total} bullets carry a number`);
  }
  if (ats.blockers > 0) {
    parts.push(`${ats.blockers} thing${ats.blockers === 1 ? "" : "s"} an ATS needs and cannot find`);
  } else if (ats.warnings > 0) {
    parts.push(`${ats.warnings} warning${ats.warnings === 1 ? "" : "s"}`);
  } else {
    parts.push("no structural problems found");
  }

  return { text: textStats, bullets, ats, summary: parts.join(" · ") };
}

/* -------------------------------------------------------------------------- */
/*  Job-description matching                                                  */
/* -------------------------------------------------------------------------- */

/** Words too common in job adverts to say anything about a match. */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "you", "our", "are", "will", "have", "this", "that",
  "from", "your", "they", "their", "them", "has", "was", "were", "been", "not", "but",
  "all", "can", "who", "what", "when", "where", "how", "job", "role", "work", "team",
  "company", "we", "us", "a", "an", "of", "to", "in", "on", "at", "by", "or", "as",
  "is", "be", "an", "it", "or", "new", "our", "any", "we", "are", "good", "great",
]);

export interface MatchResult {
  /** Share of the advert's significant words that appear in the resume, 0–100. */
  matchPercent: number;
  /** Advert terms present in the resume. */
  matched: string[];
  /** Advert terms absent from the resume, most valuable first. */
  missing: string[];
  /** Advert terms that do appear in the resume. */
  covered: number;
  total: number;
}

/**
 * Keyword overlap between a resume and a job advert.
 *
 * This is bag-of-words overlap, and the report says so. It does not understand
 * that "senior engineer" and "leadership" are different asks, and it will rate
 * a resume that lists every word in the advert highly even if none of them are
 * used honestly. That limitation is stated on screen — a number without its
 * caveat is how people talk themselves into sending a padded resume.
 */
export function matchJobDescription(resumeText: string, jobText: string): MatchResult {
  const advertWords = uniqueWords(jobText);
  const resumeWords = new Set(uniqueWords(resumeText));

  // Compare on the lower-cased surface so "React" and "react" match.
  const resumeSurface = new Set(resumeText.toLowerCase().split(/[^a-z0-9+#.-]+/i));

  const covered: string[] = [];
  const missing: string[] = [];

  for (const word of advertWords) {
    (resumeWords.has(word.toLowerCase()) || resumeSurface.has(word.toLowerCase())
      ? covered
      : missing
    ).push(word);
  }

  const total = advertWords.length;
  return {
    matchPercent: total === 0 ? 0 : Math.round((covered.length / total) * 100),
    matched: covered,
    missing,
    covered: covered.length,
    total,
  };
}

function uniqueWords(text: string): string[] {
  const seen = new Map<string, string>();
  for (const raw of text.split(/[^A-Za-z0-9+#.-]+/)) {
    const word = raw.replace(/^[.-]+|[.-]+$/g, "");
    if (word.length < 3) continue;
    if (STOP_WORDS.has(word.toLowerCase())) continue;
    const key = word.toLowerCase();
    if (!seen.has(key)) seen.set(key, word);
  }
  return [...seen.values()];
}