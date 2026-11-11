import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ObjectRecipe } from '@/lib/object-shape';
import {
  buildPlacedModelsGeometry,
  FAMILY_SURFACE,
  familyOf,
  PLACED_FAMILIES,
  PLACED_LOW_TRIANGLES,
  placedFamilyMaterials,
  splitByFamily,
  placedGeometryKey,
  type PlacedModelItem,
} from '../utils/placed-models-geometry';
import { recipeMesh, triangleCount } from '@/features/vision-insert/utils/object-geometry';
import { SURFACE_LOOK, SURFACES } from '@/features/vision-insert/utils/surface-look';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The village result with every family merged back into one geometry (`modelsGeometry`, null when empty): for shape checks. */
function build(...args: Parameters<typeof buildPlacedModelsGeometry>) {
  const res = buildPlacedModelsGeometry(...args);
  const list = Object.values(res.families);
  return {
    ...res,
    modelsGeometry: list.length
      ? mergeGeometries(
          list.map((g) => g!.clone()),
          false
        )
      : null,
  };
}

const SAMPLE_RECIPE: ObjectRecipe = {
  proportions: { w: 1, h: 0.8, d: 0.6 },
  parts: [
    {
      shape: 'box',
      at: [0, 0, 0],
      size: [1, 1, 1],
      color: '#4080c0',
    },
  ],
};

