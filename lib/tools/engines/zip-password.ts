/**
 * ZIP password recovery for archives you have legitimately lost the password for.
 *
 * WHAT THIS CAN AND CANNOT DO, stated first because it is the whole story:
 *
 *   - An encrypted ZIP entry's DATA is encrypted. There is no way to read it
 *     without the password. This module does not attempt to defeat the cipher.
 *   - What it DOES do is try a list of likely passwords, quickly, in this tab.
 *     That is a wordlist attack, not cryptanalysis.
 *   - ZipCrypto (the legacy scheme) does not encrypt FILENAMES, so the entry
 *     list can be read without any password at all. That is often the most
 *     useful thing this tool returns: proof you have the right archive, and
 *     what was in it, even when the contents stay locked.
 *   - AES (WinZip AE-1/AE-2, what 7-Zip and WinZip have produced since the
 *     mid-2000s) encrypts the filenames too, so nothing can be listed until the
 *     password is recovered.
 *
 * There is deliberately no known-plaintext attack on ZipCrypto here. That is a
 * different kind of tool, it breaks archives far more broadly than "I forgot my
 * own password", and it is out of scope for this repository's stated policy.
 *
 * All of this runs in the visitor's browser. Nothing is uploaded, so the
 * process-comments/sentences below are about reporting progress accurately.
 */

/**
 * Types only, erased at build time.
 *
 * Written as `import type` rather than inline `import("...")` annotations
 * because the repo's lint config forbids the latter, and because a top-level
 * type import keeps the dynamic `import()` below as the single runtime load.
 */
import type * as ZipJs from "@zip.js/zip.js";
import type { FileEntry } from "@zip.js/zip.js";

/* -------------------------------------------------------------------------- */
/*  Password candidates                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The passwords people actually choose.
 *
 * Ordered by how often they turn out to be the answer, so the useful cases are
 * tried first and the common ones finish in the first second. This is the
 * single reason the tool works at all: a genuinely random password is not
 * recoverable here, and pretending otherwise would be dishonest.
 */
const COMMON_PASSWORDS: readonly string[] = [
  "password", "123456", "12345678", "1234", "qwerty", "12345", "dragon", "pussy",
  "baseball", "football", "letmein", "monkey", "696969", "abc123", "mustang",
  "michael", "shadow", "master", "jennifer", "111111", "2000", "jordan", "superman",
  "harley", "1234567", "iloveyou", "trustno1", "sunshine", "ashley", "bailey",
  "passw0rd", "charlie", "robert", "thomas", "hockey", "ranger", "daniel",
  "starwars", "klaster", "112233", "george", "computer", "michelle", "jessica",
  "pepper", "1111", "zxcvbn", "555555", "11111111", "131313", "freedom",
  "7777777", "pass", "maggie", "159753", "aaaaaa", "ginger", "princess",
  "joshua", "cheese", "amanda", "summer", "love", "ashley1", "nicole",
  "chelsea", "biteme", "matthew", "access", "yankees", "987654321", "dallas",
  "austin", "thunder", "taylor", "matrix", "william", "corvette", "hello",
  "martin", "heather", "secret", "merlin", "diamond", "1234qwer", "gfhjkm",
  "hammer", "silver", "222222", "88888888", "anthony", "justin", "test",
  "bailey1", "q1w2e3r4t5", "patrick", "internet", "scooter", "orange",
  "11111", "golfer", "cookie", "richard", "samantha", "bigdog", "guitar",
  "jackson", "whatever", "mickey", "chicken", "sparky", "scooby", "maverick",
  "phoenix", "camaro", "peanut", "morgan", "welcome", "falcon", "cowboy",
  "ferrari", "samsung", "andrea", "smokey", "steelers", "joseph", "mercedes",
  "dakota", "arsenal", "eagles", "taylor1", "1234abcd", "enter", "zzzzzz",
  "123123", "pokemon", "admin", "welcome1", "admin123", "root", "guest",
  "user", "default", "changeme", "letmein1", "qwerty123", "abc", "test123",
  "pass123", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "qazwsx", "iloveu", "monkey1",
  "dragon1", "monkey123", "sunshine1", "princess1", "football1", "charlie1",
  "summer1", "shadow1", "michael1", "jennifer1", "hunter", "buster", "soccer",
  "harley1", "batman", "andrew", "tigger", "sunshine123", "ashley123",
  "nicole1", "chelsea1", "biteme1", "matthew1", "yankees1", "mustang1",
  "ranger1", "access1", "1234abcd", "robert1", "thomas1", "daniel1",
  "starwars1", "klaster1", "computer1", "michelle1", "jessica1", "pepper1",
];

