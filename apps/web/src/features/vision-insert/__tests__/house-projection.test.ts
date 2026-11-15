import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HOUSE_SLOTS } from '@/lib/house-mesh';
import type { HousePlan } from '@/lib/house-plan';
import {
  houseBaseLooks,
  houseGeometry,
  houseMaterials,
  PAINTED_SHEET_METALNESS,
} from '../utils/house-projection';

const ATLAS =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const plan: HousePlan = {
  volumes: [{ kind: 'body', plan: [0, 1, 0, 1], eave: 0.6, ridge: 1, roof: 'hip', ridgeAxis: 'x' }],
  openings: [
    { volume: 0, wall: 'front', kind: 'window', along: [0.3, 0.5], rise: [0.2, 0.5] },
    { volume: 0, wall: 'right', kind: 'door', along: [0.4, 0.6], rise: [0, 0.45] },
  ],
  chimneys: [],
  look: {
    wall: { material: 'brick', color: '#a04a35' },
    roof: { material: 'metal', color: '#212325' },
    trim: '#ffffff',
    glass: '#40546a',
    door: '#5a3d2b',
    base: '#8f8a80',
  },
};
const recipe = {
  proportions: { w: 1, h: 0.6, d: 0.8 },
  house: plan,
  faces: {
    atlas: ATLAS,
    views: ['front', 'right', 'back', 'left'] as Array<'front' | 'right' | 'back' | 'left'>,
    hull: { grid: [4, 4, 4] as [number, number, number], boxes: [[0, 4, 0, 4, 0, 4]] as never },
  },
};

describe('house projection (PQ-T72)', () => {
  it('groups the triangles by slot, material index = slot', () => {
    const g = houseGeometry(recipe);
    const used = g.groups.map((gr) => HOUSE_SLOTS[gr.materialIndex!]);
    expect(used).toEqual(
      expect.arrayContaining(['roof', 'front', 'right', 'trim', 'glass', 'door'])
    );
    const total = g.groups.reduce((n, gr) => n + gr.count, 0);
    expect(total).toBe(g.getAttribute('position').count);
  });

  it('dresses the walls with their drawings and the roof with its covering', () => {
    const ms = houseMaterials(recipe);
    expect(ms).toHaveLength(HOUSE_SLOTS.length);
    const at = (s: (typeof HOUSE_SLOTS)[number]) => ms[HOUSE_SLOTS.indexOf(s)]!;
    expect(at('front').map).toBeInstanceOf(THREE.Texture);
    expect(at('front').bumpMap).toBe(at('front').map);
    // The roof: painted sheet in its colour, not the studio's reflection.
    expect(at('roof').metalness).toBe(PAINTED_SHEET_METALNESS);
    expect(at('roof').side).toBe(THREE.DoubleSide);
    expect(at('glass').color.getHexString()).not.toBe('ffffff');
  });

  it('follows the operator: a wall given a material, the roof asked for its drawing', () => {
    const restyled = {
      ...recipe,
      faces: {
        ...recipe.faces,
        views: [...recipe.faces.views, 'top' as const],
        surfaces: { front: { material: 'plaster' as const }, roof: { drawing: true as const } },
      },
    };
    const ms = houseMaterials(restyled);
    const at = (s: (typeof HOUSE_SLOTS)[number]) => ms[HOUSE_SLOTS.indexOf(s)]!;
    expect(at('front').bumpMap).toBeNull();
    expect(at('roof').map).toBeInstanceOf(THREE.Texture);
    expect(at('roof').bumpMap).toBe(at('roof').map);
  });

  it('repeats the swatches cut on the drawings over the walls and the roof', () => {
    const swatches = {
      wall: { image: ATLAS, size: 0.05 },
      roof: { image: ATLAS, size: 0.1 },
    };
    const sampled = { ...recipe, house: { ...plan, look: { ...plan.look, swatches } } };
    const ms = houseMaterials(sampled);
    const at = (s: (typeof HOUSE_SLOTS)[number]) => ms[HOUSE_SLOTS.indexOf(s)]!;
    for (const s of ['front', 'wall', 'roof'] as const) {
      expect(at(s).map).toBeInstanceOf(THREE.Texture);
      expect(at(s).map!.wrapS).toBe(THREE.MirroredRepeatWrapping);
      // Not the whole drawing: no relief from the atlas.
      expect(at(s).bumpMap).toBeNull();
    }
    expect(at('roof').side).toBe(THREE.DoubleSide);
    // Swatch slots get planar uvs (repeats), not the atlas uvs.
    const g = houseGeometry(sampled);
    const plain = houseGeometry(recipe);
    expect(Array.from(g.getAttribute('uv').array)).not.toEqual(
      Array.from(plain.getAttribute('uv').array)
    );
    // The editor's base: the wall material, as the walls no longer wear the whole drawing.
    expect(Object.keys(houseBaseLooks(sampled.house, true))).toContain('front');
    // The operator asking for the drawing gets it back.
    const asked = {
      ...sampled,
      faces: { ...sampled.faces, surfaces: { front: { drawing: true as const } } },
    };
    const back = houseMaterials(asked)[HOUSE_SLOTS.indexOf('front')]!;
    expect(back.bumpMap).toBe(back.map);
  });

  it('gives the editor the roof covering as base look, and the walls too without drawings', () => {
    expect(houseBaseLooks(plan, true)).toEqual({
      roof: { material: 'metal', color: '#212325' },
    });
    expect(Object.keys(houseBaseLooks(plan, false))).toEqual([
      'roof',
      'front',
      'right',
      'back',
      'left',
    ]);
  });
});
