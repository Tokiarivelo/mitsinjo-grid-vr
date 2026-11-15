import { describe, expect, it } from 'vitest';
import { meshSdf } from '@/lib/sdf-mesh';
import { MAX_RECIPE_PARTS, RecipePartSchema } from '@/lib/object-shape';
import { FRONDS } from '../tree/tree-fronds';
import { fitTree } from '../tree/tree-fit';
import { crownTiers, LOBES_PER_PART, lobePart, treeRecipe, trunkPart } from '../tree/tree-parts';
import { alignedTree } from './tree-fixture';

const frame = { W: 100, H: 100, D: 100 };

describe('lobePart', () => {
  it('writes a valid sdf part whose blobs stay inside unit space', () => {
    const part = lobePart(
      [
        { c: [50, 40, 50], r: [30, 20, 30] },
        { c: [30, 50, 50], r: [1, 1, 1] }, // under the floor: raised
      ],
      frame,
      { color: '#336622', material: 'foliage', kind: 'crown' }
    );
    expect(RecipePartSchema.safeParse(part).success).toBe(true);
    expect(part.shape).toBe('sdf');
    expect(part.blobs).toHaveLength(2);
  });

  it('puts the part where the lobes are', () => {
    const part = lobePart([{ c: [25, 75, 50], r: [10, 10, 10] }], frame, { color: '#336622' });
    expect(part.at[0]).toBeCloseTo(25 / 100 - 0.5, 1);
    expect(part.at[1]).toBeCloseTo(0.5 - 75 / 100, 1);
  });
});

describe('crownTiers', () => {
  it('splits by height and never over the blob limit', () => {
    const lobes = Array.from({ length: 40 }, (_, i) => ({
      c: [50, i, 50] as [number, number, number],
      r: [5, 5, 5] as [number, number, number],
    }));
    const tiers = crownTiers(lobes, 4);
    expect(tiers.flat()).toHaveLength(40);
    for (const t of tiers) expect(t.length).toBeLessThanOrEqual(LOBES_PER_PART);
    expect(tiers[0]![0]!.c[1]).toBeLessThan(tiers[tiers.length - 1]![0]!.c[1]);
  });
});

describe('treeRecipe', () => {
  const plan = fitTree(alignedTree())!;
  const recipe = treeRecipe(plan);

  it('is a valid views recipe: a wooden trunk first, foliage crown parts after', () => {
    expect(recipe.source).toBe('views');
    expect(recipe.parts[0]).toMatchObject({ kind: 'trunk', material: 'wood', shape: 'lathe' });
    // The trunk stands on the ground: its part ends at the bottom of the recipe's box.
    const trunk = recipe.parts[0]!;
    expect(trunk.at[1] - trunk.size[1] / 2).toBeCloseTo(-0.5, 2);
    expect(trunk.profile![0]).toEqual([0, -0.5]);
    for (const p of recipe.parts.slice(1))
      expect(p).toMatchObject({ kind: 'crown', material: 'foliage', shape: 'sdf' });
    expect(Math.max(...Object.values(recipe.proportions))).toBe(1);
  });

  it('stays inside the triangle budget of a modelled object', () => {
    const triangles = recipe.parts
      .filter((p) => p.shape === 'sdf')
      .reduce((t, p) => t + meshSdf(p.blobs!).positions.length / 9, 0);
    expect(triangles).toBeGreaterThan(500);
    expect(triangles).toBeLessThan(9000);
  });

  it('has no trunk for a bush', () => {
    const bush = treeRecipe(
      fitTree(alignedTree({ crown: { top: 40, base: 127, half: 0.45 }, trunk: 0 }))!
    );
    expect(bush.parts.every((p) => p.kind === 'crown')).toBe(true);
  });

  it('writes a palm as its fronds two by two on the trunk, inside the part limit and the triangle budget', () => {
    const palm = treeRecipe(fitTree(alignedTree(), { fronds: true })!);
    expect(palm.parts).toHaveLength(1 + FRONDS / 2);
    expect(palm.parts.length).toBeLessThanOrEqual(MAX_RECIPE_PARTS);
    const triangles = palm.parts
      .filter((p) => p.shape === 'sdf')
      .reduce((t, p) => t + meshSdf(p.blobs!).positions.length / 9, 0);
    expect(triangles).toBeGreaterThan(500);
    expect(triangles).toBeLessThan(9000);
  });
});

describe('trunkPart', () => {
  it('keeps the measured radius at each height: a bottle trunk is wider low than high', () => {
    const part = trunkPart(
      [
        { c: [50, 45, 50], r: [4, 5, 4] },
        { c: [50, 55, 50], r: [6, 5, 6] },
        { c: [50, 65, 50], r: [10, 5, 10] },
      ],
      70,
      frame,
      { color: '#664433', material: 'wood', kind: 'trunk' }
    );
    expect(RecipePartSchema.safeParse(part).success).toBe(true);
    expect(part.size[0]).toBeCloseTo(0.2, 5);
    expect(part.size[1]).toBeCloseTo(0.3, 5);
    const radii = part.profile!.slice(1, -1).map((p) => p[0]);
    expect(radii[0]).toBeCloseTo(0.5, 5);
    expect(radii[radii.length - 1]).toBeLessThan(radii[0]!);
    // Closed at both ends: a flat foot and a capped tip.
    expect(part.profile![0]![0]).toBe(0);
    expect(part.profile![part.profile!.length - 1]![0]).toBe(0);
  });
});
