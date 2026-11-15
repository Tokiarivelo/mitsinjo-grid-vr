import { describe, expect, it } from 'vitest';
import { FROND_LABEL, FROND_LOBES, FRONDS, frondCrown } from '../tree/tree-fronds';

describe('FROND_LABEL', () => {
  it('names the plants with a frond crown, in the three languages of the labels', () => {
    for (const l of ['palm tree', 'Coconut', 'cocotier', 'ravenala', 'banana plant', 'bananier'])
      expect(FROND_LABEL.test(l)).toBe(true);
    for (const l of ['mango tree', 'pine', 'baobab', 'acacia', 'bush'])
      expect(FROND_LABEL.test(l)).toBe(false);
  });
});

describe('frondCrown', () => {
  const crown = frondCrown(10, 60, [40, 40], [30, 20]);

  it('gives the fronds round one heart, inside the measured outline', () => {
    expect(crown.fronds).toHaveLength(FRONDS);
    expect(crown.heart.c).toEqual([40, 10 + 0.55 * 50, 40]);
    for (const f of crown.fronds) {
      expect(f.lobes).toHaveLength(FROND_LOBES);
      for (const l of f.lobes) {
        expect(Math.abs(l.c[0] - 40)).toBeLessThanOrEqual(30);
        expect(Math.abs(l.c[2] - 40)).toBeLessThanOrEqual(20);
        expect(l.c[1]).toBeGreaterThan(0);
        expect(l.c[1]).toBeLessThan(62);
      }
    }
  });

  it('makes each frond one ribbon: every lobe reaches the next one', () => {
    for (const f of crown.fronds)
      for (let i = 0; i + 1 < f.lobes.length; i++) {
        const [a, b] = [f.lobes[i]!, f.lobes[i + 1]!];
        expect(Math.abs(b.c[1] - a.c[1])).toBeLessThanOrEqual(a.r[1] + b.r[1]);
        expect(Math.hypot(b.c[0] - a.c[0], b.c[2] - a.c[2])).toBeLessThanOrEqual(a.r[0] + b.r[0]);
      }
  });

  it('spreads the fronds round the heart and over the height', () => {
    const tips = crown.fronds.map((f) => f.lobes[FROND_LOBES - 1]!.c);
    expect(tips.some((t) => t[0] < 40) && tips.some((t) => t[0] > 40)).toBe(true);
    expect(tips.some((t) => t[2] < 40) && tips.some((t) => t[2] > 40)).toBe(true);
    expect(new Set(crown.fronds.map((f) => f.tier)).size).toBe(3);
    expect(frondCrown(10, 60, [40, 40], [30, 20])).toEqual(crown);
  });
});
