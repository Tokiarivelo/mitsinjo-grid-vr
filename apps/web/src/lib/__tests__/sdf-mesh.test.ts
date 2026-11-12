import { describe, expect, it } from 'vitest';
import { SDF_BALL, SDF_BOTTLE, SDF_PERSON, SDF_SLABS } from '@/test/sdf-blobs';
import { meshSdf, SDF_GRID } from '../sdf-mesh';

describe('sdf-mesh (PQ-T53 §8)', () => {
  it('a ball meshes at 24³: exact count, unit bounds, smooth unit normals', () => {
    const m = meshSdf(SDF_BALL);
    expect(m.grid).toBe(SDF_GRID);
    expect(m.triangles).toBe(2648);
    expect(m.positions.length).toBe(m.normals.length);
    let maxAbs = 0;
    let minDot = Infinity;
    let maxTilt = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      maxAbs = Math.max(
        maxAbs,
        Math.abs(m.positions[i]!),
        Math.abs(m.positions[i + 1]!),
        Math.abs(m.positions[i + 2]!)
      );
      const len = Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!);
      maxTilt = Math.max(maxTilt, Math.abs(len - 1));
      minDot = Math.min(
        minDot,
        m.positions[i]! * m.normals[i]! +
          m.positions[i + 1]! * m.normals[i + 1]! +
          m.positions[i + 2]! * m.normals[i + 2]!
      );
    }
    expect(maxAbs).toBeLessThanOrEqual(0.5);
    expect(maxTilt).toBeLessThan(1e-6);
    expect(minDot).toBeGreaterThan(0); // outward: every normal points away from the centre
  });

  it('smooth bodies stay at 24³: bottle and person-like union', () => {
    const bottle = meshSdf(SDF_BOTTLE);
    expect(bottle.grid).toBe(SDF_GRID);
    expect(bottle.triangles).toBe(1520);
    const person = meshSdf(SDF_PERSON);
    expect(person.grid).toBe(SDF_GRID);
    expect(person.triangles).toBe(1192);
  });

  it('adversarial unions step down the ladder and stay within the per-part cap', () => {
    const m = meshSdf(SDF_SLABS);
    expect(m.grid).toBe(16);
    expect(m.triangles).toBe(1800);
  });

  it('deterministic: same blobs, same bytes', () => {
    const a = meshSdf(SDF_PERSON);
    const b = meshSdf(SDF_PERSON);
    expect(a.grid).toBe(b.grid);
    expect(a.positions).toEqual(b.positions);
    expect(a.normals).toEqual(b.normals);
  });

  it('total: no blobs, no triangles (the schema asks for ≥ 1)', () => {
    expect(meshSdf([]).triangles).toBe(0);
  });

  it('fast: the adversarial ladder finishes inside the 300 ms shape budget', () => {
    const t0 = performance.now();
    meshSdf(SDF_SLABS);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
