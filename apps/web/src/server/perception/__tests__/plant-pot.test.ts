import { describe, expect, it } from 'vitest';
import { plantMesh, PLANT_SLOTS } from '@/lib/plant-mesh';
import { PlantPlanSchema } from '@/lib/plant-plan';
import { buildPalette } from '../recon/palette';
import { cropRows, findPot, potPlan, raisePlant } from '../tree/plant-pot';
import { reconstructTree } from '../tree/tree-recon';
import { alignedTree, ROWS } from './tree-fixture';

/** A succulent in a white pot: the crown down to row 76, the pot from row 72 to the foot. */
const POTTED = {
  crown: { top: 20, base: 76, half: 0.45 },
  trunk: 0,
  pot: { top: 72, rim: 0.3, foot: 0.22 },
};

describe('findPot (VS-T25)', () => {
  it('reads the pot at the foot: rim row, tapering outline, its colour', () => {
    const pot = findPot(alignedTree(POTTED))!;
    expect(pot).not.toBeNull();
    // Leaves hang over the rim: the pot starts once its rows are no longer leafy.
    expect(pot.top).toBeGreaterThanOrEqual(72);
    expect(pot.top).toBeLessThanOrEqual(78);
    expect(pot.foot).toBe(ROWS - 1);
    expect(pot.half[0]!).toBeGreaterThan(pot.half[pot.half.length - 1]!);
    expect(pot.rgb[0]).toBeGreaterThan(220);
    expect(pot.depth).toBeCloseTo(1);
  });

  it('a white pot is no flowers: it still counts as a pot (before: read as petals, the pot was lost)', () => {
    expect(
      findPot(alignedTree({ ...POTTED, pot: { ...POTTED.pot, color: [250, 250, 250] } }))
    ).not.toBeNull();
  });

  it('finds none under a tree on the ground, nor under a trunk flared into roots', () => {
    expect(findPot(alignedTree())).toBeNull();
    expect(findPot(alignedTree({ roots: { rows: 6, half: 12 } }))).toBeNull();
    // A bush down to the ground has no bare band at its foot.
    expect(findPot(alignedTree({ crown: { top: 4, base: 127, half: 0.45 }, trunk: 0 }))).toBeNull();
  });
});

describe('potted plant (VS-T25)', () => {
  it('stands the plant on the pot, in a box as tall as the drawing (before: the pot was cut off as roots and the plant squashed)', () => {
    const aligned = alignedTree(POTTED);
    const out = reconstructTree(aligned, buildPalette(aligned), 'potted plant')!;
    const plant = out.recipe.plant!;
    expect(PlantPlanSchema.safeParse(plant).success).toBe(true);
    expect(plant.pot).toBeDefined();
    const { w, h } = out.recipe.proportions;
    expect(h / w).toBeCloseTo(ROWS / aligned.W, 2);
    // Pot from the ground to its rim; every foliage mass sits over the soil.
    const rim = plant.pot!.profile[plant.pot!.profile.length - 1]![0];
    expect(plant.pot!.profile[0]![0]).toBeLessThan(0.05);
    expect(rim).toBeGreaterThan(0.3);
    expect(rim).toBeLessThan(0.55);
    for (const m of plant.masses) expect(m.c[1]).toBeGreaterThan(rim - 0.05);
    expect(out.plantScore.mean).toBeGreaterThan(0.6);
  }, 30_000);

  it('raisePlant maps the rows above the rim into the whole box', () => {
    const aligned = alignedTree(POTTED);
    const pot = findPot(aligned)!;
    const upper = cropRows(aligned, pot.top);
    expect(upper.H).toBe(pot.top);
    expect(upper.views.front.mask.length).toBe(aligned.W * pot.top);
    const base = {
      habit: 'shrub' as const,
      leaf: 'broad' as const,
      stems: [
        {
          points: [
            [0.5, 0, 0.5],
            [0.5, 1, 0.5],
          ] as Array<[number, number, number]>,
          r: [0.05, 0.05],
          kind: 'trunk' as const,
        },
      ],
      masses: [
        {
          c: [0.5, 0.5, 0.5] as [number, number, number],
          r: [0.4, 0.4, 0.4] as [number, number, number],
        },
      ],
      look: { bark: '#664422', leaf: '#448844', leafDark: '#224422' },
      seed: 1,
    };
    const raised = raisePlant(base, aligned, pot.top);
    const [lo, hi] = [raised.stems[0]!.points[0]![1], raised.stems[0]!.points[1]![1]];
    expect(lo).toBeGreaterThan(0.3);
    expect(hi).toBeLessThanOrEqual(1);
    expect(raised.masses[0]!.r[1]).toBeCloseTo(0.4 * (pot.top / ROWS));
    expect(raised.masses[0]!.r[0]).toBe(0.4);
    const plan = potPlan(pot, aligned);
    expect(plan.profile[plan.profile.length - 1]![0]).toBeCloseTo(lo, 1);
  });

  it('the mesh turns the pot round its axis, with soil inside, within the box', () => {
    const aligned = alignedTree(POTTED);
    const out = reconstructTree(aligned, buildPalette(aligned), 'potted plant')!;
    const { w, h, d } = out.recipe.proportions;
    const m = plantMesh(out.recipe.plant!, [w, h, d]);
    const slots = new Set(m.slot);
    expect(slots.has(PLANT_SLOTS.indexOf('pot'))).toBe(true);
    expect(slots.has(PLANT_SLOTS.indexOf('soil'))).toBe(true);
    let minY = Infinity;
    for (let i = 1; i < m.position.length; i += 3) minY = Math.min(minY, m.position[i]!);
    expect(minY).toBeGreaterThanOrEqual(-h / 2 - 1e-6);
    expect(minY).toBeLessThan(-h / 2 + 0.03);
  }, 30_000);
});
