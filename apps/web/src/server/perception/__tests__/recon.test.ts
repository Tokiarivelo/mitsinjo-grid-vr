import { describe, expect, it } from 'vitest';
import { ObjectRecipeSchema, type RecipePart } from '@/lib/object-shape';
import { pairSpans } from '../recon/carve';
import { absorbEnclosed } from '../recon/grid';
import { runPieces, spanArea } from '../recon/pieces';
import { unitRing, rowsPolygon } from '../recon/recipe';
import { classSheet, finishRecipe, reconstructFromViews } from '../recon/reconstruct';
import { readObject } from '../recon/views';
import { Canvas, COLORS, carViews, houseViews } from './fixtures/draw-views';

const build = (views: Parameters<typeof reconstructFromViews>[0]) => {
  const recon = reconstructFromViews(views);
  if (!recon) throw new Error('no reconstruction');
  return { recon, ...finishRecipe(recon) };
};
/** Parts whose colour is within a few levels of `rgb` (class colours are means of the drawn pixels). */
const ofColor = (parts: RecipePart[], [r, g, b]: readonly [number, number, number]) =>
  parts.filter((p) => {
    const n = parseInt(p.color.slice(1), 16);
    return (
      Math.abs(((n >> 16) & 255) - r) + Math.abs(((n >> 8) & 255) - g) + Math.abs((n & 255) - b) <
      12
    );
  });

describe('readObject', () => {
  it('keeps pale areas enclosed by the drawing and drops the ground line', () => {
    const img = new Canvas(120, 100)
      .rect(30, 20, 90, 80, COLORS.wall)
      .rect(45, 35, 75, 60, [250, 250, 250]) // near-paper window, enclosed
      .rect(0, 80, 120, 81, [40, 40, 40]) // ground line across the sheet
      .image();
    const obj = readObject(img)!;
    // The line survives only under the object itself (one row): never beside it.
    expect(obj.box).toMatchObject({ x0: 30, x1: 89, y0: 20 });
    expect(obj.box.y1).toBeLessThanOrEqual(80);
    expect(obj.mask[50 * 120 + 60]).toBe(1);
    expect(obj.mask[80 * 120 + 5]).toBe(0);
  });

  it('answers null on a blank sheet', () => {
    expect(readObject(new Canvas(60, 60).image())).toBeNull();
  });
});

describe('runPieces', () => {
  it('cuts a comb into its base and each tooth', () => {
    // Base on rows 8–9, three teeth above it.
    const inside = (x: number, y: number) =>
      (y >= 8 && y <= 9 && x >= 0 && x < 20) ||
      (y >= 2 && y < 8 && [1, 2, 9, 10, 17, 18].includes(x));
    const pieces = runPieces(20, 10, inside, 'rows');
    expect(pieces).toHaveLength(4);
    expect(spanArea(pieces[0]!)).toBe(40);
    expect(pieces.slice(1).map((p) => p.lo[0])).toEqual([1, 9, 17]);
  });
});

describe('absorbEnclosed', () => {
  it('gives a region enclosed by one class to that class, not one on the outline', () => {
    const cols = 12;
    const rows = 8;
    const labels = new Int16Array(cols * rows).fill(0);
    for (let y = 3; y < 5; y++) for (let x = 4; x < 7; x++) labels[y * cols + x] = 1; // window
    for (let y = 0; y < 2; y++) for (let x = 0; x < cols; x++) labels[y * cols + x] = 2; // roof band
    const out = absorbEnclosed(labels, cols, rows, 3);
    expect(out[3 * cols + 5]).toBe(0);
    expect(out[0]).toBe(2);
    expect(labels[3 * cols + 5]).toBe(1);
  });
});

describe('pairSpans', () => {
  it('builds the solid two pieces share and refuses pieces on different rows', () => {
    const front = { start: 10, lo: Array(10).fill(4), hi: Array(10).fill(7) };
    const side = { start: 2, lo: [10, 10, 12], hi: [19, 19, 19] };
    const pair = pairSpans(front, side)!;
    expect(pair.voxels).toBe(4 * (10 + 10 + 8));
    expect(pair.side.start).toBe(2);
    expect(pairSpans(front, { start: 0, lo: [30], hi: [40] })).toBeNull();
  });
});

