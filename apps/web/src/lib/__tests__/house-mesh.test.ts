import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FASCIA, HOUSE_SLOTS, houseMesh, REVEAL, THATCH_EDGE } from '../house-mesh';
import { HousePlanSchema, type HousePlan } from '../house-plan';
import lodgePlan from './fixtures/lodge-plan.json';

const LODGE_HASH = '87a1a7aa0355a2fe';
const LODGE_HASH_FRONT = '0aa134d3ec743b45';
const PLAN_HASH = '0996203857c864db';

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

// PQ-T73: a plan that reads none of the new parts builds exactly what PQ-T72 built.
const meshHash = (m: ReturnType<typeof houseMesh>) => {
  const h = createHash('sha256');
  for (const a of [m.position, m.normal, m.uv, m.slot])
    h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  return h.digest('hex').slice(0, 16);
};

describe('houseMesh without the PQ-T73 parts (regression)', () => {
  // Hashes of the PQ-T72 builder (commit 5a129af) on the same plans.
  it('builds the PQ-T72 mesh of a real lodge reading, byte for byte', () => {
    const lodge = HousePlanSchema.parse(lodgePlan);
    const views = ['front', 'right', 'back', 'left', 'top'] as const;
    expect(meshHash(houseMesh(lodge, [1, 0.5, 0.8], { views }))).toBe(LODGE_HASH);
    expect(meshHash(houseMesh(lodge, [1, 0.6, 0.7]))).toBe(LODGE_HASH_FRONT);
  });

  it('builds the PQ-T72 mesh of the veranda plan, byte for byte', () => {
    expect(meshHash(houseMesh(plan, dims))).toBe(PLAN_HASH);
  });
});

