import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { silhouetteRings, type ObjectRecipe, type RecipePart } from '@/lib/object-shape';
import {
  EDGE_BEVEL,
  edgeBevel,
  EXTRUDE_BEVEL,
  recipeMesh,
  PRISM_BEVEL_MAX,
  ROOF_OVERHANG,
  roundedBox,
  roundProfile,
  SPHERE_SEGMENTS,
  silhouetteDepth,
  silhouetteMesh,
  silhouetteSize,
  triangleCount,
  unitExtrude,
  unitLathe,
  unitHip,
  unitHull,
  unitPrism,
} from '../utils/object-geometry';
import { SURFACE_LOOK } from '../utils/surface-look';

const box = { x: 0.2, y: 0.1, w: 0.4, h: 0.5 };
const fridge: ObjectRecipe = {
  proportions: { w: 0.5, h: 1, d: 0.5 },
  parts: [
    { shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', front: true },
    { shape: 'cylinder', axis: 'x', at: [0, 0.4, 0.5], size: [0.6, 0.04, 0.04], color: '#000000' },
  ],
};

const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe('recipeMesh (PV-T10)', () => {
  it('scales parts to the object proportions and keeps their colours', () => {
    const body = recipeMesh(fridge);
    const b = bounds(body);
    expect(b.max.y - b.min.y).toBeCloseTo(1);
    expect(b.max.x - b.min.x).toBeCloseTo(0.5);
    const colors = body.getAttribute('color');
    expect(colors.count).toBe(body.getAttribute('position').count);
    expect(colors.getX(0)).toBeCloseTo(1); // first part white
    expect(colors.getX(colors.count - 1)).toBeCloseTo(0); // handle black
  });

  it('regression (PR-1.1): a measured colour is converted to linear once, not twice', () => {
    // Before: `set(hex)` then `convertSRGBToLinear()` → stone #c8aa78 shown dark orange.
    const stone: ObjectRecipe = { ...fridge, parts: [{ ...fridge.parts[0]!, color: '#808080' }] };
    const colors = recipeMesh(stone).getAttribute('color');
    expect(colors.getX(0)).toBeCloseTo(new THREE.Color('#808080').r, 5);
    expect(colors.getX(0)).toBeCloseTo(0.2158, 3); // sRGB 0.5 → linear
  });

  it('turns a cylinder to its axis: the x-axis handle is long along x', () => {
    const handleOnly: ObjectRecipe = { ...fridge, parts: [fridge.parts[1]!] };
    const b = bounds(recipeMesh(handleOnly));
    expect(b.max.x - b.min.x).toBeCloseTo(0.3); // 0.6 × w 0.5
    expect(b.max.y - b.min.y).toBeCloseTo(0.04, 2);
  });

  it('regression (user): no photo on the model, only coloured parts', () => {
    // Before: the photo was projected on every front face (screenshot pasted on the 3D).
    const body = recipeMesh(fridge);
    expect(Object.keys(body.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
  });

  it('stays light: 12 round parts within 5 k triangles (PR-1.3)', () => {
    const many: ObjectRecipe = {
      ...fridge,
      parts: Array.from({ length: 12 }, () => ({
        shape: 'sphere' as const,
        at: [0, 0, 0] as [number, number, number],
        size: [0.5, 0.5, 0.5] as [number, number, number],
        color: '#808080',
      })),
    };
    expect(triangleCount(recipeMesh(many))).toBeLessThanOrEqual(5_000);
  });
});

describe('detail kinds (PQ-T20)', () => {
  it('every detail on a 12-part vehicle (4 wheels, 8 boxes) stays within the triangle budget', () => {
    const all = ['handle', 'seam', 'mirror', 'arch', 'rim', 'gutter', 'vent', 'foot'] as const;
    const heavy: ObjectRecipe = {
      ...fridge,
      parts: Array.from({ length: 12 }, (_, i) => ({
        shape: i < 4 ? ('cylinder' as const) : ('box' as const),
        axis: 'x' as const,
        kind: i < 4 ? ('wheel' as const) : ('body' as const),
        at: [((i % 5) - 2) * 0.1, ((i % 7) - 3) * 0.1, 0] as [number, number, number],
        size: [0.2, 0.2, 0.2] as [number, number, number],
        color: '#808080',
        details: [...all],
      })),
    };
    expect(triangleCount(recipeMesh(heavy))).toBeLessThanOrEqual(5_000);
  });

  it('a fridge with handle and seam builds taller in triangles than the plain one, bounds kept', () => {
    const plain = recipeMesh(fridge);
    const detailed = recipeMesh({
      ...fridge,
      parts: [{ ...fridge.parts[0]!, details: ['handle', 'seam'] }],
    });
    expect(triangleCount(detailed)).toBeGreaterThan(
      triangleCount(recipeMesh({ ...fridge, parts: [fridge.parts[0]!] }))
    );
    expect(plain.getAttribute('position').count).toBeGreaterThan(0);
    const b = bounds(detailed);
    expect(b.max.y - b.min.y).toBeCloseTo(1, 1);
  });
});

describe('roundedBox (PR-1.2)', () => {
  it('keeps the exact size, rounds the corners, smooth normals there', () => {
    const g = roundedBox(1, 0.5, 0.4, 0.04);
    const b = bounds(g);
    expect(b.max.x - b.min.x).toBeCloseTo(1);
    expect(b.max.y - b.min.y).toBeCloseTo(0.5);
    expect(b.max.z - b.min.z).toBeCloseTo(0.4);
    // A corner point is cut off: no vertex at (0.5, 0.25, 0.2).
    const pos = g.getAttribute('position');
    let atCorner = false;
    const normals = new Set<string>();
    const n = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i) - 0.5, pos.getY(i) - 0.25, pos.getZ(i) - 0.2) < 1e-4)
        atCorner = true;
      normals.add(`${n.getX(i).toFixed(2)},${n.getY(i).toFixed(2)},${n.getZ(i).toFixed(2)}`);
    }
    expect(atCorner).toBe(false);
    expect(normals.size).toBeGreaterThan(6); // more than the 6 face normals of a sharp box
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });

  it('radius ≤ ¼ of the thinnest side; negligible radius → plain 12-triangle box', () => {
    const thin = roundedBox(1, 1, 0.02, 0.04);
    expect(bounds(thin).max.z - bounds(thin).min.z).toBeCloseTo(0.02);
    expect(triangleCount(roundedBox(1, 1, 1, 0.001))).toBe(12);
  });

  it('a metal box is rounder than a stone one (radius by material)', () => {
    const part = (material: 'metal' | 'stone'): ObjectRecipe => ({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#808080', material }],
    });
    // Distance of the vertex nearest to the sharp corner grows with the radius.
    const cornerGap = (g: THREE.BufferGeometry) => {
      const pos = g.getAttribute('position');
      let best = Infinity;
      for (let i = 0; i < pos.count; i++)
        best = Math.min(best, Math.hypot(pos.getX(i) - 0.5, pos.getY(i) - 0.5, pos.getZ(i) - 0.5));
      return best;
    };
    expect(cornerGap(recipeMesh(part('metal')))).toBeGreaterThan(
      cornerGap(recipeMesh(part('stone')))
    );
  });

  it('budget: 12 rounded boxes stay under 5 k triangles', () => {
    const boxes: ObjectRecipe = {
      ...fridge,
      parts: Array.from({ length: 12 }, () => ({
        shape: 'box' as const,
        at: [0, 0, 0] as [number, number, number],
        size: [0.5, 0.5, 0.5] as [number, number, number],
        color: '#808080',
        material: 'metal' as const,
      })),
    };
    expect(triangleCount(recipeMesh(boxes))).toBeLessThanOrEqual(5_000);
  });
});