describe('unitRing', () => {
  it('turns a staircase into the slope it samples, inside the unit square', () => {
    const stairs = {
      start: 0,
      lo: Array.from({ length: 20 }, (_, i) => 19 - i),
      hi: Array(20).fill(19),
    };
    const ring = unitRing(rowsPolygon(stairs), 0, 20, 0, 20);
    expect(ring.length).toBeLessThanOrEqual(5);
    for (const [x, y] of ring) {
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('reconstructFromViews', () => {
  it('rebuilds a house from its four drawings: walls, pitched roof, chimney, windows on their faces', () => {
    const { recipe, report } = build(houseViews());
    expect(ObjectRecipeSchema.safeParse(recipe).success).toBe(true);
    expect(report.views).toEqual(['front', 'right', 'back', 'left']);
    expect(report.flipped).toEqual([]);
    expect(report.score.overall).toBeGreaterThan(0.95);
    // 160 wide, 100 deep, 130 tall with the chimney.
    expect(recipe.proportions.d / recipe.proportions.w).toBeCloseTo(100 / 160, 1);
    expect(recipe.proportions.h / recipe.proportions.w).toBeCloseTo(130 / 160, 1);
    const walls = ofColor(recipe.parts, COLORS.wall);
    expect(walls).toHaveLength(1);
    expect(walls[0]).toMatchObject({ shape: 'box', front: true, status: 'measured' });
    // The roof is a rectangle in front and a triangle on the side: a hull whose side ring has an apex.
    const roof = ofColor(recipe.parts, COLORS.roof).find((p) => p.shape === 'hull')!;
    expect(roof.size[0]).toBeGreaterThan(0.95);
    const apex = roof.section!.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(Math.abs(apex[0])).toBeLessThan(0.1);
    expect(apex[1]).toBeGreaterThan(0.45);
    for (const p of roof.section!.filter((q) => Math.abs(q[0]) > 0.4))
      expect(p[1]).toBeLessThan(-0.2);
    // Chimney: right of the middle, toward the back.
    const chimney = ofColor(recipe.parts, COLORS.stone).find((p) => p.at[1] > 0.3)!;
    expect(chimney.at[0]).toBeGreaterThan(0.2);
    expect(chimney.at[2]).toBeLessThan(-0.1);
    // One window slab on the front face, one on the right face, none inside the house.
    const glass = ofColor(recipe.parts, COLORS.glass);
    expect(glass).toHaveLength(2);
    expect(glass.some((p) => p.at[2] > 0.49 && p.size[2] < 0.05)).toBe(true);
    expect(glass.some((p) => p.at[0] > 0.49 && p.size[0] < 0.05)).toBe(true);
  });

  it('rebuilds a car with the same code: one body, a wheel at each corner', () => {
    const { recipe, report } = build(carViews());
    expect(report.score.overall).toBeGreaterThan(0.95);
    expect(recipe.proportions.d).toBe(1);
    const wheels = ofColor(recipe.parts, COLORS.tyre).filter((p) => p.status === 'measured');
    expect(wheels).toHaveLength(4);
    expect(new Set(wheels.map((p) => `${Math.sign(p.at[0])}${Math.sign(p.at[2])}`)).size).toBe(4);
    expect(ofColor(recipe.parts, COLORS.body).filter((p) => p.front)).toHaveLength(1);
  });

  it('works from the front and one side, and takes the left drawing when it is the only side', () => {
    const { front, right, left } = houseViews();
    const two = build({ front, right });
    expect(two.report.views).toEqual(['front', 'right']);
    expect(two.report.score.overall).toBeGreaterThan(0.95);
    const fromLeft = build({ front, left });
    expect(fromLeft.report.rightFromLeft).toBe(true);
    expect(fromLeft.recipe.proportions.d).toBeCloseTo(two.recipe.proportions.d, 1);
  });

  it('flips back a left view drawn mirrored', () => {
    const { front, right } = houseViews();
    // The left side drawn like the right one (chimney on the wrong end).
    const { report } = build({ front, right, left: right });
    expect(report.flipped).toEqual(['left']);
    expect(report.agreement.rightLeft).toBeGreaterThan(0.95);
  });

  it('answers null without a readable front or without any side', () => {
    const { front, right } = houseViews();
    expect(reconstructFromViews({ front })).toBeNull();
    expect(reconstructFromViews({ right })).toBeNull();
    expect(reconstructFromViews({ front: new Canvas(50, 50).image(), right })).toBeNull();
  });

  it('carries the labelled materials per colour class', () => {
    const recon = reconstructFromViews(houseViews())!;
    const { recipe, report } = finishRecipe(recon, ['wood', 'slate', 'stone', 'glass']);
    expect(ofColor(recipe.parts, COLORS.roof).every((p) => p.material === 'slate')).toBe(true);
    expect(report.classes[3]).toMatchObject({ material: 'glass' });
  });

  it('stays in the time budget', () => {
    const views = houseViews();
    const t0 = performance.now();
    reconstructFromViews(views);
    // Strict on a quiet machine (`make test-shape`); loose under the full suite's load.
    expect(performance.now() - t0).toBeLessThan(process.env.SHAPE_BUDGET_STRICT ? 300 : 900);
  });
});

describe('classSheet', () => {
  it('draws the front tile then one tile per class', () => {
    const recon = reconstructFromViews(houseViews())!;
    const sheet = classSheet(recon);
    const tiles = recon.palette.classes.length + 1;
    expect(sheet.cols).toBe(tiles * recon.aligned.W * 3 + (tiles + 1) * 8);
    expect(sheet.rgb).toHaveLength(sheet.cols * sheet.rows * 3);
    // Tile 1 (largest class = walls): a wall cell is red.
    const x = 8 + recon.aligned.W * 3 + 8 + Math.floor((recon.aligned.W * 3) / 2);
    const y = 8 + Math.floor(recon.aligned.H * 3 * 0.9 * 0.7);
    expect([...sheet.rgb.slice((y * sheet.cols + x) * 3, (y * sheet.cols + x) * 3 + 3)]).toEqual([
      220, 20, 30,
    ]);
  });
});
