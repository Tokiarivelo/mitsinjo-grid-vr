import { describe, expect, it } from 'vitest';
import { atlasUv, faceSlot } from '../face-atlas';
import {
  cabinClimbs,
  CAR_SLOTS,
  carMesh,
  carShoulder,
  cutTriangle,
  carSection,
  EDGE_IN,
  floorLine,
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

describe('underside: floor, wheel wells and axles', () => {
  const arched = Array.from({ length: n }, (_, i) => {
    const z = i / (n - 1);
    return Math.abs(z - 0.2) < 0.13 || Math.abs(z - 0.8) < 0.13 ? 0.42 : 0.15;
  });

  it('takes the wheel arches out of the floor line', () => {
    const f = floorLine({ z0: 0, z1: 1, bottom: arched }, plan.wheels, dims[1] / dims[2]);
    for (const y of f) expect(y).toBeCloseTo(0.15, 5);
    // No wheel: the body's own underside.
    expect(floorLine({ z0: 0, z1: 1, bottom: arched }, [], 0.3)).toEqual(arched);
  });

  it('keeps the floor low between the wheels and joins each pair with an axle', () => {
    const m = carMesh({ ...plan, body: { ...plan.body!, bottom: arched } }, dims)!;
    const under = CAR_SLOTS.indexOf('under');
    const floorY = (0.15 - 0.5) * dims[1];
    const axleY = (0.2 - 0.5) * dims[1];
    let low = 0;
    let axle = 0;
    for (let t = 0; t < m.slot.length; t++) {
      if (m.slot[t] !== under) continue;
      for (let k = 0; k < 3; k++) {
        const [x, y, z] = [0, 1, 2].map((j) => m.position[t * 9 + k * 3 + j]!) as [
          number,
          number,
          number,
        ];
        // At an axle station, on the centre line: the floor (not the arch top).
        if (
          Math.abs(z - (0.2 - 0.5) * dims[2]) < 0.05 &&
          Math.abs(x) < 0.2 &&
          Math.abs(y - floorY) < 1e-3
        )
          low++;
        if (Math.abs(y - axleY) < 0.2 * 0.2 * dims[1] && Math.abs(x) > 0.5) axle++;
      }
    }
    expect(low).toBeGreaterThan(0);
    expect(axle).toBeGreaterThan(0);
  });
});

/** Triangles of a mesh as { slot, centre (shares of the box), normal of the face }. */
const faces = (m: NonNullable<ReturnType<typeof carMesh>>) =>
  Array.from({ length: m.slot.length }, (_, t) => {
    const p = [0, 1, 2].map((k) =>
      [0, 1, 2].map((j) => m.position[t * 9 + k * 3 + j]! / dims[j]! + 0.5)
    ) as [number[], number[], number[]];
    const e1 = [0, 1, 2].map((j) => (p[1][j]! - p[0][j]!) * dims[j]!);
    const e2 = [0, 1, 2].map((j) => (p[2][j]! - p[0][j]!) * dims[j]!);
    const nrm = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const l = Math.hypot(...nrm) || 1;
    return {
      slot: CAR_SLOTS[m.slot[t]!]!,
      corners: p,
      centre: [0, 1, 2].map((j) => (p[0][j]! + p[1][j]! + p[2][j]!) / 3),
      normal: nrm.map((v) => v / l),
      area: l / 2,
    };
  });

describe('cutTriangle (PQ-T78)', () => {
  const piece = {
    vs: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ] as [[number, number, number], [number, number, number], [number, number, number]],
    ns: [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ] as [[number, number, number], [number, number, number], [number, number, number]],
  };
  const flat = (p: [number, number, number]): [number, number] => [p[0], p[1]];
  const area = (t: typeof piece) =>
    Math.abs(
      (t.vs[1][0] - t.vs[0][0]) * (t.vs[2][1] - t.vs[0][1]) -
        (t.vs[2][0] - t.vs[0][0]) * (t.vs[1][1] - t.vs[0][1])
    ) / 2;

  it('cuts a triangle crossing the line into pieces on each side, the area kept', () => {
    const out = cutTriangle(piece, [0, 0, 1, 1], [0.5, 0], [0.5, 1], null, flat);
    expect(out).toHaveLength(3);
    expect(out.reduce((s, t) => s + area(t), 0)).toBeCloseTo(0.5, 9);
    for (const t of out) {
      const xs = t.vs.map((v) => v[0]);
      expect(Math.min(...xs) >= 0.5 - 1e-9 || Math.max(...xs) <= 0.5 + 1e-9).toBe(true);
    }
  });

  it('leaves a triangle whole outside the window bounds or on one side of the line', () => {
    expect(cutTriangle(piece, [2, 2, 3, 3], [0.5, 0], [0.5, 1], null, flat)).toEqual([piece]);
    expect(cutTriangle(piece, [0, 0, 1, 1], [1.5, 0], [1.5, 1], null, flat)).toEqual([piece]);
  });
});

