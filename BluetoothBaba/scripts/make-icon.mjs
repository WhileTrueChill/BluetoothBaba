// Generates a 1024x1024 PNG app icon with zero dependencies (hand-rolled PNG
// encoder). CI runs this and then feeds the result to `tauri icon`, which
// produces every platform-specific size. We ship no binary assets in the repo,
// so the icon is generated deterministically at build time.
//
//   node scripts/make-icon.mjs [output.png]

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const S = 1024;
const buf = Buffer.alloc(S * S * 4);

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

// Vertical blue gradient background (iOS system blue -> deeper blue).
for (let y = 0; y < S; y++) {
  const t = y / (S - 1);
  const r = lerp(0x0a, 0x00, t);
  const g = lerp(0x84, 0x60, t);
  const b = lerp(0xff, 0xdf, t);
  for (let x = 0; x < S; x++) set(x, y, r, g, b);
}

// Signed distance to a rectangle (for rounded corners).
function distRect(px, py, x0, y0, x1, y1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}
function sign(ax, ay, bx, by, cx, cy) {
  return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
}
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// White speech bubble: rounded rectangle + a tail toward the bottom-left.
const br = 0.11 * S;
const bx0 = 0.24 * S;
const by0 = 0.26 * S;
const bx1 = 0.76 * S;
const by1 = 0.60 * S;
function inBubble(x, y) {
  if (distRect(x, y, bx0 + br, by0 + br, bx1 - br, by1 - br) <= br) return true;
  return inTri(x, y, 0.37 * S, 0.56 * S, 0.37 * S, 0.74 * S, 0.53 * S, 0.585 * S);
}
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) if (inBubble(x, y)) set(x, y, 255, 255, 255);

// Three dots inside the bubble (a "message").
const dotY = 0.43 * S;
const dotR = 0.037 * S;
for (const dx of [0.4, 0.5, 0.6]) {
  const cx = dx * S;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const ex = x - cx;
      const ey = y - dotY;
      if (ex * ex + ey * ey <= dotR * dotR) set(x, y, 0x0a, 0x84, 0xff);
    }
}

/* ---- minimal PNG encoder ---- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++)
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// compression/filter/interlace = 0

const stride = S * 4;
const raw = Buffer.alloc((stride + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (stride + 1)] = 0; // filter: none
  buf.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
}
const idat = deflateSync(raw, { level: 9 });
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = process.argv[2] || "app-icon.png";
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${S}x${S})`);
