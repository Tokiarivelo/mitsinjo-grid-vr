import { describe, expect, it } from 'vitest';
import type { SdfBlob } from '../object-shape';
import { sdfBlob, sdfNormal, sdfOutlinePoints, sdfSmoothMin, sdfUnion } from '../sdf-field';

const sphere = (over: Partial<Extract<SdfBlob, { kind: 'sphere' }>> = {}): SdfBlob => ({
  kind: 'sphere',
  c: [0, 0, 0],
  r: 0.3,
  ...over,
});

describe('sdf-field (PQ-T53 §8)', () => {
  it('sphere: −r at the centre, 0 on the surface, +d outside', () => {
    const b = sphere();
    expect(sdfBlob(b, [0, 0, 0])).toBeCloseTo(-0.3, 12);
    expect(sdfBlob(b, [0.3, 0, 0])).toBeCloseTo(0, 12);
    expect(sdfBlob(b, [0, 0.5, 0])).toBeCloseTo(0.2, 12);
  });

  it('capsule: −r on the segment, tip distance past the ends, halfLen 0 = sphere', () => {
    const cap: SdfBlob = { kind: 'capsule', c: [0, 0, 0], axis: 'y', halfLen: 0.2, r: 0.1 };
    expect(sdfBlob(cap, [0, 0.1, 0])).toBeCloseTo(-0.1, 12);
    expect(sdfBlob(cap, [0.1, -0.2, 0])).toBeCloseTo(0, 12);
    expect(sdfBlob(cap, [0, 0.4, 0])).toBeCloseTo(0.1, 12);
    const dot: SdfBlob = { ...cap, halfLen: 0 };
    expect(sdfBlob(dot, [0, 0, 0])).toBeCloseTo(-0.1, 12);
    expect(sdfBlob(dot, [0.06, 0.08, 0])).toBeCloseTo(0, 12);
  });

  it('ellipsoid: −min radii at the centre, 0 on each axis tip', () => {
    const b: SdfBlob = { kind: 'ellipsoid', c: [0, 0, 0], radii: [0.1, 0.2, 0.3] };
    expect(sdfBlob(b, [0, 0, 0])).toBeCloseTo(-0.1, 12);
    expect(sdfBlob(b, [0.1, 0, 0])).toBeCloseTo(0, 9);
    expect(sdfBlob(b, [0, 0.2, 0])).toBeCloseTo(0, 9);
    expect(sdfBlob(b, [0, 0, 0.3])).toBeCloseTo(0, 9);
  });

  it('box: −half thinnest side at the centre, 0 on the faces', () => {
    const b: SdfBlob = { kind: 'box', c: [0, 0, 0], size: [0.4, 0.2, 0.3], r: 0.02 };
    expect(sdfBlob(b, [0, 0, 0])).toBeCloseTo(-0.1, 12);
    expect(sdfBlob(b, [0.2, 0, 0])).toBeCloseTo(0, 12);
    expect(sdfBlob(b, [0, -0.1, 0])).toBeCloseTo(0, 12);
  });

  it('smooth-min: k = 0 is the hard union, the bulge peaks at k / 4', () => {
    expect(sdfSmoothMin(0.2, 0.5, 0)).toBe(0.2);
    // Past k apart the pair does not blend (h clamps): the min wins untouched.
    expect(sdfSmoothMin(0.2, 0.5, 0.1)).toBe(0.2);
    expect(sdfSmoothMin(0.2, 0.25, 0.1)).toBeLessThan(0.2);
    expect(sdfSmoothMin(0, 0, 0.1)).toBeCloseTo(-0.025, 12);
    expect(sdfSmoothMin(0.3, 0.3, 0.2)).toBeCloseTo(0.25, 12);
    expect(sdfSmoothMin(1, 2, 0.5)).toBe(sdfSmoothMin(2, 1, 0.5));
  });

  it('union: one blob is its field, disjoint k = 0 blobs take the min', () => {
    const a = sphere({ c: [-0.2, 0, 0], r: 0.1 });
    const b = sphere({ c: [0.2, 0, 0], r: 0.1 });
    expect(sdfUnion([a], [-0.2, 0, 0])).toBeCloseTo(-0.1, 12);
    expect(sdfUnion([a, b], [0, 0, 0])).toBeCloseTo(0.1, 12);
    expect(sdfUnion([], [0, 0, 0])).toBe(Infinity);
  });

  it('union: the incoming blob folds with its own k (the first blob never blends)', () => {
    const a = sphere({ c: [-0.1, 0, 0], r: 0.1 });
    const hard: SdfBlob = { ...sphere({ c: [0.1, 0, 0], r: 0.1 }), k: 0 };
    const soft: SdfBlob = { ...hard, k: 0.1 };
    // Touching at the origin: hard stays 0, soft dips below (fused neck).
    expect(sdfUnion([a, hard], [0, 0, 0])).toBeCloseTo(0, 12);
    expect(sdfUnion([a, soft], [0, 0, 0])).toBeLessThan(0);
    // The first blob's k is unused: same union either way.
    const first: SdfBlob = { ...a, k: 0.1 };
    expect(sdfUnion([first, hard], [0, 0, 0])).toBe(sdfUnion([a, hard], [0, 0, 0]));
  });

  it('normal: unit length, radial on a sphere, axial on a box face', () => {
    const n = sdfNormal([sphere()], [0.3, 0, 0]);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
    expect(n[0]).toBeCloseTo(1, 3);
    expect(n[1]).toBeCloseTo(0, 3);
    const box: SdfBlob = { kind: 'box', c: [0, 0, 0], size: [0.4, 0.2, 0.3], r: 0 };
    const m = sdfNormal([box], [0, 0.1, 0]);
    expect(m[1]).toBeCloseTo(1, 3);
  });

  it('outline points: bounded, padded by k, deterministic', () => {
    const one = sdfOutlinePoints([sphere()]);
    expect(one.length).toBe(62); // 5 rings × 12 + poles
    for (const p of one) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(0.3, 9);
    const padded = sdfOutlinePoints([sphere({ k: 0.1 })]);
    for (const p of padded) expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(0.4, 9);
    const cap: SdfBlob = { kind: 'capsule', c: [0, 0, 0], axis: 'y', halfLen: 0.2, r: 0.1 };
    expect(sdfOutlinePoints([cap]).length).toBe(124);
    const box: SdfBlob = { kind: 'box', c: [0, 0, 0], size: [0.4, 0.2, 0.3], r: 0 };
    expect(sdfOutlinePoints([box]).length).toBe(14); // corners + face centres
    expect(sdfOutlinePoints([sphere(), cap])).toEqual(sdfOutlinePoints([sphere(), cap]));
  });
});
