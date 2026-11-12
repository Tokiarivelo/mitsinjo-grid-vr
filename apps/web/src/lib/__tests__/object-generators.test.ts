import { describe, expect, it } from 'vitest';
import type { RecipePart } from '../object-shape';
import {
  branchTree,
  drapeStrands,
  expandGenerators,
  growPart,
  insetPocket,
  loftBody,
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

describe('loftBody (PQ-T51 §7.3)', () => {
  const body = host({ at: [0, -0.06, 0], size: [1, 0.48, 0.9], color: '#b03a2e' });
  const car = {
    op: 'loft' as const,
    seed: 3,
    axis: 'x' as const,
    stations: [
      { width: 0.7, height: 0.3, radius: 0 },
      { width: 0.9, height: 0.48, radius: 0 },
      { width: 0.9, height: 0.48, radius: 0 },
      { width: 0.8, height: 0.4, radius: 0 },
    ],
  };

  it('grows one box per station pair, stepped and standing on the baseline', () => {
    const out = loftBody(body, car);
    expect(out).toHaveLength(3);
    expect(out.every((q) => q.shape === 'box')).toBe(true);
    // Taper: the mid segment is the widest and tallest; every foot on the baseline.
    expect(out[1]!.size[2]).toBeGreaterThan(out[0]!.size[2]);
    expect(out[1]!.size[1]).toBeGreaterThan(out[2]!.size[1]);
    for (const q of out) expect(q.at[1] - q.size[1] / 2).toBeCloseTo(-0.3, 6);
    expect(out[0]!.at[0]).toBeCloseTo(-1 / 3, 6);
    expect(out[2]!.at[0]).toBeCloseTo(1 / 3, 6);
    expect(out[0]!.color).toBe('#b03a2e');
  });

  it('round stations grow elliptical cylinders on the loft axis', () => {
    const out = loftBody(body, {
      ...car,
      stations: [
        { width: 0.4, height: 0.4, radius: 0.2 },
        { width: 0.5, height: 0.5, radius: 0.2 },
        { width: 0.4, height: 0.4, radius: 0.2 },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out.every((q) => q.shape === 'cylinder' && q.axis === 'x')).toBe(true);
    expect(out[0]!.size[1]).toBeCloseTo(0.45, 6);
  });

  it('a vertical loft stacks width × height sections upward', () => {
    const bottle = host({ at: [0, 0, 0], size: [0.4, 1, 0.4] });
    const out = loftBody(bottle, {
      op: 'loft',
      seed: 3,
      axis: 'y',
      stations: [
        { width: 0.3, height: 0.3, radius: 0 },
        { width: 0.36, height: 0.36, radius: 0 },
        { width: 0.24, height: 0.24, radius: 0 },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.at[1]).toBeCloseTo(-0.25, 6);
    expect(out[1]!.at[1]).toBeCloseTo(0.25, 6);
    expect(out[0]!.size[0]).toBeCloseTo(0.33, 6);
    expect(out[0]!.at[0]).toBe(0);
    expect(out[0]!.at[2]).toBe(0);
  });

  it('growth past the host cross section is clamped into it', () => {
    const tight = host({ at: [0, 0, 0], size: [1, 0.2, 0.2], generator: { ...car } });
    for (const q of growPart(tight)) {
      expect(q.size[1]).toBeLessThanOrEqual(0.2 + 0.1 + 1e-9);
      expect(q.size[2]).toBeLessThanOrEqual(0.2 + 0.1 + 1e-9);
    }
  });
});

describe('insetPocket (PQ-T51 §7.3)', () => {
  const wall = host({
    at: [0, 0, 0],
    size: [1, 0.5, 0.9],
    color: '#b03a2e',
    kind: 'body',
  });
  const hollow = {
    op: 'inset' as const,
    seed: 11,
    face: 'front' as const,
    u: 0.5,
    v: 0.4,
    w: 0.4,
    h: 0.3,
    depth: -0.05,
  };

  it('a hollow is one dark slab sunk in the face, barely proud', () => {
    const [slab] = insetPocket(wall, hollow);
    expect(slab).toBeDefined();
    expect(slab!.shape).toBe('box');
    expect(slab!.at[0]).toBeCloseTo(0, 6);
    expect(slab!.at[1]).toBeCloseTo(-0.05, 6);
    expect(slab!.at[2]).toBeCloseTo((0.4 + 0.454) / 2, 6);
    expect(slab!.size[0]).toBeCloseTo(0.4, 6);
    expect(slab!.size[1]).toBeCloseTo(0.15, 6);
    expect(slab!.size[2]).toBeCloseTo(0.054, 6);
    // Darkened host (0.55), kind kept: a recess, not a new part.
    expect(slab!.color).toBe('#612019');
    expect(slab!.kind).toBe('body');
  });

  it('a relief stands proud in its own colour and kind', () => {
    const [slab] = insetPocket(wall, {
      ...hollow,
      depth: 0.03,
      color: '#222222',
      kind: 'grille',
    });
    expect(slab!.at![2]).toBeCloseTo((0.44 + 0.48) / 2, 6);
    expect(slab!.size[2]).toBeCloseTo(0.04, 6);
    expect(slab!.color).toBe('#222222');
    expect(slab!.kind).toBe('grille');
  });

  it('a rect past the edge is clamped to fit the face', () => {
    const [slab] = growPart(host({ ...wall, generator: { ...hollow, u: 0.95 } }));
    expect(slab!.at[0] + slab!.size[0] / 2).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(slab!.at[0] - slab!.size[0] / 2).toBeGreaterThanOrEqual(-0.5 - 1e-9);
  });

  it('a top pocket lies flat on the roof face', () => {
    const [slab] = insetPocket(wall, { ...hollow, face: 'top', u: 0.5, v: 0.5, depth: 0 });
    expect(slab!.at![0]).toBeCloseTo(0, 6);
    expect(slab!.at![2]).toBeCloseTo(0, 6);
    expect(slab!.at![1]).toBeCloseTo((0.24 + 0.254) / 2, 6);
    expect(slab!.size[0]).toBeCloseTo(0.4, 6);
    expect(slab!.size[2]).toBeCloseTo(0.27, 6);
  });
});

describe('expandGenerators with loft and inset (PQ-T51 §7.3)', () => {
  it('a loft replaces its host with its segments', () => {
    const hull = host({
      at: [0, -0.06, 0],
      size: [1, 0.48, 0.9],
      generator: {
        op: 'loft',
        seed: 3,
        axis: 'x',
        stations: [
          { width: 0.7, height: 0.3, radius: 0 },
          { width: 0.9, height: 0.48, radius: 0 },
          { width: 0.8, height: 0.4, radius: 0 },
        ],
      },
    });
    const { parts, from } = expandGenerators([hull]);
    expect(parts).toHaveLength(2);
    expect(parts.every((q) => !q.generator)).toBe(true);
    expect(from).toEqual([0, 0]);
  });

  it('an inset keeps its host: wall and pocket render side by side', () => {
    const panel = host({
      at: [0, 0, 0],
      size: [1, 0.5, 0.9],
      kind: 'body',
      details: ['seam'],
      generator: {
        op: 'inset',
        seed: 11,
        face: 'right',
        u: 0.5,
        v: 0.35,
        w: 0.5,
        h: 0.25,
        depth: -0.04,
        kind: 'grille',
      },
    });
    const { parts, from } = expandGenerators([panel]);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.generator).toBeUndefined();
    expect(parts[0]!.details).toEqual(['seam']);
    expect(parts[0]!.kind).toBe('body');
    expect(parts[1]!.kind).toBe('grille');
    expect(from).toEqual([0, 0]);
  });
});
