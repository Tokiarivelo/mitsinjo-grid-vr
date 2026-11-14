import { describe, expect, it } from 'vitest';
import { ObjectRecipeSchema, restyleSurface, type RecipePart } from '@/lib/object-shape';
import { colourBands, pairSpans } from '../recon/carve';
import { absorbEnclosed } from '../recon/grid';
import { runPieces, spanArea } from '../recon/pieces';
import { unitRing, rowsPolygon } from '../recon/recipe';
import {
  classSheet,
  finishRecipe,
  readViews,
  reconstructFromViews,
  roofClassOf,
} from '../recon/reconstruct';
import { parseRoofClass } from '../recon/label-classes';
import { alignTop, depthFromPlan, readObject } from '../recon/views';
import { Canvas, COLORS, carViews, houseViews } from './fixtures/draw-views';

const build = (
  views: Parameters<typeof reconstructFromViews>[0],
  materials: Parameters<typeof reconstructFromViews>[1] = []
) => {
  const recon = reconstructFromViews(views, materials);
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

describe('alignTop', () => {
  // An L-shaped plan, 80 wide and 60 deep, its back right quarter empty.
  const plan = () =>
    new Canvas(120, 100)
      .rect(20, 20, 100, 80, COLORS.wall)
      .rect(60, 20, 100, 50, [255, 255, 255])
      .image();

  it('reads the footprint on the width × depth grid, the back on row 0', () => {
    const top = alignTop(plan(), 40, 30)!;
    expect([top.view.cols, top.view.rows]).toEqual([40, 30]);
    expect(top.view.mask[2 * 40 + 5]).toBe(1);
    expect(top.view.mask[2 * 40 + 35]).toBe(0);
    expect(top.view.mask[27 * 40 + 35]).toBe(1);
    expect(top.frame.mirrored).toBe(false);
  });

  it('answers null when the plan and the elevations disagree on the proportions', () => {
    // Drawn 4:3, the elevations say 1:4.
    expect(alignTop(plan(), 15, 60)).toBeNull();
    expect(alignTop(new Canvas(60, 60).image(), 40, 30)).toBeNull();
  });
});

describe('depthFromPlan', () => {
  it('takes the depth of the model from the plan, largest side 1', () => {
    // Sides drawn as wide as the front; the plan says twice as wide as deep.
    const p = depthFromPlan({ w: 1, h: 0.5, d: 1 }, 2);
    expect(p).toEqual({ w: 1, h: 0.5, d: 0.5 });
    // A deep, narrow object: the depth becomes the unit.
    expect(depthFromPlan({ w: 1, h: 1, d: 0.5 }, 0.5)).toEqual({ w: 0.5, h: 0.5, d: 1 });
    expect(depthFromPlan({ w: 1, h: 0.5, d: 1 }, 0)).toEqual({ w: 1, h: 0.5, d: 1 });
  });
});

describe('parseRoofClass', () => {
  it('reads the roof tile as a class, whatever the model appends to the key', () => {
    expect(parseRoofClass('{"tiles":[],"roof":2}', 3)).toBe(1);
    expect(parseRoofClass('{"tiles":[],"roof teritorial":1}', 3)).toBe(0);
  });

  it('answers null for no roof, a tile out of range or an unreadable answer', () => {
    expect(parseRoofClass('{"tiles":[],"roof":0}', 3)).toBeNull();
    expect(parseRoofClass('{"tiles":[],"roof":4}', 3)).toBeNull();
    expect(parseRoofClass('{"tiles":[],"roof ":null}', 3)).toBeNull();
    expect(parseRoofClass('not json', 3)).toBeNull();
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
    const [pair, ...rest] = pairSpans(front, side);
    expect(rest).toHaveLength(0);
    expect(pair!.voxels).toBe(4 * (10 + 10 + 8));
    expect(pair!.side.start).toBe(2);
    expect(pairSpans(front, { start: 0, lo: [30], hi: [40] })).toEqual([]);
  });

  it('gives one solid per run of side columns: a row of pillars stays pillars', () => {
    const front = { start: 0, lo: Array(10).fill(0), hi: Array(10).fill(3) };
    // Three pillars along the depth, a gap of two columns between them.
    const side = {
      start: 0,
      lo: [0, 0, 20, 20, 0, 0, 20, 20, 0, 0],
      hi: [9, 9, 20, 20, 9, 9, 20, 20, 9, 9],
    };
    expect(pairSpans(front, side).map((p) => p.side.start)).toEqual([0, 4, 8]);
  });
});

describe('colourBands', () => {
  const rows = (...runs: Array<[number, number]>) =>
    runs.flatMap(([cls, n]) =>
      Array.from({ length: n }, () =>
        Uint32Array.from({ length: 3 }, (_, c) => (c === cls ? 9 : 1))
      )
    );

  it('cuts a body where its rows change material and gives a short run to its neighbour', () => {
    expect(colourBands(rows([1, 10], [0, 2], [1, 3], [0, 20]), 5, () => true, 4)).toEqual([
      [5, 19, 1],
      [20, 39, 0],
    ]);
  });

  it('lets a paper class win a row only alone, and a refused class never', () => {
    const votes = rows([2, 6], [0, 6]);
    expect(colourBands(votes, 0, (c) => c !== 2, 3)).toEqual([[0, 11, 0]]);
    expect(
      colourBands(
        votes,
        0,
        () => true,
        3,
        (_row, c) => c !== 2
      )
    ).toEqual([[0, 11, 0]]);
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
  it('rebuilds a house from its four drawings: one closed body, roof, chimney, windows on their faces', () => {
    const { recipe, report } = build(houseViews());
    expect(ObjectRecipeSchema.safeParse(recipe).success).toBe(true);
    expect(report.views).toEqual(['front', 'right', 'back', 'left']);
    expect(report.flipped).toEqual([]);
    expect(report.score.overall).toBeGreaterThan(0.95);
    // 160 wide, 100 deep, 130 tall with the chimney.
    expect(recipe.proportions.d / recipe.proportions.w).toBeCloseTo(100 / 160, 1);
    expect(recipe.proportions.h / recipe.proportions.w).toBeCloseTo(130 / 160, 1);
    const walls = ofColor(recipe.parts, COLORS.wall).filter((p) => p.size[2] > 0.5);
    expect(walls).toHaveLength(1);
    expect(walls[0]).toMatchObject({ shape: 'box', front: true, status: 'measured' });
    // The roof is a rectangle in front and a triangle on the side: a hull whose side ring has an apex.
    const roof = ofColor(recipe.parts, COLORS.roof).find((p) => p.shape === 'hull')!;
    expect(roof.size[0]).toBeGreaterThan(0.95);
    // (The chimney stands in front of the slope on the side view, so the ring also rises there.)
    expect(roof.section!.some((q) => Math.abs(q[0]) < 0.1 && q[1] > 0.45)).toBe(true);
    expect(roof.section!.filter((q) => q[0] > 0.4).every((q) => q[1] < 0)).toBe(true);
    // The roof sits on the walls: no gap, no overlap beyond a cell.
    expect(roof.at[1] - roof.size[1] / 2).toBeCloseTo(walls[0]!.at[1] + walls[0]!.size[1] / 2, 1);
    // Chimney: a body of its own, right of the middle, toward the back.
    const chimney = ofColor(recipe.parts, COLORS.stone).find(
      (p) => p.at[1] > 0.3 && p.size[0] > 0.04 && p.size[2] > 0.04
    )!;
    expect(chimney.at[0]).toBeGreaterThan(0.2);
    expect(chimney.at[2]).toBeLessThan(-0.1);
    // One window slab on the front face, one on the right face, none inside the house.
    const glass = ofColor(recipe.parts, COLORS.glass);
    expect(glass).toHaveLength(2);
    expect(glass.some((p) => p.at[2] > 0.49 && p.size[2] < 0.05)).toBe(true);
    expect(glass.some((p) => p.at[0] > 0.49 && p.size[0] < 0.05)).toBe(true);
  });

  it('pitches the roof when its class is named a roofing material, and only then', () => {
    const named = build(houseViews(), ['wood', 'slate', 'stone', 'glass']);
    const hips = named.recipe.parts.filter((p) => p.shape === 'hip');
    expect(hips).toHaveLength(1);
    expect(hips[0]).toMatchObject({ material: 'slate', status: 'inferred' });
    // Drawn as a rectangle in front: the ridge runs the whole width (kept under the cap).
    expect(hips[0]!.ridge).toBeGreaterThan(0.8);
    expect(ofColor(named.recipe.parts, COLORS.roof)).toHaveLength(1);
    expect(build(houseViews()).recipe.parts.some((p) => p.shape === 'hip')).toBe(false);
    expect(build(houseViews(), ['wood', 'metal']).recipe.parts.some((p) => p.shape === 'hip')).toBe(
      false
    );
  });

  it('rebuilds a car with the same code: one body, a wheel at each corner', () => {
    const { recipe, report } = build(carViews());
    expect(report.score.overall).toBeGreaterThan(0.95);
    expect(recipe.proportions.d).toBe(1);
    // The wheels are bodies (they stand under the car), not marks on its sides.
    const wheels = ofColor(recipe.parts, COLORS.tyre).filter(
      (p) => p.size[0] > 0.05 && p.size[2] > 0.05
    );
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
    const { recipe, report } = build(houseViews(), ['wood', 'slate', 'stone', 'glass']);
    expect(ofColor(recipe.parts, COLORS.roof).every((p) => p.material === 'slate')).toBe(true);
    expect(ofColor(recipe.parts, COLORS.wall).every((p) => p.material === 'wood')).toBe(true);
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

describe('roofClassOf (PQ-T71)', () => {
  it('reads the roof class above the eave of a pitched house, without any model', () => {
    const reading = readViews(houseViews())!;
    const roof = roofClassOf(reading);
    expect(roof).not.toBeNull();
    const [r, g, b] = COLORS.roof;
    const hex = reading.palette.classes[roof!]!.hex;
    const n = parseInt(hex.slice(1), 16);
    expect(
      Math.abs(((n >> 16) & 255) - r) + Math.abs(((n >> 8) & 255) - g) + Math.abs((n & 255) - b)
    ).toBeLessThan(12);
  });

  it('answers null for a block with no eave (a flat roof)', () => {
    const box = () => new Canvas(120, 100).rect(20, 20, 100, 80, COLORS.wall).image();
    expect(roofClassOf(readViews({ front: box(), right: box() })!)).toBeNull();
  });
});

describe('restyleSurface (PQ-T71)', () => {
  const drawn = ObjectRecipeSchema.parse({
    proportions: { w: 1, h: 0.5, d: 0.5 },
    parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }],
    faces: {
      atlas: 'data:image/png;base64,AAAA',
      views: ['front', 'right'],
      hull: { grid: [4, 4, 4], boxes: [[0, 4, 0, 4, 0, 4]] },
    },
  });

  it('sets a look on one surface, keeps the others, and the schema accepts it', () => {
    const roofed = restyleSurface(drawn, 'roof', { material: 'tile', color: '#aa4422' });
    const both = restyleSurface(roofed, 'front', { color: '#ddeeff' });
    expect(both.faces?.surfaces).toEqual({
      roof: { material: 'tile', color: '#aa4422' },
      front: { color: '#ddeeff' },
    });
    expect(ObjectRecipeSchema.safeParse(both).success).toBe(true);
    expect(drawn.faces?.surfaces).toBeUndefined();
  });

  it('gives a surface back to its drawing, and leaves a model without drawings alone', () => {
    const roofed = restyleSurface(drawn, 'roof', { material: 'tile' });
    expect(restyleSurface(roofed, 'roof', null).faces?.surfaces).toBeUndefined();
    const { faces: _faces, ...flat } = drawn;
    void _faces;
    expect(restyleSurface(flat, 'roof', { material: 'tile' })).toBe(flat);
  });
});
