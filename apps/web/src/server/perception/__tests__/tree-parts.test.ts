import { describe, expect, it } from 'vitest';
import { meshSdf } from '@/lib/sdf-mesh';
import { RecipePartSchema } from '@/lib/object-shape';
import { fitTree } from '../tree/tree-fit';
import { crownTiers, LOBES_PER_PART, lobePart, treeRecipe } from '../tree/tree-parts';
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
    expect(recipe.parts[0]).toMatchObject({ kind: 'trunk', material: 'wood', shape: 'sdf' });
    for (const p of recipe.parts.slice(1))
      expect(p).toMatchObject({ kind: 'crown', material: 'foliage', shape: 'sdf' });
    expect(Math.max(...Object.values(recipe.proportions))).toBe(1);
  });

  it('stays inside the triangle budget of a modelled object', () => {
    const triangles = recipe.parts.reduce((t, p) => t + meshSdf(p.blobs!).positions.length / 9, 0);
    expect(triangles).toBeGreaterThan(500);
    expect(triangles).toBeLessThan(9000);
  });

  it('has no trunk for a bush', () => {
    const bush = treeRecipe(
      fitTree(alignedTree({ crown: { top: 40, base: 127, half: 0.45 }, trunk: 0 }))!
    );
    expect(bush.parts.every((p) => p.kind === 'crown')).toBe(true);
  });
});
