import { describe, expect, it } from 'vitest';
import { RECIPE_MATERIALS, type ObjectRecipe } from '@/lib/object-shape';
import { recipeMesh } from '../utils/object-geometry';
import * as THREE from 'three';
import {
  recipeMaterials,
  SURFACE_LOOK,
  surfaceLook,
  baseColorFor,
  METAL_BASE_MAX,
  METAL_BASE_MIN,
  surfaceMaterial,
  GLOSS_SHIFT,
  METAL_MIN_ROUGHNESS,
  SURFACES,
  surfaceIndex,
} from '../utils/surface-look';

const house: ObjectRecipe = {
  proportions: { w: 1, h: 0.8, d: 0.6 },
  parts: [
    {
      shape: 'box',
      at: [0, -0.25, 0],
      size: [1, 0.5, 1],
      color: '#c9a36a',
      material: 'stone',
      front: true,
    },
    { shape: 'prism', at: [0, 0.25, 0], size: [1, 0.5, 1], color: '#6e6a62', material: 'slate' },
    {
      shape: 'box',
      at: [-0.2, -0.2, 0.505],
      size: [0.1, 0.1, 0.02],
      color: '#ffffff',
      material: 'glass',
    },
    {
      shape: 'box',
      at: [0.2, -0.2, 0.505],
      size: [0.1, 0.1, 0.02],
      color: '#ffffff',
      material: 'glass',
    },
    { shape: 'box', at: [0.3, 0.35, 0], size: [0.08, 0.2, 0.1], color: '#c9a36a' },
  ],
};

describe('surface looks (AI materials)', () => {
  it('every AI material has a look; glass and metal shinier than stone', () => {
    for (const m of RECIPE_MATERIALS) expect(SURFACE_LOOK[m]).toBeDefined();
    expect(SURFACE_LOOK.glass.roughness).toBeLessThan(SURFACE_LOOK.stone.roughness);
    expect(SURFACE_LOOK.metal.metalness).toBeGreaterThan(SURFACE_LOOK.wood.metalness);
    expect(SURFACES[surfaceIndex()]).toBe('painted');
    expect(SURFACES[surfaceIndex('slate')]).toBe('slate');
  });

  it('lists the materials once each, in part order', () => {
    expect(recipeMaterials(house)).toEqual(['stone', 'slate', 'glass']);
    expect(recipeMaterials({ parts: [house.parts[4]!] })).toEqual([]);
  });

  it('recipeMesh: one geometry group per material, covering every vertex', () => {
    const g = recipeMesh(house);
    const surfaces = g.groups.map((x) => SURFACES[x.materialIndex!]);
    expect([...surfaces].sort()).toEqual(['glass', 'painted', 'slate', 'stone']);
    const total = g.groups.reduce((s, x) => s + x.count, 0);
    expect(total).toBe(g.getAttribute('position').count);
    // Two glass windows share one group (12 + 12 triangles).
    expect(g.groups.find((x) => SURFACES[x.materialIndex!] === 'glass')!.count).toBe(72);
  });
});

