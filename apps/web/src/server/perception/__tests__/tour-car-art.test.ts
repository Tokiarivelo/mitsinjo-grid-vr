import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { carArtSvg, CAR_ART_SIZE, TOUR_CAR_ART, type CarArtView } from '../tour-mock/car-art';

const VIEWS: CarArtView[] = ['right', 'front', 'back', 'top'];

describe('car art (VS-T44)', () => {
  it('draws every face of every tour car at its canvas size', { timeout: 60_000 }, async () => {
    for (const art of Object.values(TOUR_CAR_ART))
      for (const v of VIEWS) {
        const meta = await sharp(Buffer.from(carArtSvg(art, v))).metadata();
        expect([meta.width, meta.height], v).toEqual([...CAR_ART_SIZE[v]]);
      }
  });
});

/** `make tour-car-art [IDS=terrace-car] OUT=dir` → <OUT>/<id>/view-{right,front,back,top}.png. */
describe.runIf(process.env.TOUR_CAR_ART_OUT)('make tour-car-art', () => {
  it('writes the imagined drawings', { timeout: 120_000 }, async () => {
    const ids = process.env.TOUR_CAR_ART_IDS?.split(',').filter(Boolean);
    for (const [id, art] of Object.entries(TOUR_CAR_ART)) {
      if (ids && !ids.includes(id)) continue;
      const dir = join(process.env.TOUR_CAR_ART_OUT!, id);
      await mkdir(dir, { recursive: true });
      for (const v of VIEWS)
        await writeFile(
          join(dir, `view-${v}.png`),
          await sharp(Buffer.from(carArtSvg(art, v)))
            .png()
            .toBuffer()
        );
    }
  });
});
