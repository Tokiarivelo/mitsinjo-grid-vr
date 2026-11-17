// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { ObjectRecipeSchema } from '@/lib/object-shape';
import { TOUR_ROOMS } from '@/features/vision-insert/ui/xr/tour/tour-data';
import { TOUR_OUTLINES } from '@/features/vision-insert/ui/xr/tour/tour-outlines';
import type { FlatRender } from '../flat-render';
import { measurePartColors } from '../tour-mock/generate';
import { box, compileSpec, glyphRing, polygonRing } from '../tour-mock/spec';
import { TOUR_SPECS } from '../tour-mock/specs';
import {
  faceView,
  tourCoverage,
  tourMockDrawing,
  tourMockEntry,
  tourMockShape,
  tourPartMasks,
} from '../tour-mock';

const TOUR_IDS = Object.values(TOUR_ROOMS).flatMap((r) => r.objects.map((o) => o.id));

describe('tour mock (VS-T41)', () => {
  it('has an outline, a spec and a built entry for every tour object', () => {
    for (const id of TOUR_IDS) {
      expect(TOUR_OUTLINES[id], id).toBeDefined();
      expect(TOUR_SPECS[id], id).toBeDefined();
      const entry = tourMockEntry(id);
      expect(entry, id).not.toBeNull();
      expect(ObjectRecipeSchema.safeParse(entry!.recipe).success, id).toBe(true);
      expect(entry!.concepts).toHaveLength(entry!.recipe.parts.length);
    }
  });

  it('compiles a spec in metres into a recipe with the largest side = 1', () => {
    const { recipe, concepts, fixed } = compileSpec({
      kind: 'parts',
      parts: [
        box([0, 1, 0], [0.6, 2, 0.5], '#ffffff', { concept: 'door' }),
        box([0, 2.25, 0], [0.2, 0.5, 0.2], '#000000', { fixed: true }),
      ],
    });
    expect(recipe.proportions).toEqual({ w: 0.24, h: 1, d: 0.2 });
    expect(recipe.parts[0]!.at[1]).toBeCloseTo(-0.1, 4);
    expect(recipe.parts[0]!.size[1]).toBeCloseTo(0.8, 4);
    expect(concepts).toEqual(['door', undefined]);
    expect(fixed).toEqual([false, true]);
  });

  it('draws regular polygons and glyphs in unit space', () => {
    const oct = polygonRing(8, Math.PI / 8);
    expect(oct).toHaveLength(8);
    for (const [x, y] of oct) expect(Math.hypot(x, y)).toBeCloseTo(0.5, 3);
    expect(
      glyphRing([
        [0, 0],
        [1, 1],
      ])
    ).toEqual([
      [-0.5, 0.5],
      [0.5, -0.5],
    ]);
  });

  it('measures part colours past an occluder (before: a hedge greened the wall)', () => {
    const recipe = ObjectRecipeSchema.parse({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#dddddd' }],
    });
    const n = 10;
    // The part drawn at 200 grey everywhere; the photo: wall 220 on 7 pixels, hedge green on 3.
    const render = {
      part: new Int16Array(n).fill(0),
      rgb: new Uint8ClampedArray(n * 3).fill(200),
    } as unknown as FlatRender;
    const crop = { cols: n, rows: 1, rgb: new Uint8Array(n * 3) };
    for (let i = 0; i < n; i++) crop.rgb.set(i < 7 ? [220, 220, 220] : [40, 90, 30], i * 3);
    const outline = { cols: n, rows: 1, data: new Uint8Array(n).fill(1) };
    const out = measurePartColors(recipe, render, crop, outline, [false]);
    // 221 × 220 / 200 = 243: the wall's own light grey, the hedge ignored.
    expect(out.parts[0]!.color).toBe('#f3f3f3');
    expect(measurePartColors(recipe, render, crop, outline, [true]).parts[0]!.color).toBe(
      '#dddddd'
    );
  });

  it('returns part masks inside the crop and their coverage', () => {
    const entry = tourMockEntry('loft-fridge')!;
    const masks = tourPartMasks(
      entry,
      { x: 0.45, y: 0.3, w: 0.02, h: 0.1 },
      { width: 2048, height: 1280 }
    );
    expect(masks.length).toBeGreaterThan(0);
    for (const m of masks) {
      expect(m.box.x).toBeGreaterThanOrEqual(0);
      expect(m.box.x + m.box.w).toBeLessThanOrEqual(1.0001);
    }
    const cov = tourCoverage(entry, masks);
    expect(cov.find((c) => c.concept === 'handle')).toEqual({
      concept: 'handle',
      seen: 1,
      built: 1,
    });
  });

  it('answers the whole shape for a tour object and nothing for another id', async () => {
    const target = {
      id: 'loft-fridge',
      label: 'Fridge',
      category: 'fridge' as const,
      box: { x: 0.45, y: 0.3, w: 0.02, h: 0.1 },
      outline: 'M0.45 0.3L0.47 0.3L0.47 0.4Z',
    };
    const shape = await tourMockShape(target, { width: 2048, height: 1280 });
    expect(shape).toMatchObject({ detectionId: 'loft-fridge', mode: 'recipe', source: 'mock' });
    expect(shape!.imaginedViews).toHaveLength(6);
    expect(shape!.outline).toBe(target.outline);
    expect(await tourMockShape({ ...target, id: 'det-1' }, null)).toBeNull();
  });

  it('turns the camera to each face; a car shows its profile first', () => {
    const car = tourMockEntry('street-car-white')!.recipe;
    expect(faceView('main', car, true)).toEqual({ yaw: 0, pitch: 0 });
    // Nose on the left (−x): the front face is seen from −x.
    expect(faceView('front', car, true).yaw).toBeCloseTo(Math.PI / 2);
    expect(faceView('side', car, false).yaw).toBeCloseTo(-Math.PI / 2);
    expect(faceView('top', car, false).pitch).toBeGreaterThan(1.5);
  });

  it('draws a face as a white-paper PNG', async () => {
    const png = await tourMockDrawing({ id: 'loft-hood' }, 'main');
    const meta = await sharp(png!).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(await tourMockDrawing({ id: 'nope' }, 'main')).toBeNull();
  });
});