describe('silhouetteMesh (fallback)', () => {
  it('sizes the object from the box on the photo, largest side = 1', () => {
    expect(silhouetteSize({ x: 0, y: 0, w: 0.5, h: 0.5 }, 2)).toEqual([1, 0.5]);
    expect(silhouetteSize({ x: 0, y: 0, w: 0.2, h: 0.8 }, 1)).toEqual([0.25, 1]);
  });

  it('extrudes the outline by the category depth, no photo cap', () => {
    const rings = silhouetteRings({ box });
    const tv = silhouetteMesh(rings, box, 1, silhouetteDepth({ category: 'tv' }));
    const fr = silhouetteMesh(rings, box, 1, silhouetteDepth({ category: 'fridge' }));
    const depth = (g: THREE.BufferGeometry) => bounds(g).max.z - bounds(g).min.z;
    expect(depth(tv)).toBeLessThan(depth(fr));
    expect(bounds(fr).max.x - bounds(fr).min.x).toBeCloseTo(0.8);
  });

  it('scenery uses its own depth (a house is deep, water flat), not the `other` category', () => {
    expect(silhouetteDepth({ category: 'other', scenery: 'building' })).toBe(0.8);
    expect(silhouetteDepth({ category: 'other', scenery: 'water' })).toBe(0.1);
    expect(silhouetteDepth({ category: 'other' })).toBe(0.3);
  });

  it('builds nothing from no ring (no throw)', () => {
    const empty = silhouetteMesh([], box, 1, 0.3);
    expect(triangleCount(empty)).toBe(0);
  });
});

