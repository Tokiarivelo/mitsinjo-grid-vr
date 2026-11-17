// `make tour-outlines` (VS-T41/T42): the hand outlines (`outlines-src.mjs`, `outlines-src-2.mjs`, traced
// on the `make tour-trace` crops) → panorama rings in `src/features/vision-insert/ui/xr/tour/tour-outlines.ts`, and check sheets
// (each outline drawn on its crop) in the trace directory. Usage: node outlines.mjs <traceDir>.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { SRC as SRC1 } from './outlines-src.mjs';
import { SRC2 } from './outlines-src-2.mjs';
const SRC = { ...SRC1, ...SRC2 };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const sharp = require('sharp');
const S = process.argv[2]; // the trace directory (crops + objects.json)
const objs = JSON.parse(fs.readFileSync(`${S}/objects.json`, 'utf8'));
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const out = {};
for (const o of objs) {
  const s = SRC[o.id];
  if (!s) {
    console.warn('missing', o.id);
    continue;
  }
  const { a, b, c, d } = o.crop;
  const fromGrid = ([x, y]) => [a + (x / 10) * (b - a), c + (y / 10) * (d - c)];
  let rings;
  if (s.pano) rings = s.pano;
  else if (s.ell) {
    const [cx, cy, rx, ry] = s.ell;
    rings = [
      Array.from({ length: 24 }, (_, i) => {
        const t = (i / 24) * Math.PI * 2;
        return fromGrid([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
      }),
    ];
  } else if (s.ctx) {
    const [u0, uw, v0, vh, W, H] = s.ctx;
    rings = s.r.map((ring) => ring.map(([x, y]) => [u0 + (x / W) * uw, v0 + (y / H) * vh]));
  } else if (s.px) {
    const [W, H] = s.px;
    rings = s.r.map((ring) => ring.map(([x, y]) => fromGrid([(x / W) * 10, (y / H) * 10])));
  } else rings = s.g.map((ring) => ring.map(fromGrid));
  out[o.id] = rings.map((ring) => ring.map(([u, v]) => [r5(((u % 1) + 1) % 1), r5(v)]));
}
fs.writeFileSync(`${S}/outlines.json`, JSON.stringify(out));
const o = out;
const body = Object.entries(o)
  .map(([id, rings]) => `  '${id}': ${JSON.stringify(rings)},`)
  .join('\n');
fs.writeFileSync(
  path.join(ROOT, 'src/features/vision-insert/ui/xr/tour/tour-outlines.ts'),
  `import type { PanoRing } from './equirect';

/**
 * Outlines of the tour objects (VS-T41), traced by hand on the equirect photos like a SAM mask:
 * closed rings of panorama fractions (u, v), several rings for an object in pieces (the five
 * « MARRY » letters, two softboxes). The object box is their bounds; the offline detector sends
 * them projected into the scan photo as the detection outline (\`tourExpectedDetections\`).
 * Regenerate with \`make tour-mock\` after tracing (\`docs/tasks/VR-village-spatial-shoot.md\` VS-T41).
 */
export const TOUR_OUTLINES: Readonly<Record<string, ReadonlyArray<PanoRing>>> = {
${body}
};
`
);

// Overlays on the crops (crop window coords), when the outline lies in the crop window.
const tiles = [];
for (const o of objs) {
  const rings = out[o.id];
  if (!rings) continue;
  const file = `${S}/${o.id}.jpg`;
  const meta = await sharp(file).metadata();
  const { a, b, c, d } = o.crop;
  const toPx = ([u, v]) => {
    let uu = u;
    while (uu < a - 0.5) uu += 1;
    while (uu > a + 0.5) uu -= 1;
    return [((uu - a) / (b - a)) * meta.width, ((v - c) / (d - c)) * meta.height];
  };
  const polys = rings
    .map(
      (ring) =>
        `<polygon points="${ring
          .map(toPx)
          .map((p) => p.join(','))
          .join(' ')}" fill="#ff0000" fill-opacity="0.25" stroke="#ff2020" stroke-width="3"/>`
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${polys}</svg>`;
  const buf = await sharp(file)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer()
    .then((x) =>
      sharp(x).resize(300, 300, { fit: 'contain', background: '#222' }).jpeg().toBuffer()
    );
  const label = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><text x="4" y="292" font-size="16" fill="#fff" stroke="#000" stroke-width="0.6">${o.id}</text></svg>`
  );
  tiles.push(
    await sharp(buf)
      .composite([{ input: label }])
      .jpeg()
      .toBuffer()
  );
}
const cols = 6;
const rows = Math.ceil(tiles.length / cols);
for (let page = 0; page * 24 < tiles.length; page++) {
  const slice = tiles.slice(page * 24, page * 24 + 24);
  const rr = Math.ceil(slice.length / cols);
  await sharp({
    create: {
      width: cols * 300,
      height: rr * 300,
      channels: 3,
      background: '#000',
    },
  })
    .composite(
      slice.map((t, i) => ({
        input: t,
        left: (i % cols) * 300,
        top: Math.floor(i / cols) * 300,
      }))
    )
    .jpeg({ quality: 80 })
    .toFile(`${S}/outline-sheet-${page + 1}.jpg`);
}
console.log(Object.keys(out).length, 'outlines,', rows, 'rows');
