// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { kitToRecipe, type ObjectKit } from '@/lib/object-kit';
import { ObjectRecipeSchema, type PartMask, type ShapeTarget } from '@/lib/object-shape';
import { boxPath, pathToRings, polygonPath } from '@/lib/vision';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { deltaE2000, hexToLab, hexToRgb, linearToHex, srgbToLinear } from '../color-measure';
import { confidence, mixColor } from '../fusion';
import type { MaskMapGeom } from '../mask-geometry';
import { withMaskPanels } from '../mask-panels';
import { RIM_COLOR, withMaskWheels } from '../mask-wheels';
import type { RgbGrid } from '../model-score';
import { runObjectShape } from '../object-shape';
import { cropRectForShape } from '../shape-crop';
import { sampleObjectRgb } from '../shape-colors';
import {
  litMeasure,
  measureRegionColors,
  measureWallTints,
  withRegionColors,
} from '../region-colors';

const rgbHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const vehicleKit = (): ObjectKit => ({
  archetype: 'vehicle',
  proportions: { w: 1, h: 0.4, d: 0.45 },
  colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
  // PQ-T43: accent = glass, secondary = trim metal (was glass/rubber).
  materials: { main: 'metal', secondary: 'metal', accent: 'glass' },
});

/** Photo 200×100, box 160×80 px at (20, 10): the crop is the whole photo. */
const geomA = () => {
  const box = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  return { photoW: 200, photoH: 100, box, crop: cropRectForShape(200, 100, box) };
};
const photoA = { width: 200, height: 100 };

const grid = (
  cols: number,
  rows: number,
  at: (i: number, j: number) => [number, number, number]
): RgbGrid => {
  const rgb = Buffer.alloc(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [r, g, b] = at(i, j);
      rgb[(j * cols + i) * 3] = r;
      rgb[(j * cols + i) * 3 + 1] = g;
      rgb[(j * cols + i) * 3 + 2] = b;
    }
  }
  return { cols, rows, rgb };
};

/** Photo-pixel rect → box-only mask, in crop fractions. */
const boxMask = (
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
  return { concept, box: { x: cu(x0), y: cv(y0), w: cu(x1) - cu(x0), h: cv(y1) - cv(y0) } };
};

const RED: [number, number, number] = [200, 30, 30];
const BLUE: [number, number, number] = [30, 60, 200];

const expectColor = (hex: string, [r, g, b]: [number, number, number]) => {
  const [hr, hg, hb] = hexToRgb(hex);
  expect(Math.abs(hr - r)).toBeLessThanOrEqual(2);
  expect(Math.abs(hg - g)).toBeLessThanOrEqual(2);
  expect(Math.abs(hb - b)).toBeLessThanOrEqual(2);
};

