// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { kitToRecipe, TAIL_LIGHT_COLOR, type ObjectKit } from '@/lib/object-kit';
import {
  MAX_RECIPE_PARTS,
  ObjectRecipeSchema,
  type ObjectRecipe,
  type PartMask,
  type ShapeTarget,
} from '@/lib/object-shape';
import { polygonPath } from '@/lib/vision';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';
import { deltaE2000, hexToLab } from '../color-measure';
import { checkConstraints } from '../object-graph';
import type { MaskMapGeom } from '../mask-geometry';
import { runObjectShape } from '../object-shape';
import { scoreRecipe } from '../score-shape';
import { cropRectForShape } from '../shape-crop';
import { convexHull, minAreaRect, withMaskPanels } from '../mask-panels';

const vehicleKit = (): ObjectKit => ({
  archetype: 'vehicle',
  proportions: { w: 1, h: 0.4, d: 0.45 },
  colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
  materials: { main: 'metal', secondary: 'glass', accent: 'rubber' },
});

const houseKit = (): ObjectKit => ({
  archetype: 'house',
  proportions: { w: 1, h: 0.6, d: 0.5 },
  colors: { main: '#aaaaaa', secondary: '#bb2222', accent: '#2222bb' },
  materials: { main: 'plaster', secondary: 'tile', accent: 'glass' },
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

/** Full shape pipeline on a real photo: seconds of CPU, slower when the suite runs in parallel. */
const GOLDEN_E2E_TIMEOUT_MS = 30_000;

describe('convexHull / minAreaRect', () => {
  it('hull drops interior points', () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
      [2, 1],
    ]);
    expect(hull).toHaveLength(4);
    expect([...hull].sort()).toEqual([
      [0, 0],
      [0, 2],
      [4, 0],
      [4, 2],
    ]);
  });

  it('axis rectangle → exact sides, angle 0', () => {
    const r = minAreaRect([
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ])!;
    expect(r.cx).toBeCloseTo(2, 9);
    expect(r.cy).toBeCloseTo(1, 9);
    expect(r.w).toBeCloseTo(4, 9);
    expect(r.h).toBeCloseTo(2, 9);
    expect(r.angle).toBeCloseTo(0, 9);
  });

  it('square turned 30° → sides 2, angle ±30', () => {
    const a = (30 * Math.PI) / 180;
    const rot = (x: number, y: number): [number, number] => [
      x * Math.cos(a) - y * Math.sin(a),
      x * Math.sin(a) + y * Math.cos(a),
    ];
    const r = minAreaRect([rot(-1, -1), rot(1, -1), rot(1, 1), rot(-1, 1)])!;
    expect(r.cx).toBeCloseTo(0, 9);
    expect(r.cy).toBeCloseTo(0, 9);
    expect(r.w).toBeCloseTo(2, 9);
    expect(r.h).toBeCloseTo(2, 9);
    expect(Math.abs(r.angle)).toBeCloseTo(30, 6);
  });

  it('right triangle → the legs (ties keep the first edge)', () => {
    const r = minAreaRect([
      [0, 0],
      [4, 0],
      [0, 3],
    ])!;
    expect(r.w).toBeCloseTo(4, 9);
    expect(r.h).toBeCloseTo(3, 9);
    expect(r.angle).toBeCloseTo(0, 9);
  });

  it('fewer than 3 hull points → null', () => {
    expect(minAreaRect([])).toBeNull();
    expect(
      minAreaRect([
        [0, 0],
        [1, 1],
      ])
    ).toBeNull();
    expect(
      minAreaRect([
        [0, 0],
        [1, 1],
        [2, 2],
      ])
    ).toBeNull();
  });
});

