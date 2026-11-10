// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { kitToRecipe, TAIL_LIGHT_COLOR, type ObjectKit } from '@/lib/object-kit';
import {
  MAX_RECIPE_PARTS,
  ObjectRecipeSchema,
  type PartMask,
  type ShapeTarget,
} from '@/lib/object-shape';
import { polygonPath } from '@/lib/vision';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { runObjectShape } from '../object-shape';
import { cropRectForShape } from '../shape-crop';
import type { MaskMapGeom } from '../mask-geometry';
import { fitCircle, RIM_COLOR, RIM_RATIO, withMaskWheels } from '../mask-wheels';

const kit = (extra?: Partial<ObjectKit>): ObjectKit => ({
  archetype: 'vehicle',
  proportions: { w: 1, h: 0.4, d: 0.45 },
  colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
  materials: { main: 'metal', secondary: 'glass', accent: 'rubber' },
  ...extra,
});

/** Photo 200×100, box 160×80 px at (20, 10): the crop is the whole photo. */
const geomA = (): MaskMapGeom => {
  const box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  return { photoW: 200, photoH: 100, box, crop: cropRectForShape(200, 100, box) };
};

/** Circle outline (12 pts) + box as a wheel mask, in crop fractions. */
const wheelMask = (geom: MaskMapGeom, cx: number, cy: number, r: number): PartMask => {
  const { crop } = geom;
  const cu = (px: number) => (px - crop.left) / crop.width;
  const cv = (py: number) => (py - crop.top) / crop.height;
  const pts = Array.from({ length: 12 }, (_, k) => {
    const a = (k / 12) * 2 * Math.PI;
    return [cu(cx + r * Math.cos(a)), cv(cy + r * Math.sin(a))] as const;
  });
  return {
    concept: 'wheel',
    box: { x: cu(cx - r), y: cv(cy - r), w: cu(cx + r) - cu(cx - r), h: cv(cy + r) - cv(cy - r) },
    outline: polygonPath(pts.map(([x, y]) => [x, y] as [number, number])),
  };
};

/** Full shape pipeline on a real photo: seconds of CPU, slower when the suite runs in parallel. */
const GOLDEN_E2E_TIMEOUT_MS = 30_000;

describe('fitCircle', () => {
  it('exact circle → exact centre and radius', () => {
    const pts = Array.from({ length: 12 }, (_, k) => {
      const a = (k / 12) * 2 * Math.PI;
      return [50 + 10 * Math.cos(a), 50 + 10 * Math.sin(a)] as const;
    });
    const fit = fitCircle(pts)!;
    expect(fit.cx).toBeCloseTo(50, 9);
    expect(fit.cy).toBeCloseTo(50, 9);
    expect(fit.r).toBeCloseTo(10, 9);
    expect(fit.rms).toBeLessThan(1e-9);
  });

  it('collinear or too few points → null', () => {
    expect(fitCircle([[0, 0]])).toBeNull();
    expect(
      fitCircle([
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
      ])
    ).toBeNull();
  });
});

