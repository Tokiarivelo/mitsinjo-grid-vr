import { describe, expect, it } from 'vitest';
import type { ObjectKit } from '@/lib/object-kit';
import { differingCounts, sameFamily, voteKits } from '../kit-vote';

const kit = (over: Partial<ObjectKit> = {}): ObjectKit => ({
  archetype: 'vehicle',
  subtype: 'sedan',
  proportions: { w: 1, h: 0.5, d: 0.4 },
  colors: { main: '#112233', secondary: '#223344', accent: '#334455' },
  details: { wheels: 4 },
  ...over,
});
const never = async () => {
  throw new Error('no score needed');
};

describe('voteKits (PQ-T18)', () => {
  it('one sample late or failed: the first is used alone', async () => {
    const a = kit();
    expect(await voteKits(a, null, never)).toEqual({ kit: a, outcome: 'single', disagreed: [] });
  });

  it('agreeing samples → one kit, scorer never asked', async () => {
    const v = await voteKits(kit(), kit(), never);
    expect(v.outcome).toBe('agree');
    expect(v.disagreed).toEqual([]);
  });

  it('counts that differ are marked unsure', async () => {
    const a = kit();
    const v = await voteKits(a, kit({ details: { wheels: 6 } }), never);
    expect(v.disagreed).toEqual(['wheels']);
    expect(v.kit.evidence?.unsure).toContain('wheels');
    expect(v.kit.details?.wheels).toBe(4);
  });

  it('split family → the better-scoring one wins', async () => {
    const a = kit();
    const b = kit({ archetype: 'cabinet', subtype: undefined });
    const v = await voteKits(a, b, async (k) => (k === b ? 80 : 40));
    expect(v.outcome).toBe('split');
    expect(v.kit).toBe(b);
    const v2 = await voteKits(a, b, async (k) => (k === a ? 80 : 40));
    expect(v2.kit).toBe(a);
  });

  it('a split with no score keeps the first', async () => {
    const a = kit();
    const v = await voteKits(a, kit({ subtype: 'truck' }), async () => null);
    expect(v.kit).toBe(a);
  });

  it('helpers', () => {
    expect(sameFamily(kit(), kit({ subtype: ' Sedan ' }))).toBe(true);
    expect(differingCounts(kit(), kit({ details: {} }))).toEqual([]);
  });
});