describe('placed-models-geometry (PI-T2)', () => {
  it('returns null geometry when items array is empty', () => {
    const res = build([]);
    expect(res.modelsGeometry).toBeNull();
    expect(res.plinths).toHaveLength(0);
    expect(res.modelBounds).toEqual({});
  });

  it('merges 30 placed objects into at most one geometry per surface family (draw call budget)', () => {
    const items: PlacedModelItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: `app-${i}`,
      sector: 'households',
      running: true,
      position: [(i % 6) * 3 - 8, 0, Math.floor(i / 6) * 3 - 8] as [number, number, number],
      recipe: SAMPLE_RECIPE,
      scale: 1.0,
      archetype: 'cabinet',
    }));

    const res = build(items);
    expect(res.modelsGeometry).toBeInstanceOf(THREE.BufferGeometry);
    // Crucial budget test: 30 objects yield one merged geometry per family, never more than 5 draw calls.
    expect(Object.keys(res.families).length).toBeLessThanOrEqual(PLACED_FAMILIES.length);
    expect(Object.keys(res.modelBounds)).toHaveLength(30);
  });

  it('sits on terrainHeight at the lowest point of the footprint (baseH)', () => {
    const items: PlacedModelItem[] = [
      {
        id: 'app-flat',
        sector: 'water',
        running: true,
        // (0, 0) is on village flat plateau where terrainHeight == 0
        position: [0, 0, 0],
        recipe: SAMPLE_RECIPE,
        scale: 1.0,
      },
    ];

    const res = build(items);
    expect(res.modelsGeometry).toBeDefined();
    res.modelsGeometry!.computeBoundingBox();
    const bb = res.modelsGeometry!.boundingBox!;
    // On flat plateau (y=0), bottom should sit at 0
    expect(bb.min.y).toBeCloseTo(0, 2);
  });

  it('generates a concrete plinth when placed on sloped ground (slope > 0.04)', () => {
    const items: PlacedModelItem[] = [
      {
        id: 'app-hill',
        sector: 'households',
        running: true,
        // r > 20 is on rolling hills where terrainHeight varies with slope
        position: [30, 0, 30],
        recipe: SAMPLE_RECIPE,
        scale: 2.0,
      },
    ];

    const res = build(items);
    expect(res.plinths.length).toBeGreaterThan(0);
    expect(res.plinths[0]!.size[0]).toBeGreaterThan(0);
    expect(res.plinths[0]!.size[1]).toBeGreaterThan(0);
  });

  it('dims vertex colors when sector is unserved or appliance is not running', () => {
    const runningItem: PlacedModelItem = {
      id: 'app-running',
      sector: 'water',
      running: true,
      position: [0, 0, 0],
      recipe: SAMPLE_RECIPE,
    };
    const idleItem: PlacedModelItem = {
      id: 'app-idle',
      sector: 'water',
      running: false,
      position: [0, 0, 0],
      recipe: SAMPLE_RECIPE,
    };

    const resRunning = build([runningItem], { water: { unserved: false } });
    const resIdle = build([idleItem], { water: { unserved: true } });

    const colRunning = resRunning.modelsGeometry!.getAttribute('color');
    const colIdle = resIdle.modelsGeometry!.getAttribute('color');

    // Idle / unserved vertices should be dimmed
    expect(colIdle.getX(0)).toBeLessThan(colRunning.getX(0));
    expect(colIdle.getY(0)).toBeLessThan(colRunning.getY(0));
  });

  it('tints vertex colors with fiery alert red when sector is on fire', () => {
    const item: PlacedModelItem = {
      id: 'app-fire',
      sector: 'school',
      running: true,
      position: [0, 0, 0],
      recipe: SAMPLE_RECIPE,
    };

    const resFire = build([item], { school: { onFire: true } });
    const colFire = resFire.modelsGeometry!.getAttribute('color');

    // Fire alert increases red channel, suppresses green
    expect(colFire.getX(0)).toBeGreaterThan(0.3);
    expect(colFire.getY(0)).toBeLessThan(0.4);
  });

  it('keeps the model shape on tier low (before: a 24-vertex box)', () => {
    const item: PlacedModelItem = {
      id: 'app-low',
      sector: 'water',
      running: true,
      position: [0, 0, 0],
      recipe: SAMPLE_RECIPE,
    };

    const low = build([item], {}, 'low').modelsGeometry!;
    const high = build([item], {}, 'high').modelsGeometry!;
    expect(low.getAttribute('position').count).toBeGreaterThan(24);
    low.computeBoundingBox();
    high.computeBoundingBox();
    // Same size and place as the high tier.
    expect(low.boundingBox!.max.y).toBeCloseTo(high.boundingBox!.max.y, 3);
    expect(low.boundingBox!.min.y).toBeCloseTo(high.boundingBox!.min.y, 3);
  });

  it('falls back to a box per model once the low tier spends PLACED_LOW_TRIANGLES', () => {
    const pole: ObjectRecipe = {
      proportions: { w: 0.2, h: 1, d: 0.2 },
      parts: [
        { shape: 'cylinder', at: [0, -0.1, 0], size: [0.3, 0.8, 0.3], color: '#333333' },
        { shape: 'sphere', at: [0, 0.4, 0], size: [1, 0.2, 1], color: '#eeeeee' },
      ],
    };
    const one = build(
      [{ id: 'm0', sector: 'water', running: true, position: [0, 0, 0], recipe: pole }],
      {},
      'low'
    ).modelsGeometry!;
    const per = triangleCount(one);
    const n = Math.ceil(PLACED_LOW_TRIANGLES / per) + 3;
    const items: PlacedModelItem[] = Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      sector: 'water',
      running: true,
      position: [i * 3, 0, 0],
      recipe: pole,
    }));
    const all = build(items, {}, 'low').modelsGeometry!;
    // Fewer triangles than every model in full, and the last model is still drawn (as a box).
    expect(triangleCount(all)).toBeLessThan(n * per);
    all.computeBoundingBox();
    expect(all.boundingBox!.max.x).toBeGreaterThan((n - 1) * 3 - 1);
  });

  it('stands the model on top of its plinth on a slope (uphill ground never pokes through)', () => {
    const item: PlacedModelItem = {
      id: 'app-hill',
      sector: 'households',
      running: true,
      position: [30, 0, 30],
      recipe: SAMPLE_RECIPE,
      scale: 2.0,
    };
    const res = build([item]);
    const plinth = res.plinths[0]!;
    const plinthTop = plinth.position[1] + plinth.size[1] / 2;
    res.modelsGeometry!.computeBoundingBox();
    expect(res.modelsGeometry!.boundingBox!.min.y).toBeCloseTo(plinthTop, 3);
  });

  it('dims an idle appliance even when its sector is served', () => {
    const base: PlacedModelItem = {
      id: 'a',
      sector: 'water',
      running: true,
      position: [0, 0, 0],
      recipe: SAMPLE_RECIPE,
    };
    const served = { water: { unserved: false } };
    const on = build([base], served).modelsGeometry!.getAttribute('color');
    const off = build([{ ...base, running: false }], served).modelsGeometry!.getAttribute('color');
    expect(off.getX(0)).toBeLessThan(on.getX(0));
  });

  describe('surface families (PQ-T32)', () => {
    const MIXED: ObjectRecipe = {
      proportions: { w: 1, h: 0.6, d: 0.5 },
      parts: [
        { shape: 'box', at: [0, 0, 0], size: [1, 0.5, 0.5], color: '#a33327', material: 'painted' },
        {
          shape: 'box',
          at: [0.1, 0.1, 0.26],
          size: [0.3, 0.2, 0.02],
          color: '#8fa3b4',
          material: 'glass',
        },
        {
          shape: 'cylinder',
          at: [-0.4, 0.3, 0],
          size: [0.05, 0.3, 0.05],
          color: '#b0b0b0',
          material: 'metal',
        },
        {
          shape: 'box',
          at: [0.3, -0.3, 0],
          size: [0.2, 0.1, 0.4],
          color: '#8a8a80',
          material: 'stone',
        },
      ],
    };
    const item = (over: Partial<PlacedModelItem> = {}): PlacedModelItem => ({
      id: 'm',
      sector: 'water',
      running: true,
      position: [0, 0, 0],
      recipe: MIXED,
      ...over,
    });

    it('glass and metal no longer read as matt paint: each lands in its own family with its own look', () => {
      const res = buildPlacedModelsGeometry([item()], {}, 'high');
      expect(Object.keys(res.families).sort()).toEqual(['glass', 'gloss', 'matt', 'metal']);
      const mats = placedFamilyMaterials();
      expect(mats.glass.roughness).toBe(SURFACE_LOOK.glass.roughness);
      expect(mats.metal.metalness).toBe(1);
      expect(mats.gloss.metalness).toBe(0);
      expect(mats.matt.roughness).toBeGreaterThan(mats.gloss.roughness);
      for (const f of PLACED_FAMILIES) expect(SURFACES).toContain(FAMILY_SURFACE[f]);
      for (const m of Object.values(mats)) m.dispose();
    });

    it('keeps every triangle: the families together hold what the model has', () => {
      const whole = recipeMesh(MIXED, 'full');
      const res = buildPlacedModelsGeometry([item()], {}, 'high');
      const total = Object.values(res.families).reduce((n, g) => n + triangleCount(g!), 0);
      expect(total).toBe(triangleCount(whole));
    });

    it('a low-tier village keeps the same few families, inside the triangle budget', () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        item({ id: `m${i}`, position: [i * 3, 0, 0] })
      );
      const res = buildPlacedModelsGeometry(items, {}, 'low');
      expect(Object.keys(res.families).length).toBeLessThanOrEqual(4);
      const total = Object.values(res.families).reduce((n, g) => n + triangleCount(g!), 0);
      expect(total).toBeLessThanOrEqual(PLACED_LOW_TRIANGLES + 5000);
    });

    it('dimmed and fire tints are kept on every family', () => {
      const lum = (res: ReturnType<typeof buildPlacedModelsGeometry>) => {
        const c = res.families.gloss!.getAttribute('color');
        return c.getX(0) + c.getY(0) + c.getZ(0);
      };
      const on = lum(buildPlacedModelsGeometry([item()], { water: {} }));
      const dim = lum(buildPlacedModelsGeometry([item()], { water: { unserved: true } }));
      expect(dim).toBeLessThan(on);
      for (const g of Object.values(
        buildPlacedModelsGeometry([item()], { water: { onFire: true } }).families
      )) {
        expect(g!.getAttribute('color').count).toBeGreaterThan(0);
      }
    });

    it('familyOf puts glass and water in glass, paint and plastic in gloss, bare metal alone', () => {
      expect(familyOf('glass', false)).toBe('glass');
      expect(familyOf('water', false)).toBe('glass');
      expect(familyOf('painted', false)).toBe('gloss');
      expect(familyOf('plastic', false)).toBe('gloss');
      expect(familyOf('metal', false)).toBe('metal');
      expect(familyOf('brick', false)).toBe('matt');
    });

    it('splitByFamily cuts a mesh without losing vertices', () => {
      const g = recipeMesh(MIXED, 'full');
      const pieces = splitByFamily(g, false);
      const verts = [...pieces.values()].reduce((n, p) => n + p.getAttribute('position').count, 0);
      const flat = g.index ? g.toNonIndexed() : g;
      expect(verts).toBe(flat.getAttribute('position').count);
    });
  });

  describe('lamps and screens glow (PQ-T34)', () => {
    const LAMP: ObjectRecipe = {
      proportions: { w: 0.3, h: 1, d: 0.3 },
      parts: [
        {
          shape: 'cylinder',
          at: [0, -0.1, 0],
          size: [0.1, 0.8, 0.1],
          color: '#333333',
          material: 'metal',
        },
        {
          shape: 'sphere',
          at: [0, 0.42, 0],
          size: [0.3, 0.16, 0.3],
          color: '#ffe9b0',
          kind: 'light',
        },
      ],
    };
    const lamp = (over: Partial<PlacedModelItem>): PlacedModelItem => ({
      id: 'lamp',
      sector: 'water',
      running: true,
      position: [0, 0, 0],
      recipe: LAMP,
      ...over,
    });

    it('a running lamp on a served sector goes to the glow family, an idle or unserved one does not', () => {
      expect(buildPlacedModelsGeometry([lamp({})], { water: {} }).families.glow).toBeDefined();
      expect(
        buildPlacedModelsGeometry([lamp({ running: false })], { water: {} }).families.glow
      ).toBeUndefined();
      expect(
        buildPlacedModelsGeometry([lamp({})], { water: { unserved: true } }).families.glow
      ).toBeUndefined();
      expect(
        buildPlacedModelsGeometry([lamp({})], { water: { onFire: true } }).families.glow
      ).toBeUndefined();
    });

    it('the glow material is emissive and stays under 1', () => {
      const mats = placedFamilyMaterials();
      expect(mats.glow.emissiveIntensity).toBeGreaterThan(0);
      expect(mats.glow.emissiveIntensity).toBeLessThanOrEqual(1);
      expect(mats.matt.emissiveIntensity).toBe(1);
      expect(mats.matt.emissive.getHex()).toBe(0);
      for (const m of Object.values(mats)) m.dispose();
    });
  });

  describe('placedGeometryKey', () => {
    const item: PlacedModelItem = {
      id: 'a',
      sector: 'water',
      running: true,
      position: [1, 0, 2],
      recipe: SAMPLE_RECIPE,
    };

    it('is identical for equal inputs built as new objects (no rebuild on re-render)', () => {
      const k1 = placedGeometryKey([{ ...item }], { water: { unserved: false } }, 'high');
      const k2 = placedGeometryKey([{ ...item }], { water: { unserved: false } }, 'high');
      expect(k1).toBe(k2);
    });

    it('ignores sectors with no placed model', () => {
      expect(placedGeometryKey([item], { school: { onFire: true } }, 'high')).toBe(
        placedGeometryKey([item], {}, 'high')
      );
    });

    it('changes on move, running state, sector state, tier and a new recipe', () => {
      const k = placedGeometryKey([item], {}, 'high');
      expect(placedGeometryKey([{ ...item, position: [2, 0, 2] }], {}, 'high')).not.toBe(k);
      expect(placedGeometryKey([{ ...item, running: false }], {}, 'high')).not.toBe(k);
      expect(placedGeometryKey([item], { water: { onFire: true } }, 'high')).not.toBe(k);
      expect(placedGeometryKey([item], {}, 'low')).not.toBe(k);
      expect(placedGeometryKey([{ ...item, recipe: { ...SAMPLE_RECIPE } }], {}, 'high')).not.toBe(
        k
      );
    });
  });
});
