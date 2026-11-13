import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ShapeTarget } from '@/lib/object-shape';
vi.mock('server-only', () => ({}));
import { museImage, museImageReady } from '../facade-specialist';
import { renderFlat } from '../flat-render';
import { getPerceptionClient } from '../client';
import { reconstructObject, reportLine, type ViewName } from '../recon';
import { VIEW_CAMERA } from '../recon/score';

/**
 * `make views-3d FRONT=front.png [RIGHT=… BACK=… LEFT=…] OUT=dir [LABEL=…]` (PQ-T69): the app's
 * views reconstruction on your own drawings. With the front and one side it runs offline (pure
 * math, no API call). A missing side, back or left is drawn by Muse Image when Meta is configured
 * (`LLM_PROVIDER=meta` + key; costs one drawing each), and the materials are then asked of the
 * cheap seeing model. Writes `recipe.json`, `report.txt`, each view used (`view-*.png`) and
 * `model.png` (the model seen from the four cameras, front · right · back · left).
 */
describe.runIf(process.env.VIEWS_3D_FRONT)('make views-3d', () => {
  it('rebuilds the object from its views', async () => {
    const out = process.env.VIEWS_3D_OUT;
    if (!out) throw new Error('Usage: make views-3d FRONT=front.png [RIGHT= BACK= LEFT=] OUT=dir');
    const url = async (path?: string) =>
      path
        ? `data:image/png;base64,${(
            await sharp(await readFile(path))
              .png()
              .toBuffer()
          ).toString('base64')}`
        : undefined;
    const [facadeUrl, side, back, left] = await Promise.all([
      url(process.env.VIEWS_3D_FRONT),
      url(process.env.VIEWS_3D_RIGHT),
      url(process.env.VIEWS_3D_BACK),
      url(process.env.VIEWS_3D_LEFT),
    ]);
    const target: ShapeTarget = {
      id: 'views-3d',
      label: process.env.VIEWS_3D_LABEL || 'object',
      category: 'other',
      box: { x: 0, y: 0, w: 1, h: 1 },
      facadeUrl: facadeUrl!,
      faceUrls: { ...(side ? { side } : {}), ...(back ? { back } : {}), ...(left ? { left } : {}) },
    };
    const live = museImageReady();
    const perception = live ? getPerceptionClient('views-3d') : null;
    await mkdir(out, { recursive: true });
    const built = await reconstructObject(
      {
        draw: live ? museImage : null,
        ...(perception ? { nameClasses: perception.nameClasses.bind(perception) } : {}),
      },
      target,
      { onView: (view: ViewName, png) => void writeFile(join(out, `view-${view}.png`), png) }
    );
    if (!built)
      throw new Error(
        'No model: the front and at least one side must be readable (give RIGHT= or LEFT=, or configure Meta so the side can be drawn).'
      );
    const { recipe, report } = built;
    await writeFile(join(out, 'recipe.json'), JSON.stringify(recipe, null, 2));
    await writeFile(join(out, 'report.txt'), `${reportLine(report)}\n`);
    // The model from the four cameras, 256 px tall each, side by side.
    const rows = 256;
    const tiles = (['front', 'right', 'back', 'left'] as const).map((view) => {
      const across =
        view === 'front' || view === 'back' ? recipe.proportions.w : recipe.proportions.d;
      const cols = Math.max(8, Math.round((rows * across) / recipe.proportions.h));
      const r = renderFlat(recipe, 1, cols, rows, VIEW_CAMERA[view], () => ({
        cx: 0,
        cy: 0,
        fw: across * 1.06,
        fh: recipe.proportions.h * 1.06,
      }));
      const rgb = Buffer.from(r.rgb);
      r.mask.data.forEach((v, i) => {
        if (!v) rgb.fill(255, i * 3, i * 3 + 3);
      });
      return { cols, rgb };
    });
    const gap = 12;
    const width = tiles.reduce((w, t) => w + t.cols + gap, gap);
    let leftEdge = gap;
    const composites = await Promise.all(
      tiles.map(async (t) => {
        const input = await sharp(t.rgb, { raw: { width: t.cols, height: rows, channels: 3 } })
          .png()
          .toBuffer();
        const placed = { input, left: leftEdge, top: gap };
        leftEdge += t.cols + gap;
        return placed;
      })
    );
    await sharp({ create: { width, height: rows + 2 * gap, channels: 3, background: '#ffffff' } })
      .composite(composites)
      .png()
      .toFile(join(out, 'model.png'));
    console.info(`\n${recipe.parts.length} parts — ${reportLine(report)}\n→ ${out}`);
    expect(recipe.parts.length).toBeGreaterThan(0);
  }, 600_000);
});
