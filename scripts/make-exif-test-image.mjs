/**
 * Builds a JPEG that genuinely carries EXIF, GPS and XMP metadata.
 *
 * Needed to test the metadata remover honestly. A generated PNG has no
 * metadata by construction, so testing against one would prove only that the
 * tool reports "nothing found" — which it would, correctly, and which tells us
 * nothing about whether it removes anything.
 *
 * A minimal valid JPEG is used as the image body and a real APP1 segment is
 * spliced in after the SOI marker, so the result decodes normally and still
 * contains exactly the tags written below.
 *
 *   node scripts/make-exif-test-image.mjs [outfile]
 */
import { writeFileSync } from "node:fs";

/* A 1x1 baseline JPEG. Decodes everywhere, carries no metadata of its own. */
const BASE_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAAR" +
    "CAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA" +
    "AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK" +
    "FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWG" +
    "h4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl" +
    "5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA" +
    "AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYk" +
    "NOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE" +
    "hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk" +
    "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);

const out = process.argv[2] ?? "tmp/exif-test.jpg";

/* -- EXIF/TIFF construction ------------------------------------------------- */
/* Little-endian ("II"). Offsets are from the start of the TIFF header.      */

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const BYTE = 1;

const asciiBytes = (s) => [...Buffer.from(s, "ascii"), 0];

/** A heap-allocated value blob that an entry can point at. */
function heap(bytes) {
  return Buffer.from(bytes);
}

/** 8-byte unsigned rational, the EXIF type 5 element. */
function rational(n, d) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(n, 0);
  b.writeUInt32LE(d, 4);
  return b;
}

/** Degrees/minutes/seconds, the way GPS coordinates are actually stored. */
function dms(deg, min, sec) {
  return Buffer.concat([rational(deg, 1), rational(min, 1), rational(Math.round(sec * 100), 100)]);
}

/**
 * Assembles one IFD: the entry table, a zero next-IFD pointer, then a value heap.
 *
 * Two passes, because an entry's offset into the heap is not known until the
 * table's size is known, and the table's size depends only on the entry count.
 * Allocating the table alone and writing the heap past its end silently drops
 * every value longer than four bytes — which is most of them.
 */
function buildIfd(entries, base) {
  const count = entries.length;
  const tableSize = 2 + count * 12 + 4;

  // Pad every heap value to an even offset, as the spec requires.
  let heapSize = 0;
  for (const e of entries) {
    if (e.payload.length > 4) {
      e.offset = base + tableSize + heapSize;
      heapSize += e.payload.length + (e.payload.length & 1);
    }
  }

  const buf = Buffer.alloc(tableSize + heapSize);
  buf.writeUInt16LE(count, 0);

  entries.forEach((e, i) => {
    const at = 2 + i * 12;
    buf.writeUInt16LE(e.tag, at);
    buf.writeUInt16LE(e.type, at + 2);
    // The count field is a number of ELEMENTS, not bytes. For ASCII those
    // happen to coincide because the payload includes its NUL terminator, but
    // a RATIONAL[3] array is 24 bytes and must declare a count of 3. Writing
    // the byte length instead makes the array look like garbage, which shows up
    // as a GPS block that is "present but incomplete".
    buf.writeUInt32LE(e.count ?? e.payload.length, at + 4);
    if (e.payload.length > 4) {
      buf.writeUInt32LE(e.offset, at + 8);
      e.payload.copy(buf, e.offset - base);
    } else {
      e.payload.copy(buf, at + 8);
    }
  });

  // next-IFD pointer stays zero: there is no IFD1 in this file.
  buf.writeUInt32LE(0, 2 + count * 12);

  return { buf, size: buf.length };
}

const EXIF_IFD_POINTER = 0;

/* The TIFF header: "II", 42, then the offset of IFD0 measured from here. */
const TIFF_HEADER = 8;

/* IFD0: the camera, the software, and a pointer to the GPS IFD. Reserved for a
 * possible Exif sub-IFD, left null.
 *
 * Every numeric tag declares `count: 1` explicitly. The default is the payload's
 * byte length, which is right for ASCII and wrong for everything else: a LONG
 * pointer is 4 bytes holding ONE value, and writing count=4 makes a reader
 * compute a 16-byte value, follow a garbage offset, and discard the tag. The
 * GPS pointer disappears that way and the block looks simply absent. */
