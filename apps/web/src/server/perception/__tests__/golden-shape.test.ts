// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { deltaE2000, hexToLab } from '../color-measure';
import { GOLDEN_SHAPES } from '../__fixtures__/shape';
import { runGolden as run } from './golden-run';

/**
 * Math budget per object (best of 3 runs): 300 ms when run alone (`make test-shape` sets
 * SHAPE_BUDGET_STRICT); inside the full suite (many test files share the CPU; 1026 ms seen once against
 * a 1000 ms budget) it is only a guard against a gross regression.
 */
const BUDGET_MS = process.env.SHAPE_BUDGET_STRICT ? 300 : 2500;
const dE = (a: string, b: string) => deltaE2000(hexToLab(a), hexToLab(b));

describe('golden shapes (PF-T9)', () => {
  it.each(GOLDEN_SHAPES.map((c) => [c.name, c] as const))('%s', async (_, c) => {
    // Best of 3 (the first also warms sharp and the JIT): the budget is the steady-state math, and the
    // fastest run filters out CPU contention from other test files running in parallel.
    const runs = [await run(c), await run(c), await run(c)];
    const { shape } = runs[runs.length - 1]!;
    const ms = Math.min(...runs.map((r) => r.ms));
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
    // All the math (crop, samples, colours, roof, repetition, perspective, fit) inside the budget.
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
