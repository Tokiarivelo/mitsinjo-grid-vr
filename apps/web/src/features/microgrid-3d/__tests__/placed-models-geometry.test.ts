import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ObjectRecipe } from '@/lib/object-shape';
import {
  buildPlacedModelsGeometry,
  PLACED_DRAWN_MAX,
  PLACED_LOW_TRIANGLES,
  placedGeometryKey,
  type PlacedModelItem,
} from '../utils/placed-models-geometry';
import { triangleCount } from '@/features/vision-insert/utils/object-geometry';

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
    const res = buildPlacedModelsGeometry([]);
    expect(res.modelsGeometry).toBeNull();
    expect(res.plinths).toHaveLength(0);
    expect(res.modelBounds).toEqual({});
  });

  it('merges 30 placed objects into a single BufferGeometry (draw call budget: ≤ +2)', () => {
    const items: PlacedModelItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: `app-${i}`,
      sector: 'households',
      running: true,
      position: [(i % 6) * 3 - 8, 0, Math.floor(i / 6) * 3 - 8] as [number, number, number],
      recipe: SAMPLE_RECIPE,
      scale: 1.0,
      archetype: 'cabinet',
    }));

    const res = buildPlacedModelsGeometry(items);
    expect(res.modelsGeometry).toBeInstanceOf(THREE.BufferGeometry);
    // Crucial budget test: 30 objects yield 1 merged geometry, representing exactly 1 draw call!
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

    const res = buildPlacedModelsGeometry(items);
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

    const res = buildPlacedModelsGeometry(items);
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

    const resRunning = buildPlacedModelsGeometry([runningItem], { water: { unserved: false } });
    const resIdle = buildPlacedModelsGeometry([idleItem], { water: { unserved: true } });

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

    const resFire = buildPlacedModelsGeometry([item], { school: { onFire: true } });
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

    const low = buildPlacedModelsGeometry([item], {}, 'low').modelsGeometry!;
    const high = buildPlacedModelsGeometry([item], {}, 'high').modelsGeometry!;
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
    const one = buildPlacedModelsGeometry(
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
    const all = buildPlacedModelsGeometry(items, {}, 'low').modelsGeometry!;
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
    const res = buildPlacedModelsGeometry([item]);
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
    const on = buildPlacedModelsGeometry([base], served).modelsGeometry!.getAttribute('color');
    const off = buildPlacedModelsGeometry(
      [{ ...base, running: false }],
      served
    ).modelsGeometry!.getAttribute('color');
    expect(off.getX(0)).toBeLessThan(on.getX(0));
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

/** A tiny 1 × 1 atlas: enough for the mesh and the materials (the pixels are never read here). */
const ATLAS =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('placed models that wear their drawings (PQ-T71)', () => {
  const drawnRecipe: ObjectRecipe = {
    ...SAMPLE_RECIPE,
    faces: {
      atlas: ATLAS,
      views: ['front', 'right'],
      hull: { grid: [4, 4, 4], boxes: [[0, 4, 0, 4, 0, 4]] },
    },
  };
  const item = (i: number, recipe: ObjectRecipe, running = true): PlacedModelItem => ({
    id: `app-${i}`,
    sector: 'households',
    running,
    position: [i * 3 - 12, 0, 0],
    recipe,
    scale: 1,
    archetype: 'house',
  });

  it('draws them one by one outside the merged mesh, with their bounds and feeder state', () => {
    const res = buildPlacedModelsGeometry([
      item(0, drawnRecipe),
      item(1, SAMPLE_RECIPE),
      item(2, drawnRecipe, false),
    ]);
    expect(res.drawn.map((d) => [d.id, d.state])).toEqual([
      ['app-0', 'served'],
      ['app-2', 'unserved'],
    ]);
    expect(res.modelsGeometry).not.toBeNull();
    expect(res.modelBounds['app-0']!.height).toBeCloseTo(0.8);
    // Resting on the ground: the mesh origin is half a height above it.
    expect(res.drawn[0]!.position[1]).toBeCloseTo(0.4, 1);
    res.modelsGeometry?.dispose();
  });

  it('keeps flat colours on the low tier and past the cap', () => {
    expect(buildPlacedModelsGeometry([item(0, drawnRecipe)], undefined, 'low').drawn).toHaveLength(
      0
    );
    const many = Array.from({ length: PLACED_DRAWN_MAX + 2 }, (_, i) => item(i, drawnRecipe));
    const res = buildPlacedModelsGeometry(many);
    expect(res.drawn).toHaveLength(PLACED_DRAWN_MAX);
    expect(res.modelsGeometry).not.toBeNull();
    res.modelsGeometry?.dispose();
  });

  it('is nothing but drawn models when every model wears its drawings', () => {
    const res = buildPlacedModelsGeometry([item(0, drawnRecipe)]);
    expect(res.modelsGeometry).toBeNull();
    expect(res.drawn).toHaveLength(1);
  });
});
