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
});
