import { FRONDS } from '../tree/tree-fronds';
import { describe, expect, it } from 'vitest';
import { barkColour, fitTree, hsv, isLeaf, TRUNK_WIDTH_RANGE } from '../tree/tree-fit';
import { alignedTree, ROWS } from './tree-fixture';

describe('isLeaf', () => {
  it('takes greens and teals, not bark, sky or grey', () => {
    expect(isLeaf(70, 140, 60)).toBe(true); // green
    expect(isLeaf(120, 155, 129)).toBe(true); // palm teal
    expect(isLeaf(110, 80, 60)).toBe(false); // bark brown
    expect(isLeaf(196, 218, 232)).toBe(false); // the blue sheet
    expect(isLeaf(113, 145, 148)).toBe(true); // teal frond
    expect(isLeaf(120, 125, 122)).toBe(false); // grey
  });
  it('reads hue, saturation and value', () => {
    const [h, s, v] = hsv(0, 255, 0);
    expect([Math.round(h), s, v]).toEqual([120, 1, 1]);
  });
});

describe('fitTree', () => {
  it('finds the crown and a trunk that meets the ground', () => {
    const plan = fitTree(alignedTree({ crown: { top: 4, base: 70, half: 0.42 }, trunk: 4 }))!;
    expect(plan.bush).toBe(false);
    expect(plan.crownTop).toBeLessThanOrEqual(6);
    expect(plan.crownBase).toBeGreaterThanOrEqual(66);
    expect(plan.crownBase).toBeLessThanOrEqual(72);
    expect(plan.foot).toBeGreaterThanOrEqual(ROWS - 3);
    expect(plan.trunk.length).toBeGreaterThan(2);
    // The trunk is 8 cells wide: every lobe stays close to it.
    for (const l of plan.trunk) expect(l.r[0] * 2).toBeGreaterThan(6);
    for (const l of plan.trunk) expect(l.r[0] * 2).toBeLessThan(10);
    expect(plan.crown.length).toBeGreaterThan(5);
  });

  it('reads leaf and bark colours on the pixels', () => {
    const plan = fitTree(alignedTree({ leaf: [60, 150, 70], bark: [100, 70, 50] }))!;
    expect(plan.bark).toBe('#644632');
    for (const hex of plan.leaf) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(g!).toBeGreaterThan(r!);
      expect(g!).toBeGreaterThan(b!);
    }
  });

  it('cuts the roots: the foot stands above the spread of the base', () => {
    const plan = fitTree(alignedTree({ trunk: 4, roots: { rows: 6, half: 22 } }))!;
    expect(plan.foot).toBeLessThan(ROWS - 5);
    expect(plan.foot).toBeGreaterThan(ROWS - 12);
  });

  it('ignores a swelling of the trunk that is not the trunk (fallen fronds)', () => {
    const plan = fitTree(alignedTree({ trunk: 4, swollen: { rows: 14, by: 12 } }))!;
    for (const l of plan.trunk) expect(l.r[0] * 2).toBeLessThan(8 * TRUNK_WIDTH_RANGE[1] + 1);
  });

  it('a crown down to the ground is a bush without a trunk', () => {
    const plan = fitTree(alignedTree({ crown: { top: 40, base: 127, half: 0.45 }, trunk: 0 }))!;
    expect(plan.bush).toBe(true);
    expect(plan.trunk).toEqual([]);
    expect(plan.foot).toBe(ROWS - 1);
  });

  it('is null when no leaf shows', () => {
    expect(fitTree(alignedTree({ bare: true }))).toBeNull();
  });

  it('is deterministic', () => {
    const a = fitTree(alignedTree());
    const b = fitTree(alignedTree());
    expect(a).toEqual(b);
  });
});

describe('barkColour', () => {
  it('takes the middle band of the trunk pixels: no ink line, no pale edge, nothing outside its run', () => {
    // One row, the trunk run is its first 10 pixels: 2 ink black, 6 bark, 2 pale edge; then a leaf and paper.
    const px = [
      ...Array(2).fill([10, 10, 10]),
      ...Array(6).fill([100, 70, 50]),
      ...Array(2).fill([200, 200, 210]),
      [70, 140, 60],
      [250, 250, 250],
    ] as number[][];
    const view = {
      cols: 12,
      rows: 1,
      rgb: Uint8Array.from(px.flat()),
      mask: new Uint8Array(12).fill(1),
    };
    const [r, g, b] = barkColour([view], [5], [10], 0, 0);
    expect([Math.round(r), Math.round(g), Math.round(b)]).toEqual([100, 70, 50]);
  });
  it('falls back to a brown without pixels', () => {
    const view = { cols: 2, rows: 2, rgb: new Uint8Array(12), mask: new Uint8Array(4) };
    const [r, g, b] = barkColour([view], [1, 1], [2, 2], 0, 1);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
});

describe('fitTree options', () => {
  it('reads fronds only when asked, centred on the trunk and inside the crown rows', () => {
    expect(fitTree(alignedTree())!.fronds).toBeUndefined();
    const plan = fitTree(alignedTree(), { fronds: true })!;
    expect(plan.fronds!.fronds).toHaveLength(FRONDS);
    expect(plan.fronds!.heart.c[0]).toBeCloseTo(plan.trunk[0]!.c[0], 5);
    expect(plan.fronds!.heart.c[1]).toBeGreaterThan(plan.crownTop);
    expect(plan.fronds!.heart.c[1]).toBeLessThan(plan.crownBase);
  });

  it('raises the trunk to the leaves above its own column under an arched crown', () => {
    // A flat tree: the trunk's top stays inside the crown, under its top row.
    const plan = fitTree(alignedTree())!;
    const top = plan.trunk[0]!.c[1];
    expect(top).toBeGreaterThan(plan.crownTop);
    expect(top).toBeLessThan(plan.crownBase);
  });
});
