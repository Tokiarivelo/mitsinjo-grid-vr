import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PLANT_SLOTS } from '@/lib/plant-mesh';
import type { PlantPlan } from '@/lib/plant-plan';
import { modelKind, pieceNames } from '../utils/model-pieces';
import { plantGeometry, plantMaterials, plantSlotLooks } from '../utils/plant-projection';

const plant: PlantPlan = {
  habit: 'round',
  leaf: 'broad',
  stems: [
    {
      points: [
        [0.5, 0, 0.5],
        [0.5, 0.5, 0.5],
      ],
      r: [0.05, 0.04],
      kind: 'trunk',
    },
  ],
  masses: [{ c: [0.5, 0.7, 0.5], r: [0.3, 0.2, 0.3] }],
  look: { bark: '#553322', leaf: '#448833', leafDark: '#225511', flower: '#cc3344' },
  bloom: 0.2,
  seed: 5,
};
const recipe = { proportions: { w: 1, h: 2, d: 1 }, plant };

describe('plant projection', () => {
  it('groups the plant by slot and textures every slot', () => {
    const g = plantGeometry(recipe);
    expect(g.groups.length).toBeGreaterThanOrEqual(3);
    for (const group of g.groups) expect(group.materialIndex).toBeLessThan(PLANT_SLOTS.length);
    const uv = g.getAttribute('uv').array;
    expect([...uv].some((v) => v !== 0)).toBe(true);
    g.dispose();
  });

  it('wears bark on the wood, foliage on both sides of the leaves, the measured colours', () => {
    const looks = plantSlotLooks(recipe);
    expect(looks.map((l) => l.surface)).toEqual(['wood', 'foliage', 'foliage', 'foliage']);
    expect(looks[3]!.color).toBe('#cc3344');
    const mats = plantMaterials(recipe);
    expect(mats[0]!.side).toBe(THREE.FrontSide);
    expect(mats[1]!.side).toBe(THREE.DoubleSide);
    mats.forEach((m) => m.dispose());
  });

  it('is its own model kind, its pieces its slots', () => {
    const kind = modelKind({ plant } as never);
    expect(kind).toBe('plant');
    expect(pieceNames(kind)).toBe(PLANT_SLOTS);
  });
});
