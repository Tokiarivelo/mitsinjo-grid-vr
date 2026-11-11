// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { ObjectRecipeSchema, type PartMask, type ShapeTarget } from '@/lib/object-shape';
import { polygonPath } from '@/lib/vision';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { DOOR_COLOR } from '../facade-house';
import {
  facadeMaskGeom,
  facadeObjectBox,
  fetchFacadeMasks,
  FACADE_OBJECT_MIN_AREA,
} from '../facade-masks';
import { withMaskPanels } from '../mask-panels';
import { runObjectShape } from '../object-shape';
import { shapeWithCritic } from '../spark-critic';

const houseKit = (): ObjectKit => ({
  archetype: 'house',
  proportions: { w: 1, h: 0.6, d: 0.5 },
  colors: { main: '#aaaaaa', secondary: '#bb2222', accent: '#2222bb' },
  materials: { main: 'plaster', secondary: 'tile', accent: 'glass' },
});

/** Facade-fraction rect → mask (4-corner outline). */
const mask = (concept: string, x0: number, y0: number, x1: number, y1: number): PartMask => ({
  concept,
  box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
  outline: polygonPath([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]),
});

const leaves = (r: { parts: ReadonlyArray<{ shape: string; size: number[] }> }) =>
  r.parts.filter((p) => p.shape === 'box' && p.size[2] === 0.02);

/** Fake SAM: `answers[concept]` = instances in pixels of a W×H image. */
function fakeSam(
  W: number,
  H: number,
  answers: Record<string, Array<[number, number, number, number]>>,
  source: 'meta' | 'mock' = 'meta'
) {
  return vi.fn(async (_url: string, concept: string) => ({
    source,
    model: 'sam-3.1',
    concept,
    imageWidth: W,
    imageHeight: H,
    instances: (answers[concept] ?? []).map(([x1, y1, x2, y2]) => ({
      box: { x1, y1, x2, y2 },
      confidence: 0.9,
    })),
    count: (answers[concept] ?? []).length,
    boxCoverage: 0.1,
  }));
}

