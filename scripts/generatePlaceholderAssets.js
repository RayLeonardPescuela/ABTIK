/**
 * Generates placeholder brand assets (icon / adaptive-icon / splash-icon).
 *
 * The real artwork should replace these files before a store submission —
 * the filenames are referenced by app.json, so dropping in replacements
 * requires no config changes. Run with:
 *
 *   npm run assets:placeholder
 *
 * Zero dependencies: hand-rolled PNG encoder (IHDR/IDAT/IEND + CRC32).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const DARK = [0x0b, 0x12, 0x20, 255]; // #0B1220
const ACCENT = [0xf5, 0xa5, 0x24, 255]; // #F5A524
const TRANSPARENT = [0, 0, 0, 0];

// --- PNG encoding -----------------------------------------------------------

function crc32(buf) {
  if (!crc32.table) {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- drawing ----------------------------------------------------------------

function setPixel(rgba, x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  rgba[i] = color[0];
  rgba[i + 1] = color[1];
  rgba[i + 2] = color[2];
  rgba[i + 3] = color[3];
}

function inRoundRect(x, y, x0, y0, w, h, r) {
  if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) return false;
  const dx = Math.min(x - x0, x0 + w - 1 - x);
  const dy = Math.min(y - y0, y0 + h - 1 - y);
  if (dx >= r || dy >= r) return true;
  const ex = r - dx;
  const ey = r - dy;
  return ex * ex + ey * ey <= r * r;
}

/**
 * Draws the ABTIK mark: rounded square + location pin, centred at (512,512).
 * @param {number} size - side length of the rounded square (base design: 640)
 * @param {boolean} withBackground - paint the full-bleed dark background
 */
function drawMark(rgba, size, withBackground) {
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const x0 = Math.round(cx - size / 2);
  const y0 = Math.round(cy - size / 2);
  const corner = Math.round(size * 0.219); // 140 / 640
  const s = size / 640;

  const circleR = 170 * s;
  const circleCy = cy - 82 * s;
  const triTop = circleCy;
  const triBottom = cy + 248 * s;
  const halfTop = 140 * s;
  const holeR = 70 * s;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let color = withBackground ? DARK : TRANSPARENT;

      if (inRoundRect(x, y, x0, y0, size, size, corner)) {
        color = ACCENT;
        const dx = x - cx;
        const dy = y - circleCy;
        const inCircle = dx * dx + dy * dy <= circleR * circleR;
        const inTriangle =
          y >= triTop &&
          y <= triBottom &&
          Math.abs(x - cx) <= halfTop * ((triBottom - y) / (triBottom - triTop));
        if (inCircle || inTriangle) color = DARK;
        if (dx * dx + dy * dy <= holeR * holeR) color = ACCENT;
      }

      setPixel(rgba, x, y, color);
    }
  }
}

function render(size, withBackground) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  drawMark(rgba, size, withBackground);
  return encodePng(SIZE, SIZE, rgba);
}

// --- write ------------------------------------------------------------------

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['icon.png', render(640, true)], // full-bleed app icon
  ['adaptive-icon.png', render(424, false)], // 66% safe zone, transparent
  ['splash-icon.png', render(410, false)], // centred logo, transparent
];

for (const [name, buffer] of files) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, buffer);
  console.log(`wrote ${path.relative(process.cwd(), file)} (${buffer.length} bytes)`);
}

console.log('Placeholder assets generated — replace before store submission.');
