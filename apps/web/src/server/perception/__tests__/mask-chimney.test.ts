// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import {
  MAX_COMPONENTS,
  ObjectRecipeSchema,
  type ObjectRecipe,
  type PartMask,
  type ShapeTarget,
} from '@/lib/object-shape';
import { polygonPath } from '@/lib/vision';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { withMaskChimney } from '../mask-chimney';
import type { MaskMapGeom } from '../mask-geometry';
import { runObjectShape } from '../object-shape';
import { cropRectForShape } from '../shape-crop';

const houseKit = (details?: ObjectKit['details']): ObjectKit => ({
  archetype: 'house',
  proportions: { w: 1, h: 0.6, d: 0.5 },
  colors: { main: '#aaaaaa', secondary: '#bb2222', accent: '#2222bb' },
  materials: { main: 'plaster', secondary: 'tile', accent: 'glass' },
  ...(details ? { details } : {}),
});

const roofedKit = (): ObjectKit => ({
  ...houseKit({ chimney: true }),
  roof: { eave: 0.4, gables: [{ x0: 0, x1: 1, peak: 0.5, top: 0 }] },
});

/** Photo 200×100, box 160×80 px at (20, 10): the crop is the whole photo. */
const geomA = () => {
  const box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  return { photoW: 200, photoH: 100, box, crop: cropRectForShape(200, 100, box) };
};

/** Photo-pixel rect → mask with a 4-corner outline, in crop fractions. */
const rectMask = (
  geom: MaskMapGeom,
  concept: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): PartMask => {
  const { crop } = geom;
  const cu = (px: number) => (px - crop.left) / crop.width;
  const cv = (py: number) => (py - crop.top) / crop.height;
  return {
    concept,
    box: { x: cu(x0), y: cv(y0), w: cu(x1) - cu(x0), h: cv(y1) - cv(y0) },
    outline: polygonPath([
      [cu(x0), cv(y0)],
      [cu(x1), cv(y0)],
      [cu(x1), cv(y1)],
      [cu(x0), cv(y1)],
    ]),
  };
};

const free = (r: ObjectRecipe): ObjectRecipe => ({ ...r, source: 'free' });