describe('withMaskPanels (PR-2.7)', () => {
  it('vehicle: shell takes the body colour, measured glass both sides, decals fund the room', () => {
    const geom = geomA();
    const recipe = kitToRecipe(vehicleKit());
    expect(recipe.parts).toHaveLength(12);
    const out = withMaskPanels(
      'vehicle',
      recipe,
      [rectMask(geom, 'window', 60, 16, 100, 32), rectMask(geom, 'window', 100, 16, 132, 32)],
      geom
    );
    expect(out).not.toBe(recipe);
    // Shell (glasshouse) recolored to the body colour behind the glass.
    const shell = out.parts.find((p) => p.shape === 'box' && p.at[1] === 0.32)!;
    expect(shell.color).toBe('#a33327');
    expect(shell.material).toBe('metal');
    // Window 1: photo x 60..100 → obj −0.25..0; y 16..32 → obj 0.225..0.425.
    const panels = out.parts.filter((p) => p.shape === 'box' && p.size[2] === 0.02);
    expect(panels).toHaveLength(4);
    expect(panels.every((p) => p.color === '#cfd6dd' && p.material === 'glass')).toBe(true);
    const near = panels.filter((p) => p.at[2] > 0);
    const far = panels.filter((p) => p.at[2] < 0);
    expect(near).toHaveLength(2);
    expect(far).toHaveLength(2);
    expect(near[0]!.at[2]).toBeCloseTo(0.415, 9);
    const left = near.find((p) => p.at[0] < 0)!;
    expect(left.at[0]).toBeCloseTo(-0.125, 3);
    expect(left.at[1]).toBeCloseTo(0.325, 3);
    expect(left.size[0]).toBeCloseTo(0.25, 3);
    expect(left.size[1]).toBeCloseTo(0.2, 3);
    // 12 − 4 light dots (heads, tails) + 4 panels = 12; prisms survive.
    expect(out.parts).toHaveLength(12);
    expect(out.parts.some((p) => p.shape === 'prism')).toBe(true);
    expect(out.parts.some((p) => p.size[0] === 0.02 && p.size[1] === 0.08)).toBe(false);
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('house: spread facade replaced by a segmented wall with inset leaves (PR-2.17)', () => {
    const geom = geomA();
    const recipe = kitToRecipe(houseKit());
    expect(recipe.parts).toHaveLength(8);
    const out = withMaskPanels(
      'house',
      recipe,
      [
        rectMask(geom, 'window', 40, 50, 70, 66),
        rectMask(geom, 'door', 100, 58, 120, 82),
        rectMask(geom, 'chimney', 140, 10, 150, 30),
      ],
      geom
    );
    expect(out).not.toBe(recipe);
    // 3 slabs + 7 strips + 2 leaves; the chimney mask is not consumed.
    expect(out.parts).toHaveLength(12);
    const strips = out.parts.filter((p) => p.color === '#aaaaaa');
    expect(strips).toHaveLength(7);
    // Full-depth wall strips in the wall paint; the largest keeps `front`.
    expect(strips.every((p) => p.shape === 'box' && p.size[2] === 1)).toBe(true);
    expect(strips.filter((p) => p.front)).toHaveLength(1);
    // Leaves at the measured x/y, centred in the wall depth (recessed both faces).
    const win = out.parts.find((p) => p.color === '#2222bb')!;
    expect(win.at[0]).toBeCloseTo(-0.28125, 3);
    expect(win.at[1]).toBeCloseTo(-0.1, 3);
    expect(win.size[0]).toBeCloseTo(0.1875, 3);
    expect(win.size[1]).toBeCloseTo(0.2, 3);
    expect(win.at[2]).toBe(0);
    const door = out.parts.find((p) => p.color === '#bb2222' && p.size[2] === 0.02)!;
    expect(door.at[0]).toBeCloseTo(0.0625, 3);
    expect(door.at[1]).toBeCloseTo(-0.25, 3);
    expect(door.size[0]).toBeCloseTo(0.125, 3);
    expect(door.size[1]).toBeCloseTo(0.3, 3);
    expect(door.at[2]).toBe(0);
    // No overlay decals left on either face: nothing thin at |z| ≈ 0.5.
    const thin = out.parts.filter((p) => p.shape === 'box' && p.size[2] === 0.02);
    expect(thin).toHaveLength(2);
    expect(thin.every((p) => Math.abs(p.at[2]!) < 0.01)).toBe(true);
    // Roof slabs kept.
    expect(out.parts.filter((p) => p.color === '#bb2222' && p.size[2] !== 0.02)).toHaveLength(3);
    expect(ObjectRecipeSchema.safeParse(out).success).toBe(true);
  });

  it('yawed house segments at any yaw; unfundable holes fall back to overlays (PR-2.17)', () => {
    const geom = geomA();
    const masks = [
      rectMask(geom, 'window', 40, 50, 70, 66),
      rectMask(geom, 'door', 100, 58, 120, 82),
    ];
    const leaves = (r: ObjectRecipe) =>
      r.parts.filter((p) => p.shape === 'box' && p.size[2] === 0.02);
    // Through-holes are view-independent: centred leaves at 0.2 and at 0.5 rad alike.
    for (const yaw of [0.2, 0.5]) {
      const input = { ...kitToRecipe(houseKit()), yaw };
      const turned = withMaskPanels('house', input, masks, geom);
      expect(turned).not.toBe(input);
      expect(leaves(turned)).toHaveLength(2);
      expect(leaves(turned).every((p) => Math.abs(p.at[2]!) < 0.01)).toBe(true);
      expect(ObjectRecipeSchema.safeParse(turned).success).toBe(true);
    }
    // 3 windows + 2 doors need 21 parts: overlays, near side, budget held.
    const many = withMaskPanels(
      'house',
      kitToRecipe(houseKit()),
      [
        rectMask(geom, 'window', 30, 46, 50, 62),
        rectMask(geom, 'window', 60, 46, 80, 62),
        rectMask(geom, 'window', 90, 46, 110, 62),
        rectMask(geom, 'door', 120, 56, 136, 84),
        rectMask(geom, 'door', 142, 56, 158, 84),
      ],
      geom
    );
    expect(many.parts.length).toBeLessThanOrEqual(MAX_RECIPE_PARTS);
    const over = leaves(many);
    expect(over.length).toBeGreaterThan(0);
    expect(over.every((p) => p.at[2]! > 0.4)).toBe(true);
    expect(ObjectRecipeSchema.safeParse(many).success).toBe(true);
  });

  it('three masks on a full sedan → near side only, nothing structural dropped', () => {
    const geom = geomA();
    const out = withMaskPanels(
      'vehicle',
      kitToRecipe(vehicleKit()),
      [
        rectMask(geom, 'window', 60, 16, 84, 32),
        rectMask(geom, 'window', 88, 16, 112, 32),
        rectMask(geom, 'window', 116, 16, 140, 32),
      ],
      geom
    );
    const panels = out.parts.filter((p) => p.shape === 'box' && p.size[2] === 0.02);
    expect(panels).toHaveLength(3);
    expect(panels.every((p) => p.at[2] > 0)).toBe(true);
    expect(out.parts).toHaveLength(12);
    // 3 near panels funded by 3 of the 4 light dots: prisms, wheels and one taillight survive.
    expect(out.parts.some((p) => p.shape === 'prism')).toBe(true);
    expect(out.parts.filter((p) => p.shape === 'cylinder' && p.axis === 'z')).toHaveLength(4);
    expect(out.parts.filter((p) => p.color === TAIL_LIGHT_COLOR)).toHaveLength(1);
    expect(out.parts.some((p) => p.shape === 'cylinder' && p.axis === 'x' && p.at[0]! > 0)).toBe(
      false
    );
  });

  it('rotated, floating and tiny masks are skipped, panels clamp into the span', () => {
    const geom = geomA();
    const recipe = kitToRecipe(vehicleKit());
    // Diamond (45°): not a facade rectangle.
    const diamond: PartMask = {
      concept: 'window',
      box: { x: 0.2, y: 0.2, w: 0.2, h: 0.4 },
      outline: polygonPath([
        [0.3, 0.2],
        [0.4, 0.4],
        [0.3, 0.6],
        [0.2, 0.4],
      ]),
    };
    expect(withMaskPanels('vehicle', recipe, [diamond], geom)).toBe(recipe);
    // Above the shell: floats in the air.
    expect(withMaskPanels('vehicle', recipe, [rectMask(geom, 'window', 60, 0, 100, 4)], geom)).toBe(
      recipe
    );
    // Tiny: trim, not a panel.
    expect(
      withMaskPanels('vehicle', recipe, [rectMask(geom, 'window', 60, 16, 64, 20)], geom)
    ).toBe(recipe);
    // Wider than the shell: clamped into the span (shell x1 = 0.23).
    const out = withMaskPanels(
      'vehicle',
      recipe,
      [rectMask(geom, 'window', 100, 16, 160, 32)],
      geom
    );
    const panel = out.parts.find((p) => p.shape === 'box' && p.size[2] === 0.02)!;
    expect(panel.at[0]).toBeCloseTo(0.0425, 3);
    expect(panel.size[0]).toBeCloseTo(0.375, 3);
  });

  it('returns the recipe untouched when disqualified', () => {
    const geom = geomA();
    const recipe = kitToRecipe(vehicleKit());
    const masks = [rectMask(geom, 'window', 60, 16, 100, 32)];
    expect(withMaskPanels('cabinet', recipe, masks, geom)).toBe(recipe);
    expect(withMaskPanels('vehicle', recipe, [], geom)).toBe(recipe);
    // Past the hard gate (60°) the template is kept; at 0.5 the near side still places.
    const turned = { ...recipe, yaw: 1.2 };
    expect(withMaskPanels('vehicle', turned, masks, geom)).toBe(turned);
    // Wheel masks are not panels; a house without facade panels teaches no colours.
    expect(
      withMaskPanels('vehicle', recipe, [{ concept: 'wheel', box: masks[0]!.box }], geom)
    ).toBe(recipe);
    const walls: ObjectRecipe = { ...kitToRecipe(houseKit()), parts: [] };
    walls.parts = kitToRecipe(houseKit()).parts.slice(0, 1);
    expect(withMaskPanels('house', walls, [rectMask(geom, 'window', 40, 50, 70, 66)], geom)).toBe(
      walls
    );
  });

  it(
    'golden car: masks on the shell keep the score (machinery end to end)',
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
      // No locator masks: every part stamped, wheels inferred (outline evidence), never measured.
      expect(plain.recipe!.parts.every((p) => p.status !== undefined)).toBe(true);
      const plainWheels = plain.recipe!.parts.filter((p) => p.shape === 'cylinder');
      expect(plainWheels.length).toBeGreaterThan(0);
      expect(plainWheels.every((p) => p.status === 'inferred')).toBe(true);
      // Two window masks splitting the shell side (self-consistent: thirds of its span).
      const box = target.box;
      const geom: MaskMapGeom = {
        photoW: photo.width,
        photoH: photo.height,
        box,
        crop: cropRectForShape(photo.width, photo.height, box),
      };
      const main = plain.recipe!.parts.find((p) => p.front)!;
      const shell = plain
        .recipe!.parts.filter((p) => p.shape === 'box' && p !== main && p.at[1] > main.at[1])
        .sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0]!;
      const sx0 = shell.at[0] - shell.size[0] / 2;
      const sx1 = shell.at[0] + shell.size[0] / 2;
      const sy0 = shell.at[1] - shell.size[1] / 2;
      const sy1 = shell.at[1] + shell.size[1] / 2;
      const objMask = (ox0: number, oy0: number, ox1: number, oy1: number): PartMask => {
        const px = (ox: number) => (box.x + (ox + 0.5) * box.w) * photo.width;
        const py = (oy: number) => (box.y + (0.5 - oy) * box.h) * photo.height;
        const { crop } = geom;
        const cu = (x: number) => (x - crop.left) / crop.width;
        const cv = (y: number) => (y - crop.top) / crop.height;
        const x0 = px(ox0);
        const y0 = py(oy1);
        const x1 = px(ox1);
        const y1 = py(oy0);
        return {
          concept: 'window',
          box: { x: cu(x0), y: cv(y0), w: cu(x1) - cu(x0), h: cv(y1) - cv(y0) },
          outline: polygonPath([
            [cu(x0), cv(y0)],
            [cu(x1), cv(y0)],
            [cu(x1), cv(y1)],
            [cu(x0), cv(y1)],
          ]),
        };
      };
      const span = sx1 - sx0;
      const masks = [
        objMask(
          sx0 + 0.05 * span,
          sy0 + 0.2 * (sy1 - sy0),
          sx0 + 0.45 * span,
          sy0 + 0.8 * (sy1 - sy0)
        ),
        objMask(
          sx0 + 0.55 * span,
          sy0 + 0.2 * (sy1 - sy0),
          sx0 + 0.95 * span,
          sy0 + 0.8 * (sy1 - sy0)
        ),
      ];
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
                outline: m.outline,
              }))
            : [],
        count: concept === 'window' ? masks.length : 0,
        boxCoverage: 0.1,
      }));
      const measured = await runObjectShape({ ...spark, segmentImage }, photo, 'data:full', target);
      expect(measured.mode).toBe('recipe');
      expect(measured.partMasks!.filter((m) => m.concept === 'window')).toHaveLength(2);
      expect(measured.recipe!.parts.length).toBeLessThanOrEqual(MAX_RECIPE_PARTS);
      // Shell recolored to the body, four glass panels (both sides) at the old glass colour.
      // Biggest box above the main body, like the plain locator: Fit v2 (PR-2.9) may shift the
      // cabin in y, so the shell is not matched by its height anymore.
      const outMain = measured.recipe!.parts.find((p) => p.front)!;
      const outShell = measured
        .recipe!.parts.filter((p) => p.shape === 'box' && p !== outMain && p.at[1] > outMain.at[1])
        .sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0]!;
      expect(outShell.color).toBe(main.color);
      // Glass colour within ΔE 3 of the shell's (region medians move a bit when Fit v2 shifts the shell).
      const glassLab = hexToLab(shell.color);
      const glassPanels = measured.recipe!.parts.filter(
        (p) => p.shape === 'box' && p.size[2] < 0.05 && deltaE2000(hexToLab(p.color), glassLab) < 3
      );
      expect(glassPanels).toHaveLength(4);
      expect(ObjectRecipeSchema.safeParse(measured.recipe!).success).toBe(true);
      console.info(
        `[test] car panels: iou ${plain.fit!.iou} → ${measured.fit!.iou}, parts ${plain.recipe!.parts.length} → ${measured.recipe!.parts.length}`
      );
      expect(Math.abs(measured.fit!.iou - plain.fit!.iou)).toBeLessThanOrEqual(0.03);
      // Landmarks (PR-0.8): the glass sits on its masks, so the 4-term score must not drop.
      const withLm = (await scoreRecipe(photo, target, measured.recipe!, measured.partMasks))!;
      const withoutLm = (await scoreRecipe(photo, target, measured.recipe!))!;
      expect(withLm.score.landmark).toBeDefined();
      expect(withLm.score.landmark!).toBeGreaterThan(0.5);
      console.info(
        `[test] car landmarks: ${withLm.score.landmark}, score ${withoutLm.score.score} → ${withLm.score.score}`
      );
      expect(withLm.score.score).toBeGreaterThanOrEqual(withoutLm.score.score - 2);
      // Statuses (PR-2.15): every part stamped, measured glass, template dims estimated.
      expect(measured.recipe!.parts.every((p) => p.status !== undefined)).toBe(true);
      const glass = measured.recipe!.parts.filter(
        (p) => p.shape === 'box' && p.size[2] === 0.02 && p.at[2]! > 0
      );
      expect(glass.length).toBeGreaterThan(0);
      expect(glass.every((p) => p.status === 'measured')).toBe(true);
      expect(measured.recipe!.dimStatus).toMatchObject({ depth: 'estimated', scale: 'estimated' });
    },
    GOLDEN_E2E_TIMEOUT_MS
  );

  it('golden cottage: a window mask segments the wall, the leaf sits inset (PR-2.17)', async () => {
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
    // One window mask over the wall band (self-consistent: inside the fitted wall span).
    const box = target.box;
    const geom: MaskMapGeom = {
      photoW: photo.width,
      photoH: photo.height,
      box,
      crop: cropRectForShape(photo.width, photo.height, box),
    };
    const wall = plain.recipe!.parts.find((p) => p.front)!;
    const wx0 = wall.at[0] - wall.size[0] / 2;
    const wx1 = wall.at[0] + wall.size[0] / 2;
    const wy0 = wall.at[1] - wall.size[1] / 2;
    const wy1 = wall.at[1] + wall.size[1] / 2;
    const spanX = wx1 - wx0;
    const spanY = wy1 - wy0;
    const hx0 = wx0 + 0.3 * spanX;
    const hx1 = wx0 + 0.5 * spanX;
    const hy0 = wy0 + 0.45 * spanY;
    const hy1 = wy0 + 0.75 * spanY;
    const px = (ox: number) => (box.x + (ox + 0.5) * box.w) * photo.width;
    const py = (oy: number) => (box.y + (0.5 - oy) * box.h) * photo.height;
    const { crop } = geom;
    const cu = (x: number) => (x - crop.left) / crop.width;
    const cv = (y: number) => (y - crop.top) / crop.height;
    const x0 = px(hx0);
    const y0 = py(hy1);
    const x1 = px(hx1);
    const y1 = py(hy0);
    const outline = polygonPath([
      [cu(x0), cv(y0)],
      [cu(x1), cv(y0)],
      [cu(x1), cv(y1)],
      [cu(x0), cv(y1)],
    ]);
    const segmentImage = vi.fn(async (_url: string, concept: string) => ({
      source: 'meta' as const,
      model: 'sam-3.1',
      concept,
      imageWidth: geom.crop.outWidth,
      imageHeight: geom.crop.outHeight,
      instances:
        concept === 'window'
          ? [
              {
                box: {
                  x1: cu(x0) * geom.crop.outWidth,
                  y1: cv(y0) * geom.crop.outHeight,
                  x2: cu(x1) * geom.crop.outWidth - 1,
                  y2: cv(y1) * geom.crop.outHeight - 1,
                },
                confidence: 0.9,
                outline,
              },
            ]
          : [],
      count: concept === 'window' ? 1 : 0,
      boxCoverage: 0.1,
    }));
    const measured = await runObjectShape({ ...spark, segmentImage }, photo, 'data:full', target);
    expect(measured.mode).toBe('recipe');
    expect(measured.partMasks!.filter((m) => m.concept === 'window')).toHaveLength(1);
    expect(measured.recipe!.parts.length).toBeLessThanOrEqual(MAX_RECIPE_PARTS);
    // The wall is gone, replaced by full-depth strips in the wall paint (ΔE: a later
    // pass may re-tint the front strip a digit, like Fit v2 does the shell).
    const wallLab = hexToLab(wall.color);
    const walls = measured.recipe!.parts.filter(
      (p) => p.shape === 'box' && p.size[2] > 0.5 && deltaE2000(hexToLab(p.color), wallLab) < 3
    );
    expect(walls.length).toBeGreaterThanOrEqual(4);
    expect(walls.some((p) => p.front)).toBe(true);
    // One leaf at the mask rect, centred in the wall depth (no overlay z-fight).
    const leaves = measured.recipe!.parts.filter(
      (p) => p.shape === 'box' && p.size[2] === 0.02 && Math.abs(p.at[2]! - wall.at[2]) < 0.05
    );
    expect(leaves).toHaveLength(1);
    const leaf = leaves[0]!;
    expect(leaf.at[0]).toBeCloseTo((hx0 + hx1) / 2, 1);
    expect(leaf.at[1]).toBeCloseTo((hy0 + hy1) / 2, 1);
    const overlays = measured.recipe!.parts.filter(
      (p) =>
        p.shape === 'box' &&
        p.size[2] <= 0.05 &&
        Math.abs(Math.abs(p.at[2]! - wall.at[2]) - wall.size[2] / 2) < 0.05
    );
    expect(overlays).toHaveLength(0);
    expect(ObjectRecipeSchema.safeParse(measured.recipe!).success).toBe(true);
    expect(checkConstraints('house', measured.recipe!)).toBe(0);
    // The leaf hangs under the wall node and reads measured (mask-matched).
    expect(leaf.status).toBe('measured');
    console.info(
      `[test] cottage openings: iou ${plain.fit!.iou} → ${measured.fit!.iou}, parts ${plain.recipe!.parts.length} → ${measured.recipe!.parts.length}`
    );
    expect(Math.abs(measured.fit!.iou - plain.fit!.iou)).toBeLessThanOrEqual(0.03);
    const scored = (await scoreRecipe(photo, target, measured.recipe!, measured.partMasks))!;
    const plainScored = (await scoreRecipe(photo, target, plain.recipe!))!;
    console.info(
      `[test] cottage openings score: ${plainScored.score.score} → ${scored.score.score}`
    );
    expect(scored.score.score).toBeGreaterThanOrEqual(plainScored.score.score - 2);
  });
});