describe('unitPrism (PF-T3)', () => {
  it('fills the unit box with the ridge at the apex, front face turned to the camera', () => {
    const g = unitPrism(0.25);
    const b = bounds(g);
    expect(b.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(b.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    const pos = g.getAttribute('position');
    const top = Array.from({ length: pos.count }, (_, i) => i).filter((i) => pos.getY(i) === 0.5);
    for (const i of top) expect(pos.getX(i)).toBe(-0.25);
    expect(triangleCount(g)).toBe(8);
  });

  it('merges with the other primitives in a recipe (gable roof on walls)', () => {
    const house: ObjectRecipe = {
      proportions: { w: 1, h: 0.8, d: 0.6 },
      parts: [
        { shape: 'box', at: [0, -0.25, 0], size: [1, 0.5, 1], color: '#c9a36a', front: true },
        { shape: 'prism', at: [0, 0.25, 0], size: [1, 0.5, 1], color: '#6e6a62', apex: 0.5 },
      ],
    };
    const body = recipeMesh(house);
    // Rounded walls (PR-1.2: 300 triangles) + the bevelled prism (PT-1c: 2 caps, 3 sides, 6 bevel quads).
    expect(body.getAttribute('position').count).toBe(3 * (2 * 6 * 25 + 20));
    expect(bounds(body).max.y).toBeCloseTo(0.4, 6);
  });

  it('a gable roof overhangs the walls on every side, the ridge stays at its height (PR-1.3)', () => {
    const roof: ObjectRecipe = {
      proportions: { w: 1, h: 0.8, d: 0.6 },
      parts: [{ shape: 'prism', at: [0, 0.25, 0], size: [1, 0.5, 1], color: '#6e6a62' }],
    };
    const b = bounds(recipeMesh(roof));
    expect(b.max.x - b.min.x).toBeCloseTo(1 + 2 * ROOF_OVERHANG, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(0.6 + 2 * ROOF_OVERHANG, 6);
    expect(b.max.y).toBeCloseTo(0.4, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(0.4, 6);
  });
});

describe('roof overhang option (PQ-T43)', () => {
  const roof = (shape: 'prism' | 'hip', over?: Partial<RecipePart>): ObjectRecipe => ({
    proportions: { w: 1, h: 0.8, d: 0.6 },
    parts: [
      {
        shape,
        at: [0, 0.25, 0],
        size: [1, 0.5, 1],
        color: '#6e6a62',
        kind: 'roof',
        ...(over ?? {}),
      },
    ],
  });

  it('explicit overhang grows prisms and hips past the legacy eave', () => {
    for (const shape of ['prism', 'hip'] as const) {
      const b = bounds(recipeMesh(roof(shape, { overhang: 0.05 })));
      expect(b.max.x - b.min.x).toBeCloseTo(1 + 0.1, 6);
      expect(b.max.z - b.min.z).toBeCloseTo(0.6 + 0.1, 6);
    }
  });

  it('legacy hips stay flush while legacy prisms keep the 0.03 eave', () => {
    const hip = bounds(recipeMesh(roof('hip')));
    expect(hip.max.x - hip.min.x).toBeCloseTo(1, 6);
    expect(hip.max.z - hip.min.z).toBeCloseTo(0.6, 6);
    const prism = bounds(recipeMesh(roof('prism')));
    expect(prism.max.x - prism.min.x).toBeCloseTo(1 + 2 * ROOF_OVERHANG, 6);
  });

  it('overhang 0 keeps gable ends flush with the walls', () => {
    const b = bounds(recipeMesh(roof('prism', { overhang: 0 })));
    expect(b.max.x - b.min.x).toBeCloseTo(1, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(0.6, 6);
  });
});

describe('unitHip (2D facade house)', () => {
  const topX = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute('position');
    return Array.from({ length: pos.count }, (_, i) => i)
      .filter((i) => pos.getY(i) === 0.5)
      .map((i) => pos.getX(i));
  };

  it('fills the unit box, ridge along x of the given share, every face turned outwards', () => {
    const g = unitHip(0.6);
    const b = bounds(g);
    expect(b.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(b.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    const xs = topX(g);
    expect(Math.min(...xs)).toBeCloseTo(-0.3, 6);
    expect(Math.max(...xs)).toBeCloseTo(0.3, 6);
    expect(triangleCount(g)).toBe(8);
    // Each face normal points away from the centre (CCW winding seen from outside).
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    for (let t = 0; t < pos.count; t += 3) {
      const c = new THREE.Vector3();
      for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(pos, t + k));
      c.divideScalar(3);
      expect(c.dot(new THREE.Vector3().fromBufferAttribute(nrm, t))).toBeGreaterThan(0);
    }
  });

  it('ridge 0 is a pyramid, ridge 1 a side gable (front reads as a rectangle)', () => {
    expect(new Set(topX(unitHip(0)))).toEqual(new Set([0]));
    const xs = topX(unitHip(1));
    expect(Math.min(...xs)).toBe(-0.5);
    expect(Math.max(...xs)).toBe(0.5);
  });

  it('half-hip (PG-T22): vertical gable ends up to the clip, hip above, faces outwards', () => {
    const g = unitHip(0.8, 0.6);
    const b = bounds(g);
    expect(b.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
    expect(b.max.toArray()).toEqual([0.5, 0.5, 0.5]);
    // 2 slopes × 4 + 2 hip ends + 2 gable quads × 2 + bottom 2.
    expect(triangleCount(g)).toBe(16);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    let gableTop = -Infinity;
    for (let t = 0; t < pos.count; t += 3) {
      const c = new THREE.Vector3();
      for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(pos, t + k));
      c.divideScalar(3);
      const n = new THREE.Vector3().fromBufferAttribute(nrm, t);
      expect(c.dot(n)).toBeGreaterThan(0);
      if (Math.abs(n.x) > 0.999)
        for (let k = 0; k < 3; k++) gableTop = Math.max(gableTop, pos.getY(t + k));
    }
    expect(gableTop).toBeCloseTo(0.1, 6);
    // No clip: the plain hip, collapsed gable faces dropped.
    expect(triangleCount(unitHip(0.8, 0))).toBe(8);
  });

  it('builds in a recipe with no overhang added (the facade measured it)', () => {
    const roof: ObjectRecipe = {
      proportions: { w: 1, h: 0.8, d: 0.6 },
      parts: [{ shape: 'hip', ridge: 0.5, at: [0, 0.25, 0], size: [1, 0.5, 1], color: '#6e6a62' }],
    };
    const b = bounds(recipeMesh(roof));
    expect(b.max.x - b.min.x).toBeCloseTo(1, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(0.6, 6);
  });
});

describe('round parts (PR-1.3)', () => {
  const one = (shape: 'sphere' | 'cylinder' | 'cone'): ObjectRecipe => ({
    proportions: { w: 1, h: 1, d: 1 },
    parts: [{ shape, at: [0, 0, 0], size: [1, 1, 1], color: '#808080' }],
  });
  /** Distinct normals on the curved surface (y ≈ 0 band of the side): many = smooth, few = facets. */
  const sideNormals = (g: THREE.BufferGeometry) => {
    const pos = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const set = new Set<string>();
    for (let i = 0; i < pos.count; i++)
      if (Math.abs(n.getY(i)) < 0.9) set.add(`${n.getX(i).toFixed(3)},${n.getZ(i).toFixed(3)}`);
    return set.size;
  };
  // Smooth shading: one normal per vertex column, not per face (flat would repeat each face normal).
  it.each(['sphere', 'cylinder', 'cone'] as const)('%s is smooth-shaded', (shape) => {
    const g = recipeMesh(one(shape));
    const pos = g.getAttribute('position');
    const n = g.getAttribute('normal');
    // On a smooth surface the normal points away from the axis through the vertex.
    let aligned = 0;
    let side = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      if (r < 0.2 || Math.abs(n.getY(i)) > 0.9) continue;
      side++;
      const cos =
        (pos.getX(i) * n.getX(i) + pos.getZ(i) * n.getZ(i)) /
        (r * Math.hypot(n.getX(i), n.getZ(i)));
      if (cos > 0.999) aligned++;
    }
    expect(aligned / side).toBeGreaterThan(0.99);
    expect(sideNormals(g)).toBeGreaterThanOrEqual(SPHERE_SEGMENTS[0]);
  });
});

describe('recipeMesh with a yaw (PF-T5)', () => {
  const block: ObjectRecipe = {
    proportions: { w: 1, h: 0.6, d: 0.5 },
    parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#cccccc', front: true }],
  };

  it('turns the model like on the photo: the side shows, the box seen wider', () => {
    const straight = bounds(recipeMesh(block));
    const turned = bounds(recipeMesh({ ...block, yaw: Math.PI / 6 }));
    expect(straight.max.x - straight.min.x).toBeCloseTo(1, 6);
    // Sharp box: w·cos 30° + d·sin 30°; rounded corners (PR-1.2) take 2r off each side, add 2r back.
    const r = SURFACE_LOOK.painted.radius;
    const expected = (1 - 2 * r) * Math.cos(Math.PI / 6) + (0.5 - 2 * r) * 0.5 + 2 * r;
    expect(turned.max.x - turned.min.x).toBeCloseTo(expected, 3);
  });
});

describe('unitExtrude (PR-2.1)', () => {
  const square: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];

  it('is centred, 1 deep, and merges into a recipe', () => {
    const g = unitExtrude(square);
    expect(g.index).toBeNull();
    const bb = bounds(g);
    expect(bb.min.z).toBeCloseTo(-0.5, 2);
    expect(bb.max.z).toBeCloseTo(0.5, 2);
    // The bevel reaches slightly past the ring on the profile plane.
    expect(bb.min.x).toBeGreaterThanOrEqual(-0.5 - EXTRUDE_BEVEL - 1e-3);
    expect(bb.max.x).toBeLessThanOrEqual(0.5 + EXTRUDE_BEVEL + 1e-3);
    const body = recipeMesh({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [
        { shape: 'extrude', at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', points: square },
      ],
    });
    expect(body.getAttribute('position').count).toBe(g.getAttribute('position').count);
    expect(body.getAttribute('color').count).toBe(g.getAttribute('position').count);
  });

  it('either winding builds the same mesh; a 64-gon stays light', () => {
    const ring = Array.from({ length: 64 }, (_, i) => {
      const a = (2 * Math.PI * i) / 64;
      return [0.5 * Math.cos(a), 0.5 * Math.sin(a)] as [number, number];
    });
    expect(triangleCount(unitExtrude([...ring].reverse()))).toBe(triangleCount(unitExtrude(ring)));
    expect(triangleCount(unitExtrude(ring))).toBeLessThan(1000);
  });
});

describe('unitLathe (PR-2.3)', () => {
  const tube: [number, number][] = [
    [0, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [0, 0.5],
  ];

  it('spans the profile with outward normals and merges into a recipe', () => {
    const g = unitLathe(tube);
    expect(g.index).toBeNull();
    const bb = bounds(g);
    expect(bb.min.x).toBeCloseTo(-0.5, 2);
    expect(bb.max.x).toBeCloseTo(0.5, 2);
    expect(bb.min.y).toBeCloseTo(-0.5, 6);
    expect(bb.max.y).toBeCloseTo(0.5, 6);
    // A side vertex faces outward (not into the tube).
    const mid = unitLathe([
      [0, -0.5],
      [0.5, -0.5],
      [0.5, 0],
      [0.5, 0.5],
      [0, 0.5],
    ]);
    const pos = mid.getAttribute('position');
    const nrm = mid.getAttribute('normal');
    let outward = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (Math.abs(y) < 0.01 && r > 0.4) {
        const dot = (nrm.getX(i) * x + nrm.getZ(i) * z) / r;
        expect(dot).toBeGreaterThan(0.5);
        outward++;
      }
    }
    expect(outward).toBeGreaterThan(0);
    const body = recipeMesh({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [{ shape: 'lathe', at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff', profile: tube }],
    });
    expect(body.getAttribute('position').count).toBe(g.getAttribute('position').count);
  });

  it('a 32-point barrel stays light', () => {
    const barrel = Array.from({ length: 32 }, (_, i) => {
      const y = -0.5 + i / 31;
      return [0.5 * (0.9 + 0.1 * Math.cos(y * Math.PI)), y] as [number, number];
    });
    expect(triangleCount(unitLathe(barrel))).toBeLessThan(2000);
  });
});

describe('unitHull (PV-H)', () => {
  const square: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const roof: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.1],
    [0, 0.5],
    [-0.5, 0.1],
  ];

  it('fills the unit box, closed, under the triangle budget', () => {
    const g = unitHull(roof, square);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.x).toBeCloseTo(-0.5, 2);
    expect(b.max.y).toBeCloseTo(0.5, 2);
    expect(b.max.z).toBeCloseTo(0.5, 2);
    expect(g.getAttribute('position').count / 3).toBeLessThan(2500);
  });

  it('normals point out (right side +x, front cap +z)', () => {
    const g = unitHull(square, square);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      if (x > 0.49 && Math.abs(y) < 0.3 && Math.abs(z) < 0.3)
        expect(nor.getX(i)).toBeGreaterThan(0);
      if (z > 0.49 && Math.abs(x) < 0.3 && Math.abs(y) < 0.3)
        expect(nor.getZ(i)).toBeGreaterThan(0);
    }
  });

  it('a recipe with a hull body builds a mesh', () => {
    const mesh = recipeMesh({
      proportions: { w: 0.5, h: 0.4, d: 1 },
      parts: [
        {
          shape: 'hull',
          at: [0, 0, 0],
          size: [1, 1, 1],
          points: roof,
          section: square,
          color: '#5a4aca',
        },
      ],
    });
    expect(triangleCount(mesh)).toBeGreaterThan(100);
  });
});

describe('hull soft edges (PT-1a)', () => {
  const square: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const bevel = [0.04, 0.04, 0.04] as const;
  const box = (g: THREE.BufferGeometry) => {
    g.computeBoundingBox();
    return g.boundingBox!;
  };

  it('keeps the bounds and costs 4 × n triangles', () => {
    const sharp = unitHull(square, square);
    const soft = unitHull(square, square, undefined, undefined, bevel);
    const [a, b] = [box(sharp), box(soft)];
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b.min[k] - a.min[k])).toBeLessThan(1e-6);
      expect(Math.abs(b.max[k] - a.max[k])).toBeLessThan(1e-6);
    }
    const n = 2 * 14; // 2 × HULL_LEVELS points per loop
    expect(triangleCount(soft) - triangleCount(sharp)).toBe(4 * n);
  });

  it('turns the edge normals toward the cap (< 60° on the bevel ring)', () => {
    const g = unitHull(square, square, undefined, undefined, bevel);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const zMax = box(g).max.z;
    let ring = 0;
    for (let i = 0; i < pos.count; i++) {
      // Front plane vertices on the outline (cap fans excluded: they are flat already).
      if (pos.getZ(i) < zMax - 1e-6 || Math.abs(nor.getZ(i)) > 0.999) continue;
      ring++;
      expect(nor.getZ(i)).toBeGreaterThan(Math.cos(Math.PI / 3));
    }
    expect(ring).toBeGreaterThan(0);
  });

  it('bevel size: share of the smallest side, capped by the surface radius', () => {
    expect(edgeBevel(1, 0.2, 0.5, 1)).toBeCloseTo(EDGE_BEVEL * 0.2);
    expect(edgeBevel(1, 1, 1, 0.01)).toBe(0.01);
  });

  it('a hull body gets the bevel, a skin patch keeps sharp edges', () => {
    const recipe = (front: boolean): ObjectRecipe => ({
      proportions: { w: 1, h: 1, d: 1 },
      parts: [
        {
          shape: 'hull',
          at: [0, 0, 0],
          size: [1, 1, 1],
          points: square,
          section: square,
          color: '#5a4aca',
          material: 'metal',
          ...(front ? { front: true } : {}),
        },
      ],
    });
    const body = recipeMesh(recipe(true));
    const bb = box(body);
    expect(bb.max.x - bb.min.x).toBeCloseTo(1, 2);
    expect(bb.max.z - bb.min.z).toBeCloseTo(1, 2);
    const patch = recipeMesh(recipe(false));
    const sharpPatch = unitHull(square, square, 8, 6);
    expect(triangleCount(patch)).toBe(triangleCount(sharpPatch));
  });
});

