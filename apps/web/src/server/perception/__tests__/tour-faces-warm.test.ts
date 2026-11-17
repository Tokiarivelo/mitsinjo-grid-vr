import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { tourFaces, tourImagined } from '../tour-mock';
import DATA from '../tour-mock/tour-mock.json';

/**
 * `make tour-faces [IDS=loft-sofa]` (VS-T44): every tour object not precomputed (`make
 * tour-imagine`: the cars) imagined on its six faces once (a plant also drawn), into the disk cache
 * (`node_modules/.cache/tour-imagined/`), so the immersion view never waits on a render.
 */
const RUN = process.env.TOUR_FACES === '1';
const IDS = process.env.TOUR_FACES_IDS?.split(',').filter(Boolean);

describe.runIf(RUN)('make tour-faces', () => {
  it('imagines every tour object into the cache', { timeout: 4 * 3_600_000 }, async () => {
    let failed = 0;
    for (const id of Object.keys(DATA)) {
      if ((IDS && !IDS.includes(id)) || (await tourImagined(id))) continue;
      const t0 = Date.now();
      const faces = await tourFaces(id);
      if (!faces) failed++;
      console.info(`[tour-faces] ${id}: ${faces ? 'ok' : 'FAILED'}, ${Date.now() - t0} ms`);
    }
    expect(failed).toBe(0);
  });
});
