// `make tour-trace` (VS-T41): each tour object cropped from its panorama (box + 25 %) with a labelled
// 10 × 10 grid of panorama coordinates, to trace its outline by hand (`outlines-src.mjs`).
// Usage: node trace-crops.mjs <outDir> [idRegex]. Writes <id>.jpg and objects.json (crop windows).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const sharp = require('sharp');

const OUT = process.argv[2];
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const src = fs.readFileSync(`${ROOT}/src/features/vision-insert/ui/xr/tour/tour-data.ts`, 'utf8');

// Rooms → src; objects: id + last 4 numbers of obj(/scene( call.
const rooms = {};
for (const m of src.matchAll(/(\w+): \{\s*id: '(\w+)',\s*src: '([^']+)'/g)) rooms[m[2]] = m[3];
const objs = [];
let room = null;
const flat = src.replace(/\s+/g, ' ');
const re = /id: '(\w+)', src: '[^']+'|(?:obj|scene)\( ?'([\w-]+)',([^)]*)\)/g;
for (const m of flat.matchAll(re)) {
  if (m[1]) {
    room = m[1];
    continue;
  }
  const nums = m[3]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^-?[\d.]+$/.test(s))
    .map(Number);
  const [u0, v0, u1, v1] = nums.slice(-4);
  objs.push({ id: m[2], room, box: { u0, v0, u1, v1 } });
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'objects.json'), JSON.stringify(objs, null, 1));

const cache = {};
async function pano(room) {
  if (!cache[room]) {
    const file = `${ROOT}/public${rooms[room]}`;
    const img = sharp(file);
    cache[room] = { meta: await img.metadata(), file };
  }
  return cache[room];
}

for (const o of objs) {
  if (only && !only.test(o.id)) continue;
  const { meta, file } = await pano(o.room);
  const W = meta.width,
    H = meta.height;
  let { u0, v0, u1, v1 } = o.box;
  if (u1 < u0) u1 += 1;
  const mw = (u1 - u0) * 0.25,
    mh = (v1 - v0) * 0.25;
  const a = u0 - mw,
    b = u1 + mw,
    c = Math.max(0, v0 - mh),
    d = Math.min(1, v1 + mh);
  // Extract with wrap: build from pano, possibly two pieces.
  const left = Math.round(a * W),
    right = Math.round(b * W),
    top = Math.round(c * H),
    bot = Math.round(d * H);
  const width = right - left,
    height = bot - top;
  const pieces = [];
  let x = left;
  while (x < right) {
    const sx = ((x % W) + W) % W;
    const w = Math.min(right - x, W - sx);
    pieces.push({
      input: await sharp(file).extract({ left: sx, top, width: w, height }).toBuffer(),
      left: x - left,
      top: 0,
    });
    x += w;
  }
  const scale = Math.min(8, 900 / Math.max(width, height));
  const ow = Math.round(width * scale),
    oh = Math.round(height * scale);
  const base = await sharp({
    create: { width, height, channels: 3, background: '#000' },
  })
    .composite(pieces)
    .png()
    .toBuffer();
  // Grid: 10 divisions in u and v across the crop, labelled with pano coords.
  const lines = [];
  for (let i = 0; i <= 10; i++) {
    const px = (i / 10) * ow,
      py = (i / 10) * oh;
    const uu = (a + ((b - a) * i) / 10) % 1,
      vv = c + ((d - c) * i) / 10;
    lines.push(
      `<line x1="${px}" y1="0" x2="${px}" y2="${oh}" stroke="#0ff" stroke-opacity="0.55" stroke-width="1"/>`
    );
    lines.push(
      `<line x1="0" y1="${py}" x2="${ow}" y2="${py}" stroke="#0ff" stroke-opacity="0.55" stroke-width="1"/>`
    );
    lines.push(
      `<text x="${px + 2}" y="12" font-size="11" fill="#ff0" stroke="#000" stroke-width="0.4">${uu.toFixed(4)}</text>`
    );
    lines.push(
      `<text x="2" y="${py - 2}" font-size="11" fill="#ff0" stroke="#000" stroke-width="0.4">${vv.toFixed(4)}</text>`
    );
  }
  // Current hand box.
  const bx = ((o.box.u0 - a) / (b - a)) * ow,
    by = ((v0 - c) / (d - c)) * oh;
  const bw = ((u1 - o.box.u0) / (b - a)) * ow,
    bh = ((v1 - v0) / (d - c)) * oh;
  lines.push(
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="#f0f" stroke-width="2"/>`
  );
  if (o.outline) {
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}">${lines.join('')}</svg>`;
  await sharp(base)
    .resize(ow, oh, { kernel: 'lanczos3' })
    .composite([{ input: Buffer.from(svg) }])
    .jpeg({ quality: 85 })
    .toFile(path.join(OUT, `${o.id}.jpg`));
  o.crop = { a, b, c, d };
}
fs.writeFileSync(path.join(OUT, 'objects.json'), JSON.stringify(objs, null, 1));
console.log(objs.length, 'objects');
