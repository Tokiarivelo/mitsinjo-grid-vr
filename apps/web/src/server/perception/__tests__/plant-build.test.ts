import { describe, expect, it } from 'vitest';
import {
  PLANT_LEAVES_MAX,
  PLANT_STRANDS_MAX,
  PlantPlanSchema,
  type PlantPlan,
} from '@/lib/plant-plan';
import { buildPalette } from '../recon/palette';
import { buildPlant, type PlantHints } from '../tree/plant-build';
import { habitFromLabel, habitFromShape, leafFromLabel } from '../tree/plant-habit';
import { scorePlant } from '../tree/plant-score';
import { fitTree } from '../tree/tree-fit';
import { reconstructTree } from '../tree/tree-recon';
import { alignedTree, type DrawnTree } from './tree-fixture';

/** The plant a label (and the team's hints) builds on the synthetic drawn tree. */
function plantOf(label: string, hints: PlantHints = {}, tree: DrawnTree = {}): PlantPlan {
  const aligned = alignedTree(tree);
  const plan = fitTree(aligned, { sideIsFront: true })!;
  return buildPlant(plan, label, hints, 7);
}

describe('habitFromLabel / leafFromLabel', () => {
  it.each([
    ['weeping willow', 'weeping'],
    ['saule pleureur', 'weeping'],
    ['coconut palm', 'palm'],
    ['satrana', 'palm'],
    ['bananier', 'fan'],
    ['ravenala', 'fan'],
    ['sapin', 'conical'],
    ['cypress tree', 'columnar'],
    ['volo (bamboo)', 'bamboo'],
    ['raketa', 'cactus'],
    ['aloe vera', 'rosette'],
    ['lemongrass', 'grass'],
    ['flamboyant', 'spreading'],
    ['hibiscus hedge', 'shrub'],
  ] as const)('%s → %s', (label, habit) => expect(habitFromLabel(label)).toBe(habit));

  it('names no habit for a plain "tree"', () => expect(habitFromLabel('tree')).toBeNull());

  it('gives fan palms palmate leaves, other palms none by name', () => {
    expect(leafFromLabel('bismarckia fan palm')).toBe('palmate');
    expect(leafFromLabel('palmier à éventail')).toBe('palmate');
    expect(leafFromLabel('coconut palm')).toBeNull();
  });

  it('reads a habit off the outline when nobody named it', () => {
    const base = { bush: false, crownHeight: 0.6, aspect: 0.8, widestAt: 0.5 };
    expect(habitFromShape({ ...base, bush: true })).toBe('shrub');
    expect(habitFromShape({ ...base, aspect: 0.3 })).toBe('columnar');
    expect(habitFromShape({ ...base, widestAt: 0.85 })).toBe('conical');
    expect(habitFromShape({ ...base, aspect: 2 })).toBe('spreading');
    expect(habitFromShape(base)).toBe('round');
  });
});

