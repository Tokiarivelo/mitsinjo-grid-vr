import { describe, expect, it } from 'vitest';
import { fitSection } from '../car/car-fit';
import {
  fitMirrors,
  MIRROR_COLOR,
  mirrorStation,
  placeMirrors,
  readMirrors,
} from '../car/car-mirrors';
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
    // The body under them: the cabin's edge, just above and just below their rows.
    expect(m.outline.root).toBeCloseTo(0.25, 2);
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

describe('readMirrors (the car team looked for them)', () => {
  const detail = (view: 'front' | 'right' | 'left' | 'top', box: number[], color?: string) => ({
    view,
    kind: 'mirror' as const,
    box: box as [number, number, number, number],
    ...(color ? { color } : {}),
  });

  it('takes the heights and the reach on the front, the place along the car on the sides', () => {
    const told = readMirrors(
      {
        details: [
          detail('front', [0.05, 0.2, 0.13, 0.3], '#111111'),
          detail('front', [0.87, 0.2, 0.95, 0.3]),
          // The right drawing reads backwards: its front is at the left.
          detail('right', [0.3, 0.25, 0.4, 0.32]),
          detail('left', [0.6, 0.25, 0.7, 0.32]),
          detail('top', [0.03, 0.6, 0.1, 0.65]),
        ],
      },
      { right: true, left: false },
      0.75,
      3
    )!;
    expect(told.z).toBeCloseTo(0.65, 3);
    const o = told.outline!;
    expect(o.y0).toBeCloseTo(0.7, 3);
    expect(o.y1).toBeCloseTo(0.8, 3);
    expect(o.root).toBeCloseTo(0.37, 3);
    // A rounded housing: its middle at the box's outer edge.
    expect(o.reach[1]).toBeCloseTo(0.45, 3);
    expect(o.reach[0]).toBeLessThan(o.reach[1]!);
    expect(o.color).toBe('#111111');
  });

  it('builds them from the side boxes alone when no end shows them', () => {
    const told = readMirrors({ details: [detail('right', [0.3, 0.3, 0.36, 0.34])] }, {}, 0.75)!;
    expect(told.z).toBeCloseTo(0.33, 3);
    const o = told.outline!;
    expect(o.y1 - o.y0).toBeCloseTo(0.04, 3);
    expect(Math.max(...o.reach) - o.root!).toBeCloseTo(0.04 * 0.75 * 1.4, 3);
    expect(o.color).toBe(MIRROR_COLOR);
  });

  it('is null when the team named no mirror', () => {
    expect(readMirrors({ details: [] }, {}, 0.75)).toBeNull();
  });
});

describe('placeMirrors', () => {
  const body = {
    z0: 0,
    z1: 1,
    top: [0.5, 1, 1, 1, 0.9, 0.7, 0.5, 0.5, 0.5],
    bottom: Array(9).fill(0.2),
    half: [0.4, 0.4],
  };
  const seen = { y0: 0.5, y1: 0.6, reach: [0.45, 0.5], root: 0.4 };
  const read = { y0: 0.5, y1: 0.6, reach: [0.42, 0.44], root: 0.4, color: '#111111' };

  it('keeps the outline measured on the pixels, at the place the team read on the side', () => {
    const m = placeMirrors({ body }, seen, { z: 0.55, outline: read })!;
    expect(m.reach).toEqual(seen.reach);
    expect(m.color).toBeUndefined();
    expect(m.z).toBe(0.55);
  });

  it("takes the team's outline when the front shows no mirror", () => {
    const m = placeMirrors({ body }, null, { z: null, outline: read })!;
    expect(m.color).toBe('#111111');
    expect(m.z).toBeCloseTo(0.5, 3);
  });

  it('does not follow a place far from where the cabin stands', () => {
    expect(placeMirrors({ body }, seen, { z: 0.95, outline: null })!.z).toBeCloseTo(0.5, 3);
  });

  it('is null when nobody saw a mirror', () => {
    expect(placeMirrors({ body }, null, { z: 0.5, outline: null })).toBeNull();
    expect(placeMirrors({ body }, null, null)).toBeNull();
  });
});
