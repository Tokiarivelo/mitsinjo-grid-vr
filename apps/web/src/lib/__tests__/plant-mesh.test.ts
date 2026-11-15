import { describe, expect, it } from 'vitest';
import {
  FAN_PLEATS,
  FROND_LEAFLETS,
  LEAF_SEGMENTS,
  MASS_TRIANGLES,
  PLANT_SLOTS,
  PLANT_TWO_SIDED,
  STRAND_ARCH_SEGMENTS,
  STRAND_SEGMENTS,
  catmull,
  plantMesh,
} from '../plant-mesh';
import type { PlantPlan } from '../plant-plan';

const LOOK = { bark: '#553322', leaf: '#448833', leafDark: '#225511' };
const plan = (p: Partial<PlantPlan>): PlantPlan => ({
  habit: 'round',
  leaf: 'broad',
  stems: [],
  masses: [],
  look: LOOK,
  seed: 3,
  ...p,
});
const DIMS = [1, 2, 1] as const;

/** Signed volume of the triangles (positive = wound outward, a closed solid). */
function volume(pos: Float32Array, slot: Uint8Array, only: number): number {
  let v = 0;
  for (let t = 0; t < slot.length; t++) {
    if (slot[t] !== only) continue;
    const p = (k: number) => [
      pos[t * 9 + k * 3]!,
      pos[t * 9 + k * 3 + 1]!,
      pos[t * 9 + k * 3 + 2]!,
    ];
    const [a, b, c] = [p(0), p(1), p(2)] as [number[], number[], number[]];
    v +=
      (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
        a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
        a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) /
      6;
  }
  return v;
}

describe('plantMesh', () => {
  it('builds a trunk as a closed tube wound outward, in bark', () => {
    const m = plantMesh(
      plan({
        stems: [
          {
            points: [
              [0.5, 0, 0.5],
              [0.5, 0.6, 0.5],
            ],
            r: [0.05, 0.04],
            kind: 'trunk',
          },
        ],
      }),
      DIMS
    );
    expect(m.slot.length).toBeGreaterThan(0);
    expect([...m.slot].every((s) => s === PLANT_SLOTS.indexOf('bark'))).toBe(true);
    expect(volume(m.position, m.slot, 0)).toBeGreaterThan(0);
  });

  it('keeps the foliage balls within their triangle budget', () => {
    const masses = Array.from({ length: 40 }, (_, i) => ({
      c: [0.2 + (i % 8) * 0.08, 0.6 + Math.floor(i / 8) * 0.06, 0.5] as [number, number, number],
      r: [0.1, 0.1, 0.1] as [number, number, number],
    }));
    const m = plantMesh(plan({ masses }), DIMS);
    // Balls plus their two-triangle leaf cards.
    expect(m.slot.length).toBeLessThan(MASS_TRIANGLES + 2 * 1400 + 1);
  });

  it('arches each hanging strand before it falls', () => {
    const m = plantMesh(
      plan({ habit: 'weeping', strands: [{ top: [0.8, 0.8, 0.5], bottom: 0.2, width: 0.02 }] }),
      DIMS
    );
    expect(m.slot.length).toBe(2 * (STRAND_ARCH_SEGMENTS + STRAND_SEGMENTS));
    // The arch rises above the strand's top before the drop.
    let top = -Infinity;
    for (let i = 1; i < m.position.length; i += 3) top = Math.max(top, m.position[i]!);
    expect(top).toBeGreaterThan((0.8 - 0.5) * 2);
  });

  it('draws a palmate leaf as a stalk and a pleated fan, a frond as a comb', () => {
    const leaf = {
      base: [0.5, 0.6, 0.5] as [number, number, number],
      tip: [0.8, 0.8, 0.5] as [number, number, number],
      width: 0.2,
      droop: 0.1,
    };
    const fan = plantMesh(plan({ habit: 'palm', leaves: [{ ...leaf, fan: true }] }), DIMS);
    const frond = plantMesh(plan({ habit: 'palm', leaves: [{ ...leaf, cut: true }] }), DIMS);
    // Stalk: 10 segments of 2 triangles; fan: 4 triangles per pleat.
    expect(fan.slot.length).toBe(20 + 4 * FAN_PLEATS);
    // A cut frond: its rachis, then a comb of leaflets on both sides.
    expect(frond.slot.length).toBe(2 * LEAF_SEGMENTS + 2 * FROND_LEAFLETS);
  });

  it('folds a leaf on its midrib so it shows from the side', () => {
    const leaf = {
      base: [0.5, 0.5, 0.5] as [number, number, number],
      tip: [0.9, 0.5, 0.5] as [number, number, number],
      width: 0.2,
      droop: 0,
    };
    const flat = plantMesh(plan({ habit: 'fan', leaves: [leaf] }), DIMS);
    const folded = plantMesh(plan({ habit: 'fan', leaves: [{ ...leaf, fold: 0.6 }] }), DIMS);
    // Two halves per segment.
    expect(folded.slot.length).toBe(2 * flat.slot.length);
    // Seen from the front (x, y), the flat level leaf is a line; the folded one has a height.
    const height = (m: { position: Float32Array }) => {
      let [lo, hi] = [Infinity, -Infinity];
      for (let i = 1; i < m.position.length; i += 3) {
        lo = Math.min(lo, m.position[i]!);
        hi = Math.max(hi, m.position[i]!);
      }
      return hi - lo;
    };
    expect(height(flat)).toBeLessThan(1e-6);
    expect(height(folded)).toBeGreaterThan(0.03);
  });

  it('runs a traced leaf through its midrib, its width across the front', () => {
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
    ];
    expect(catmull(pts, 0)).toEqual([0, 0, 0]);
    expect(catmull(pts, 0.5)[1]).toBeCloseTo(1);
    expect(catmull(pts, 1)[0]).toBeCloseTo(2);
    const m = plantMesh(
      plan({
        habit: 'palm',
        leaves: [
          {
            base: [0.3, 0.5, 0.5],
            mid: [[0.5, 0.8, 0.5]],
            tip: [0.7, 0.5, 0.5],
            width: 0.1,
            droop: 0,
            facing: true,
          },
        ],
      }),
      DIMS
    );
    // Facing the front: flat in z, up through the midrib's middle point.
    let [top, depth] = [-Infinity, 0];
    for (let i = 0; i < m.position.length; i += 3) {
      top = Math.max(top, m.position[i + 1]!);
      depth = Math.max(depth, Math.abs(m.position[i + 2]!));
    }
    expect(depth).toBeLessThan(1e-6);
    expect(top).toBeGreaterThan((0.8 - 0.5) * 2 - 0.01);
  });

  it('marks the thin slots two-sided and is deterministic', () => {
    expect(PLANT_TWO_SIDED.has('leaf')).toBe(true);
    expect(PLANT_TWO_SIDED.has('bark')).toBe(false);
    const p = plan({
      masses: [{ c: [0.5, 0.7, 0.5], r: [0.2, 0.2, 0.2] }],
      tiers: [{ y0: 0.3, y1: 0.9, r: 0.3 }],
    });
    expect(plantMesh(p, DIMS).position).toEqual(plantMesh(p, DIMS).position);
  });
});