describe('withMaskWheels (PR-2.6)', () => {
  it('two wheel masks → measured tyres + rims, mirrored, template wheels gone', () => {
    const geom = geomA();
    expect([geom.crop.left, geom.crop.top, geom.crop.width, geom.crop.height]).toEqual([
      0, 0, 200, 100,
    ]);
    const recipe = kitToRecipe(kit());
    expect(recipe.parts).toHaveLength(12);
    const out = withMaskWheels(
      'vehicle',
      recipe,
      [wheelMask(geom, 60, 70, 12), wheelMask(geom, 140, 70, 12)],
      geom
    );
    expect(out).not.toBe(recipe);
    // Photo (60, 70) r=12 in box 160×80 at (20, 10): x = −0.25, y = −0.25, rx = 0.075, ry = 0.15.
    const near = out.parts.filter((p) => p.shape === 'cylinder' && p.axis === 'z' && p.at[2] > 0);
    expect(near).toHaveLength(4);
    const tyres = near.filter((p) => p.color === '#1c1c1e');
    const rims = near.filter((p) => p.color === RIM_COLOR);
    expect(tyres).toHaveLength(2);
    expect(rims).toHaveLength(2);
    const left = tyres.find((p) => p.at[0] < 0)!;
    expect(left.at[0]).toBeCloseTo(-0.25, 3);
    expect(left.at[1]).toBeCloseTo(-0.25, 3);
    expect(left.size[0]).toBeCloseTo(0.15, 3);
    expect(left.size[1]).toBeCloseTo(0.3, 3);
    expect(left.size[2]).toBeCloseTo(0.14, 6);
    expect(left.material).toBe('rubber');
    const rim = rims.find((p) => p.at[0] < 0)!;
    expect(rim.at[0]).toBeCloseTo(-0.25, 3);
    expect(rim.size[0]).toBeCloseTo(0.15 * RIM_RATIO, 3);
    expect(rim.size[1]).toBeCloseTo(0.3 * RIM_RATIO, 3);
    expect(rim.size[2]).toBeGreaterThan(left.size[2]);
    expect(rim.material).toBe('metal');
    // Far side mirrored (tyres only), template wheels replaced: 8 body + 6 wheel − 2 lights = 12.
    const far = out.parts.filter((p) => p.shape === 'cylinder' && p.axis === 'z' && p.at[2] < 0);
    expect(far).toHaveLength(2);
    expect(far.every((p) => p.color === '#1c1c1e')).toBe(true);
    expect(out.parts.length).toBeLessThanOrEqual(MAX_RECIPE_PARTS);
    expect(out.parts).toHaveLength(12);
    // Budget backstop dropped the two headlight dots first of the four light dots; the
    // red lenses stay, never the body or the glasshouse.
    expect(out.parts.some((p) => p.front)).toBe(true);
    expect(out.parts.filter((p) => p.color === TAIL_LIGHT_COLOR)).toHaveLength(2);
    expect(out.parts.some((p) => p.shape === 'cylinder' && p.axis === 'x' && p.at[0]! > 0)).toBe(
      false
    );
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('box-only and ragged masks fall back to the box circle', () => {
    const geom = geomA();
    const recipe = kitToRecipe(kit());
    const boxOnly: PartMask = {
      concept: 'wheel',
      box: { x: 0.24, y: 0.58, w: 0.12, h: 0.24 },
    };
    const plus: PartMask = {
      concept: 'wheel',
      box: { x: 0.64, y: 0.58, w: 0.12, h: 0.24 },
      // A plus sign: the circle fit exists but its residual dwarfs the radius.
      outline: polygonPath([
        [0.7, 0.58],
        [0.7, 0.82],
        [0.64, 0.7],
        [0.76, 0.7],
        [0.7, 0.7],
      ]),
    };
    const out = withMaskWheels('vehicle', recipe, [boxOnly, plus], geom);
    const tyres = out.parts.filter(
      (p) => p.shape === 'cylinder' && p.axis === 'z' && p.color === '#1c1c1e' && p.at[2] > 0
    );
    expect(tyres).toHaveLength(2);
    // Box (48, 58)–(72, 82) px → centre (60, 70) r = 12: the same numbers as the circle test.
    const left = tyres.find((p) => p.at[0] < 0)!;
    expect(left.at[0]).toBeCloseTo(-0.25, 6);
    expect(left.size[0]).toBeCloseTo(0.15, 6);
    expect(left.size[1]).toBeCloseTo(0.3, 6);
    // Ragged outline ignored: the right box (128, 58)–(152, 82) → x = +0.25.
    const right = tyres.find((p) => p.at[0] > 0)!;
    expect(right.at[0]).toBeCloseTo(0.25, 6);
    expect(right.size[0]).toBeCloseTo(0.15, 6);
  });

  it('offset crop: fractions map through the crop rect onto the box', () => {
    // Photo 300×200, box 60×60 at (150, 50): crop 96×96 at (132, 32).
    const box = { x: 0.5, y: 0.25, w: 0.2, h: 0.3 };
    const geom: MaskMapGeom = {
      photoW: 300,
      photoH: 200,
      box,
      crop: cropRectForShape(300, 200, box),
    };
    expect([geom.crop.left, geom.crop.top, geom.crop.width, geom.crop.height]).toEqual([
      132, 32, 96, 96,
    ]);
    const out = withMaskWheels('vehicle', kitToRecipe(kit()), [wheelMask(geom, 160, 95, 10)], geom);
    const tyre = out.parts.find(
      (p) => p.shape === 'cylinder' && p.axis === 'z' && p.color === '#1c1c1e'
    )!;
    // bu = 10/60 → x = −1/3; bv = 45/60 → y = −0.25; r = 10/60 both axes (square box).
    expect(tyre.at[0]).toBeCloseTo(-1 / 3, 3);
    expect(tyre.at[1]).toBeCloseTo(-0.25, 3);
    expect(tyre.size[0]).toBeCloseTo(1 / 3, 3);
    expect(tyre.size[1]).toBeCloseTo(1 / 3, 3);
  });

  it('filter-then-cap (FIX 3): out-of-span FPs first do not starve the real wheels', () => {
    const geom = geomA();
    const recipe = kitToRecipe(kit());
    // Before: slice(0, 3) kept these three (|x| or |y| > 0.6), all rejected, recipe unchanged.
    const masks = [
      wheelMask(geom, 2, 50, 8),
      wheelMask(geom, 198, 50, 8),
      wheelMask(geom, 100, 1, 8),
      wheelMask(geom, 60, 70, 12),
      wheelMask(geom, 140, 70, 12),
    ];
    const out = withMaskWheels('vehicle', recipe, masks, geom);
    expect(out).not.toBe(recipe);
    const tyres = out.parts.filter(
      (p) => p.shape === 'cylinder' && p.axis === 'z' && p.color === '#1c1c1e' && p.at[2] > 0
    );
    expect(tyres).toHaveLength(2);
  });

  it('motorbike wheels on the centre plane are placed once, not mirrored', () => {
    const geom = geomA();
    const bike = kitToRecipe(kit({ details: { wheels: 2 } }));
    expect(bike.parts.filter((p) => p.shape === 'cylinder' && p.axis === 'z')).toHaveLength(2);
    const out = withMaskWheels('vehicle', bike, [wheelMask(geom, 100, 70, 12)], geom);
    const wheels = out.parts.filter((p) => p.shape === 'cylinder' && p.axis === 'z');
    // One tyre + one rim at z = 0; no far-side double.
    expect(wheels).toHaveLength(2);
    expect(wheels.every((p) => p.at[2] === 0)).toBe(true);
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('measured centres un-turn with the yaw', () => {
    const geom = geomA();
    const recipe = { ...kitToRecipe(kit()), yaw: 0.2 };
    const out = withMaskWheels('vehicle', recipe, [wheelMask(geom, 60, 70, 12)], geom);
    const tyre = out.parts.find(
      (p) => p.shape === 'cylinder' && p.axis === 'z' && p.color === '#1c1c1e' && p.at[2] > 0
    )!;
    // x = (xw − z·d·sin) / cos / w = (−0.25 − 0.44·0.45·sin0.2) / cos0.2 ≈ −0.2952.
    expect(tyre.at[0]).toBeCloseTo(-0.2952, 3);
    expect(tyre.size[0]).toBeCloseTo(0.15 / Math.cos(0.2), 3);
  });

  it('returns the recipe untouched when disqualified', () => {
    const geom = geomA();
    const recipe = kitToRecipe(kit());
    const masks = [wheelMask(geom, 60, 70, 12)];
    expect(withMaskWheels('cabinet', recipe, masks, geom)).toBe(recipe);
    expect(withMaskWheels('vehicle', recipe, [], geom)).toBe(recipe);
    expect(
      withMaskWheels('vehicle', recipe, [{ concept: 'window', box: masks[0]!.box }], geom)
    ).toBe(recipe);
    const turned = { ...recipe, yaw: 0.5 };
    expect(withMaskWheels('vehicle', turned, masks, geom)).toBe(turned);
    // Mask outside the frame and zero-size box: nothing usable.
    expect(
      withMaskWheels(
        'vehicle',
        recipe,
        [{ concept: 'wheel', box: { x: 2, y: 2, w: 0.1, h: 0.1 } }],
        geom
      )
    ).toBe(recipe);
    expect(
      withMaskWheels(
        'vehicle',
        recipe,
        [{ concept: 'wheel', box: { x: 0.3, y: 0.7, w: 0, h: 0 } }],
        geom
      )
    ).toBe(recipe);
  });

  it(
    'golden car: masks at the template wheels keep the score (machinery end to end)',
    async () => {
      const c = GOLDEN_SHAPES.find((g) => g.name === 'car')!;
      const buffer = await sharp(Buffer.from(goldenSvg(c)))
        .jpeg({ quality: 85 })
        .toBuffer();
      const photo = { buffer, ...PHOTO };
      const target: ShapeTarget = {
        id: 'car',
        label: 'car',
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
      // Wheel masks where the template put its wheels (near side), round in pixels.
      const box = target.box;
      const geom: MaskMapGeom = {
        photoW: photo.width,
        photoH: photo.height,
        box,
        crop: cropRectForShape(photo.width, photo.height, box),
      };
      const templateWheels = plain.recipe!.parts.filter(
        (p) => p.shape === 'cylinder' && p.axis === 'z' && p.at[2] > 0
      );
      expect(templateWheels.length).toBeGreaterThan(0);
      const masks = templateWheels.map((tw) => {
        const cx = (box.x + (tw.at[0] + 0.5) * box.w) * photo.width;
        const cy = (box.y + (0.5 - tw.at[1]) * box.h) * photo.height;
        const r = (tw.size[0] / 2) * box.w * photo.width;
        return wheelMask(geom, cx, cy, r);
      });
      const segmentImage = vi.fn(async (_url: string, concept: string) => ({
        source: 'meta' as const,
        model: 'sam-3.1',
        concept,
        imageWidth: geom.crop.outWidth,
        imageHeight: geom.crop.outHeight,
        instances:
          concept === 'wheel'
            ? masks.map((m) => ({
                box: {
                  x1: m.box.x * geom.crop.outWidth,
                  y1: m.box.y * geom.crop.outHeight,
                  x2: (m.box.x + m.box.w) * geom.crop.outWidth - 1,
                  y2: (m.box.y + m.box.h) * geom.crop.outHeight - 1,
                },
                confidence: 0.9,
                outline: m.outline,
              }))
            : [],
        count: concept === 'wheel' ? masks.length : 0,
        boxCoverage: 0.1,
      }));
      const measured = await runObjectShape({ ...spark, segmentImage }, photo, 'data:full', target);
      expect(measured.mode).toBe('recipe');
      expect(measured.partMasks!.filter((m) => m.concept === 'wheel')).toHaveLength(masks.length);
      expect(measured.recipe!.parts.length).toBeLessThanOrEqual(MAX_RECIPE_PARTS);
      expect(ObjectRecipeSchema.safeParse(measured.recipe!).success).toBe(true);
      console.info(
        `[test] car wheels: iou ${plain.fit!.iou} → ${measured.fit!.iou}, parts ${plain.recipe!.parts.length} → ${measured.recipe!.parts.length}`
      );
      expect(Math.abs(measured.fit!.iou - plain.fit!.iou)).toBeLessThanOrEqual(0.03);
    },
    GOLDEN_E2E_TIMEOUT_MS
  );
});
