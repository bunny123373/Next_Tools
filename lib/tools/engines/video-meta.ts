/**
 * ISO base media file format (MP4 / QuickTime / MOV) metadata reader and
 * stripper.
 *
 * Why this exists rather than going through the canvas like the other video
 * tools do: stripping metadata does not require touching the picture. The tags
 * live in `moov/udta`, and the actual audio and video samples live in `mdat`.
 * Copying every box except `udta` produces a file that is bit-for-bit
 * identical in its media data and has nothing left to strip. Re-encoding would
 * throw away quality and several minutes of processing to achieve the same
 * result.
 *
 * The one thing this cannot do — and which no metadata tool can do — is remove
 * a visible watermark, because a burned-in logo is part of the video frames
 * rather than part of the metadata. Removing that means re-encoding every
 * frame, and it still only works if something is available to paint over the
 * area. This module never claims to have done that.
 *
 * Scope, deliberately narrow:
 *   - only `udta` (and the `meta` inside it) is removed
 *   - `moov`, `trak`, `mdia`, `minf`, `stbl`, `stsd` and `mdat` are never
 *     touched, because removing any of them makes the file unplayable
 *   - `ftyp` is preserved, since players use it to pick a parser
 *   - box sizes are recomputed on the way out, including the 64-bit form
 */

/** One readable metadata field found in the container. */
export interface VideoTag {
  /** The four-character atom name, e.g. "©nam", "loci", or "mdta". */
  key: string;
  /** A friendlier label where one is well known. */
  label: string;
  /** Decoded text, when the value is textual. */
  value: string | null;
  /** Byte size of the whole atom, so a large cover image can be reported
   *  honestly without embedding megabytes of base64 in the UI. */
  bytes: number;
}

export interface VideoTagReport {
  /** "mp4", "quicktime", "3gpp" or similar, read from `ftyp`. */
  brand: string | null;
  /** Top-level box types present, in file order. Useful when a file will not parse. */
  boxes: string[];
  tags: VideoTag[];
  /** Fields that hold a location, flagged separately because they are the
   *  reason people strip metadata before publishing. */
  hasLocation: boolean;
}

/* -------------------------------------------------------------------------- */
/* box walking                                                                 */
/* -------------------------------------------------------------------------- */

interface Box {
  type: string;
  /** Offset of the 8-byte header. */
  start: number;
  /** Total size including the header. */
  size: number;
  /** True when the size field was 1 and a 64-bit largesize followed. */
  wide: boolean;
  /** Offset of the first child byte, i.e. past any FullBox version/flags. */
  bodyStart: number;
}

const ascii = (view: DataView, at: number, length: number) => {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(view.getUint8(at + i));
  return out;
};

/** `meta` is a FullBox: four bytes of version and flags come before its children.
 *  Getting this wrong makes every child offset four bytes wrong, which looks
 *  like a corrupt file rather than a parser mistake. */
const FULL_BOX = new Set(["meta"]);

/** Reads the box header at `at`, or null when fewer than 8 bytes remain. */
function readBox(view: DataView, at: number, limit: number): Box | null {
  if (at + 8 > limit) return null;
  let size = view.getUint32(at);
  const type = ascii(view, at + 4, 4);
  let wide = false;

  if (size === 1) {
    if (at + 16 > limit) return null;
    const high = view.getUint32(at + 8);
    const low = view.getUint32(at + 12);
    size = high * 2 ** 32 + low;
    wide = true;
  } else if (size === 0) {
    // A size of 0 means the box runs to the end of the file.
    size = limit - at;
  }

  if (size < 8 || at + size > limit) return null;

  return {
    type,
    start: at,
    size,
    wide,
    bodyStart: at + (wide ? 16 : 8) + (FULL_BOX.has(type) ? 4 : 0),
  };
}