describe('clearcoat by surface (PT-3)', () => {
  const coated = ['painted', 'plastic', 'tile', 'glass', 'metal'] as const;

  it('every surface: roughness and clearcoat in [0, 1]; coat only on lacquered surfaces', () => {
    for (const s of SURFACES) {
      const l = SURFACE_LOOK[s];
      for (const v of [l.roughness, l.clearcoat, l.clearcoatRoughness]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(l.clearcoat > 0).toBe((coated as readonly string[]).includes(s));
    }
    expect(SURFACE_LOOK.metal.roughness).toBeGreaterThanOrEqual(0.45);
  });

  it('physical material only when coated, standard otherwise', () => {
    const glass = surfaceMaterial('glass', { vertexColors: true });
    expect(glass).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((glass as THREE.MeshPhysicalMaterial).clearcoat).toBe(SURFACE_LOOK.glass.clearcoat);
    expect(glass.vertexColors).toBe(true);
    const stone = surfaceMaterial('stone');
    expect(stone).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(stone.roughness).toBe(SURFACE_LOOK.stone.roughness);
    [glass, stone].forEach((m) => m.dispose());
  });
});

describe('surfaceLook (PQ-T26)', () => {
  it('no or satin gloss keeps the material entry; matt and gloss shift within the clamp', () => {
    for (const s of SURFACES) {
      expect(surfaceLook(s)).toBe(SURFACE_LOOK[s]);
      expect(surfaceLook(s, 'satin')).toBe(SURFACE_LOOK[s]);
      for (const g of ['matt', 'gloss'] as const) {
        const look = surfaceLook(s, g);
        expect(Math.abs(look.roughness - SURFACE_LOOK[s].roughness)).toBeLessThanOrEqual(
          GLOSS_SHIFT + 1e-9
        );
        expect(Math.abs(look.clearcoat - SURFACE_LOOK[s].clearcoat)).toBeLessThanOrEqual(
          GLOSS_SHIFT + 1e-9
        );
        expect(look.roughness).toBeGreaterThanOrEqual(0.05);
        expect(look.roughness).toBeLessThanOrEqual(1);
        expect(look.clearcoat).toBeGreaterThanOrEqual(0);
        expect(look.clearcoat).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gloss lowers roughness and raises the clearcoat, matt does the opposite', () => {
    expect(surfaceLook('plastic', 'gloss').roughness).toBeLessThan(SURFACE_LOOK.plastic.roughness);
    expect(surfaceLook('plastic', 'gloss').clearcoat).toBeGreaterThan(
      SURFACE_LOOK.plastic.clearcoat
    );
    expect(surfaceLook('plastic', 'matt').roughness).toBeGreaterThan(
      SURFACE_LOOK.plastic.roughness
    );
    expect(surfaceLook('plastic', 'matt').clearcoat).toBeLessThan(SURFACE_LOOK.plastic.clearcoat);
  });

  it('metal never goes under roughness 0.45, even measured gloss', () => {
    expect(surfaceLook('metal', 'gloss').roughness).toBeGreaterThanOrEqual(METAL_MIN_ROUGHNESS);
    expect(surfaceMaterial('metal', {}, 'gloss').roughness).toBeGreaterThanOrEqual(
      METAL_MIN_ROUGHNESS
    );
  });
});

describe('physical material rules (PQ-T39)', () => {
  it('metalness is 0 or 1 for every surface; only bare metal is 1', () => {
    for (const s of SURFACES) expect([0, 1], s).toContain(SURFACE_LOOK[s].metalness);
    expect(SURFACE_LOOK.metal.metalness).toBe(1);
    expect(SURFACE_LOOK.painted.metalness).toBe(0);
    expect(SURFACE_LOOK.painted.clearcoat).toBeGreaterThan(0);
    expect(SURFACE_LOOK.water.metalness).toBe(0);
  });

  it('`painted` is a recipe material, so Muse can name it', () => {
    expect(RECIPE_MATERIALS).toContain('painted');
    expect(SURFACES[surfaceIndex('painted')]).toBe('painted');
  });

  it('a bare-metal base colour is lifted into 180–255 sRGB, other surfaces keep theirs', () => {
    const lifted = baseColorFor('metal', '#000000');
    expect(lifted).toBe('#b4b4b4');
    expect(baseColorFor('metal', '#ffffff')).toBe('#ffffff');
    const [r, g, b] = [1, 3, 5].map((i) =>
      parseInt(baseColorFor('metal', '#3a6f9c').slice(i, i + 2), 16)
    );
    for (const c of [r, g, b]) {
      expect(c).toBeGreaterThanOrEqual(METAL_BASE_MIN);
      expect(c).toBeLessThanOrEqual(METAL_BASE_MAX);
    }
    expect(baseColorFor('painted', '#000000')).toBe('#000000');
  });
});
