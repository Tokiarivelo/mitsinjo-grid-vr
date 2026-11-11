import { describe, expect, it } from 'vitest';
import {
  clippedShare,
  conditionsFacts,
  conditionsTrust,
  hiddenShare,
  laplacianVariance,
  measurePhotoConditions,
  viewClass,
} from '../photo-conditions';
import type { GrayGrid } from '../repetition';

const W = 64;
const H = 64;

/** Checkerboard of 4 px tiles: sharp edges everywhere. */
function checker(): GrayGrid {
  const gray = new Float32Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++)
      gray[j * W + i] = (Math.floor(i / 4) + Math.floor(j / 4)) % 2 ? 0.8 : 0.2;
  return { width: W, height: H, gray, mask: new Uint8Array(W * H).fill(1) };
}

/** Box blur of the grid: same content, softer edges. */
function blurred(g: GrayGrid, r = 3): GrayGrid {
  const gray = new Float32Array(g.gray.length);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      let sum = 0;
      let n = 0;
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          sum += g.gray[y * W + x]!;
          n++;
        }
      gray[j * W + i] = sum / n;
    }
  return { ...g, gray };
}

describe('photo conditions (PQ-T7)', () => {
  it('a blurred copy is classed lower than the sharp one', () => {
    const sharp = checker();
    expect(laplacianVariance(blurred(sharp))).toBeLessThan(laplacianVariance(sharp));
    const a = measurePhotoConditions({
      widthPx: 400,
      heightPx: 300,
      grid: sharp,
      nativeGrid: sharp,
      hasOutline: false,
    });
    const b = measurePhotoConditions({
      widthPx: 400,
      heightPx: 300,
      grid: blurred(sharp),
      nativeGrid: blurred(sharp),
      hasOutline: false,
    });
    expect(a.sharpness).toBe('high');
    expect(b.sharpness).toBe('low');
  });

  it('sharpness is read on the native grid only: without it, it is not reported', () => {
    const c = measurePhotoConditions({
      widthPx: 400,
      heightPx: 300,
      grid: checker(),
      hasOutline: false,
    });
    expect(c.sharpness).toBeUndefined();
    expect(c.exposure).toBe('low');
  });

  it('half-covered outline → hidden ≈ 0.5 (unit fill)', () => {
    expect(hiddenShare(0.45, 'cabinet')).toBeCloseTo(0.5, 1);
    const g = checker();
    for (let k = 0; k < g.mask.length; k++) g.mask[k] = k % W < W / 2 ? 1 : 0;
    // 'building' usually fills 0.9 of its box: 0.5 / 0.9 → hidden ≈ 0.44
    const c = measurePhotoConditions({
      widthPx: 400,
      heightPx: 300,
      grid: g,
      hasOutline: true,
      archetype: 'building',
    });
    expect(c.hidden).toBeGreaterThan(0.4);
    expect(c.hidden).toBeLessThan(0.5);
  });

  it('no outline → hidden is not reported', () => {
    const c = measurePhotoConditions({
      widthPx: 400,
      heightPx: 300,
      grid: checker(),
      hasOutline: false,
      archetype: 'house',
    });
    expect(c.hidden).toBeUndefined();
  });

  it('counts clipped pixels and classes exposure', () => {
    const g = checker();
    g.gray.fill(1);
    expect(clippedShare(g)).toBe(1);
    const c = measurePhotoConditions({ widthPx: 400, heightPx: 300, grid: g, hasOutline: false });
    expect(c.exposure).toBe('high');
    expect(conditionsTrust(c)).toBeLessThan(1);
  });

  it('view class from the yaw', () => {
    expect(viewClass(0.05)).toBe('front');
    expect(viewClass(-0.5)).toBe('three_quarter');
    expect(viewClass(1.2)).toBe('side');
  });

  it('facts line lists only what was measured', () => {
    expect(conditionsFacts({ widthPx: 412, heightPx: 178 })).toEqual(['object 412 × 178 px']);
    expect(
      conditionsFacts({
        widthPx: 412,
        heightPx: 178,
        sharpness: 'low',
        exposure: 'low',
        hidden: 0.35,
        view: 'side',
      })
    ).toEqual(['object 412 × 178 px', 'sharpness low', '35 % hidden', 'facing: side']);
  });
});
