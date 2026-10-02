/**
 * Dumps the EXIF structure of a JPEG so a parse failure can be diagnosed
 * instead of guessed at.
 *
 *   node scripts/dump-exif.mjs tmp/exif-test.jpg
 */
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "tmp/exif-test.jpg";
const buf = readFileSync(file);
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const TYPE_NAME = {
  1: "BYTE", 2: "ASCII", 3: "SHORT", 4: "LONG", 5: "RATIONAL",
  6: "SBYTE", 7: "UNDEF", 8: "SSHORT", 9: "SLONG", 10: "SRATIONAL",
  11: "FLOAT", 12: "DOUBLE",
};

console.log(`${file} — ${buf.length} bytes\n`);

/* Locate the APP1 Exif segment. */
let tiffStart = -1;
if (view.getUint16(0) === 0xffd8) {
  let at = 2;
  while (at + 4 < view.byteLength) {
    if (view.getUint8(at) !== 0xff) break;
    const marker = view.getUint8(at + 1);
    const len = view.getUint16(at + 2);
    if (marker === 0xe1) {
      const head = buf.subarray(at + 4, at + 10).toString("ascii");
      if (head.startsWith("Exif")) {
        tiffStart = at + 10;
        console.log(`APP1 Exif found at byte ${at}, TIFF header at ${tiffStart}`);
        console.log(`  segment length: ${len}`);
      }
      break;
    }
    if (marker === 0xda) break;
    at += 2 + len;
  }
}

if (tiffStart < 0) {
  console.log("No Exif segment found.");
  process.exit(1);
}

const little = view.getUint16(tiffStart) === 0x4949;
console.log(`  byte order: ${little ? "little-endian (II)" : "big-endian (MM)"}`);
console.log(`  magic: ${view.getUint16(tiffStart + 2, little)} (42 = valid)`);
console.log(`  IFD0 offset: ${view.getUint32(tiffStart + 4, little)}`);

function dumpIfd(label, offset) {
  const start = tiffStart + offset;
  if (start + 2 > view.byteLength) {
    console.log(`\n${label}: out of bounds (start ${start})`);
    return 0;
  }
  const count = view.getUint16(start, little);
  // A count that cannot possibly fit is a misread pointer, not a real IFD.
  if (count > 256 || start + 2 + count * 12 > view.byteLength) {
    console.log(`\n${label}: implausible entry count ${count} at ${offset} — not a real IFD`);
    return 0;
  }
  console.log(`\n${label} at ${offset} — ${count} entries`);
  for (let i = 0; i < count; i += 1) {
    const e = start + 2 + i * 12;
    const tag = view.getUint16(e, little);
    const type = view.getUint16(e + 2, little);
    const n = view.getUint32(e + 4, little);
    const unit = TYPE_BYTES[type];
    const total = unit ? unit * n : 0;
    const inline = total <= 4;
    const base = inline ? e + 8 : tiffStart + view.getUint32(e + 8, little);

    let detail = "";
    if (unit && base + total <= view.byteLength) {
      if (type === 2) {
        detail = JSON.stringify(buf.subarray(base, base + Math.min(n, 40)).toString("ascii"));
      } else if (type === 5 || type === 10) {
        const parts = [];
        for (let k = 0; k < Math.min(n, 4); k += 1) {
          const o = base + k * 8;
          parts.push(`${view.getUint32(o, little)}/${view.getInt32(o + 4, little)}`);
        }
        detail = `[${parts.join(", ")}]`;
      } else if (type === 3) {
        detail = String(view.getUint16(base, little));
      } else if (type === 4) {
        detail = String(view.getUint32(base, little));
      }
    }

    const fits = unit ? (base + total <= view.byteLength ? "" : "  *** OUT OF BOUNDS ***") : "  *** UNKNOWN TYPE ***";
    console.log(
      `  ${i}: tag 0x${tag.toString(16).padStart(4, "0")} ${TYPE_NAME[type] ?? `t${type}`} count=${n} ` +
        `bytes=${total} base=${base} ${detail}${fits}`,
    );
  }
  return count;
}

const ifd0Offset = view.getUint32(tiffStart + 4, little);
dumpIfd("IFD0", ifd0Offset);

const start = tiffStart + ifd0Offset;
const count = view.getUint16(start, little);
for (let i = 0; i < count; i += 1) {
  const e = start + 2 + i * 12;
  const tag = view.getUint16(e, little);
  const type = view.getUint16(e + 2, little);
  const n = view.getUint32(e + 4, little);
  if ((tag === 0x8825 || tag === 0x8769) && type === 4 && n === 1) {
    const ptr = view.getUint32(e + 8, little);
    // A null sub-IFD pointer is normal and means "not present". Following it
    // would read whatever bytes happen to sit at offset 0 and print nonsense.
    if (ptr === 0) {
      console.log(`\n${tag === 0x8825 ? "GPS IFD" : "Exif IFD"}: null (not present)`);
      continue;
    }
    dumpIfd(tag === 0x8825 ? "GPS IFD" : "Exif IFD", ptr);
  }
}
