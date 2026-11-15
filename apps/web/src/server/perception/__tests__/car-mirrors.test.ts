import { describe, expect, it } from 'vitest';
import { fitSection } from '../car/car-fit';
import { fitMirrors, mirrorStation } from '../car/car-mirrors';
import type { GridView } from '../recon/views';
import { Canvas, COLORS } from './fixtures/draw-views';

/** The canvas as a grid view: drawn = not white. */
const grid = (c: Canvas): GridView => {
  const mask = new Uint8Array(c.cols * c.rows);
  for (let i = 0; i < mask.length; i++)
    mask[i] = c.rgb[i * 3]! + c.rgb[i * 3 + 1]! + c.rgb[i * 3 + 2]! < 740 ? 1 : 0;
  return { cols: c.cols, rows: c.rows, rgb: c.rgb, mask };
};

/** Front 100 × 60: cabin columns 25–74 rows 0–19, body columns 10–89 rows 20–59. */
const bare = () =>
  new Canvas(100, 60).rect(25, 0, 75, 20, COLORS.body).rect(10, 20, 90, 60, COLORS.body);
/** The same with mirrors over the full width on rows 14–17, beside the cabin. */
const mirrored = () => grid(bare().rect(0, 14, 100, 18, COLORS.body));

describe('fitMirrors (PQ-T80)', () => {
  it('reads the bump of the outline: its rows, its heights and how far it reaches', () => {
    const m = fitMirrors(mirrored(), 4)!;
    expect(m.rows).toEqual([13, 18]);
    expect(m.outline.y0).toBeCloseTo(1 - 18 / 60, 3);
    expect(m.outline.y1).toBeCloseTo(1 - 14 / 60, 3);
    expect(m.outline.reach).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('finds none on a front without a bump', () => {
    expect(fitMirrors(grid(bare()))).toBeNull();
  });

  it('takes a part that is wide over a long height for body, not for a mirror', () => {
    // A cab as wide as the image over rows 2–19 (30 % of the height).
    expect(fitMirrors(grid(bare().rect(0, 2, 100, 20, COLORS.body)))).toBeNull();
  });

  it('leaves a bump under the wings alone (a wheel arch flare, a step)', () => {
    expect(fitMirrors(grid(bare().rect(0, 40, 100, 44, COLORS.body)))).toBeNull();
  });
});

describe('fitSection without the mirrors', () => {
  it('reads the body across the rows the mirrors take', () => {
    const front = mirrored();
    const rows = fitMirrors(front)!.rows;
    // Level 9 of 13 = row 15, inside the mirrors: capped at the body without them, the cabin with.
    expect(fitSection(front, 13)![9]).toBeCloseTo(0.4, 2);
    expect(fitSection(front, 13, rows)![9]).toBeCloseTo(0.25, 2);
    // The other levels are the drawing's.
    expect(fitSection(front, 13, rows)![2]).toBeCloseTo(0.4, 2);
    expect(fitSection(front, 13, rows)![12]).toBeCloseTo(0.25, 2);
  });
});

describe('mirrorStation', () => {
  const body = {
    z0: 0,
    z1: 1,
    // Tail, cabin (roof at 1), a windscreen falling to a bonnet at 0.5.
    top: [0.5, 1, 1, 1, 0.9, 0.7, 0.5, 0.5, 0.5],
    bottom: Array(9).fill(0.2),
    half: [0.4, 0.4],
  };

  it('stands where the cabin has risen over the mirror, not over the bonnet', () => {
    // Top of the mirror 0.6: a third of the way to the roof is 0.733, reached at station 4.
    expect(mirrorStation({ body }, { y1: 0.6 })).toBeCloseTo(0.5, 3);
  });

  it('stands at the front corner of the side glass when it is further back', () => {
    const windows = [
      {
        view: 'right' as const,
        points: [
          [0.2, 0.6],
          [0.44, 0.6],
          [0.4, 0.9],
        ] as [number, number][],
      },
    ];
    expect(mirrorStation({ body, windows }, { y1: 0.6 })).toBeCloseTo(0.44, 3);
  });

  it('is unknown without a body and without side glass', () => {
    expect(mirrorStation({}, { y1: 0.6 })).toBeNull();
  });
});
