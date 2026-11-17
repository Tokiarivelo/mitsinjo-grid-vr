import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, it } from 'vitest';
import { TOUR_ROOMS } from '@/features/vision-insert/ui/xr/tour/tour-data';
import { tourMockEntry } from '../tour-mock';
import { TOUR_CAR_ART } from '../tour-mock/car-art';
import { objectPhoto } from '../tour-mock/generate';
import { imagineCar, type TourImagined } from '../tour-mock/imagine';

/**
 * `make tour-imagine [IDS=terrace-car] [FORCE=1]` (VS-T44): each tour car drawn on every face
 * (`car-art.ts`), built offline from those drawings, turned to its photo →
 * `tour-mock/tour-imagined.json`. A car already there is kept unless `FORCE=1`; every other
 * object is imagined on demand (`make tour-faces` prepares them).
 */
const RUN = process.env.TOUR_IMAGINE === '1';
const IDS = process.env.TOUR_IMAGINE_IDS?.split(',').filter(Boolean);
const ROOT = join(__dirname, '..', '..', '..', '..');
const PATH = join(__dirname, '..', 'tour-mock', 'tour-imagined.json');
const FORCE = process.env.TOUR_IMAGINE_FORCE === '1';

describe.runIf(RUN)('make tour-imagine', () => {
  it('builds every imagined tour object', async () => {
    const out: Record<string, TourImagined> = existsSync(PATH)
      ? JSON.parse(readFileSync(PATH, 'utf8'))
      : {};
    for (const room of Object.values(TOUR_ROOMS)) {
      const objs = room.objects.filter(
        (o) => o.outline && TOUR_CAR_ART[o.id] && (!IDS || IDS.includes(o.id))
      );
      if (!objs.length) continue;
      const { data, info } = await sharp(join(ROOT, 'public', room.src))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pano = { data, width: info.width, height: info.height };
      for (const o of objs) {
        const entry = tourMockEntry(o.id);
        if (!entry || (!FORCE && out[o.id])) continue;
        const shot = await objectPhoto(pano, o.outline!);
        const y = entry.recipe.yaw ?? 0;
        const built = await imagineCar(o.id, TOUR_CAR_ART[o.id]!, shot, entry.pitch, [
          y + Math.PI / 2,
          y - Math.PI / 2,
        ]);
        console.info(
          `[tour-imagine] ${o.id}: ${built ? `iou ${built.iou.toFixed(2)} (hand-built ${entry.score.iou}), yaw ${built.yaw.toFixed(2)}` : 'not built'}`
        );
        if (built) out[o.id] = built;
      }
    }
    await writeFile(PATH, JSON.stringify(out));
  }, 900_000);
});
