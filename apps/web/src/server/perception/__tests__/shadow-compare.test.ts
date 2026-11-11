// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { deltaE2000, hexToLab, measureKitColors } from '../color-measure';
import { prepareVisionImage } from '../prepare-image';
import { readCapture } from '../shape-capture';
import { pixelBox, sampleObjectPixels } from '../shape-colors';
import { photoSize } from '../vision-request';
import SHADOW_WALLS from '../__fixtures__/shape/shadow-walls.json';

/** Share of the box width put in shadow, and how dark the shadow is (black at this opacity). */
const SHADOWS = [
  [0.5, 0.5],
  [0.65, 0.5],
  [0.65, 0.65],
] as const;
/** Main colours closer than this (ΔE 2000) count as the same colour. */
const SAME_COLOR = 5;

const dE = (a: string, b: string) => deltaE2000(hexToLab(a), hexToLab(b));

/**
 * `make shadow-compare` (SHADOW_COMPARE=1, no API call): the proof of PQ-T10 on the real photos, which hold
 * no wall in shadow. A shadow is painted over part of each object, and the main colour is read with and
 * without `litSurface`: it should stay the colour read on the untouched photo. Also lists the untouched
 * photos whose colours `litSurface` changes (its side effects).
 */
describe.runIf(process.env.SHADOW_COMPARE)('make shadow-compare', () => {
  it('main colour under a painted shadow, litSurface on vs off', async () => {
    const dir =
      process.env.SHAPE_REAL_DIR ??
      join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
    const ids = readdirSync(dir)
      .filter((f) => f.endsWith('.capture.json'))
      .map((f) => f.slice(0, -'.capture.json'.length))
      .sort();
    const rows: string[] = [];
    const changed: string[] = [];
    const sum = { on: 0, off: 0, n: 0, kept: { on: 0, off: 0 }, gains: 0, harms: 0 };
    for (const id of ids) {
      const photoPath = join(dir, 'photos', `${id}.jpg`);
      if (!existsSync(photoPath)) continue;
      const { capture } = await readCapture(dir, id);
      const archetype = capture.kit?.archetype;
      if (!archetype) continue;
      const prepared = await prepareVisionImage(readFileSync(photoPath), 'image/jpeg');
      const size = await photoSize(prepared.buffer);
      if (!size) continue;
      const box = capture.target.box;
      const px = pixelBox(size, box);
      const read = async (buffer: Buffer, litSurface: boolean) =>
        measureKitColors(
          await sampleObjectPixels({ ...size, buffer }, box, capture.target.outline),
          archetype,
          { litSurface }
        );
      const base = {
        on: await read(prepared.buffer, true),
        off: await read(prepared.buffer, false),
      };
      if (!base.on || !base.off) continue;
      if (JSON.stringify(base.on) !== JSON.stringify(base.off)) {
        changed.push(
          `| ${id} | ${base.off.main} ${base.off.secondary} ${base.off.accent} | ${base.on.main} ${base.on.secondary} ${base.on.accent} |`
        );
      }
      for (const [share, dark] of SHADOWS) {
        const w = Math.max(1, Math.round(px.width * share));
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${px.height}"><rect width="${w}" height="${px.height}" fill="black" fill-opacity="${dark}"/></svg>`;
        const shadowed = await sharp(prepared.buffer)
          .composite([{ input: Buffer.from(svg), left: px.left, top: px.top }])
          .jpeg({ quality: 92 })
          .toBuffer();
        const on = await read(shadowed, true);
        const off = await read(shadowed, false);
        if (!on || !off) continue;
        const dOn = dE(on.main, base.on.main);
        const dOff = dE(off.main, base.off.main);
        sum.n += 1;
        sum.on += dOn;
        sum.off += dOff;
        if (dOn < SAME_COLOR) sum.kept.on += 1;
        if (dOff < SAME_COLOR) sum.kept.off += 1;
        if (dOn < SAME_COLOR && dOff >= SAME_COLOR) sum.gains += 1;
        if (dOn >= SAME_COLOR && dOff < SAME_COLOR) sum.harms += 1;
        rows.push(
          `| ${id} | ${Math.round(share * 100)} % at ${dark} | ${off.main} ${dOff.toFixed(1)} | ${on.main} ${dOn.toFixed(1)} |`
        );
      }
    }
    console.info(
      `\n## Main colour under a painted shadow (ΔE to the untouched photo)\n\n| id | shadow | off | litSurface |\n| -- | ------ | --- | ---------- |\n${rows.join('\n')}\n\n` +
        `kept (ΔE < ${SAME_COLOR}): off ${sum.kept.off}/${sum.n}, litSurface ${sum.kept.on}/${sum.n} (gained ${sum.gains}, lost ${sum.harms}); ` +
        `mean ΔE: off ${(sum.off / sum.n).toFixed(1)}, litSurface ${(sum.on / sum.n).toFixed(1)}\n\n` +
        `## Untouched photos whose colours litSurface changes (${changed.length})\n\n| id | off | litSurface |\n| -- | --- | ---------- |\n${changed.join('\n')}`
    );
  }, 300_000);

  /** Median CIELAB of a patch: the colour of the lit wall, read where no shadow falls. */
  const medianLab = (lab: Float32Array): [number, number, number] => {
    const mid = (c: number) => {
      const v = Array.from({ length: lab.length / 3 }, (_, k) => lab[k * 3 + c]!).sort(
        (a, b) => a - b
      );
      return v[Math.floor(v.length / 2)] ?? 0;
    };
    return [mid(0), mid(1), mid(2)];
  };

  /**
   * Real walls partly in shadow (`__fixtures__/shape/shadow-walls.json`, photos fetched by
   * `make shadow-photos`): the wall colour read on the whole box, against the colour of a patch of the same
   * wall that the sun reaches. No painted shadow here: this is the « done when » of PQ-T10.
   */
  it('real walls in shadow: wall colour against its lit patch, litSurface on vs off', async () => {
    const dir =
      process.env.SHAPE_REAL_DIR ??
      join(process.cwd(), 'src/server/perception/__fixtures__/shape/real');
    const rows: string[] = [];
    const sum = { on: 0, off: 0, n: 0, better: 0, worse: 0, rolesOn: 0, rolesOff: 0 };
    const grey = { on: 0, off: 0, n: 0 };
    for (const wall of SHADOW_WALLS) {
      const photoPath = join(dir, 'photos', `${wall.id}.jpg`);
      if (!existsSync(photoPath)) continue;
      const prepared = await prepareVisionImage(readFileSync(photoPath), 'image/jpeg');
      const size = await photoSize(prepared.buffer);
      if (!size) continue;
      const photo = { ...size, buffer: prepared.buffer };
      const truth = medianLab((await sampleObjectPixels(photo, wall.lit)).lab);
      const pixels = await sampleObjectPixels(photo, wall.box);
      let share = 0;
      const on = measureKitColors(pixels, 'building', {
        litSurface: true,
        onShadowShare: (v) => (share = v),
      });
      const off = measureKitColors(pixels, 'building');
      if (!on || !off) continue;
      const dOn = deltaE2000(hexToLab(on.main), truth);
      const dOff = deltaE2000(hexToLab(off.main), truth);
      const bucket = wall.coloured ? sum : grey;
      bucket.n += 1;
      bucket.on += dOn;
      bucket.off += dOff;
      if (wall.coloured && dOn < dOff - 1) sum.better += 1;
      if (wall.coloured && dOn > dOff + 1) sum.worse += 1;
      // A shadow that stays a group of its own is handed out as the roof or the accent colour: count the
      // colour roles that are the lit wall's own colour, darkened (same hue, darker than the lit patch).
      const shadowRoles = (c: NonNullable<typeof on>) =>
        [c.secondary, c.accent].filter((hex) => {
          const [l, a, b] = hexToLab(hex);
          const fade = (l + 16) / (truth[0] + 16);
          return truth[0] - l > 8 && Math.hypot(truth[1] * fade - a, truth[2] * fade - b) < 10;
        }).length;
      if (wall.coloured) {
        sum.rolesOn += shadowRoles(on);
        sum.rolesOff += shadowRoles(off);
      }
      rows.push(
        `| ${wall.id} | ${wall.coloured ? 'coloured' : 'grey'} | ${off.main} ${dOff.toFixed(1)} · ${off.secondary} ${off.accent} | ${on.main} ${dOn.toFixed(1)} · ${on.secondary} ${on.accent} | ${Math.round(share * 100)} % |`
      );
    }
    if (sum.n + grey.n === 0) throw new Error('No shadowed-wall photo: run make shadow-photos');
    const mean = (b: { on: number; off: number; n: number }) =>
      b.n ? `off ${(b.off / b.n).toFixed(1)}, litSurface ${(b.on / b.n).toFixed(1)}` : 'none';
    console.info(
      `\n## Real walls in shadow (ΔE of the wall colour to its lit patch)\n\n| id | wall | off: main ΔE · secondary accent | litSurface: main ΔE · secondary accent | shadow read apart |\n| -- | ---- | --- | ---------- | ----------------- |\n${rows.join('\n')}\n\n` +
        `coloured walls (${sum.n}): mean ΔE ${mean(sum)}; closer on ${sum.better}, further on ${sum.worse}; secondary / accent that are the wall's own shadow: off ${sum.rolesOff}, litSurface ${sum.rolesOn}\n` +
        `grey walls (${grey.n}, not handled by design): mean ΔE ${mean(grey)}`
    );
  }, 300_000);
});