describe('measureRegionColors (PR-2.8)', () => {
  it('window region reads its cells, rest reads the outline outside every mask', () => {
    const geom = geomA();
    const g = grid(12, 12, (i) => (i < 6 ? RED : BLUE));
    const outline = boxPath(geom.box);
    const rings = pathToRings(outline);
    // Right half of the box (photo x 100..180): eroded 20% → 4 cols × 8 rows, all blue.
    const masks = [boxMask(geom, 'window', 100, 10, 180, 90)];
    const out = measureRegionColors(g, rings, masks, geom, photoA, geom.box);
    expect(out.regions).toHaveLength(1);
    expect(out.regions[0]!.pixels).toBe(32);
    expectColor(out.regions[0]!.color, BLUE);
    expect(out.rest!.pixels).toBe(144 - 32);
    // Rest is 72 red + 40 blue cells: the median stays red where a mean would go mauve.
    expectColor(out.rest!.color, RED);
  });

  it('a part half in shadow reads its lit colour, the shadow share is reported apart (PQ-T10)', () => {
    const geom = geomA();
    const LIT: [number, number, number] = [200, 60, 50];
    const SHADE: [number, number, number] = [70, 21, 18];
    const rings = pathToRings(boxPath(geom.box));
    const masks = [boxMask(geom, 'window', 20, 10, 180, 90)];
    // Wall 40 % in shadow: the lit 60 % are exactly the lit cells.
    const half = grid(10, 10, (i) => (i < 4 ? SHADE : LIT));
    const out = measureRegionColors(half, rings, masks, geom, photoA, geom.box);
    expect(deltaE2000(hexToLab(out.regions[0]!.color), hexToLab(rgbHex(LIT)))).toBeLessThan(5);
    expect(out.regions[0]!.shadow).toBeGreaterThan(0.3);
    // Before: the median of everything. 65 % in shadow reads the shade colour, 100 % lit reads no shadow.
    const mostly = grid(10, 10, (i) => (i < 6 ? SHADE : LIT));
    const m = measureRegionColors(mostly, rings, masks, geom, photoA, geom.box);
    expect(m.regions[0]!.shadow).toBeGreaterThan(0.5);
    const flat = measureRegionColors(
      grid(10, 10, () => LIT),
      rings,
      masks,
      geom,
      photoA,
      geom.box
    );
    expect(flat.regions[0]!.shadow).toBe(0);
    expect(deltaE2000(hexToLab(flat.regions[0]!.color), hexToLab(rgbHex(LIT)))).toBeLessThan(1);
  });

  it('litMeasure: a single colour is itself, an empty-ish pool never throws', () => {
    const one = litMeasure([0.5], [0.2], [0.1]);
    expect(one.pixels).toBe(1);
    expect(one.shadow).toBe(0);
  });

  it('box-only masks erode 20%: round-wheel corners do not pollute the colour', () => {
    const geom = geomA();
    const g = grid(10, 10, (i, j) => (i >= 2 && i <= 7 && j >= 2 && j <= 7 ? BLUE : RED));
    const rings = pathToRings(boxPath(geom.box));
    // Whole-box mask: eroded to the blue centre (6×6), red corners excluded.
    const masks = [boxMask(geom, 'wheel', 20, 10, 180, 90)];
    const out = measureRegionColors(g, rings, masks, geom, photoA, geom.box);
    expect(out.regions[0]!.pixels).toBe(36);
    expectColor(out.regions[0]!.color, BLUE);
    expect(out.rest!.pixels).toBe(64);
    expectColor(out.rest!.color, RED);
  });

  it('outline masks test exactly: triangle inside the blue half reads blue', () => {
    const geom = geomA();
    const g = grid(10, 10, (i) => (i < 5 ? RED : BLUE));
    const rings = pathToRings(boxPath(geom.box));
    const mask: PartMask = {
      concept: 'window',
      box: { x: 0.5, y: 0.1, w: 0.4, h: 0.8 },
      outline: polygonPath([
        [0.5, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
      ]),
    };
    const out = measureRegionColors(g, rings, [mask], geom, photoA, geom.box);
    expect(out.regions[0]!.pixels).toBeGreaterThan(0);
    expectColor(out.regions[0]!.color, BLUE);
    expect(out.regions[0]!.pixels + out.rest!.pixels).toBe(100);
  });

  it('too few cells → null; no outline → no rest (regions still read)', () => {
    const geom = geomA();
    const g = grid(10, 10, () => RED);
    const rings = pathToRings(boxPath(geom.box));
    const tiny = [boxMask(geom, 'window', 60, 40, 64, 44)];
    expect(measureRegionColors(g, rings, tiny, geom, photoA, geom.box).regions).toEqual([null]);
    const full = [boxMask(geom, 'window', 20, 10, 180, 90)];
    const noOutline = measureRegionColors(g, [], full, geom, photoA, geom.box);
    expect(noOutline.regions[0]).not.toBeNull();
    expect(noOutline.rest).toBeNull();
    expect(measureRegionColors(g, [], [], geom, photoA, geom.box)).toEqual({
      regions: [],
      rest: null,
    });
  });
});

describe('withRegionColors (PR-2.8)', () => {
  it('glass, tyres and body take their regions; rims keep their alloy', () => {
    const geom = geomA();
    const masks: PartMask[] = [
      boxMask(geom, 'window', 60, 16, 100, 32),
      boxMask(geom, 'wheel', 44, 70, 76, 90),
      boxMask(geom, 'wheel', 124, 70, 156, 90),
    ];
    // Pipeline order: wheels, then panels, then colours.
    const wheeled = withMaskWheels('vehicle', kitToRecipe(vehicleKit()), masks, geom);
    const panelled = withMaskPanels('vehicle', wheeled, masks, geom);
    const measured = {
      regions: [
        { color: '#1122ff', pixels: 2000, shadow: 0 },
        { color: '#111111', pixels: 2000, shadow: 0 },
        { color: '#111111', pixels: 2000, shadow: 0 },
      ],
      rest: { color: '#ff0000', pixels: 2000, shadow: 0 },
    };
    const out = withRegionColors('vehicle', panelled, masks, measured, geom);
    expect(out).not.toBe(panelled);
    // Full confidence (≥ 1000 px): exact measured colours.
    expect(confidence.colors(2000)).toBe(1);
    const panels = out.parts.filter((p) => p.shape === 'box' && p.size[2] === 0.02);
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.every((p) => p.color === '#1122ff')).toBe(true);
    const tyres = out.parts.filter(
      (p) => p.shape === 'cylinder' && p.axis === 'z' && p.color === '#111111'
    );
    expect(tyres.length).toBe(4);
    const rims = out.parts.filter((p) => p.color === RIM_COLOR);
    expect(rims.length).toBe(2);
    const main = out.parts.find((p) => p.front)!;
    expect(main.color).toBe('#ff0000');
    const shell = out.parts.find((p) => p.shape === 'box' && p.at[1] === 0.32)!;
    expect(shell.color).toBe('#ff0000');
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('a glass shell (no panels pass) keeps its colour; thin evidence is ignored', () => {
    const geom = geomA();
    const recipe = kitToRecipe(vehicleKit());
    const masks = [boxMask(geom, 'window', 60, 16, 100, 32)];
    // Glass shell untouched (colour differs from the body), body takes the rest.
    const out = withRegionColors(
      'vehicle',
      recipe,
      masks,
      { regions: [null], rest: { color: '#ff0000', pixels: 2000, shadow: 0 } },
      geom
    );
    expect(out.parts.find((p) => p.front)!.color).toBe('#ff0000');
    expect(out.parts.find((p) => p.shape === 'box' && p.at[1] === 0.32)!.color).toBe('#1c1c1e');
    // 32 px measured but below trust: same reference.
    const thin = withRegionColors(
      'vehicle',
      recipe,
      masks,
      { regions: [{ color: '#1122ff', pixels: 32, shadow: 0 }], rest: null },
      geom
    );
    expect(confidence.colors(32)).toBe(0);
    expect(thin).toBe(recipe);
    // Nothing applicable: same reference.
    expect(withRegionColors('cabinet', recipe, masks, { regions: [null], rest: null }, geom)).toBe(
      recipe
    );
    expect(withRegionColors('vehicle', recipe, [], { regions: [], rest: null }, geom)).toBe(recipe);
  });

  it('golden car: live masks recolour glass and body, silhouette stable', async () => {
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
    const box = target.box;
    const geom: MaskMapGeom = {
      photoW: photo.width,
      photoH: photo.height,
      box,
      crop: cropRectForShape(photo.width, photo.height, box),
    };
    // Window masks over the shell thirds (self-consistent with the plain run).
    const main = plain.recipe!.parts.find((p) => p.front)!;
    const shell = plain
      .recipe!.parts.filter((p) => p.shape === 'box' && p !== main && p.at[1] > main.at[1])
      .sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0]!;
    const sx0 = shell.at[0] - shell.size[0] / 2;
    const sx1 = shell.at[0] + shell.size[0] / 2;
    const sy0 = shell.at[1] - shell.size[1] / 2;
    const sy1 = shell.at[1] + shell.size[1] / 2;
    const px = (ox: number) => (box.x + (ox + 0.5) * box.w) * photo.width;
    const py = (oy: number) => (box.y + (0.5 - oy) * box.h) * photo.height;
    const objBox = (ox0: number, oy0: number, ox1: number, oy1: number): PartMask['box'] => {
      const { crop } = geom;
      const x0 = px(ox0);
      const y0 = py(oy1);
      const x1 = px(ox1);
      const y1 = py(oy0);
      return {
        x: (x0 - crop.left) / crop.width,
        y: (y0 - crop.top) / crop.height,
        w: (x1 - x0) / crop.width,
        h: (y1 - y0) / crop.height,
      };
    };
    const span = sx1 - sx0;
    const masks: PartMask[] = [0.05, 0.55].map((f0) => ({
      concept: 'window',
      box: objBox(
        sx0 + f0 * span,
        sy0 + 0.2 * (sy1 - sy0),
        sx0 + (f0 + 0.4) * span,
        sy0 + 0.8 * (sy1 - sy0)
      ),
    }));
    const segmentImage = vi.fn(async (_url: string, concept: string) => ({
      source: 'meta' as const,
      model: 'sam-3.1',
      concept,
      imageWidth: geom.crop.outWidth,
      imageHeight: geom.crop.outHeight,
      instances:
        concept === 'window'
          ? masks.map((m) => ({
              box: {
                x1: m.box.x * geom.crop.outWidth,
                y1: m.box.y * geom.crop.outHeight,
                x2: (m.box.x + m.box.w) * geom.crop.outWidth - 1,
                y2: (m.box.y + m.box.h) * geom.crop.outHeight - 1,
              },
              confidence: 0.9,
            }))
          : [],
      count: concept === 'window' ? masks.length : 0,
      boxCoverage: 0.1,
    }));
    const measured = await runObjectShape({ ...spark, segmentImage }, photo, 'data:full', target);
    expect(measured.mode).toBe('recipe');
    // Panels and body match an independent re-measure mixed by confidence, exactly.
    const grid = await sampleObjectRgb(photo, box, 96, 96);
    const re = measureRegionColors(
      grid,
      target.outline ? pathToRings(target.outline).filter((r) => r.length >= 3) : [],
      measured.partMasks!,
      geom,
      photo,
      box
    );
    const glassPanels = measured.recipe!.parts.filter(
      (p) => p.shape === 'box' && p.size[2] <= 0.05 && Math.abs(p.at[2]) > 0.1
    );
    expect(glassPanels.length).toBe(4);
    // Each panel matches its own mask's mix (left third → region 0, right third → region 1).
    const midx = shell.at[0];
    for (const p of glassPanels) {
      const region = p.at[0] < midx ? re.regions[0]! : re.regions[1]!;
      expect(p.color).toBe(mixColor(region.color, shell.color, confidence.colors(region.pixels)));
    }
    expect(glassPanels.some((p) => p.color !== shell.color)).toBe(true);
    const outMain = measured.recipe!.parts.find((p) => p.front)!;
    const expectedBody = mixColor(re.rest!.color, main.color, confidence.colors(re.rest!.pixels));
    expect(outMain.color).toBe(expectedBody);
    expect(ObjectRecipeSchema.safeParse(measured.recipe!).success).toBe(true);
    console.info(
      `[test] car colours: glass ${shell.color} → ${glassPanels[0]!.color}, body ${main.color} → ${expectedBody}, iou ${plain.fit!.iou} → ${measured.fit!.iou}`
    );
    expect(Math.abs(measured.fit!.iou - plain.fit!.iou)).toBeLessThanOrEqual(0.03);
  });
});

describe('measureWallTints (PQ-T44 remedy 4)', () => {
  const RED: [number, number, number] = [200, 40, 40];
  const TAN: [number, number, number] = [200, 180, 140];
  const BLUE: [number, number, number] = [40, 80, 200];
  const geom = geomA();
  const rings = pathToRings(boxPath(geom.box));
  const win = { concept: 'window', box: { x: 0.45, y: 0.5, w: 0.08, h: 0.12 } } as const;

  it('splits wall cells into front and visible-side tints, openings excluded', () => {
    const g = grid(24, 24, (i) => ((i + 0.5) / 24 < 1 / 3 ? RED : TAN));
    const out = measureWallTints(g, rings, [win], geom, photoA, geom.box, 0.5, 0.3)!;
    expect(out.front).toBe(linearToHex(...srgbToLinear(...TAN)));
    expect(out.left).toBe(linearToHex(...srgbToLinear(...RED)));
    expect(out.right).toBeUndefined();
  });

  it('mirrored yaw tints the right face', () => {
    const g = grid(24, 24, (i) => ((i + 0.5) / 24 > 2 / 3 ? BLUE : TAN));
    const out = measureWallTints(g, rings, [win], geom, photoA, geom.box, -0.5, 0.3)!;
    expect(out.right).toBe(linearToHex(...srgbToLinear(...BLUE)));
    expect(out.front).toBe(linearToHex(...srgbToLinear(...TAN)));
    expect(out.left).toBeUndefined();
  });

  it('needs yaw, an eave, an outline and enough cells', () => {
    const g = grid(24, 24, () => TAN);
    expect(measureWallTints(g, rings, [win], geom, photoA, geom.box, 0, 0.3)).toBeNull();
    expect(measureWallTints(g, rings, [win], geom, photoA, geom.box, 0.5, null)).toBeNull();
    expect(measureWallTints(g, [], [win], geom, photoA, geom.box, 0.5, 0.3)).toBeNull();
    const tiny = pathToRings(boxPath({ x: 0.4, y: 0.4, w: 0.05, h: 0.05 }));
    expect(measureWallTints(g, tiny, [win], geom, photoA, geom.box, 0.5, 0.3)).toBeNull();
  });
});
