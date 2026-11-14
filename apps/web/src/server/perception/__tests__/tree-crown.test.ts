import { describe, expect, it } from 'vitest';
import { clearance, CLUMPS_MAX, packCrown, runsOf } from '../tree/tree-crown';

/** An elliptic crown on a `cols` × 128 sheet, as a mask. */
function ellipse(cols: number, top: number, base: number, half: number): Uint8Array {
  const m = new Uint8Array(cols * 128);
  const [cx, cy, rx, ry] = [cols / 2, (top + base) / 2, half * cols, (base - top) / 2];
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < cols; x++)
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) m[y * cols + x] = 1;
  return m;
}

describe('runsOf', () => {
  it('bridges gaps narrower than the limit', () => {
    const m = Uint8Array.from([1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1]);
    expect(runsOf(m, 11, [0], 2)).toEqual([
      [0, 5],
      [10, 10],
    ]);
    expect(runsOf(m, 11, [0], 1)).toEqual([
      [0, 1],
      [4, 5],
      [10, 10],
    ]);
  });
});

describe('clearance', () => {
  it('grows toward the middle of a solid', () => {
    const n = 9;
    const occ = new Uint8Array(n * n * n).fill(1);
    const d = clearance(occ, [n, n, n]);
    const at = (x: number, y: number, z: number) => d[(z * n + y) * n + x]!;
    expect(at(0, 4, 4)).toBeCloseTo(1, 5);
    expect(at(4, 4, 4)).toBeGreaterThan(at(2, 4, 4));
    expect(at(4, 4, 4)).toBeCloseTo(5, 5);
  });
});

describe('packCrown', () => {
  const front = ellipse(80, 10, 90, 0.45);
  const side = ellipse(60, 10, 90, 0.45);
  const lobes = packCrown({ front, side, W: 80, D: 60, rows: 128 }, 10, 90, 4);

  it('fills the crown with clumps, no more than the limit', () => {
    expect(lobes.length).toBeGreaterThan(5);
    expect(lobes.length).toBeLessThanOrEqual(CLUMPS_MAX);
  });

  it('keeps every clump centre inside the crown', () => {
    for (const l of lobes) {
      expect(l.c[0]).toBeGreaterThan(0);
      expect(l.c[0]).toBeLessThan(80);
      expect(l.c[1]).toBeGreaterThanOrEqual(10);
      expect(l.c[1]).toBeLessThanOrEqual(91);
      expect(l.c[2]).toBeGreaterThan(0);
      expect(l.c[2]).toBeLessThan(60);
    }
  });

  it('reaches the outline without much overshoot', () => {
    const xs = lobes.flatMap((l) => [l.c[0] - l.r[0], l.c[0] + l.r[0]]);
    expect(Math.min(...xs)).toBeGreaterThan(-4);
    expect(Math.max(...xs)).toBeLessThan(84);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(80 * 0.7);
  });

  it('is deterministic and sorted top to bottom', () => {
    const again = packCrown({ front, side, W: 80, D: 60, rows: 128 }, 10, 90, 4);
    expect(again).toEqual(lobes);
    for (let i = 1; i < lobes.length; i++)
      expect(lobes[i]!.c[1]).toBeGreaterThanOrEqual(lobes[i - 1]!.c[1]);
  });

  it('is empty without a crown', () => {
    const empty = new Uint8Array(80 * 128);
    expect(packCrown({ front: empty, side: empty, W: 80, D: 80, rows: 128 }, 0, 100, 4)).toEqual(
      []
    );
  });
});
