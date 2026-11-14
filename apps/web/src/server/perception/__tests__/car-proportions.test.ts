import { describe, expect, it } from 'vitest';
import { bodyWidthShare, profileProportions, vehicleAspects } from '../car/car-proportions';
import { alignViews, GRID_COLS_MAX, GRID_ROWS } from '../recon/views';
import { Canvas, COLORS } from './fixtures/draw-views';

describe('profileProportions (PQ-T76)', () => {
  it('reads width on the front and depth on the profile, largest side 1', () => {
    // A sedan as Muse drew it: front 1.23 h wide, profile 2.85 h long.
    const p = profileProportions({ w: 1.23, d: 2.85 });
    expect(p.d).toBe(1);
    expect(p.h).toBeCloseTo(1 / 2.85, 5);
    expect(p.w).toBeCloseTo(1.23 / 2.85, 5);
    // An unreadable aspect counts as one height, never NaN.
    expect(profileProportions({ w: Number.NaN, d: 0 })).toEqual({ w: 1, h: 1, d: 1 });
  });

  it('keeps a profile longer than the grid allows in the aspects', () => {
    // Front as wide as high; profile six times longer than high: the grid clamps, the aspect does not.
    const front = new Canvas(120, 100).rect(30, 30, 90, 90, COLORS.wall).image();
    const side = new Canvas(400, 100).rect(20, 30, 380, 90, COLORS.wall).image();
    const aligned = alignViews({ front, right: side })!;
    expect(aligned.D).toBe(GRID_COLS_MAX);
    expect(aligned.D / GRID_ROWS).toBeLessThan(6);
    expect(aligned.aspects.w).toBeCloseTo(1, 1);
    expect(aligned.aspects.d).toBeCloseTo(6, 1);
    expect(profileProportions(aligned.aspects).h).toBeCloseTo(1 / 6, 2);
  });
});

describe('bodyWidthShare (PQ-T76)', () => {
  const view = (rows: Array<[number, number]>, cols = 10) => {
    const mask = new Uint8Array(cols * rows.length);
    rows.forEach(([a, b], y) => {
      for (let x = a; x < b; x++) mask[y * cols + x] = 1;
    });
    return { cols, rows: rows.length, rgb: new Uint8Array(cols * rows.length * 3), mask };
  };

  it('leaves out wing mirrors that stick out above the beltline', () => {
    // Cabin 4 wide, mirrors 10 wide, body 8 wide in the lower half.
    const suv = view([
      [3, 7],
      [0, 10],
      [1, 9],
      [1, 9],
      [1, 9],
      [2, 8],
    ]);
    expect(bodyWidthShare(suv)).toBeCloseTo(0.8, 5);
    const a = vehicleAspects({ aspects: { w: 1.5, d: 3 }, views: { front: suv, right: suv } });
    expect(a.w).toBeCloseTo(1.2, 5);
    expect(a.d).toBe(3);
  });

  it('reads 1 when the body is widest low (bumper) or the view is blank', () => {
    expect(
      bodyWidthShare(
        view([
          [3, 7],
          [2, 8],
          [0, 10],
          [1, 9],
        ])
      )
    ).toBe(1);
    expect(
      bodyWidthShare(
        view([
          [0, 0],
          [0, 0],
        ])
      )
    ).toBe(1);
  });
});
