import { describe, expect, it } from 'vitest';
import { ObjectRecipeSchema } from '@/lib/object-shape';
import { modelKind, pieceNames } from '../utils/model-pieces';
import {
  SKIN_METALNESS_MAX,
  skinGeometry,
  skinMaterials,
  skinPieceNames,
  type SkinRecipe,
} from '../utils/skin-projection';

const ATLAS = 'data:image/jpeg;base64,AAAA';

const recipe = ObjectRecipeSchema.parse({
  proportions: { w: 1, h: 1, d: 0.5 },
  yaw: 0.3,
  parts: [
    { shape: 'box', at: [0, 0.1, 0], size: [1, 0.2, 1], color: '#333333', material: 'fabric' },
    {
      shape: 'cylinder',
      at: [-0.4, -0.3, 0],
      size: [0.05, 0.4, 0.1],
      color: '#222222',
      material: 'metal',
    },
    {
      shape: 'cylinder',
      at: [0.4, -0.3, 0],
      size: [0.05, 0.4, 0.1],
      color: '#222222',
      material: 'metal',
    },
  ],
  skin: {
    atlas: ATLAS,
    view: { yaw: 0.3, pitch: 0 },
    box: [-0.5, -0.5, -0.25, 0.5, 0.5, 0.25],
    pieces: ['seat', 'leg', 'leg'],
  },
}) as SkinRecipe;

describe('skin projection (VS-T43)', () => {
  it('is its own model kind and names its pieces after its parts', () => {
    expect(modelKind(recipe)).toBe('skin');
    expect(skinPieceNames(recipe.skin)).toEqual(['seat', 'leg']);
    expect(pieceNames('skin', recipe)).toEqual(['seat', 'leg']);
  });

  it('groups the parts by piece with atlas uvs and white colours, never turned by a yaw', () => {
    const g = skinGeometry(recipe);
    expect(g.groups.map((x) => x.materialIndex)).toEqual([0, 1]);
    const uv = g.getAttribute('uv');
    expect(uv.count).toBe(g.getAttribute('position').count);
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
    }
    expect([...(g.getAttribute('color').array as Float32Array)].every((v) => v === 1)).toBe(true);
    g.computeBoundingBox();
    // The seat spans the model's width as built (no yaw applied to the geometry).
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(1, 1);
  });

  it('gives each piece the atlas and caps how metallic it looks', () => {
    const mats = skinMaterials(recipe, { selected: { surface: 'leg', color: '#00ffff' } });
    expect(mats).toHaveLength(2);
    expect(mats.every((m) => m.map !== null)).toBe(true);
    expect(mats[1]!.metalness).toBeLessThanOrEqual(SKIN_METALNESS_MAX);
    expect(mats[1]!.emissiveIntensity).toBeGreaterThan(0);
  });
});
