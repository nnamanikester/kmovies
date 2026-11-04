/**
 * Generates the webOS launcher icons and splash image into /webos.
 * Pure Node (no image libraries): draws a rounded gradient tile with a play
 * triangle, matching the in-app <Logo />. Run with `npm run icons`.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'webos');

const BG = [11, 11, 18];
const ACCENT = [229, 53, 75];
const ACCENT_2 = [255, 138, 61];
const WHITE = [255, 255, 255];

const ASSETS = [
  { file: 'icon.png', width: 80, height: 80, tile: 80 },
  { file: 'largeIcon.png', width: 130, height: 130, tile: 130 },
  { file: 'splash.png', width: 1920, height: 1080, tile: 280 },
];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Signed-distance test for a rounded rectangle centred at the origin. */
function insideRoundedRect(x, y, half, radius) {
  const qx = Math.abs(x) - (half - radius);
  const qy = Math.abs(y) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius <= 0;
}

/** Point-in-triangle for a right-pointing play symbol. */
function insidePlay(x, y, size) {
  const left = -size * 0.32;
  const right = size * 0.4;
  const halfH = size * 0.42;
  if (x < left || x > right) return false;
  const t = (x - left) / (right - left);
  return Math.abs(y) <= halfH * (1 - t);
}

function renderPixel(px, py, { width, height, tile }) {
  const x = px - width / 2;
  const y = py - height / 2;
  const half = tile / 2;

  if (!insideRoundedRect(x, y, half, tile * 0.26)) return BG;
  if (insidePlay(x, y, tile * 0.5)) return WHITE;
  return mix(ACCENT, ACCENT_2, (x + y + tile) / (2 * tile));
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(asset) {
  const { width, height } = asset;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = renderPixel(x + 0.5, y + 0.5, asset);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const asset of ASSETS) {
  writeFileSync(join(OUT_DIR, asset.file), encodePng(asset));
  console.log(`✔ webos/${asset.file} (${asset.width}x${asset.height})`);
}
