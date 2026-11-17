import { describe, expect, it } from 'vitest';
import {
  cardLevel,
  dissolveLevel,
  dissolveProgress,
  dissolveSeeds,
  grainAge,
  DISSOLVE_EDGE,
  DISSOLVE_GRAINS,
  DISSOLVE_MS,
  GRAIN_LIFE,
} from '../lab-dissolve';

describe('lab 2D → 3D dissolve', () => {
  it('eases from 0 to 1 over the hand-over, clamped outside it', () => {
    expect(dissolveProgress(-50)).toBe(0);
    expect(dissolveProgress(0)).toBe(0);
    expect(dissolveProgress(DISSOLVE_MS / 2)).toBeCloseTo(0.5);
    expect(dissolveProgress(DISSOLVE_MS)).toBe(1);
    expect(dissolveProgress(DISSOLVE_MS * 3)).toBe(1);
    // Smooth start: slower than linear in the first quarter.
    expect(dissolveProgress(DISSOLVE_MS / 4)).toBeLessThan(0.25);
    let prev = 0;
    for (let t = 0; t <= DISSOLVE_MS; t += 100) {
      const p = dissolveProgress(t);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it('the line rises from the plate to past the top, edge included', () => {
    expect(dissolveLevel(0, 0.5)).toBe(0);
    expect(dissolveLevel(1, 0.5)).toBeCloseTo(0.5 * (1 + DISSOLVE_EDGE));
    expect(dissolveLevel(0.5, -1)).toBe(0);
  });

  it('the card is whole below its bottom and fully gone (noisy edge too) at the end', () => {
    expect(cardLevel(0, 0.1, 0.4)).toBe(0);
    expect(cardLevel(0.3, 0.1, 0.4)).toBeCloseTo(0.5);
    expect(cardLevel(2, 0.1, 0.4)).toBe(1 + DISSOLVE_EDGE);
    // The final line clears a card whose top is the highest point.
    const top = 0.1 + 0.4;
    expect(cardLevel(dissolveLevel(1, top), 0.1, 0.4)).toBeGreaterThanOrEqual(
      1 + DISSOLVE_EDGE / 2
    );
  });

  it('seeds the same grains every time, in range', () => {
    const a = dissolveSeeds();
    expect(a).toHaveLength(DISSOLVE_GRAINS * 3);
    expect(Array.from(a)).toEqual(Array.from(dissolveSeeds()));
    expect(Array.from(dissolveSeeds(8, 1))).not.toEqual(Array.from(dissolveSeeds(8, 2)));
    for (let i = 0; i < a.length; i += 3) {
      expect(a[i]!).toBeGreaterThanOrEqual(-0.5);
      expect(a[i]!).toBeLessThan(0.5);
      expect(a[i + 1]!).toBeGreaterThanOrEqual(0);
      expect(a[i + 1]!).toBeLessThan(1);
    }
  });

  it('a grain leaves when the line passes it and is gone one life later', () => {
    expect(grainAge(0.5, 0.4)).toBeLessThan(0);
    expect(grainAge(0.5, 0.5)).toBe(0);
    expect(grainAge(0.5, 0.5 + GRAIN_LIFE)).toBeCloseTo(1);
    // Every grain is gone at the end of the hand-over.
    expect(grainAge(0.99, 1 + DISSOLVE_EDGE)).toBeLessThan(1);
  });
});