/** Years, because "my archive from 2019" is a very common actual answer. */
function yearCandidates(): string[] {
  const out: string[] = [];
  for (let year = 1970; year <= 2035; year += 1) out.push(String(year));
  return out;
}

/** Appended to common words and years — capitalisation and trailing digits. */
function decorate(base: string): string[] {
  const out = [base, base.toUpperCase(), `${base[0]?.toUpperCase() ?? ""}${base.slice(1)}`];
  for (const suffix of ["1", "12", "123", "1234", "!", "01"]) out.push(`${base}${suffix}`);
  return out;
}

export interface WordlistOptions {
  /** Extra words the visitor typed — their filename, their dog, their company. */
  extraWords?: readonly string[];
  /** Skip the year list when the user only wants a fast pass. */
  includeYears?: boolean;
  includeDecorations?: boolean;
}

/**
 * Builds the ordered candidate list.
 *
 * Duplicates are removed while preserving first-seen order, so a word the user
 * typed that is already in the common list does not get tried twice — on a list
 * of a few hundred entries that is a meaningful fraction of the work.
 */
export function buildWordlist(options: WordlistOptions = {}): string[] {
  const { extraWords = [], includeYears = true, includeDecorations = true } = options;

  const seeds: string[] = [...COMMON_PASSWORDS];
  if (includeYears) seeds.push(...yearCandidates());

  const candidates: string[] = [];

  // User words come first: they are the most likely single guess and the whole
  // reason someone remembers "it was something about the project name".
  for (const word of extraWords) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    candidates.push(trimmed);
    if (includeDecorations) candidates.push(...decorate(trimmed));
  }

  for (const seed of seeds) candidates.push(seed);
  if (includeDecorations) {
    // Decorating the entire common list would multiply the work by ~7 for very
    // little gain, so it is applied to the short, high-value words only.
    for (const seed of COMMON_PASSWORDS.slice(0, 40)) candidates.push(...decorate(seed));
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    if (candidate.length === 0 || candidate.length > 128) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    unique.push(candidate);
  }
  return unique;
}

/* -------------------------------------------------------------------------- */
/*  Recovery                                                                  */
/* -------------------------------------------------------------------------- */

export type ZipEncryption = "none" | "zipcrypto" | "aes";

export interface ArchiveEntry {
  filename: string;
  directory: boolean;
  /** True when this entry's data needs a password. */
  encrypted: boolean;
  encryption: ZipEncryption;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ArchiveListing {
  entries: ArchiveEntry[];
  /** Entries whose data is protected. */
  encryptedCount: number;
  /**
   * True when filenames themselves were readable.
   *
   * False for an AES archive: zip.js reports the entries but their names are
   * placeholders, which is why the UI must not present them as real.
   */
  namesVisible: boolean;
  encryption: ZipEncryption;
  comment?: string;
}

export interface RecoveryProgress {
  tried: number;
  total: number;
  current?: string;
  /** True the moment a candidate works, so the loop can stop immediately. */
  found: boolean;
  password?: string;
}

export interface RecoveryResult {
  recovered: boolean;
  password?: string;
  tried: number;
  total: number;
  elapsedMs: number;
}

export type ZipRecoveryErrorCode = "unreadable" | "not_encrypted" | "unsupported" | "cancelled";

/**
 * Declared without a TypeScript parameter property on purpose.
 *
 * `constructor(readonly code: ZipRecoveryErrorCode, message: string)` is valid
 * and is the pattern used by `lib/billing/provider.ts`, but it cannot be run
 * through Node's type-stripping loader, which means the engine could not be
 * exercised by the round-trip probe in `tmp/`. Assigning explicitly costs two
 * lines and keeps the module runnable outside Next.js.
 */
export class ZipRecoveryError extends Error {
  readonly code: ZipRecoveryErrorCode;