describe('cylinder / cone soft rims (PT-1b)', () => {
  const part = (shape: 'cylinder' | 'cone', axis?: 'x' | 'z'): ObjectRecipe => ({
    proportions: { w: 1, h: 1, d: 1 },
    parts: [
      {
        shape,
        at: [0, 0, 0],
        size: [0.4, 0.8, 0.4],
        color: '#808080',
        material: 'metal',
        ...(axis ? { axis } : {}),
      },
    ],
  });
  const sharp = {
    cylinder: new THREE.CylinderGeometry(0.2, 0.2, 0.8, 24),
    cone: new THREE.ConeGeometry(0.2, 0.8, 24),
  };

  it.each(['cylinder', 'cone'] as const)('%s keeps its bounds', (shape) => {
    const [a, b] = [bounds(sharp[shape]), bounds(recipeMesh(part(shape)))];
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b.min[k] - a.min[k])).toBeLessThan(1e-6);
      expect(Math.abs(b.max[k] - a.max[k])).toBeLessThan(1e-6);
    }
  });

  it.each(['cylinder', 'cone'] as const)('%s rim normals lean toward the cap (< 60°)', (shape) => {
    const g = recipeMesh(part(shape));
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    let ring = 0;
    for (let i = 0; i < pos.count; i++) {
      // Bottom rim ring: on the base plane, off the flat cap.
      if (pos.getY(i) > -0.4 + 1e-6 || Math.abs(nor.getY(i)) > 0.999) continue;
      ring++;
      expect(-nor.getY(i)).toBeGreaterThan(Math.cos(Math.PI / 3));
    }
    expect(ring).toBeGreaterThan(0);
  });

  it('a wheel on the x axis keeps its turned bounds', () => {
    const b = bounds(recipeMesh(part('cylinder', 'x')));
    expect(b.max.x - b.min.x).toBeCloseTo(0.4, 6);
    expect(b.max.y - b.min.y).toBeCloseTo(0.8, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(0.4, 6);
  });

  it('profile: radius 0.5 kept, apex sharp, cut capped at a quarter', () => {
    expect(Math.max(...roundProfile('cylinder', 0.1, 0.1).map(([r]) => r))).toBe(0.5);
    expect(roundProfile('cone', 0.1, 0.1).at(-1)).toEqual([0, 0.5]);
    expect(roundProfile('cylinder', 9, 9)[1]).toEqual([0.25, -0.5]);
  });
});