/** Every direct child box of a container region. */
function childrenOf(view: DataView, from: number, to: number): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at < to) {
    const box = readBox(view, at, to);
    if (!box) break;
    out.push(box);
    at += box.size;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* reading                                                                     */
/* -------------------------------------------------------------------------- */

const KNOWN_LABELS: Record<string, string> = {
  "©nam": "Title",
  "©ART": "Artist",
  "©alb": "Album",
  "©day": "Date",
  "©cmt": "Comment",
  "©too": "Encoder",
  "©gen": "Genre",
  "©wrt": "Writer",
  "©cpy": "Copyright",
  "©prd": "Producer",
  "©dir": "Director",
  "desc": "Description",
  "ldes": "Long description",
  "loci": "Location",
  "©xyz": "GPS coordinates",
  "purd": "Purchase date",
  "©st3": "Subtitle",
  "©enc": "Encoded by",
  "©mak": "Camera make",
  "©mod": "Camera model",
  "©swr": "Software",
};

const utf8 = new TextDecoder("utf-8", { fatal: false });

/**
 * Decodes the `data` atom inside an `ilst` item.
 *
 * Each item is `<item><data version flags locale value>`. The first four bytes
 * of the payload are version/flags, then a locale, then the bytes. The data
 * type in the flags decides how to read it: 1 is UTF-8 text, 13 is JPEG, 0 is
 * binary. Only text is decoded; anything else is reported by size, because a
 * 2 MB cover art has no useful text form and putting it in the UI would be
 * noise.
 */
function decodeDataAtom(view: DataView, data: Box): { value: string | null } {
  if (data.size < 16) return { value: null };
  const type = view.getUint32(data.start + 8) & 0x00ffffff;
  const payloadAt = data.start + 16;
  const length = data.start + data.size - payloadAt;
  if (length <= 0) return { value: null };

  if (type !== 1) return { value: null };

  const raw = new Uint8Array(view.buffer, view.byteOffset + payloadAt, length);
  // Values are frequently NUL-terminated; the terminator is not part of the text.
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0) end -= 1;
  return { value: utf8.decode(raw.subarray(0, end)).slice(0, 300) };
}

/** Keys that hold a place. Reported apart because they are why people ask. */
const LOCATION_KEYS = new Set(["loci", "©xyz"]);

/** Walks `moov/udta` and collects anything worth showing. */
function collectFromUdta(view: DataView, udta: Box, out: VideoTag[]): void {
  for (const child of childrenOf(view, udta.bodyStart, udta.start + udta.size)) {
    if (child.type === "meta") {
      // QuickTime keeps the item list inside meta/ilst.
      for (const inner of childrenOf(view, child.bodyStart, child.start + child.size)) {
        if (inner.type === "ilst") collectFromIlst(view, inner, out);
        else if (inner.type === "hdlr") continue;
        else
          out.push({
            key: inner.type,
            label: KNOWN_LABELS[inner.type] ?? inner.type,
            value: null,
            bytes: inner.size,
          });
      }
      continue;
    }

    if (child.type === "ilst") {
      collectFromIlst(view, child, out);
      continue;
    }

    // udta children are sometimes bare atoms holding text directly.
    out.push({
      key: child.type,
      label: KNOWN_LABELS[child.type] ?? child.type,
      value: null,
      bytes: child.size,
    });
  }
}

function collectFromIlst(view: DataView, ilst: Box, out: VideoTag[]): void {
  for (const item of childrenOf(view, ilst.bodyStart, ilst.start + ilst.size)) {
    let value: string | null = null;
    for (const data of childrenOf(view, item.bodyStart, item.start + item.size)) {
      if (data.type === "data") {
        value = decodeDataAtom(view, data).value;
        break;
      }
    }
    out.push({
      key: item.type,
      label: KNOWN_LABELS[item.type] ?? item.type,
      value,
      bytes: item.size,
    });
  }
}

/**
 * Reports the metadata in a video container without changing anything.
 *
 * Returns an empty tag list for a file that has none, which is the honest
 * answer for most screen recordings and for anything that has already been
 * through an editor.
 */
export async function readVideoMetadata(file: Blob): Promise<VideoTagReport> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const top = childrenOf(view, 0, buffer.byteLength);

  let brand: string | null = null;
  for (const box of top) {
    if (box.type === "ftyp" && box.start + 12 <= box.start + box.size) {
      brand = ascii(view, box.start + 8, 4);
      break;
    }
  }

  const tags: VideoTag[] = [];
  for (const box of top) {
    if (box.type !== "moov") continue;
    for (const child of childrenOf(view, box.bodyStart, box.start + box.size)) {
      if (child.type === "udta") collectFromUdta(view, child, tags);
    }
  }

  return {
    brand,
    boxes: top.map((b) => b.type),
    tags,
    hasLocation: tags.some((t) => LOCATION_KEYS.has(t.key)),
  };
}

/* -------------------------------------------------------------------------- */
/* removing                                                                    */
/* -------------------------------------------------------------------------- */

export interface StripVideoResult {
  blob: Blob;
  filename: string;
  /** Fields that were present and are gone. */
  removed: VideoTag[];
  /** Byte size of `udta`, i.e. what leaving the file saves. */
  removedBytes: number;
  wasAlreadyClean: boolean;
  beforeBytes: number;
  afterBytes: number;
  /** Top-level boxes in the output, for the UI to show nothing was lost. */
  boxes: string[];
  /** True when a fresh read of the output found no `udta`. */
  verified: boolean;
  /** Set when the file is not an ISO container and cannot be handled. */
  unsupported?: string;
}

