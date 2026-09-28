/**
 * Generates a realistically sized PNG with no image library, so the AI image
 * tools can be tested with something closer to what a person actually uploads
 * than a 662-byte icon.
 *
 *   node scripts/make-test-image.mjs [width] [height] [outfile]
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const width = Number(process.argv[2] ?? 1400);
const height = Number(process.argv[3] ?? 1400);
const out = process.argv[4] ?? "public/icons/_test-large.png";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Noise, so the file does not compress to nothing and we exercise a real size.
const raw = Buffer.alloc(height * (1 + width * 3));
let seed = 12345;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed >> 16) & 0xff;
};
for (let y = 0; y < height; y += 1) {
  const rowStart = y * (1 + width * 3);
  raw[rowStart] = 0; // filter: none
  for (let x = 0; x < width * 3; x += 1) raw[rowStart + 1 + x] = random();
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 6 })),
  chunk("IEND", Buffer.alloc(0)),
]);

writeFileSync(out, png);
console.log(`${out}  ${width}x${height}  ${(png.length / 1024 / 1024).toFixed(2)} MB`);