describe('buildPlant', () => {
  it('builds a valid plan for every habit, each with its own foliage', () => {
    const mango = plantOf('mango tree');
    expect(mango.habit).toBe('round');
    expect(mango.masses.length).toBeGreaterThan(2);
    expect(mango.stems.some((s) => s.kind === 'branch')).toBe(true);

    const willow = plantOf('weeping willow');
    expect(willow.strands!.length).toBeGreaterThan(40);
    expect(willow.strands!.length).toBeLessThanOrEqual(PLANT_STRANDS_MAX);

    expect(plantOf('pine').tiers!.length).toBeGreaterThanOrEqual(5);
    expect(plantOf('coconut palm').leaves!.every((l) => l.cut && !l.fan)).toBe(true);
    expect(plantOf('satrana fan palm').leaves!.every((l) => l.fan)).toBe(true);
    expect(plantOf('agave').leaves!.length).toBeGreaterThan(8);
    expect(plantOf('cactus').stems[0]!.green).toBe(true);
    expect(plantOf('bamboo').stems.filter((s) => s.kind === 'cane').length).toBe(7);
    for (const label of ['mango', 'willow', 'pine', 'palm', 'agave', 'cactus', 'bamboo', 'grass'])
      expect(PlantPlanSchema.safeParse(plantOf(label)).success).toBe(true);
    // Sixteen fits of the drawn tree: seconds, more when the suite runs in parallel.
  }, 30_000);

  it('lets the team overrule the label: habit, leaf, leaf count, no bloom', () => {
    const p = plantOf('tree', { habit: 'palm', leaf: 'palmate', leafCount: 9, bloom: 0 });
    expect(p.habit).toBe('palm');
    expect(p.leaves).toHaveLength(9);
    expect(p.leaves!.every((l) => l.fan)).toBe(true);
    expect(p.bloom).toBeUndefined();
    expect(plantOf('tree', { leafCount: 500, habit: 'palm' }).leaves!.length).toBeLessThanOrEqual(
      PLANT_LEAVES_MAX
    );
  });

  it('lays the traced leaves where they are drawn, turned alternately toward and away', () => {
    const frond = {
      points: [
        [0.5, 0.35],
        [0.7, 0.25],
        [0.85, 0.4],
      ] as Array<[number, number]>,
      width: 0.06,
    };
    const traces = [
      frond,
      frond,
      { ...frond, points: frond.points.map(([x, y]) => [1 - x, y]) as Array<[number, number]> },
    ];
    const p = plantOf('coconut palm', { traces });
    expect(p.leaves).toHaveLength(3);
    const [a, b, c] = p.leaves!;
    // Same drawn frond: same place on the front, on either side of the viewer.
    expect(a!.tip[0]).toBeCloseTo(b!.tip[0]);
    expect(a!.tip[1]).toBeCloseTo(b!.tip[1]);
    expect(Math.sign(a!.tip[2] - a!.base[2])).toBe(-Math.sign(b!.tip[2] - b!.base[2]));
    expect(a!.mid).toHaveLength(1);
    expect(a!.facing && a!.cut).toBe(true);
    // The mirrored trace lands mirrored.
    expect(a!.tip[0] + c!.tip[0]).toBeCloseTo(2 * a!.base[0]);
    // Too few traces: the grown fronds instead.
    expect(plantOf('coconut palm', { traces: [frond] }).leaves!.length).toBeGreaterThan(5);
    // A prickly pear's traced pads replace its column.
    const pads = plantOf('opuntia', { traces: [frond, frond] });
    expect(pads.leaves).toHaveLength(2);
    expect(pads.stems).toHaveLength(0);
  });

  it('runs a palm’s leaves out to the drawn outline, not short of it', () => {
    const p = plantOf('coconut palm');
    // The upright leaves reach the crown's top band (y share near the top of the drawing).
    const highest = Math.max(...p.leaves!.map((l) => l.tip[1]));
    const heart = p.leaves![0]!.base[1];
    expect(highest).toBeGreaterThan(heart + 0.1);
  });

  it('draws the team’s limbs, and its trunks standing apart from the measured one', () => {
    const limbs = [
      {
        points: [
          [0.5, 0.6],
          [0.3, 0.4],
        ] as Array<[number, number]>,
        width: 0.04,
      },
    ];
    const trunks = [
      {
        points: [
          [0.5, 1],
          [0.5, 0.6],
        ] as Array<[number, number]>,
        width: 0.1,
      },
      {
        points: [
          [0.2, 1],
          [0.25, 0.6],
        ] as Array<[number, number]>,
        width: 0.06,
      },
    ];
    const p = plantOf('mango tree', { branches: limbs, trunks });
    // The measured trunk, the team's second trunk (the one on the measured foot is skipped).
    expect(p.stems.filter((s) => s.kind === 'trunk')).toHaveLength(2);
    // A limb on the front, and the same limb turned a quarter (the side is the front).
    expect(p.stems.filter((s) => s.kind === 'branch')).toHaveLength(2);
  });

  it('is deterministic: same drawing, same label, same plan', () => {
    expect(plantOf('weeping willow')).toEqual(plantOf('weeping willow'));
  });
});

describe('scorePlant / reconstructTree', () => {
  it('scores the built plant on the drawings and returns it on the recipe', () => {
    const aligned = alignedTree();
    const out = reconstructTree(aligned, buildPalette(aligned), 'mango tree', {
      sideIsFront: true,
    })!;
    expect(out.recipe.plant?.habit).toBe('round');
    expect(out.plantScore.front).toBeGreaterThan(0.5);
    expect(out.plantScore.mean).toBeCloseTo((out.plantScore.front + out.plantScore.side) / 2);
  }, 30_000);

  it('scores an empty plant zero', () => {
    const aligned = alignedTree();
    const plan = fitTree(aligned)!;
    const empty: PlantPlan = {
      habit: 'round',
      leaf: 'broad',
      stems: [],
      masses: [],
      look: { bark: '#553322', leaf: '#336622', leafDark: '#224411' },
      seed: 1,
    };
    expect(scorePlant(empty, plan, aligned).mean).toBe(0);
  });
});
