import { describe, expect, it } from 'vitest';
import { HOUSE_SLOTS, houseMesh, REVEAL } from '../house-mesh';
import { HousePlanSchema, type HousePlan } from '../house-plan';

const look: HousePlan['look'] = {
  wall: { material: 'brick', color: '#a04a35' },
  roof: { material: 'tile', color: '#b5543a' },
  trim: '#f0f0f0',
  glass: '#40546a',
  door: '#5a3d2b',
  base: '#8f8a80',
};

/** A body with a hip roof, a veranda under its roof at the front left, two windows and a door. */
const plan: HousePlan = HousePlanSchema.parse({
  volumes: [
    { kind: 'body', plan: [0, 1, 0, 1], eave: 0.6, ridge: 1, roof: 'hip', ridgeAxis: 'x' },
    {
      kind: 'veranda',
      plan: [0, 0.4, 0.75, 1],
      eave: 0.6,
      ridge: 0.6,
      roof: 'none',
      ridgeAxis: 'x',
      open: ['front', 'left'],
      columns: 3,
      floor: 0.05,
    },
  ],
  openings: [
    // Behind the veranda: moves to the back of the recess.
    { volume: 0, wall: 'front', kind: 'door', along: [0.15, 0.25], rise: [0.05, 0.45] },
    // Front window, reaching into the roof: clipped under the eave.
    {
      volume: 0,
      wall: 'front',
      kind: 'window',
      along: [0.6, 0.8],
      rise: [0.2, 0.9],
      panes: [3, 2],
    },
    { volume: 0, wall: 'right', kind: 'window', along: [0.3, 0.6], rise: [0.2, 0.5] },
  ],
  chimneys: [{ plan: [0.7, 0.75, 0.4, 0.45], top: 1 }],
  look,
});

const dims = [1, 0.6, 0.8] as const;
const slot = (s: (typeof HOUSE_SLOTS)[number]) => HOUSE_SLOTS.indexOf(s);

/** World points of the triangles of one slot. */
function points(m: ReturnType<typeof houseMesh>, s: number) {
  const out: Array<[number, number, number]> = [];
  m.slot.forEach((v, t) => {
    if (v !== s) return;
    for (let k = 0; k < 3; k++)
      out.push([
        m.position[t * 9 + k * 3]!,
        m.position[t * 9 + k * 3 + 1]!,
        m.position[t * 9 + k * 3 + 2]!,
      ]);
  });
  return out;
}

describe('houseMesh', () => {
  const m = houseMesh(plan, dims, { views: ['front', 'right', 'back', 'left', 'top'] });

  it('emits consistent arrays and unit normals', () => {
    const tris = m.slot.length;
    expect(tris).toBeGreaterThan(100);
    expect(m.position.length).toBe(tris * 9);
    expect(m.normal.length).toBe(tris * 9);
    expect(m.uv.length).toBe(tris * 6);
    for (let i = 0; i < m.normal.length; i += 3)
      expect(Math.hypot(m.normal[i]!, m.normal[i + 1]!, m.normal[i + 2]!)).toBeCloseTo(1, 5);
  });

  it('builds every kind of detail: roof, drawn walls, plain wall, trim, glass, door, deck', () => {
    for (const s of ['roof', 'front', 'right', 'wall', 'trim', 'glass', 'door', 'base'] as const)
      expect(points(m, slot(s)).length, s).toBeGreaterThan(0);
  });

  it('keeps every window under its eave (never in the roof)', () => {
    const eaveY = (0.6 - 0.5) * dims[1];
    for (const p of points(m, slot('glass'))) expect(p[1]).toBeLessThanOrEqual(eaveY + 1e-6);
  });

  it('sets the glass back in its reveal', () => {
    const frontZ = dims[2] / 2;
    const glass = points(m, slot('glass')).filter((p) => p[2] > frontZ - 0.05);
    expect(glass.length).toBeGreaterThan(0);
    for (const p of glass) expect(p[2]).toBeCloseTo(frontZ - REVEAL, 5);
  });

  it('opens the front wall where the veranda sits under the roof, its door at the back of the recess', () => {
    const frontZ = dims[2] / 2;
    const recessZ = (0.75 - 0.5) * dims[2];
    // No front wall left of x = 0.4 at mid height on the outer plane.
    const outer = points(m, slot('front')).filter((p) => Math.abs(p[2] - frontZ) < 1e-6);
    const xCut = (0.4 - 0.5) * dims[0];
    const xs = outer.map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(xCut - 1e-6);
    // The door leaf stands at the back of the recess.
    const door = points(m, slot('door'));
    expect(door.length).toBeGreaterThan(0);
    for (const p of door) expect(p[2]).toBeCloseTo(recessZ - REVEAL, 5);
  });

  it('puts posts along the open sides of the veranda', () => {
    const frontZ = dims[2] / 2;
    const atFront = points(m, slot('trim')).filter(
      (p) => p[2] > frontZ - 0.03 && p[0] < (0.4 - 0.5) * dims[0] && p[1] < 0
    );
    expect(atFront.length).toBeGreaterThan(0);
  });

  it('sets every closed block on a plinth, closed underneath', () => {
    const m = houseMesh(plan, dims);
    const base = slot('base');
    let down = 0;
    for (let t = 0; t < m.slot.length; t++)
      if (
        m.slot[t] === base &&
        m.normal[t * 9 + 1]! < -0.9 &&
        m.position[t * 9 + 1]! <= -dims[1] / 2 + 1e-6
      )
        down++;
    // At least two triangles under the body (plus the deck's).
    expect(down).toBeGreaterThanOrEqual(2);
  });

  it('draws a chimney above the roof', () => {
    const top = (1 - 0.5) * dims[1];
    expect(Math.max(...points(m, slot('wall')).map((p) => p[1]))).toBeGreaterThan(top - 0.02);
  });

  it('raises a gable wall on the ends of a gable roof and railed balcony slabs', () => {
    const gable = houseMesh(
      HousePlanSchema.parse({
        volumes: [
          {
            kind: 'body',
            plan: [0, 1, 0, 0.8],
            eave: 0.5,
            ridge: 0.9,
            roof: 'gable',
            ridgeAxis: 'x',
          },
          {
            kind: 'balcony',
            plan: [0.3, 0.7, 0.8, 1],
            eave: 0.5,
            ridge: 0.5,
            roof: 'none',
            ridgeAxis: 'x',
            open: ['front', 'left', 'right'],
            floor: 0.45,
          },
        ],
        openings: [],
        chimneys: [],
        look,
      }),
      [1, 1, 1]
    );
    const right = points(gable, slot('right'));
    expect(Math.max(...right.map((p) => p[1]))).toBeCloseTo(0.4, 5);
    // The balcony slab sits at its floor, off the ground (past the body's plinth).
    const base = points(gable, slot('base')).filter((p) => p[2] > 0.3 + 0.01);
    expect(Math.min(...base.map((p) => p[1]))).toBeGreaterThan(-0.5 + 0.3);
  });
});
