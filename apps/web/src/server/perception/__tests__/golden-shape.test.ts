// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { deltaE2000, hexToLab } from '../color-measure';
import { GOLDEN_SHAPES } from '../__fixtures__/shape';
import { runGolden as run } from './golden-run';

/**
 * Math budget per object (best of 3 runs), in CPU time (`cpuMs`), so the other test files of the full suite
 * do not count: the wall clock was seen at 1026 ms there for the same math. 300 ms when run alone
 * (`make test-shape` sets SHAPE_BUDGET_STRICT).
 */
const BUDGET_MS = process.env.SHAPE_BUDGET_STRICT ? 300 : 1000;
const dE = (a: string, b: string) => deltaE2000(hexToLab(a), hexToLab(b));

describe('golden shapes (PF-T9)', () => {
  it.each(GOLDEN_SHAPES.map((c) => [c.name, c] as const))('%s', async (_, c) => {
    // Best of 3 (the first also warms sharp and the JIT): the budget is the steady-state math, and the
    // fastest run filters out what is left of the contention from other test files running in parallel.
    const runs = [await run(c), await run(c), await run(c)];
    const { shape } = runs[runs.length - 1]!;
    const ms = Math.min(...runs.map((r) => r.cpuMs));
    expect(shape.mode).toBe('recipe');
    const recipe = shape.recipe!;
    // Silhouette matches the expected outline.
    expect(shape.fit!.iou).toBeGreaterThanOrEqual(0.75);
    // Colours measured on the photo, not Spark's wrong ones.
    // Templates put the main body first (walls, pole, canopy, car body).
    const main = recipe.parts[0]!.color;
    const colours = recipe.parts.map((p) => p.color);
    expect(dE(main, c.expect.main)).toBeLessThan(10);
    if (c.expect.secondary) {
      expect(Math.min(...colours.map((x) => dE(x, c.expect.secondary!)))).toBeLessThan(10);
    }
    if (c.expect.gables) {
      expect(recipe.parts.filter((p) => p.shape === 'prism')).toHaveLength(c.expect.gables);
    }
    if (c.name === 'cottage row') {
      expect(recipe.swatches?.stone).toBeDefined();
      expect(recipe.swatches?.slate).toBeDefined();
    }
    // The look rules reach the answer (PR #15 review): the gloss read on the photo is on the final recipe and
    // only for smooth materials; a flat drawn car body has no highlight (its windows and wheels are read apart).
    // The lamp post's dark pole is paint over metal: it keeps its measured colour instead of turning silver.
    if (c.name === 'car') expect(['matt', 'satin']).toContain(recipe.gloss?.painted);
    for (const m of ['stone', 'slate', 'foliage', 'wood'] as const)
      expect(recipe.gloss?.[m]).toBeUndefined();
    if (c.name === 'lamp post') expect(recipe.parts[0]!.material).toBe('painted');
    // All the math (crop, samples, colours, roof, repetition, perspective, fit) inside the budget.
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
