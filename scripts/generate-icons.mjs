/**
 * Generates the PWA / OG image assets with zero dependencies.
 *
 * Why not a design tool: the icons need to be regenerable from source on any
 * machine, and adding sharp or canvas just to draw a "B" is a poor trade. This
 * script rasterises a tiny 5x7 bitmap font and encodes real PNGs using Node's
 * built-in zlib.
 *
 * Run: `node scripts/generate-icons.mjs`
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/icons");

/* ------------------------------------------------------------------ */
/*  5x7 bitmap font (uppercase + digits + a little punctuation)        */
/* ------------------------------------------------------------------ */

const FONT = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.###.",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: "#####|..#..|..#..|..#..|..#..|..#..|#####",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#...#|#...#|#...#|#...#",
  N: "#...#|##..#|#.#.#|#..##|#...#|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#...#|#.#.#|##.##|#...#",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  0: ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  1: "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  2: ".###.|#...#|....#|...#.|..#..|.#...|#####",
  3: "#####|...#.|..#..|...#.|....#|#...#|.###.",
  4: "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  5: "#####|#....|####.|....#|....#|#...#|.###.",
  6: "..##.|.#...|#....|####.|#...#|#...#|.###.",
  7: "#####|....#|...#.|..#..|.#...|.#...|.#...",
  8: ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  9: ".###.|#...#|#...#|.####|....#|...#.|.##..",
  " ": ".....|.....|.....|.....|.....|.....|.....",
  ".": ".....|.....|.....|.....|.....|.##..|.##..",
  ",": ".....|.....|.....|.....|.##..|.##..|.#...",
  "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..",
  "-": ".....|.....|.....|#####|.....|.....|.....",
  _: ".....|.....|.....|.....|.....|.....|#####",
  "'": "..#..|..#..|.....|.....|.....|.....|.....",
  '"': ".#.#.|.#.#.|.....|.....|.....|.....|.....",
  "/": "....#|....#|...#.|..#..|.#...|#....|#....",
  "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
  ":": ".....|.....|..#..|.....|.....|..#..|.....",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
  "(": "...#.|..#..|.#...|.#...|.#...|..#..|...#.",
  ")": ".#...|..#..|...#.|...#.|...#.|..#..|.#...",
  "&": ".##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#",
  "*": ".....|#.#.#|.###.|#####|.###.|#.#.#|.....",
  "=": ".....|.....|#####|.....|#####|.....|.....",
  "%": "#...#|....#|...#.|..#..|.#...|#....|#...#",
  "#": ".#.#.|#####|.#.#.|.#.#.|#####|.#.#.|.....",
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function glyph(ch) {
  const rows = (FONT[ch] ?? FONT[" "]).split("|");
  return rows.map((row) => row.padEnd(GLYPH_W, ".").slice(0, GLYPH_W));
}

/* ------------------------------------------------------------------ */
/*  Raster canvas                                                      */
/* ------------------------------------------------------------------ */

function createCanvas(width, height, fill) {
  const data = Buffer.alloc(width * height * 3);
  if (fill) {
    for (let i = 0; i < data.length; i += 3) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
    }
  }
  return { width, height, data };
}

function setPixel(canvas, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const i = (y * canvas.width + x) * 3;
  canvas.data[i] = r;
  canvas.data[i + 1] = g;
  canvas.data[i + 2] = b;
}

function fillRect(canvas, x, y, w, h, color) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(canvas, x + dx, y + dy, color);
    }
  }
}

/** Rounded rectangle with a radius in pixels, drawn per-pixel. */
function fillRoundedRect(canvas, x, y, w, h, radius, color) {
  const r = Math.min(radius, Math.floor(w / 2), Math.floor(h / 2));
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
      // Distance test against the nearest corner centre.
      const cx = dx < r ? r : dx > w - r - 1 ? w - r - 1 : dx;
      const cy = dy < r ? r : dy > h - r - 1 ? h - r - 1 : dy;
      const nx = dx - cx;
      const ny = dy - cy;
      if (nx * nx + ny * ny <= r * r) setPixel(canvas, px, py, color);
    }
  }
}

/** Draws text with the 5x7 font. Returns the advance width. */
function drawText(canvas, text, x, y, scale, color, letterSpacing = 1) {
  const chars = [...text.toUpperCase()];
  let cursor = x;
  for (const ch of chars) {
    const rows = glyph(ch);
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (rows[gy][gx] === "#") {
          fillRect(canvas, cursor + gx * scale, y + gy * scale, scale, scale, color);
        }
      }
    }
    cursor += (GLYPH_W + letterSpacing) * scale;
  }
  return cursor - x;
}