describe('withMaskChimney (PR-2.10)', () => {
  it('stepped house: template stack replaced by the measured one at the mask x', () => {
    const geom = geomA();
    const recipe = kitToRecipe(houseKit({ chimney: true }));
    expect(recipe.parts).toHaveLength(9);
    // Photo x 100..116 → obj 0..0.1; y 10..26 → obj 0.3..0.5 (top 0.5).
    const out = withMaskChimney(
      'house',
      recipe,
      [rectMask(geom, 'chimney', 100, 10, 116, 26)],
      geom
    );
    expect(out).not.toBe(recipe);
    // 9 − 1 template + 1 measured = 9; the fixed x = 0.3 stack is gone.
    expect(out.parts).toHaveLength(9);
    expect(out.parts.some((p) => p.shape === 'box' && Math.abs(p.at[0] - 0.3) < 1e-9)).toBe(false);
    const stack = out.parts.find(
      (p) => p.shape === 'box' && p.at[2] === 0 && p.size[0] === p.size[2] && p.size[0] <= 0.2
    )!;
    expect(stack.at[0]).toBeCloseTo(0.05, 3);
    // Feet buried at the eave (walls top 0.1), top follows the mask (0.5 > slabs 0.46).
    expect(stack.at[1] - stack.size[1] / 2).toBeCloseTo(0.1, 9);
    expect(stack.at[1] + stack.size[1] / 2).toBeCloseTo(0.5, 3);
    expect(stack.size[0]).toBeCloseTo(0.1, 3);
    expect(stack.color).toBe('#aaaaaa');
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('measured roof: a short mask still peeks above the ridge, feet at the eave', () => {
    const geom = geomA();
    const recipe = kitToRecipe(roofedKit());
    // Walls 0.1 high eave (0.5 − 0.4), ridge at 0.5: mask top 0.4 sits below the ridge.
    const out = withMaskChimney(
      'house',
      recipe,
      [rectMask(geom, 'chimney', 84, 18, 100, 34)],
      geom
    );
    expect(out).not.toBe(recipe);
    const main = out.parts.find((p) => p.front)!;
    const eave = main.at[1] + main.size[1] / 2;
    expect(eave).toBeCloseTo(0.1, 9);
    const stack = out.parts.find(
      (p) => p.shape === 'box' && p.at[2] === 0 && p.size[0] === p.size[2] && p !== main
    )!;
    expect(stack.at[1] - stack.size[1] / 2).toBeCloseTo(eave, 9);
    expect(stack.at[1] + stack.size[1] / 2).toBeCloseTo(0.52, 3);
  });

  it('rotated, buried, tiny and off-house masks are skipped', () => {
    const geom = geomA();
    const recipe = kitToRecipe(houseKit({ chimney: true }));
    // Diamond (45°): not a stack.
    const diamond: PartMask = {
      concept: 'chimney',
      box: { x: 0.4, y: 0.1, w: 0.1, h: 0.2 },
      outline: polygonPath([
        [0.45, 0.1],
        [0.5, 0.2],
        [0.45, 0.3],
        [0.4, 0.2],
      ]),
    };
    expect(withMaskChimney('house', recipe, [diamond], geom)).toBe(recipe);
    // Top below the eave (y 58..82 → obj −0.35..−0.05): a downspout, not a stack.
    expect(
      withMaskChimney('house', recipe, [rectMask(geom, 'chimney', 100, 58, 116, 82)], geom)
    ).toBe(recipe);
    // Tiny: trim, not a stack.
    expect(
      withMaskChimney('house', recipe, [rectMask(geom, 'chimney', 100, 10, 104, 14)], geom)
    ).toBe(recipe);
    // Off the house (photo x 194..200 → obj 0.5875..0.625, past span + 0.1): neighbour's.
    expect(
      withMaskChimney('house', recipe, [rectMask(geom, 'chimney', 194, 10, 200, 26)], geom)
    ).toBe(recipe);
    // Window masks are not chimneys.
    expect(
      withMaskChimney('house', recipe, [rectMask(geom, 'window', 100, 10, 116, 26)], geom)
    ).toBe(recipe);
  });

  it('returns the recipe untouched when disqualified', () => {
    const geom = geomA();
    const recipe = kitToRecipe(houseKit({ chimney: true }));
    const masks = [rectMask(geom, 'chimney', 100, 10, 116, 26)];
    expect(withMaskChimney('vehicle', recipe, masks, geom)).toBe(recipe);
    expect(withMaskChimney('house', recipe, [], geom)).toBe(recipe);
    const turned = { ...recipe, yaw: 0.5 };
    expect(withMaskChimney('house', turned, masks, geom)).toBe(turned);
  });

  it('a full recipe without a stack funds the new one from decals', () => {
    const geom = geomA();
    const base = free(kitToRecipe(houseKit()));
    expect(base.parts).toHaveLength(8);
    const decals = [0, 1, 2, 3].map((i) => ({
      shape: 'box' as const,
      at: [-0.4 + i * 0.2, -0.3, 0.505] as [number, number, number],
      size: [0.08, 0.1, 0.02] as [number, number, number],
      color: '#2222bb',
    }));
    const full: ObjectRecipe = { ...base, parts: [...base.parts, ...decals] };
    const out = withMaskChimney('house', full, [rectMask(geom, 'chimney', 100, 10, 116, 26)], geom);
    expect(out).not.toBe(full);
    expect(out.parts).toHaveLength(12);
    const main = out.parts.find((p) => p.front)!;
    const stack = out.parts.find(
      (p) => p.shape === 'box' && p.at[2] === 0 && p.size[0] === p.size[2] && p !== main
    );
    expect(stack).toBeDefined();
    // Structure kept: walls + 3 slabs + stack = 5 centred parts.
    expect(out.parts.filter((p) => p.at[2] === 0)).toHaveLength(5);
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('golden cottage: a chimney mask keeps the score (machinery end to end)', async () => {
    const c = GOLDEN_SHAPES.find((g) => g.name === 'cottage row')!;
    const buffer = await sharp(Buffer.from(goldenSvg(c)))
      .jpeg({ quality: 85 })
      .toBuffer();
    const photo = { buffer, ...PHOTO };
    const target: ShapeTarget = {
      id: 'cottage',
      label: 'cottage',
      category: 'other',
      box: goldenBox(c),
      outline: goldenOutline(c),
    };
    const spark = {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe(c.prior),
        kit: c.prior,
        source: 'meta',
        model: 'muse-spark-1.3',
      }),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
    };
    const plain = await runObjectShape(spark, photo, 'data:full', target);
    expect(plain.mode).toBe('recipe');
    // Chimney mask in object fractions: above the ridge at x ≈ 0.2.
    const box = target.box;
    const geom: MaskMapGeom = {
      photoW: photo.width,
      photoH: photo.height,
      box,
      crop: cropRectForShape(photo.width, photo.height, box),
    };
    const walls = plain.recipe!.parts.find((p) => p.front)!;
    const ridge = Math.max(
      ...plain.recipe!.parts.filter((p) => p !== walls).map((p) => p.at[1] + p.size[1] / 2)
    );
    const px = (ox: number) => (box.x + (ox + 0.5) * box.w) * photo.width;
    const py = (oy: number) => (box.y + (0.5 - oy) * box.h) * photo.height;
    const { crop } = geom;
    const cu = (x: number) => (x - crop.left) / crop.width;
    const cv = (y: number) => (y - crop.top) / crop.height;
    // Small and mostly overlapping the roof: the golden outline has no chimney, so every
    // above-ridge pixel is a false positive by construction — a real chimney photo includes
    // the stack in its outline.
    const x0 = px(0.17);
    const y0 = py(ridge + 0.06);
    const x1 = px(0.23);
    const y1 = py(ridge - 0.05);
    const chimney: PartMask = {
      concept: 'chimney',
      box: { x: cu(x0), y: cv(y0), w: cu(x1) - cu(x0), h: cv(y1) - cv(y0) },
      outline: polygonPath([
        [cu(x0), cv(y0)],
        [cu(x1), cv(y0)],
        [cu(x1), cv(y1)],
        [cu(x0), cv(y1)],
      ]),
    };
    const segmentImage = vi.fn(async (_url: string, concept: string) => ({
      source: 'meta' as const,
      model: 'sam-3.1',
      concept,
      imageWidth: geom.crop.outWidth,
      imageHeight: geom.crop.outHeight,
      instances:
        concept === 'chimney'
          ? [
              {
                box: {
                  x1: chimney.box.x * geom.crop.outWidth,
                  y1: chimney.box.y * geom.crop.outHeight,
                  x2: (chimney.box.x + chimney.box.w) * geom.crop.outWidth - 1,
                  y2: (chimney.box.y + chimney.box.h) * geom.crop.outHeight - 1,
                },
                confidence: 0.9,
                outline: chimney.outline,
              },
            ]
          : [],
      count: concept === 'chimney' ? 1 : 0,
      boxCoverage: 0.05,
    }));
    const measured = await runObjectShape({ ...spark, segmentImage }, photo, 'data:full', target);
    expect(measured.mode).toBe('recipe');
    expect(measured.partMasks!.filter((m) => m.concept === 'chimney')).toHaveLength(1);
    expect(measured.recipe!.parts.length).toBeLessThanOrEqual(MAX_COMPONENTS);
    // A stack rises past the walls on the roof at the mask x.
    const outWalls = measured.recipe!.parts.find((p) => p.front)!;
    const stack = measured.recipe!.parts.find(
      (p) =>
        p.shape === 'box' &&
        p !== outWalls &&
        Math.abs(p.at[2]) < 0.3 &&
        p.size[0] <= 0.2 &&
        p.at[1] + p.size[1] / 2 > outWalls.at[1] + outWalls.size[1] / 2
    );
    expect(stack).toBeDefined();
    expect(stack!.at[0]).toBeCloseTo(0.2, 1);
    expect(ObjectRecipeSchema.safeParse(measured.recipe!).success).toBe(true);
    console.info(
      `[test] cottage chimney: iou ${plain.fit!.iou} → ${measured.fit!.iou}, parts ${plain.recipe!.parts.length} → ${measured.recipe!.parts.length}`
    );
    expect(Math.abs(measured.fit!.iou - plain.fit!.iou)).toBeLessThanOrEqual(0.03);
  });
});
