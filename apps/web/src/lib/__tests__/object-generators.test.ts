import { describe, expect, it } from 'vitest';
import type { RecipePart } from '../object-shape';
import {
  branchTree,
  drapeStrands,
  expandGenerators,
  growPart,
  scatterLeaves,
  sweepTube,
} from '../object-generators';

const host = (over: Partial<RecipePart> = {}): RecipePart => ({
  shape: 'box',
  at: [0, 0, 0],
  size: [1, 1, 1],
  color: '#3e7a34',
  ...over,
});

describe('sweepTube (PQ-T50 §7.3)', () => {
  const trunk = {
    op: 'sweep' as const,
    seed: 7,
    points: [
      [0, -0.5, 0],
      [0, -0.28, 0],
      [0, -0.06, 0],
    ] as [number, number, number][],
    r0: 0.075,
    r1: 0.045,
    flare: 0.6,
  };

  it('a vertical run tapers across cylinder segments, base flared', () => {
    const out = sweepTube(host(), trunk);
    expect(out).toHaveLength(2);
    expect(out.every((q) => q.shape === 'cylinder' && q.axis === 'y')).toBe(true);
    // Taper: lower segment wider; flare widens the base past r0.
    expect(out[0]!.size[0]).toBeGreaterThan(out[1]!.size[0]);
    expect(out[0]!.size[0]).toBeGreaterThan(0.075 * 2);
    expect(out[0]!.color).toBe('#3e7a34');
  });

  it('an angled run becomes boxes, and a zero-length step is skipped', () => {
    const out = sweepTube(host(), {
      ...trunk,
      points: [
        [0, 0, 0],
        [0.3, 0.1, 0],
        [0.3, 0.1, 0],
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.shape).toBe('box');
  });
});

describe('branchTree (PQ-T50 §7.3)', () => {
  const limbs = {
    op: 'branch' as const,
    seed: 21,
    at: [0, -0.1, 0] as [number, number, number],
    dir: [0, 1, 0] as [number, number, number],
    length: 0.22,
    radius: 0.03,
    levels: 2,
    count: 3,
    angle: 0.6,
    droop: 0.15,
    decay: 0.7,
  };

  it('grows stem plus children, seeded and bounded', () => {
    const out = branchTree(host(), limbs);
    expect(out).toHaveLength(1 + 3);
    expect(branchTree(host(), limbs)).toEqual(out);
    expect(branchTree(host(), { ...limbs, seed: 22 })).not.toEqual(out);
    // Children start on the upper stem and stay near it.
    for (const q of out.slice(1)) {
      expect(q.at[1]).toBeGreaterThan(-0.1);
      expect(Math.abs(q.at[0])).toBeLessThan(0.3);
    }
  });

  it('three levels of five stay within 31 segments', () => {
    const out = branchTree(host(), { ...limbs, levels: 3, count: 5 });
    expect(out).toHaveLength(1 + 5 + 25);
  });
});

describe('scatterLeaves (PQ-T50 §7.3)', () => {
  const crown = {
    op: 'scatter' as const,
    seed: 42,
    volume: {
      shape: 'ellipsoid' as const,
      at: [0, 0.2, 0] as [number, number, number],
      size: [0.9, 0.56, 0.9] as [number, number, number],
    },
    count: 48,
    size: 0.085,
    orientation: 'random' as const,
    colors: ['#3e7a34'],
  };

  it('fills the volume with thin seeded cards in the palette', () => {
    const out = scatterLeaves(host(), crown);
    expect(out).toHaveLength(48);
    expect(scatterLeaves(host(), crown)).toEqual(out);
    for (const q of out) {
      expect(q.shape).toBe('box');
      const thin = Math.min(...q.size);
      expect(thin).toBeLessThan(0.085 * 0.7);
      expect(q.color).toBe('#3e7a34');
      // Inside the ellipsoid (card centre; half-size tolerance for the corners).
      const dx = (q.at[0] - 0) / 0.45;
      const dy = (q.at[1] - 0.2) / 0.28;
      const dz = (q.at[2] - 0) / 0.45;
      expect(dx * dx + dy * dy + dz * dz).toBeLessThanOrEqual(1.01);
    }
  });

  it('a box volume and a flat orientation read as such', () => {
    const out = scatterLeaves(host(), {
      ...crown,
      volume: { shape: 'box', at: [0, 0, 0], size: [0.5, 0.5, 0.5] },
      orientation: 'flat',
      count: 10,
    });
    expect(out).toHaveLength(10);
    expect(out.every((q) => q.size[1] < q.size[0] && q.size[1] < q.size[2])).toBe(true);
    expect(out.every((q) => Math.abs(q.at[0]) <= 0.25)).toBe(true);
  });
});

describe('drapeStrands (PQ-T50 §7.3)', () => {
  it('hangs three wavy boxes per strand under each point', () => {
    const out = drapeStrands(host(), {
      op: 'drape',
      seed: 5,
      points: [
        [0.1, 0.4, 0],
        [-0.1, 0.4, 0],
      ],
      strands: 2,
      length: 0.3,
      waviness: 0.1,
      thickness: 0.01,
    });
    expect(out).toHaveLength(2 * 2 * 3);
    expect(out.every((q) => q.at[1] < 0.4)).toBe(true);
    // Sway: strands off one hang point spread sideways.
    const right = out.filter((q) => q.at[0] > 0).map((q) => q.at[0]);
    expect(Math.max(...right) - Math.min(...right)).toBeGreaterThan(0.01);
  });
});

describe('expandGenerators (PQ-T50 §7.3)', () => {
  const scatterHost = host({
    at: [0, 0.2, 0],
    size: [0.95, 0.62, 0.95],
    generator: {
      op: 'scatter',
      seed: 42,
      volume: { shape: 'ellipsoid', at: [0, 0.2, 0], size: [0.9, 0.56, 0.9] },
      count: 8,
      size: 0.085,
      orientation: 'random',
      colors: ['#3e7a34'],
    },
  });

  it('grows generator parts and maps every leaf back to its host', () => {
    const plain = host({ at: [0, -0.4, 0], size: [0.2, 0.2, 0.2] });
    const { parts, from } = expandGenerators([plain, scatterHost]);
    expect(parts).toHaveLength(1 + 8);
    expect(parts[0]).toBe(plain);
    expect(from).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(parts.slice(1).every((q) => !q.generator)).toBe(true);
  });

  it('growth stays inside the host box plus margin', () => {
    const tight = host({
      at: [0, 0, 0],
      size: [0.2, 0.2, 0.2],
      generator: {
        op: 'scatter',
        seed: 1,
        volume: { shape: 'box', at: [0.5, 0.5, 0.5], size: [0.4, 0.4, 0.4] },
        count: 20,
        size: 0.05,
        orientation: 'random',
        colors: ['#3e7a34'],
      },
    });
    for (const q of growPart(tight)) {
      for (const a of [0, 1, 2] as const) {
        expect(q.at[a] - q.size[a] / 2).toBeGreaterThanOrEqual(-0.15 - 1e-9);
        expect(q.at[a] + q.size[a] / 2).toBeLessThanOrEqual(0.15 + 1e-9);
      }
    }
  });

  it('details on a generator part are ignored: trim belongs on plain hosts', () => {
    const { parts } = expandGenerators([{ ...scatterHost, details: ['handle'] }]);
    expect(parts).toHaveLength(8);
  });
});