describe('silhouette soft edges (PT-1d)', () => {
  const rings = silhouetteRings({ box });
  const flatBody = (depth: number) => {
    const [w, h] = silhouetteSize(box, 1);
    const shapes = rings.map(
      (r) => new THREE.Shape(r.map(([u, v]) => new THREE.Vector2((u - 0.5) * w, (0.5 - v) * h)))
    );
    const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return g;
  };

  it.each([0.1, 0.3, 0.8])('keeps the bounds at depth share %s', (share) => {
    const soft = silhouetteMesh(rings, box, 1, share);
    const [w, h] = silhouetteSize(box, 1);
    const [a, b] = [bounds(flatBody(share * Math.max(w, h))), bounds(soft)];
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b.min[k] - a.min[k])).toBeLessThan(1e-6);
      expect(Math.abs(b.max[k] - a.max[k])).toBeLessThan(1e-6);
    }
  });

  it('turns the outline normals toward the face (< 60° on the bevel ring)', () => {
    const g = silhouetteMesh(rings, box, 1, 0.3);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const zMax = bounds(g).max.z;
    let ring = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < zMax - 1e-6 || Math.abs(nor.getZ(i)) > 0.999) continue;
      ring++;
      expect(nor.getZ(i)).toBeGreaterThan(Math.cos(Math.PI / 3));
    }
    expect(ring).toBeGreaterThan(0);
  });
});

