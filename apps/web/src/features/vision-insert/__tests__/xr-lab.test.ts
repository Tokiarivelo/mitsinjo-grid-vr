import { describe, expect, it } from 'vitest';
import { editPiece } from '@/lib/piece-edits';
import { LAB_PAGE, labRotate, labScale, nextOpacity, pagePieces } from '../utils/xr-lab';

describe('VR lab edits (VS-T22)', () => {
  it('scales round the piece, inside the edit bounds', () => {
    expect(labScale(undefined, 1.15)).toEqual([1.15, 1.15, 1.15]);
    expect(labScale({ scale: [4.9, 1, 0.06] }, 1.15)).toEqual([5, 1.15, 0.069]);
    expect(labScale({ scale: [0.05, 1, 1] }, 1 / 1.15)[0]).toBe(0.05);
  });

  it('turns a quarter about the vertical, wrapped', () => {
    expect(labRotate(undefined)[1]).toBeCloseTo(Math.PI / 2);
    const four = [1, 2, 3, 4].reduce<ReturnType<typeof labRotate> | undefined>(
      (r) => labRotate(r ? { rotation: r } : undefined),
      undefined
    );
    expect(Math.abs(four![1])).toBeLessThan(1e-5);
  });

  it('cycles opacity 1 → 0.6 → 0.3 → 1, and the edit stays valid', () => {
    expect(nextOpacity(undefined)).toBe(0.6);
    expect(nextOpacity(0.6)).toBe(0.3);
    expect(nextOpacity(0.3)).toBe(1);
    // Opaque again = no edit left (cleanEdit drops it).
    expect(editPiece({ roof: { opacity: 0.3 } }, 'roof', { opacity: nextOpacity(0.3) })).toEqual(
      {}
    );
  });

  it('pages the pieces list', () => {
    const names = Array.from({ length: LAB_PAGE + 2 }, (_, i) => `glass-${i}`);
    expect(pagePieces(names, 0).items).toHaveLength(LAB_PAGE);
    expect(pagePieces(names, 1)).toMatchObject({ pages: 2, page: 1 });
    expect(pagePieces(names, 1).items).toHaveLength(2);
    expect(pagePieces([], 3)).toEqual({ items: [], pages: 1, page: 0 });
  });
});
