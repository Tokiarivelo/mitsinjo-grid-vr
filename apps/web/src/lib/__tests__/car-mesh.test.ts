import { describe, expect, it } from 'vitest';
import { CAR_SLOTS, carMesh, inPolygon } from '../car-mesh';
import { CarPlanSchema, type CarPlan } from '../car-plan';

const n = 16;
const ramp = (a: number, b: number) =>
  Array.from({ length: n }, (_, i) => +(a + ((b - a) * i) / (n - 1)).toFixed(3));

/** A box-like body on two axles, one side window on the right. */
const plan: CarPlan = CarPlanSchema.parse({
  kind: 'sedan',
  wheels: [
    { z: 0.2, y: 0.2, r: 0.2, rim: 0.6 },
    { z: 0.8, y: 0.2, r: 0.2, rim: 0.6 },
  ],
  track: { x0: 0.05, x1: 0.95, tyre: 0.12 },
  body: {
    z0: 0,
    z1: 1,
    top: ramp(0.7, 0.9),
    bottom: Array(n).fill(0.25),
    half: Array(8).fill(0.45),
  },
  windows: [
    {
      view: 'right',
      points: [
        [0.3, 0.55],
        [0.7, 0.55],
        [0.7, 0.8],
        [0.3, 0.8],
      ],
    },
  ],
  look: { paint: '#c82828' },
});
const dims = [1.8, 1.4, 4.5] as const;

const slotCount = (slot: Uint8Array) => {
  const out = Object.fromEntries(CAR_SLOTS.map((s) => [s, 0])) as Record<string, number>;
  for (const s of slot) out[CAR_SLOTS[s]!]! += 1;
  return out;
};

describe('inPolygon', () => {
  it('is an even-odd test', () => {
    const sq: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(inPolygon([0.5, 0.5], sq)).toBe(true);
    expect(inPolygon([1.5, 0.5], sq)).toBe(false);
  });
});

describe('carMesh', () => {
  it('is null without a fitted body', () => {
    expect(carMesh({ wheels: plan.wheels }, dims)).toBeNull();
  });

  it('builds the body, glass and four wheels inside the box', () => {
    const m = carMesh(plan, dims)!;
    const tris = m.position.length / 9;
    expect(m.slot).toHaveLength(tris);
    expect(m.normal).toHaveLength(m.position.length);
    expect(m.uv).toHaveLength((m.position.length / 3) * 2);
    const c = slotCount(m.slot);
    expect(c.glass).toBeGreaterThan(0);
    expect(c.tyre).toBeGreaterThan(0);
    expect(c.rim).toBeGreaterThan(0);
    expect(c.roof).toBeGreaterThan(0);
    expect(c.right! + c.left!).toBeGreaterThan(0);
    for (let i = 0; i < m.position.length; i += 3) {
      expect(Math.abs(m.position[i]!)).toBeLessThanOrEqual(dims[0] / 2 + 1e-4);
      expect(Math.abs(m.position[i + 1]!)).toBeLessThanOrEqual(dims[1] / 2 + 1e-4);
      expect(Math.abs(m.position[i + 2]!)).toBeLessThanOrEqual(dims[2] / 2 + 1e-4);
    }
    for (const v of m.normal) expect(Number.isFinite(v)).toBe(true);
  });

  it('puts no glass without windows and is deterministic', () => {
    const bare = carMesh({ ...plan, windows: undefined }, dims)!;
    expect(slotCount(bare.slot).glass).toBe(0);
    expect(carMesh(plan, dims)!.position).toEqual(carMesh(plan, dims)!.position);
  });
});