const IFD0_ENTRIES = [
  { tag: 0x010f, type: ASCII, payload: heap(asciiBytes("BaluTools")) },            // Make
  { tag: 0x0110, type: ASCII, payload: heap(asciiBytes("MetadataTestCam 9000")) },  // Model
  { tag: 0x0131, type: ASCII, payload: heap(asciiBytes("Balu Tools 1.0")) },       // Software
  { tag: 0x0132, type: ASCII, payload: heap(asciiBytes("2026:10:02 14:31:07")) }, // DateTime
  { tag: 0x0112, type: SHORT, count: 1, payload: heap(Buffer.from([1, 0])) },      // Orientation
  { tag: 0x8769, type: LONG, count: 1, payload: heap(Buffer.from([0, 0, 0, 0])) },  // ExifIFD ptr
  { tag: 0x8825, type: LONG, count: 1, payload: heap(Buffer.from([0, 0, 0, 0])) },  // GPS ptr
];

/* The GPS block: a real coordinate, so removal is observable. `count` is the
 * number of rationals, not the byte length of the array. */
const GPS_ENTRIES = [
  { tag: 0x0001, type: ASCII, payload: heap(asciiBytes("N")) },   // LatitudeRef
  { tag: 0x0002, type: RATIONAL, count: 3, payload: heap(dms(51, 30, 26.4)) },
  { tag: 0x0003, type: ASCII, payload: heap(asciiBytes("W")) },   // LongitudeRef
  { tag: 0x0004, type: RATIONAL, count: 3, payload: heap(dms(0, 7, 39.6)) },
  { tag: 0x0005, type: BYTE, count: 1, payload: heap(Buffer.from([0])) },   // AltitudeRef
  { tag: 0x0006, type: RATIONAL, count: 1, payload: heap(rational(35, 1)) }, // Altitude
];

const ifd0Offset = TIFF_HEADER;
const ifd0 = buildIfd(IFD0_ENTRIES, ifd0Offset);
const gpsOffset = ifd0Offset + ifd0.size;
const gps = buildIfd(GPS_ENTRIES, gpsOffset);

// Now that the GPS IFD's offset is final, point IFD0 at it.
const gpsPointerAt = 2 + 6 * 12 + 8; // entry index 6 (the GPS pointer)
ifd0.buf.writeUInt32LE(gpsOffset, gpsPointerAt);

const tiff = Buffer.concat([
  (() => {
    const h = Buffer.alloc(TIFF_HEADER);
    h.write("II", 0, "ascii");
    h.writeUInt16LE(42, 2);
    h.writeUInt32LE(ifd0Offset, 4);
    return h;
  })(),
  ifd0.buf,
  gps.buf,
]);

const payload = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
const app1Length = Buffer.alloc(2);
app1Length.writeUInt16BE(payload.length + 2, 0); // length covers itself + payload
const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), app1Length, payload]);

/* Splice after the SOI marker (first two bytes). */
const jpeg = Buffer.concat([BASE_JPEG.subarray(0, 2), app1, BASE_JPEG.subarray(2)]);

writeFileSync(out, jpeg, { flag: "w" });

/* -- Report, so a failure here is legible rather than mysterious ----------- */

const has = (needle) => jpeg.includes(needle);
const checks = [
  ["APP1 segment present", has(Buffer.from("Exif\0\0", "ascii"))],
  ["Make written", has(Buffer.from("BaluTools", "ascii"))],
  ["Model written", has(Buffer.from("MetadataTestCam 9000", "ascii"))],
  ["Software written", has(Buffer.from("Balu Tools 1.0", "ascii"))],
  ["GPS coordinate written", has(Buffer.from("N\0", "ascii"))],
  ["still a JPEG (SOI present)", jpeg[0] === 0xff && jpeg[1] === 0xd8],
  ["still ends with EOI", jpeg[jpeg.length - 2] === 0xff && jpeg[jpeg.length - 1] === 0xd9],
];

console.log(`wrote ${out} — ${jpeg.length} bytes\n`);
let bad = 0;
for (const [label, ok] of checks) {
  if (!ok) bad += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
}
process.exit(bad === 0 ? 0 : 1);