describe('prism soft edges (PT-1c)', () => {
  const bevel = [0.04, 0.04, 0.04] as const;

  it.each([0, 0.25, 0.5, 1])('apex %s keeps the unit bounds and the ridge', (apex) => {
    const [a, b] = [bounds(unitPrism(apex)), bounds(unitPrism(apex, bevel))];
    for (const k of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b.min[k] - a.min[k])).toBeLessThan(1e-6);
      expect(Math.abs(b.max[k] - a.max[k])).toBeLessThan(1e-6);
    }
    const g = unitPrism(apex, bevel);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++)
      if (Math.abs(pos.getY(i) - 0.5) < 1e-6) expect(pos.getX(i)).toBeCloseTo(apex - 0.5, 6);
  });

  it('turns the gable edge normals toward the gable (< 60° on the bevel ring)', () => {
    const g = unitPrism(0.5, bevel);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    let ring = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < 0.5 - 1e-6 || Math.abs(nor.getZ(i)) > 0.999) continue;
      ring++;
      expect(nor.getZ(i)).toBeGreaterThan(Math.cos(Math.PI / 3));
    }
    expect(ring).toBeGreaterThan(0);
  });

  it('a huge bevel is capped so the cap never flips', () => {
    const g = unitPrism(0.5, [1, 1, 1]);
    const b = bounds(g);
    expect(b.max.x - b.min.x).toBeCloseTo(1, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(1, 6);
    expect(PRISM_BEVEL_MAX).toBeLessThan(0.3);
  });
});