function measureText(text, scale, letterSpacing = 1) {
  return [...text.toUpperCase()].length * (GLYPH_W + letterSpacing) * scale - letterSpacing * scale;
}

/* ------------------------------------------------------------------ */
/*  PNG encoder                                                        */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(canvas) {
  const { width, height, data } = canvas;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter type (0 = None).
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    data.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Brand palette (mirrors app/globals.css)                            */
/* ------------------------------------------------------------------ */

const BLACK = [5, 5, 5];
const CARD = [13, 13, 13];
const CARD2 = [18, 18, 18];
const LINE = [36, 36, 36];
const WHITE = [255, 255, 255];
const MUTED = [138, 138, 138];
const BRAND = [255, 59, 48];

/* ------------------------------------------------------------------ */
/*  Icon                                                               */
/* ------------------------------------------------------------------ */

/** The mark: a red rounded square with a white "B". */
function drawMark(canvas, cx, cy, size) {
  const half = Math.floor(size / 2);
  fillRoundedRect(canvas, cx - half, cy - half, size, size, Math.floor(size * 0.24), BRAND);
  const scale = Math.max(1, Math.floor(size * 0.098));
  const textW = measureText("B", scale);
  drawText(canvas, "B", Math.round(cx - textW / 2), Math.round(cy - (GLYPH_H * scale) / 2), scale, WHITE);
}

function makeIcon(size, { maskable = false } = {}) {
  const canvas = createCanvas(size, size, BLACK);
  // Maskable icons need the content inside the safe zone (centre 80%).
  const markSize = maskable ? Math.floor(size * 0.56) : Math.floor(size * 0.62);
  drawMark(canvas, Math.floor(size / 2), Math.floor(size / 2), markSize);
  return encodePng(canvas);
}

/* ------------------------------------------------------------------ */
/*  Open Graph / Twitter card                                         */
/* ------------------------------------------------------------------ */

function makeOgImage() {
  const width = 1200;
  const height = 630;
  const canvas = createCanvas(width, height, BLACK);

  // Subtle card panel behind the content, with a hairline border.
  fillRoundedRect(canvas, 40, 40, width - 80, height - 80, 24, CARD);
  fillRoundedRect(canvas, 40, 40, width - 80, 2, 1, LINE);

  drawMark(canvas, 130, 175, 116);

  drawText(canvas, "BALU TOOLS", 200, 145, 7, WHITE, 2);
  drawText(canvas, "SIMPLE TOOLS. POWERFUL RESULTS.", 202, 205, 3, BRAND, 1);

  const lines = [
    "FAST, PRIVATE, BROWSER-BASED UTILITIES FOR",
    "IMAGES, PDFS, VIDEO, AUDIO, TEXT, AI AND",
    "DEVELOPERS. NO SIGN-UP REQUIRED.",
  ];
  lines.forEach((line, index) => {
    drawText(canvas, line, 80, 340 + index * 46, 4, MUTED, 1);
  });

  // Accent rule + domain line.
  fillRoundedRect(canvas, 80, 500, 120, 4, 2, BRAND);
  const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://balu.tools").host.toUpperCase();
  drawText(canvas, site, 80, 530, 3, MUTED, 1);

  return encodePng(canvas);
}

/* ------------------------------------------------------------------ */
/*  Favicon (32px, 16px)                                               */
/* ------------------------------------------------------------------ */

function makeFavicon(size) {
  const canvas = createCanvas(size, size, null);
  drawMark(canvas, 0, 0, size);
  return encodePng(canvas);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

mkdirSync(OUT, { recursive: true });

const outputs = [
  ["public/icons/icon-192.png", makeIcon(192)],
  ["public/icons/icon-512.png", makeIcon(512)],
  ["public/icons/maskable-512.png", makeIcon(512, { maskable: true })],
  ["public/icons/apple-touch-icon.png", makeIcon(180)],
  ["public/icons/favicon-32.png", makeFavicon(32)],
  ["public/icons/favicon-16.png", makeFavicon(16)],
  ["public/opengraph-image.png", makeOgImage()],
];

for (const [relative, buffer] of outputs) {
  const target = resolve(ROOT, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  console.log(`wrote ${relative} (${(buffer.length / 1024).toFixed(1)} KB)`);
}
