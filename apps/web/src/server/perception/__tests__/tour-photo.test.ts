import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, it } from 'vitest';
import { TOUR_ROOMS } from '@/features/vision-insert/ui/xr/tour/tour-data';
import { objectPhoto, outlinedFront } from '../tour-mock/generate';

/**
 * `make tour-photo IDS=terrace-car OUT=dir` (VS-T44): each tour object's photo, cut to its outline
 * on white paper, at the panorama's resolution → `<OUT>/<id>/photo.png`, the photo `make views-3d
 * PHOTO=` imagines every face from (Muse Image draws the views, never the photo on the model).
 */
const IDS = process.env.TOUR_PHOTO_IDS?.split(',').filter(Boolean) ?? [];
const ROOT = join(__dirname, '..', '..', '..', '..');

describe.runIf(IDS.length)('make tour-photo', () => {
  it('writes the outlined photo of each object', async () => {
    const out = process.env.TOUR_PHOTO_OUT ?? join(ROOT, '..', '..', 'test-results', 'tour-photo');
    for (const room of Object.values(TOUR_ROOMS)) {
      const objs = room.objects.filter((o) => o.outline && IDS.includes(o.id));
      if (!objs.length) continue;
      const { data, info } = await sharp(join(ROOT, 'public', room.src))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pano = { data, width: info.width, height: info.height };
      for (const o of objs) {
        const shot = await objectPhoto(pano, o.outline!);
        const px = Math.round(Math.max(shot.box.w * pano.width, shot.box.h * pano.height));
        await mkdir(join(out, o.id), { recursive: true });
        await writeFile(join(out, o.id, 'photo.png'), await outlinedFront(shot, Math.max(320, px)));
        console.info(`[tour-photo] ${o.id}: ${px} px → ${join(out, o.id, 'photo.png')}`);
      }
    }
  }, 120_000);
});
