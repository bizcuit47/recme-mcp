'use strict';

// Draws the Recme app icon (build/icon.png, 512x512): a red record ring on a dark rounded square.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const px = Buffer.alloc(SIZE * SIZE * 4);

const clamp = (v) => Math.min(1, Math.max(0, v));
const BG = [24, 27, 34];
const RED = [255, 77, 94];

function roundedRectAlpha(x, y, r) {
  // signed distance to a rounded square filling the canvas (with a small margin)
  const m = 12;
  const half = SIZE / 2 - m;
  const dx = Math.abs(x - SIZE / 2) - (half - r);
  const dy = Math.abs(y - SIZE / 2) - (half - r);
  const d = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
  return clamp(0.5 - d);
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    const a = roundedRectAlpha(x + 0.5, y + 0.5, 104);
    const d = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2);
    const ring = clamp(0.5 - (Math.abs(d - 150) - 17));
    const dot = clamp(0.5 - (d - 84));
    const red = Math.max(ring, dot);
    px[i] = Math.round(BG[0] * (1 - red) + RED[0] * red);
    px[i + 1] = Math.round(BG[1] * (1 - red) + RED[1] * red);
    px[i + 2] = Math.round(BG[2] * (1 - red) + RED[2] * red);
    px[i + 3] = Math.round(a * 255);
  }
}

// --- minimal PNG encoder (RGBA, 8 bit) ---
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote', out, png.length, 'bytes');