describe('glass follows the windows the team read (PQ-T78)', () => {
  it('cuts the flank along the window: every glass triangle lies inside its polygon', () => {
    const glass = faces(carMesh(plan, dims)!).filter((f) => f.slot === 'glass');
    expect(glass.length).toBeGreaterThan(0);
    for (const f of glass)
      for (const [, y, z] of f.corners) {
        expect(z!).toBeGreaterThanOrEqual(0.3 - 1e-6);
        expect(z!).toBeLessThanOrEqual(0.7 + 1e-6);
        expect(y!).toBeGreaterThanOrEqual(0.55 - 1e-6);
        expect(y!).toBeLessThanOrEqual(0.8 + 1e-6);
      }
    // The whole window is glass on each flank (the other side wears the same windows).
    const side = glass.filter((f) => f.centre[0]! > 0.5).reduce((s, f) => s + f.area, 0);
    expect(side).toBeGreaterThan(0.4 * dims[2] * 0.25 * dims[1] * 0.97);
  });

  const n2 = 32;
  /** Boot, rear window, roof, a raked windscreen, a bonnet with a small step (a louvre). */
  const top = Array.from({ length: n2 }, (_, i) =>
    i < 5
      ? 0.6
      : i < 8
        ? 0.6 + ((i - 4) * 0.35) / 3
        : i < 16
          ? 0.95
          : i < 22
            ? 0.95 - ((i - 15) * 0.35) / 6
            : i === 26
              ? 0.57
              : 0.6
  );
  const half = [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.36, 0.34, 0.33, 0.32];
  const raked: CarPlan = {
    ...plan,
    body: { z0: 0, z1: 1, top, bottom: Array(n2).fill(0.25), half },
    windows: [
      {
        view: 'front',
        points: [
          [0.2, 0.55],
          [0.8, 0.55],
          [0.8, 0.94],
          [0.2, 0.94],
        ],
      },
    ],
  };

  it('finds where the body climbs to the roof: windscreen and rear window, not the decks', () => {
    const climbs = cabinClimbs(raked.body!);
    expect(climbs.slice(0, 4).some(Boolean)).toBe(false);
    expect(climbs.slice(4, 7).every(Boolean)).toBe(true);
    expect(climbs.slice(8, 15).some(Boolean)).toBe(false);
    expect(climbs.slice(15, 21).every(Boolean)).toBe(true);
    expect(climbs.slice(22).some(Boolean)).toBe(false);
    expect(carShoulder(raked.body!).shoulder).toBeCloseTo(5 / 9, 5);
  });

  it('glazes a raked windscreen that faces the sky, never the bonnet under it', () => {
    const m = carMesh(raked, dims, { views: ['front', 'right', 'top'] })!;
    const glass = faces(m).filter((f) => f.slot === 'glass');
    expect(glass.length).toBeGreaterThan(0);
    // Windscreen stations 15 → 21 of 32: z between 0.48 and 0.68; the bonnet (z > 0.7) has none.
    for (const f of glass) {
      expect(f.centre[2]!).toBeGreaterThan(0.47);
      expect(f.centre[2]!).toBeLessThan(0.69);
    }
    expect(glass.some((f) => f.normal[1]! > 0.7)).toBe(true);
  });
});

describe('ring parts (PQ-T78)', () => {
  it('reads the bumper under the nose on the front drawing, not on the floor', () => {
    const bottom = Array.from({ length: n }, (_, i) => (i === n - 1 ? 0.6 : 0.25));
    const m = carMesh({ ...plan, body: { ...plan.body!, bottom } }, dims)!;
    const nose = faces(m).filter(
      (f) => f.centre[2]! > 0.94 && f.normal[2]! > 0.7 && f.centre[1]! < 0.6
    );
    expect(nose.length).toBeGreaterThan(0);
    expect(nose.every((f) => f.slot === 'front')).toBe(true);
    // Between the wheels the underside stays the floor, whatever way it faces.
    expect(faces(m).some((f) => f.slot === 'under' && Math.abs(f.centre[2]! - 0.5) < 0.2)).toBe(
      true
    );
  });

  it('keeps a wing or a sill turned up on its flank: the roof is only the top of the ring', () => {
    const half = [0.45, 0.45, 0.45, 0.45, 0.3, 0.3, 0.3, 0.3];
    const m = carMesh({ ...plan, windows: undefined, body: { ...plan.body!, half } }, dims)!;
    const roof = faces(m).filter((f) => f.slot === 'roof');
    expect(roof.length).toBeGreaterThan(0);
    for (const f of roof) expect(f.centre[1]!).toBeGreaterThan(0.65);
  });
});