describe('facadeObjectBox', () => {
  it('largest SAM box; a tiny or missing one → the whole image', () => {
    const big = { x: 0.1, y: 0.2, w: 0.8, h: 0.7 };
    expect(facadeObjectBox([{ x: 0, y: 0, w: 0.2, h: 0.2 }, big])).toEqual(big);
    expect(facadeObjectBox([{ x: 0, y: 0, w: 0.3, h: 0.3 }])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(0.3 * 0.3).toBeLessThan(FACADE_OBJECT_MIN_AREA);
    expect(facadeObjectBox([])).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('withMaskPanels on facade masks (frontal)', () => {
  const geom = facadeMaskGeom(400, 300, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const masks = [mask('window', 0.2, 0.5, 0.35, 0.66), mask('door', 0.5, 0.58, 0.6, 0.82)];

  it('places leaves at the facade fractions of the object box', () => {
    const out = withMaskPanels('house', kitToRecipe(houseKit()), masks, geom, { frontal: true });
    const win = out.parts.find((p) => p.color === '#2222bb')!;
    // Window centre 0.275 of the image → (0.275 − 0.1) / 0.8 − 0.5 of the box.
    expect(win.at[0]).toBeCloseTo((0.275 - 0.1) / 0.8 - 0.5, 3);
    expect(win.size[0]).toBeCloseTo(0.15 / 0.8, 3);
    expect(leaves(out)).toHaveLength(2);
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('a yawed model keeps the facade positions (before: un-turned like photo masks)', () => {
    const flat = withMaskPanels('house', kitToRecipe(houseKit()), masks, geom, { frontal: true });
    const turned = { ...kitToRecipe(houseKit()), yaw: 0.5 };
    const frontal = withMaskPanels('house', turned, masks, geom, { frontal: true });
    const photoLike = withMaskPanels('house', turned, masks, geom);
    const xs = (r: typeof flat) => leaves(r).map((p) => (p as unknown as { at: number[] }).at[0]);
    expect(xs(frontal)).toEqual(xs(flat));
    expect(xs(photoLike)).not.toEqual(xs(flat));
    // Past the photo's hard yaw gate the facade still places its panels.
    const side = { ...kitToRecipe(houseKit()), yaw: 1.2 };
    expect(withMaskPanels('house', side, masks, geom)).toBe(side);
    expect(leaves(withMaskPanels('house', side, masks, geom, { frontal: true }))).toHaveLength(2);
  });
});

describe('fetchFacadeMasks', () => {
  it('segments the object, windows and doors on the facade; maps to its box', async () => {
    const sam = fakeSam(400, 300, {
      house: [[40, 30, 359, 269]],
      window: [[80, 150, 139, 197]],
      door: [[200, 174, 239, 245]],
    });
    const got = await fetchFacadeMasks(sam, 'https://r2/f.png', 'house', 'house');
    expect(sam.mock.calls.map((c) => c[1]).sort()).toEqual(['door', 'house', 'window']);
    expect(sam.mock.calls.every((c) => c[0] === 'https://r2/f.png')).toBe(true);
    expect(got!.masks.map((m) => m.concept).sort()).toEqual(['door', 'window']);
    expect(got!.geom.photoW).toBe(400);
    expect(got!.geom.box.x).toBeCloseTo(0.1, 3);
    expect(got!.geom.box.w).toBeCloseTo(0.8, 3);
  });

  it('no facade concepts (vehicle), mock answers or nothing found → null', async () => {
    const none = fakeSam(400, 300, {});
    expect(await fetchFacadeMasks(none, 'u', 'vehicle', 'car')).toBeNull();
    expect(none).not.toHaveBeenCalled();
    expect(await fetchFacadeMasks(none, 'u', 'house', 'house')).toBeNull();
    const mock = fakeSam(400, 300, { window: [[80, 150, 139, 197]] }, 'mock');
    expect(await fetchFacadeMasks(mock, 'u', 'house', 'house')).toBeNull();
  });

  it('object not found → whole image as the box, panels still measured', async () => {
    const sam = fakeSam(400, 300, { window: [[80, 150, 139, 197]] });
    const got = await fetchFacadeMasks(sam, 'u', 'house', 'house');
    expect(got!.geom.box).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('runObjectShape with a validated facade', () => {
  it('golden cottage: the window comes from the facade, the photo gives none', async () => {
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
      facadeUrl: 'https://r2.example/facade.png',
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
    const facadeSam = fakeSam(400, 300, { window: [[150, 160, 209, 219]] });
    const segmentImage = vi.fn(async (url: string, concept: string) =>
      url === target.facadeUrl
        ? facadeSam(url, concept)
        : { ...(await facadeSam(url, concept)), instances: [], count: 0 }
    );
    const out = await runObjectShape({ ...spark, segmentImage }, photo, 'data:full', target);
    expect(out.mode).toBe('recipe');
    // Spark is told about the facade, SAM ran on it.
    expect(spark.describeShape.mock.calls[0]![1].facadeUrl).toBe(target.facadeUrl);
    expect(segmentImage.mock.calls.some((c) => c[0] === target.facadeUrl)).toBe(true);
    // No photo window, yet a measured leaf sits in the wall (from the facade).
    expect(out.partMasks?.filter((m) => m.concept === 'window') ?? []).toHaveLength(0);
    expect(leaves(out.recipe!).length).toBeGreaterThanOrEqual(1);
    expect(ObjectRecipeSchema.safeParse(out.recipe!).success).toBe(true);
  });

  it('a readable facade rebuilds the house from it: proportions, roof, door (user 2026-11-02)', async () => {
    const c = GOLDEN_SHAPES.find((g) => g.name === 'cottage row')!;
    const buffer = await sharp(Buffer.from(goldenSvg(c)))
      .jpeg({ quality: 85 })
      .toBuffer();
    const photo = { buffer, ...PHOTO };
    const target: ShapeTarget = {
      id: 'house',
      label: 'house',
      category: 'other',
      scenery: 'building',
      box: goldenBox(c),
      outline: goldenOutline(c),
      facadeUrl: 'https://r2.example/facade.png',
    };
    const spark = {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe({ ...c.prior, archetype: 'house' }),
        kit: { ...c.prior, archetype: 'house' },
        source: 'meta',
        model: 'muse-spark-1.3',
      }),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
    };
    // A 600 × 400 front: walls 60 % of the width, roof 40 % of the body, 2 windows, 1 door.
    const facadeSam = fakeSam(600, 400, {
      house: [[60, 40, 539, 359]],
      roof: [[60, 40, 539, 159]],
      wall: [[90, 160, 509, 359]],
      window: [
        [140, 200, 199, 259],
        [400, 200, 459, 259],
      ],
      door: [[270, 240, 329, 359]],
    });
    const segmentImage = vi.fn(async (url: string, concept: string) =>
      url === target.facadeUrl
        ? facadeSam(url, concept)
        : { ...(await facadeSam(url, concept)), instances: [], count: 0 }
    );
    const criticizeShape = vi.fn().mockResolvedValue({ patch: { subtype: 'x' } });
    const out = await shapeWithCritic(
      { ...spark, segmentImage, criticizeShape },
      photo,
      'data:full',
      target
    );
    expect(out.mode).toBe('recipe');
    const r = out.recipe!;
    expect(r.source).toBe('facade');
    // Measured on the elevations, not the photo: the photo critic has nothing to patch.
    expect(criticizeShape).not.toHaveBeenCalled();
    expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
    // Facade 480 × 320 px body: wide, not the photo box's shape.
    expect(r.proportions.w / r.proportions.h).toBeCloseTo(480 / 320, 1);
    expect(r.parts.filter((p) => p.material === 'glass')).toHaveLength(2);
    expect(r.parts.find((p) => p.material === 'wood')?.color).toBe(DOOR_COLOR);
    expect(r.dimStatus?.eave).toBe('measured');
    // PQ-T7: the facade path carries the photo conditions too, or the small / blurred hint never shows.
    expect(out.conditions).toMatchObject({ sharpness: expect.any(String) });
    expect(out.conditions!.widthPx).toBeGreaterThan(0);
    // PQ-T23: the same house from a clean front (drawn where the photo shows nothing) reads inferred,
    // on the facade route too (before: only the views path marked it).
    const drawnOnly = (parts: typeof r.parts) => parts.filter((p) => !p.front);
    expect(drawnOnly(r.parts).some((p) => p.status === 'measured')).toBe(true);
    const clean = await shapeWithCritic(
      { ...spark, segmentImage, criticizeShape },
      photo,
      'data:full',
      {
        ...target,
        cleanFront: true,
      }
    );
    expect(clean.recipe!.source).toBe('facade');
    expect(drawnOnly(clean.recipe!.parts).some((p) => p.status === 'measured')).toBe(false);
    expect(clean.recipe!.parts).toHaveLength(r.parts.length);
  });

  it('the staged loop asks Spark per stage and never makes the house worse (PG-T16)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const c = GOLDEN_SHAPES.find((g) => g.name === 'cottage row')!;
    const buffer = await sharp(Buffer.from(goldenSvg(c)))
      .jpeg({ quality: 85 })
      .toBuffer();
    const target: ShapeTarget = {
      id: 'house',
      label: 'house',
      category: 'other',
      scenery: 'building',
      box: goldenBox(c),
      outline: goldenOutline(c),
      facadeUrl: 'https://r2.example/facade.png',
    };
    const kit = { ...c.prior, archetype: 'house' as const };
    const spark = {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe(kit),
        kit,
        source: 'meta',
        model: 'muse-spark-1.3',
      }),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
    };
    const facadeSam = fakeSam(600, 400, {
      house: [[60, 40, 539, 359]],
      roof: [[60, 40, 539, 159]],
      wall: [[90, 160, 509, 359]],
      window: [
        [140, 200, 199, 259],
        [400, 200, 459, 259],
      ],
      door: [[270, 240, 329, 359]],
    });
    const segmentImage = vi.fn(async (url: string, concept: string) =>
      url === target.facadeUrl
        ? facadeSam(url, concept)
        : { ...(await facadeSam(url, concept)), instances: [], count: 0 }
    );
    // A harmful patch each round: shrink the walls, flatten the roof, drop a window.
    const proposeShapeOps = vi.fn(async () => ({
      source: 'meta' as const,
      model: 'muse-spark-1.3',
      ops: [
        { op: 'set', id: 'wall', size: [0.3, 0.3, 0.3] },
        { op: 'set', id: 'roof', ridge: 0 },
        { op: 'remove', id: 'window' },
      ],
    }));
    const run = (withLoop: boolean) =>
      runObjectShape(
        { ...spark, segmentImage, ...(withLoop ? { proposeShapeOps } : {}) },
        { buffer, ...PHOTO },
        'data:full',
        target
      );
    const plain = await run(false);
    const looped = await run(true);
    vi.unstubAllGlobals();
    expect(proposeShapeOps).toHaveBeenCalled();
    const [img, question] = proposeShapeOps.mock.calls[0]! as unknown as [string, string];
    expect(img).toMatch(/^data:image\/jpeg/);
    expect(question).toMatch(/Stage: (massing|roof|openings|accessories)/);
    expect(looped.recipe!.source).toBe('facade');
    expect(looped.recipe!.parts).toEqual(plain.recipe!.parts);
  });
});