describe('houseMesh PQ-T73 parts', () => {
  const count = (m: ReturnType<typeof houseMesh>, s: (typeof HOUSE_SLOTS)[number]) =>
    m.slot.filter((v) => v === slot(s)).length;

  it('builds stone piers with a cap from the ground', () => {
    const m = houseMesh({ ...plan, piers: [{ plan: [0.02, 0.06, 0.94, 0.99], top: 0.55 }] }, dims);
    const pts = points(m, slot('stone'));
    expect(pts.length).toBeGreaterThan(0);
    const ys = pts.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-dims[1] / 2, 5);
    expect(Math.max(...ys)).toBeCloseTo((0.55 - 0.5) * dims[1], 5);
    expect(count(houseMesh(plan, dims), 'stone')).toBe(0);
  });

  it('stops a pier at the beam of the veranda it carries', () => {
    const veranda = {
      ...plan,
      volumes: plan.volumes.map((v, i) =>
        i === 1 ? { ...v, plan: [0, 0.4, 0.8, 1] as never, roof: 'shed' as const, ridge: 0.65 } : v
      ),
      piers: [{ plan: [0.02, 0.06, 0.94, 0.99] as never, top: 0.9 }],
    };
    const top = (p: HousePlan) =>
      Math.max(...points(houseMesh(p, dims), slot('stone')).map((q) => q[1]));
    expect(top(veranda)).toBeLessThan((0.6 - 0.5) * dims[1]);
    // Under a deck (flat roof, a balcony on top) the pier rises through to its own top.
    const deck = {
      ...veranda,
      volumes: veranda.volumes.map((v, i) =>
        i === 1 ? { ...v, roof: 'flat' as const, ridge: 0.6 } : v
      ),
    };
    expect(top(deck)).toBeCloseTo((0.9 - 0.5) * dims[1], 5);
  });

  it('puts a roof on its second roofing', () => {
    const vols = plan.volumes.map((v, i) => (i === 0 ? { ...v, roofFinish: 'roof2' as const } : v));
    const m = houseMesh({ ...plan, volumes: vols }, dims);
    expect(count(m, 'roof2')).toBeGreaterThan(0);
    expect(count(m, 'roof')).toBe(0);
  });

  it('dresses a block in its second cladding', () => {
    const vols = plan.volumes.map((v, i) => (i === 0 ? { ...v, wallFinish: 'wall2' as const } : v));
    const m = houseMesh({ ...plan, volumes: vols }, dims);
    expect(count(m, 'wall2')).toBeGreaterThan(0);
    expect(count(m, 'front')).toBe(0);
  });

  it('fills the spandrels of an arched window up to its top', () => {
    const arched = {
      ...plan,
      openings: plan.openings.map((o, i) => (i === 1 ? { ...o, head: 'arch' as const } : o)),
    };
    const flat = houseMesh(plan, dims);
    const m = houseMesh(arched, dims);
    expect(count(m, 'front')).toBeGreaterThan(count(flat, 'front'));
    // The spandrels stand on the wall plane, between the spring and the window's top.
    const front = points(m, slot('front')).filter((p) => Math.abs(p[2] - dims[2] / 2) < 1e-6);
    const inWindow = front.filter(
      (p) => p[0] > (0.62 - 0.5) * dims[0] && p[0] < (0.78 - 0.5) * dims[0] && p[1] > 0.0
    );
    expect(inWindow.length).toBeGreaterThan(0);
  });

  it('arches the bays of an arcade and bolts timber knees on a bracketed one', () => {
    const withArcade = (arcade: 'arch' | 'bracket') => ({
      ...plan,
      look: { ...plan.look, timber: { material: 'wood' as const, color: '#5a3b26' } },
      volumes: plan.volumes.map((v, i) =>
        i === 1 ? { ...v, roof: 'flat' as const, ridge: 0.62, arcade } : v
      ),
    });
    const free = (p: HousePlan) => ({
      ...p,
      // A veranda standing out of the body: its own posts and beam.
      volumes: p.volumes.map((v, i) => (i === 1 ? { ...v, plan: [0, 0.4, 1, 1] as never } : v)),
    });
    const base = houseMesh(free(withArcade('arch')), dims);
    expect(count(base, 'timber')).toBeGreaterThan(0);
    const bracket = houseMesh(free(withArcade('bracket')), dims);
    expect(count(bracket, 'timber')).toBeGreaterThan(count(base, 'timber'));
  });

  it('raises a gallery on its slab: posts, beam and arches under the main eave', () => {
    const galleryPlan = HousePlanSchema.parse({
      ...plan,
      volumes: [
        {
          kind: 'body',
          plan: [0.1, 0.9, 0.1, 0.9],
          eave: 0.7,
          ridge: 1,
          roof: 'hip',
          ridgeAxis: 'x',
        },
        {
          kind: 'balcony',
          plan: [0, 1, 0.9, 1],
          eave: 0.7,
          ridge: 0.7,
          roof: 'none',
          ridgeAxis: 'x',
          open: ['front'],
          columns: 5,
          floor: 0.4,
          rail: true,
          arcade: 'arch',
        },
      ],
      openings: [],
      chimneys: [],
    });
    const trim = points(houseMesh(galleryPlan, dims), slot('trim'));
    // Posts stand on the slab (none reach the ground) up to the beam under the eave.
    expect(Math.min(...trim.map((p) => p[1]))).toBeGreaterThan(-dims[1] / 2 + 0.3 * dims[1]);
    expect(Math.max(...trim.map((p) => p[1]))).toBeGreaterThan((0.7 - 0.5) * dims[1] - 1e-6);
    // Out of the body's roof: a flat roof skirt covers it, past the body's overhang.
    const roofed = points(houseMesh(galleryPlan, dims), slot('roof'));
    expect(roofed.some((p) => p[2] > (0.9 - 0.5) * dims[2] + 0.04)).toBe(true);
    // The same balcony without posts stays a railed slab (PQ-T72).
    const bare = HousePlanSchema.parse({
      ...galleryPlan,
      volumes: galleryPlan.volumes.map((v, i) => (i === 1 ? { ...v, columns: 0 } : v)),
    });
    // No post and no beam in front of the facade above the rail.
    const front = (m: ReturnType<typeof houseMesh>) =>
      points(m, slot('trim')).filter(
        // Past the body's fascia (its overhang), above the balcony's rail.
        (p) => p[2] > (0.9 - 0.5) * dims[2] + 0.04 && p[1] > 0.05
      );
    expect(front(houseMesh(bare, dims))).toHaveLength(0);
    expect(front(houseMesh(galleryPlan, dims)).length).toBeGreaterThan(0);
  });

  it('keeps the posts of a side where only post bases stand', () => {
    const veranda = {
      ...plan,
      volumes: plan.volumes.map((v, i) => (i === 1 ? { ...v, plan: [0, 0.4, 1, 1] as never } : v)),
    };
    const base = count(houseMesh(veranda, dims), 'trim');
    const withBases = houseMesh(
      { ...veranda, piers: [{ plan: [0.1, 0.12, 0.98, 1], top: 0.1 }] },
      dims
    );
    expect(count(withBases, 'trim')).toBe(base);
    const withPier = houseMesh(
      { ...veranda, piers: [{ plan: [0.1, 0.14, 0.97, 1], top: 0.6 }] },
      dims
    );
    expect(count(withPier, 'trim')).toBeLessThan(base);
  });

  it('keeps posts in the trim colour until a timber finish is read', () => {
    expect(count(houseMesh(plan, dims), 'timber')).toBe(0);
  });

  it('frames both gable ends with a timber truss', () => {
    const gable = HousePlanSchema.parse({
      ...plan,
      look: { ...plan.look, timber: { material: 'wood', color: '#5a3b26' } },
      volumes: [
        {
          kind: 'body',
          plan: [0, 1, 0, 1],
          eave: 0.6,
          ridge: 1,
          roof: 'gable',
          ridgeAxis: 'z',
          truss: true,
        },
      ],
      openings: [],
    });
    const m = houseMesh(gable, dims);
    const pts = points(m, slot('timber'));
    expect(pts.some((p) => p[2] > dims[2] / 2)).toBe(true);
    expect(pts.some((p) => p[2] < -dims[2] / 2)).toBe(true);
  });

  it('gives a thatched roof a thick edge of thatch at its eaves and verges (PQ-T74)', () => {
    const gable = (material: 'thatch' | 'tile') =>
      HousePlanSchema.parse({
        ...plan,
        volumes: [
          { kind: 'body', plan: [0, 1, 0, 1], eave: 0.6, ridge: 1, roof: 'gable', ridgeAxis: 'x' },
        ],
        openings: [],
        chimneys: [],
        look: { ...look, roof: { material, color: '#8a7a5a' } },
      });
    const lowest = (m: ReturnType<typeof houseMesh>, s: number) =>
      Math.min(...points(m, s).map((p) => p[1]));
    const tiled = houseMesh(gable('tile'), dims);
    const thatched = houseMesh(gable('thatch'), dims);
    // The thatch itself hangs down by its thickness; a tiled roof ends on a thin trim fascia.
    const S = Math.max(...dims);
    expect(lowest(tiled, slot('roof')) - lowest(thatched, slot('roof'))).toBeCloseTo(
      THATCH_EDGE * S,
      5
    );
    expect(THATCH_EDGE).toBeGreaterThan(FASCIA * 2);
    // Eaves (2 quads) and verges (4 quads) more in the roof slot, none left in the trim.
    const count = (m: ReturnType<typeof houseMesh>, s: number) => points(m, s).length / 3;
    expect(count(thatched, slot('roof')) - count(tiled, slot('roof'))).toBe(12);
    expect(count(tiled, slot('trim')) - count(thatched, slot('trim'))).toBe(4);
  });

  it('builds a chimney of its own masonry in the stone slot (PQ-T74)', () => {
    const own = HousePlanSchema.parse({
      ...plan,
      chimneys: [{ ...plan.chimneys[0]!, finish: 'stone' }],
    });
    const count = (m: ReturnType<typeof houseMesh>, s: number) => points(m, s).length / 3;
    const [a, b] = [houseMesh(plan, dims), houseMesh(own, dims)];
    expect(count(a, slot('stone'))).toBe(0);
    // Shaft (5 faces) and cap (6 faces) leave the wall and the trim for the stone.
    expect(count(b, slot('stone'))).toBe(22);
    expect(count(a, slot('wall')) - count(b, slot('wall'))).toBe(10);
    expect(count(a, slot('trim')) - count(b, slot('trim'))).toBe(12);
  });

  it('clads the lower storey of a block in its own finish (PQ-T74)', () => {
    const split = HousePlanSchema.parse({
      ...plan,
      volumes: [{ ...plan.volumes[0]!, lower: { finish: 'wall2', top: 0.3 } }],
      openings: [],
      chimneys: [],
    });
    const m = houseMesh(split, dims);
    const lower = points(m, slot('wall2'));
    expect(lower.length).toBeGreaterThan(0);
    // The second cladding stops at the split height; the drawn wall starts there.
    const y = (0.3 - 0.5) * dims[1];
    expect(Math.max(...lower.map((p) => p[1]))).toBeCloseTo(y, 5);
    expect(Math.min(...points(m, slot('front')).map((p) => p[1]))).toBeCloseTo(y, 5);
  });

  it('cuts a gable wall level where its lower cladding ends (PQ-T74)', () => {
    // An A-frame: no eave wall, the gable ends rise from the ground to the ridge.
    const aframe = HousePlanSchema.parse({
      ...plan,
      volumes: [
        {
          kind: 'body',
          plan: [0, 1, 0, 1],
          eave: 0,
          ridge: 1,
          roof: 'gable',
          ridgeAxis: 'z',
          lower: { finish: 'wall2', top: 0.25 },
        },
      ],
      openings: [],
      chimneys: [],
    });
    const m = houseMesh(aframe, dims);
    const y = (0.25 - 0.5) * dims[1];
    const lower = points(m, slot('wall2'));
    expect(lower.length).toBeGreaterThan(0);
    expect(Math.max(...lower.map((p) => p[1]))).toBeCloseTo(y, 5);
    const upper = points(m, slot('front'));
    expect(Math.min(...upper.map((p) => p[1]))).toBeCloseTo(y, 5);
    expect(Math.max(...upper.map((p) => p[1]))).toBeCloseTo(dims[1] / 2, 5);
  });
});