  constructor(code: ZipRecoveryErrorCode, message: string) {
    super(message);
    this.name = "ZipRecoveryError";
    this.code = code;
  }
}

/**
 * The module namespace, taken from the `import type * as ZipJs` above.
 *
 * An inline `typeof import("@zip.js/zip.js")` expresses the same thing but the
 * repo's lint config forbids `import()` type annotations, so the namespace
 * import is the sanctioned route.
 */
type ZipJsModule = typeof ZipJs;

/**
 * Loads the library on demand.
 *
 * zip.js is a real dependency with a real size, and the contract for this repo
 * is that nothing unused rides along in the bundle. Only this tool's own chunk
 * ever pays for it, and only once someone actually opens a ZIP.
 */
async function loadZipJs(): Promise<ZipJsModule> {
  try {
    return await import("@zip.js/zip.js");
  } catch (error) {
    throw new ZipRecoveryError(
      "unsupported",
      "The ZIP engine could not be loaded. Check your connection and try again.",
    );
  }
}

/**
 * Decides whether an encrypted entry uses AES or the legacy PKWARE scheme.
 *
 * The obvious check is wrong, and measurably so. zip.js reports
 * `compressionMethod: 0` (STORE) for BOTH an AES entry and a ZipCrypto entry —
 * AES is flagged in the central directory by the version field and the 0x9901
 * extra field, not by the compression method. Keying off `compressionMethod`
 * classifies every AES archive as ZipCrypto, which silently produces wrong
 * labels in the UI.
 *
 * Signals checked, most reliable first:
 *   1. `zipCrypto`  — zip.js's own flag. Definitive when present.
 *   2. `extraFieldAES` — the WinZip AES marker (0x9901).
 *   3. `version >= 51` — the "version needed to extract" for AE-2 is 51, while
 *      a ZipCrypto entry reports 20.
 *
 * Unknown rather than guessed: anything encrypted that matches none of these is
 * reported as `zipcrypto`, which is the legacy default and the least alarming
 * mislabel, and the UI says the scheme is detected rather than guaranteed.
 */
function detectEncryption(entry: unknown): ZipEncryption {
  const e = entry as {
    zipCrypto?: boolean;
    extraFieldAES?: unknown;
    version?: number;
  };

  if (typeof e.zipCrypto === "boolean") return e.zipCrypto ? "zipcrypto" : "aes";
  if (e.extraFieldAES) return "aes";
  if (typeof e.version === "number" && e.version >= 51) return "aes";
  return "zipcrypto";
}

/** Classifies the strongest encryption present in the archive. */
function strongest(entries: readonly ArchiveEntry[]): ZipEncryption {
  if (entries.some((entry) => entry.encryption === "aes")) return "aes";
  if (entries.some((entry) => entry.encryption === "zipcrypto")) return "zipcrypto";
  return "none";
}

/**
 * Opens the archive and reports what is inside.
 *
 * Filenames come back without a password for ZipCrypto archives. For AES they
 * do not, and `namesVisible` is false so the caller can say so rather than
 * printing placeholder strings as though they were real filenames.
 */
export async function listArchive(source: Blob): Promise<ArchiveListing> {
  const zip = await loadZipJs();

  let reader: InstanceType<typeof zip.ZipReader> | undefined;
  try {
    reader = new zip.ZipReader(new zip.BlobReader(source));

    const raw = await reader.getEntries();
    const entries: ArchiveEntry[] = raw.map((entry) => {
      const encrypted = Boolean(entry.encrypted);
      const encryption: ZipEncryption = encrypted ? detectEncryption(entry) : "none";

      return {
        filename: entry.filename,
        directory: entry.directory,
        encrypted,
        encryption,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
      };
    });

    const encryption = strongest(entries);
    // AES hides the names; ZipCrypto does not. A placeholder name in zip.js's
    // listing is a strong signal of AES.
    const namesVisible = encryption !== "aes";

    return {
      entries,
      encryptedCount: entries.filter((entry) => entry.encrypted).length,
      namesVisible,
      encryption,
    };
  } catch (error) {
    throw new ZipRecoveryError(
      "unreadable",
      "This file could not be read as a ZIP archive. If it is a split or spanned archive, or a format that only looks like a ZIP, it will not open here.",
    );
  } finally {
    await reader?.close().catch(() => undefined);
  }
}

/**
 * Tries each candidate against the first encrypted entry.
 *
 * Only ONE entry is used as the oracle, on purpose. Verifying against every
 * entry would multiply the work by the file count for no extra confidence — if
 * the password opens one, it opens all of them, because the password is
 * archive-wide.
 *
 * The entry is chosen as the smallest encrypted one: the smallest is the
 * fastest to decrypt and check for every attempt, which is the only thing that
 * makes a few hundred attempts feel instant.
 */
export async function recoverPassword(
  source: Blob,
  candidates: readonly string[],
  onProgress?: (progress: RecoveryProgress) => void,
  signal?: AbortSignal,
): Promise<RecoveryResult> {
  if (candidates.length === 0) {
    throw new ZipRecoveryError("unsupported", "No candidate passwords were supplied.");
  }

  const zip = await loadZipJs();
  const startedAt = performance.now();

  let reader: InstanceType<typeof zip.ZipReader> | undefined;
  try {
    reader = new zip.ZipReader(new zip.BlobReader(source));
    const raw = await reader.getEntries();

    const encrypted = raw.filter(
      (entry): entry is FileEntry => !entry.directory && entry.encrypted,
    );
    if (encrypted.length === 0) {
      throw new ZipRecoveryError(
        "not_encrypted",
        "This archive has no password-protected entries, so there is nothing to recover.",
      );
    }

    // `encryptedEntries`, NOT `candidates`: the parameter is already called
    // `candidates` and shadowing it here made the search loop iterate over
    // archive entries instead of passwords.
    // `Entry` is `DirectoryEntry | FileEntry`; only FileEntry has getData, and
    // an encrypted entry is never a directory, so the predicate narrows the
    // union properly instead of casting around it.
    const encryptedEntries = raw.filter(
      (entry): entry is FileEntry => !entry.directory && entry.encrypted,
    );

    if (encryptedEntries.length === 0) {
      throw new ZipRecoveryError(
        "not_encrypted",
        "This archive has no password-protected files, so there is nothing to recover.",
      );
    }

    const oracle = encryptedEntries.reduce((smallest, entry) =>
      entry.uncompressedSize < smallest.uncompressedSize ? entry : smallest,
    );

    for (let index = 0; index < candidates.length; index += 1) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const candidate = candidates[index]!;
      let worked = false;

      try {
        /**
         * A real sink, not a trick one. zip.js throws `ERR_INVALID_PASSWORD`
         * when the password cannot decrypt the entry, and AE-2 additionally
         * verifies an authentication code, so a wrong password is rejected
         * rather than silently returning garbage. Probing with a genuine
         * writer means the check is the same operation the real extraction
         * will perform, so it cannot disagree with it.
         *
         * Cost is bounded because `oracle` is the smallest encrypted entry.
         */
        await oracle.getData(new zip.Uint8ArrayWriter(), {
          password: candidate,
          checkSignature: true,
        });
        worked = true;
      } catch {
        worked = false;
      }

      onProgress?.({ tried: index + 1, total: candidates.length, current: candidate, found: worked, password: worked ? candidate : undefined });
      if (worked) {
        return {
          recovered: true,
          password: candidate,
          tried: index + 1,
          total: candidates.length,
          elapsedMs: performance.now() - startedAt,
        };
      }
    }

    return {
      recovered: false,
      tried: candidates.length,
      total: candidates.length,
      elapsedMs: performance.now() - startedAt,
    };
  } finally {
    await reader?.close().catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/*  Extraction                                                                */
/* -------------------------------------------------------------------------- */

export interface ExtractedFile {
  name: string;
  blob: Blob;
}

/**
 * Extracts every readable entry.
 *
 * Individual files are returned rather than a rebuilt ZIP, so the visitor gets
 * something they can open immediately. A re-zipped output would need the
 * password to open again, which would defeat the purpose.
 */
export async function extractWithPassword(
  source: Blob,
  password: string,
): Promise<ExtractedFile[]> {
  const zip = await loadZipJs();

  let reader: InstanceType<typeof zip.ZipReader> | undefined;
  try {
    reader = new zip.ZipReader(new zip.BlobReader(source));
    const entries = await reader.getEntries();

    const out: ExtractedFile[] = [];
    for (const entry of entries) {
      if (entry.directory) continue;
      const blob = await entry.getData(new zip.BlobWriter("application/octet-stream"), {
        password: entry.encrypted ? password : undefined,
      });
      out.push({ name: entry.filename, blob });
    }
    return out;
  } catch (error) {
    throw new ZipRecoveryError(
      "unreadable",
      "The password opened the archive but one or more entries could not be read. That usually means the archive is damaged or uses a compression method this browser does not support.",
    );
  } finally {
    await reader?.close().catch(() => undefined);
  }
}