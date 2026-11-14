import { describe, expect, it } from 'vitest';
import { atlasUv, faceSlot } from '../face-atlas';
import {
  CAR_SLOTS,
  carMesh,
  carSection,
  EDGE_IN,
  inPolygon,
  stationTaper,
  TAPER_MIN,
} from '../car-mesh';
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

describe('carSection (bonnet, cabin and roof as a car is built)', () => {
  // Front section: body 0.47 up to 0.58, cabin narrowing to 0.27, a rounded top row at 0.08.
  const half = [0, 0.41, 0.47, 0.47, 0.47, 0.47, 0.47, 0.46, 0.42, 0.33, 0.29, 0.27, 0.08];
  const top = [0.3, 0.7, 0.7, 0.72, 0.85, 1, 1, 1, 0.9, 0.72, 0.72, 0.4];
  const section = carSection({ half, top });

  it('keeps a bonnet or boot at the body width, never pinched to the cabin', () => {
    // A deck station (top 0.72): at 0.7 the front shows the cabin (≈ 0.40), the deck stays ≈ 0.46.
    expect(section(0.72, 0.65)).toBeCloseTo(0.46, 2);
    expect(section(0.72, 0.72)).toBeCloseTo(0.46 * (1 - EDGE_IN), 3);
  });

  it('narrows the cabin going up, never wider, and keeps the roof wide under the rounded top', () => {
    const ys = [0.7, 0.8, 0.9, 0.95, 1];
    const w = ys.map((y) => section(1, y));
    for (let i = 1; i < w.length; i++) expect(w[i]!).toBeLessThanOrEqual(w[i - 1]! + 1e-9);
    // The top row of the front (0.08) is the drawing's rounded corner, not the roof's width.
    expect(section(1, 0.99)).toBeGreaterThan(0.2);
  });
});

describe('stationTaper', () => {
  it('narrows only the nose and the tail, never under TAPER_MIN; none without a plan', () => {
    const top = Array(20).fill(0.8);
    const taper = Array.from({ length: 20 }, (_, i) => 0.6 + (0.4 * i) / 19); // a perspective trend
    const at = stationTaper({ top, taper });
    expect(at(10)).toBe(1);
    expect(at(0)).toBeGreaterThanOrEqual(TAPER_MIN);
    expect(at(0)).toBeLessThan(1);
    expect(stationTaper({ top })(0)).toBe(1);
  });
});

describe('carMesh look', () => {
  it('lays the floor on the underside tile when it was drawn', () => {
    const m = carMesh(plan, dims, { views: ['front', 'right'], underside: true })!;
    const under = CAR_SLOTS.indexOf('under');
    const [u0, v0] = atlasUv(faceSlot('bottom'), 0, 0);
    const [u1, v1] = atlasUv(faceSlot('bottom'), 1, 1);
    let n = 0;
    for (let t = 0; t < m.slot.length; t++) {
      if (m.slot[t] !== under) continue;
      n++;
      const u = m.uv[t * 6]!;
      const v = m.uv[t * 6 + 1]!;
      expect(u).toBeGreaterThanOrEqual(Math.min(u0, u1) - 1e-6);
      expect(u).toBeLessThanOrEqual(Math.max(u0, u1) + 1e-6);
      expect(v).toBeGreaterThanOrEqual(Math.min(v0, v1) - 1e-6);
      expect(v).toBeLessThanOrEqual(Math.max(v0, v1) + 1e-6);
    }
    expect(n).toBeGreaterThan(0);
  });

  it('keeps flat panels flat: the roof is level away from its rounded edges, no dome', () => {
    const m = carMesh({ ...plan, windows: undefined }, dims)!;
    const roof = CAR_SLOTS.indexOf('roof');
    let n = 0;
    for (let t = 0; t < m.slot.length; t++)
      if (m.slot[t] === roof)
        for (let k = 0; k < 3; k++)
          if (Math.abs(m.position[t * 9 + k * 3]!) < 0.3 * dims[0]) {
            n++;
            expect(m.normal[t * 9 + k * 3 + 1]!).toBeGreaterThan(0.95);
          }
    expect(n).toBeGreaterThan(0);
  });
});
