import { describe, expect, it } from 'vitest';
import type { ObjectRecipe } from '@/lib/object-shape';
import type { PlantPlan } from '@/lib/plant-plan';
import { PLANT_SLOTS } from '@/lib/plant-mesh';
import { renderPlant } from '../tour-mock/plant-render';

/** A tree: a trunk up the middle under one round mass. */
const plan: PlantPlan = {
  habit: 'round',
  leaf: 'broad',
  stems: [
    {
      points: [
        [0.5, 0, 0.5],
        [0.5, 0.55, 0.5],
      ],
      r: [0.04, 0.03],
      kind: 'trunk',
    },
  ],
  masses: [{ c: [0.5, 0.7, 0.5], r: [0.4, 0.28, 0.4] }],
  look: { bark: '#5b4a3a', leaf: '#4f7a3a', leafDark: '#355a28' },
  seed: 7,
};
const recipe = {
  proportions: { w: 1, h: 1, d: 1 },
  parts: [],
  plant: plan,
} as unknown as ObjectRecipe;

const rows = (r: ReturnType<typeof renderPlant>, slot: number) => {
  const ys: number[] = [];
  for (let i = 0; i < r.part.length; i++) if (r.part[i] === slot) ys.push(Math.floor(i / 64));
  return ys;
};

describe('renderPlant (VS-T46)', () => {
  it('draws the mesh the viewer builds: leaves above, bark at the foot', () => {
    const r = renderPlant(recipe, 64, 64, { yaw: 0, pitch: 0 });
    const covered = r.mask.data.reduce((a, b) => a + b, 0);
    expect(covered).toBeGreaterThan(64 * 64 * 0.25);
    const bark = rows(r, PLANT_SLOTS.indexOf('bark'));
    const leaves = [
      ...rows(r, PLANT_SLOTS.indexOf('leaf')),
      ...rows(r, PLANT_SLOTS.indexOf('leafDark')),
    ];
    expect(Math.max(...bark)).toBeGreaterThan(Math.max(...leaves));
    expect(r.colors).toHaveLength(PLANT_SLOTS.length);
  });

  it('fills the grid on its bounds when asked', () => {
    const r = renderPlant(recipe, 40, 40, { yaw: 0, pitch: 0 }, true);
    const first = r.mask.data.indexOf(1);
    expect(Math.floor(first / 40)).toBeLessThanOrEqual(1);
  });

  it('is deterministic and shaded only inside its mask', () => {
    const a = renderPlant(recipe, 32, 32, { yaw: 0.4, pitch: 0.2 });
    const b = renderPlant(recipe, 32, 32, { yaw: 0.4, pitch: 0.2 });
    expect(Array.from(a.rgb)).toEqual(Array.from(b.rgb));
    for (let i = 0; i < 32 * 32; i++) if (!a.mask.data[i]) expect(a.rgb[i * 3]).toBe(0);
  });
});
