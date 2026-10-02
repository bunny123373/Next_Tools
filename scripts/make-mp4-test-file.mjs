/**
 * Builds a minimal but genuinely valid MP4 carrying real iTunes-style metadata.
 *
 * Same reasoning as the EXIF fixture: a file with no metadata would only prove
 * the tool reports "nothing found", which tells us nothing about whether it can
 * remove anything.
 *
 * This writes a real ISO base media container — ftyp, moov (with mvhd, trak,
 * tkhd and a udta/meta/ilst item list), then mdat holding identifiable bytes.
 * The mdat payload is deliberately a recognisable pattern so the test can prove
 * the media data came through the strip untouched rather than being re-encoded.
 *
 *   node scripts/make-mp4-test-file.mjs [outfile]
 */
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "tmp/mp4-test.mp4";

/* -- box construction -------------------------------------------------------- */

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
};

/** [size][type][payload] */
const box = (type, ...payload) => {
  const body = Buffer.concat(payload.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  return Buffer.concat([u32(body.length + 8), Buffer.from(type, "ascii"), body]);
};

/** A FullBox: version and flags before the payload. */
const fullBox = (type, version, flags, ...payload) =>
  box(type, Buffer.from([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...payload);

/* -- identity                                                              -- */

const IDENTITY = Buffer.from("BaluToolsVideoTest");
const COMMENT = Buffer.from("shot on the roof, do not repost");
const TITLE = Buffer.from("Private holiday footage");
const AUTHOR = Buffer.from("Balu Jeswanth");

/** A `data` atom holding UTF-8 text. Type flag 1 = UTF-8. */
const dataAtom = (text) => fullBox("data", 0, 1, u32(0), text);

/** An ilst item: a four-character key wrapping a data atom. */
const item = (key, text) => box(key, dataAtom(Buffer.from(text, "utf8")));

/* -- metadata --------------------------------------------------------------- */

const ilst = box(
  "ilst",
  box("\xa9nam", dataAtom(TITLE)),
  box("\xa9ART", dataAtom(AUTHOR)),
  box("\xa9too", dataAtom(Buffer.from("Balu Tools 1.0", "utf8"))),
  box("\xa9day", dataAtom(Buffer.from("2026:10:02 14:31:07", "utf8"))),
  box("\xa9cmt", dataAtom(COMMENT)),
  box("\xa9wrt", dataAtom(Buffer.from("Balu Jeswanth", "utf8"))),
  // The location field. This is the one that matters for privacy.
  box("loci", dataAtom(Buffer.from("+51.5073-000.1277/", "utf8"))),
  // A cover image, so there is a genuinely large blob to account for.
  box("covr", fullBox("data", 0, 13, u32(0), Buffer.alloc(4096, 0x42))),
);

const udta = box("udta", fullBox("meta", 0, 0, box("hdlr", u32(0), Buffer.from("mdirappl", "ascii")) , ilst));

/* -- moov, with real track structure so the file stays plausible ---------- */

const mvhd = fullBox(
  "mvhd",
  0,
  0,
  u32(0), u32(0),          // creation, modification
  u32(1000), u32(0),       // timescale, duration
  u32(0x00010000), u32(0x01000000), // rate, volume
  u32(0), u32(0),
  // unity matrix
  u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
  u32(0), u32(0), u32(0), u32(0), u32(0), u32(0),
  u32(2),                  // next track id
);

const tkhd = fullBox(
  "tkhd",
  0,
  3,
  u32(0), u32(0), u32(1), u32(0), u32(1000),
  u32(0), u32(0),
  u16(0), u16(0), u16(0), u16(0),
  u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000),
  u32(320 << 16), u32(180 << 16),
);

const mdhd = fullBox("mdhd", 0, 0, u32(0), u32(0), u32(1000), u32(0), u16(0x55c4), u16(0));
const hdlr = fullBox("hdlr", 0, 0, u32(0), Buffer.from("vide", "ascii"), u32(0), u32(0), u32(0), Buffer.from("VideoHandler\0", "ascii"));
const vmhd = fullBox("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0));
const dref = fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1));
const dinf = box("dinf", dref);

const trak = box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", vmhd, dinf)));

/* ftyp */
const ftyp = box("ftyp", Buffer.from("isom", "ascii"), u32(0x200), Buffer.from("isomiso2avc1mp41", "ascii"));

/* -- mdat: the media data the stripper must not touch --------------------- */

const pattern = Buffer.alloc(8192);
for (let i = 0; i < pattern.length; i += 1) pattern[i] = (i * 7 + 13) & 0xff;
IDENTITY.copy(pattern, 0);
const mdat = box("mdat", pattern);

const moov = box("moov", mvhd, trak, udta);
const file = Buffer.concat([ftyp, moov, mdat]);

writeFileSync(out, file, { flag: "w" });

/* -- report ----------------------------------------------------------------- */

const checks = [
  ["ftyp present", file.includes(Buffer.from("ftyp", "ascii"))],
  ["moov present", file.includes(Buffer.from("moov", "ascii"))],
  ["udta present", file.includes(Buffer.from("udta", "ascii"))],
  ["ilst present", file.includes(Buffer.from("ilst", "ascii"))],
  ["title written", file.includes(TITLE)],
  ["comment written", file.includes(COMMENT)],
  ["location written", file.includes(Buffer.from("+51.5073-000.1277/", "utf8"))],
  ["identity in mdat", file.includes(IDENTITY)],
  ["mdat present", file.includes(Buffer.from("mdat", "ascii"))],
  ["covr payload present", file.includes(Buffer.alloc(64, 0x42))],
];

console.log(`wrote ${out} — ${file.length} bytes`);
console.log(`  ftyp=${ftyp.length}  moov=${moov.length}  udta=${udta.length}  mdat=${mdat.length}\n`);
let bad = 0;
for (const [label, ok] of checks) {
  if (!ok) bad += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
}
process.exit(bad === 0 ? 0 : 1);