/**
 * Removes `udta` from an MP4/MOV/3GP file, keeping every other box byte-exact.
 *
 * The rewrite walks the top-level boxes and copies each one, skipping `udta`
 * wherever it appears at the top level or inside `moov`, then patches the
 * recorded size of every container that lost a child. Copying rather than
 * re-muxing is what makes the media data identical: `mdat` is never parsed,
 * re-encoded or even interpreted.
 */
export async function stripVideoMetadata(file: Blob, name: string): Promise<StripVideoResult> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  if (buffer.byteLength < 16 || view.getUint32(4) !== 0x66747970 /* ftyp */) {
    const notIso = !topIsIso(view, buffer.byteLength);
    return {
      blob: file,
      filename: name,
      removed: [],
      removedBytes: 0,
      wasAlreadyClean: true,
      beforeBytes: file.size,
      afterBytes: file.size,
      boxes: [],
      verified: false,
      unsupported: notIso
        ? "This is not an MP4, MOV or 3GP container, so it has no metadata atoms to remove. " +
          "WebM and Matroska keep their tags in a different structure that this tool does not read yet."
        : "The file looks like an MP4 but its header could not be read, so it may be truncated or damaged.",
    };
  }

  const report = await readVideoMetadata(file);
  const top = childrenOf(view, 0, buffer.byteLength);

  /* Which top-level boxes to drop. `udta` is legal both at the top level and
   * inside `moov`, and some encoders use one, some the other. */
  const dropped = new Set(top.filter((b) => b.type === "udta").map((b) => b.start));

  /* Same thing one level down: drop udta inside each moov, and record how much
   * to subtract from the moov header. */
  const moovShrink = new Map<number, number>();
  for (const box of top) {
    if (box.type !== "moov") continue;
    let shrink = 0;
    for (const child of childrenOf(view, box.bodyStart, box.start + box.size)) {
      if (child.type === "udta") {
        shrink += child.size;
        dropped.add(child.start);
      }
    }
    if (shrink > 0) moovShrink.set(box.start, shrink);
  }

  let removedBytes = 0;
  for (const at of dropped) {
    const box = readBox(view, at, buffer.byteLength);
    if (box) removedBytes += box.size;
  }

  const pieces: Uint8Array[] = [];
  for (const box of top) {
    if (dropped.has(box.start)) continue;

    if (moovShrink.has(box.start)) {
      // Copy the moov with the offending children excised, then rewrite its
      // declared size. Everything inside the children that survive is copied
      // verbatim; only `udta` disappears.
      const patched = new Uint8Array(box.size - moovShrink.get(box.start)!);
      patched.set(new Uint8Array(buffer, box.start, box.bodyStart - box.start), 0);
      let at = box.bodyStart;
      for (const child of childrenOf(view, box.bodyStart, box.start + box.size)) {
        if (dropped.has(child.start)) continue;
        patched.set(
          new Uint8Array(buffer, child.start, child.size),
          at - box.start,
        );
        at += child.size;
      }
      writeBoxSize(patched, 0, patched.length, box.wide);
      pieces.push(patched);
      continue;
    }

    pieces.push(new Uint8Array(buffer, box.start, box.size));
  }

  const total = pieces.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const piece of pieces) {
    out.set(piece, cursor);
    cursor += piece.length;
  }

  const blob = new Blob([out], { type: file.type || "video/mp4" });
  const after = await readVideoMetadata(blob);
  const stem = name.replace(/\.[^.]+$/, "") || "video";

  return {
    blob,
    filename: `${stem}.clean.mp4`,
    removed: report.tags,
    removedBytes,
    wasAlreadyClean: report.tags.length === 0,
    beforeBytes: file.size,
    afterBytes: blob.size,
    boxes: after.boxes,
    verified: after.tags.length === 0,
  };
}

/** Writes a box length back, honouring the 64-bit form when the box used it. */
function writeBoxSize(target: Uint8Array, at: number, size: number, wide: boolean): void {
  const view = new DataView(target.buffer, target.byteOffset, target.byteLength);
  if (!wide || size < 2 ** 32) {
    view.setUint32(at, size);
    return;
  }
  view.setUint32(at, 1);
  view.setUint32(at + 8, Math.floor(size / 2 ** 32));
  view.setUint32(at + 12, size >>> 0);
}

/** Cheap check for an ISO signature anywhere in the first bytes. */
function topIsIso(view: DataView, length: number): boolean {
  return view.getUint32(4) === 0x66747970 && length > 16;
}
