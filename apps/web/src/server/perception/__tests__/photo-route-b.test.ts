// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { kitToRecipe } from '@/lib/object-kit';
import type { ShapeTarget } from '@/lib/object-shape';
import { runObjectShape } from '../object-shape';
import { GOLDEN_SHAPES, goldenBox, goldenOutline, goldenSvg, PHOTO } from '../__fixtures__/shape';

/** Route B on the photo path (PQ-T57): every object reaches the writer, the draft survives a loss. */
describe('photo path route B (PQ-T57)', () => {
  it('asks the writer (prompt v2) for a fitted object and keeps the draft when nothing wins', async () => {
    const c = GOLDEN_SHAPES.find((g) => g.name === 'car')!;
    const buffer = await sharp(Buffer.from(goldenSvg(c)))
      .jpeg({ quality: 85 })
      .toBuffer();
    const target: ShapeTarget = {
      id: c.name,
      label: c.name,
      category: 'other',
      box: goldenBox(c),
      outline: goldenOutline(c),
    };
    const writeBuildCode = vi.fn().mockResolvedValue({
      model: 'muse-wonder-1.0',
      code: "return [{shape:'box',at:[9,9,9],size:[1,1,1],color:'#ff0000'}];",
    });
    const spark = {
      describeShape: vi.fn().mockResolvedValue({
        recipe: kitToRecipe(c.prior),
        kit: c.prior,
        source: 'meta',
        model: 'muse-spark-1.3',
      }),
      describeParts: vi.fn().mockResolvedValue({ recipe: null }),
      writeBuildCode,
    };
    const onCode = vi.fn();
    const onStage = vi.fn();
    const shape = await runObjectShape(spark, { buffer, ...PHOTO }, 'data:full', target, {
      onCode,
      onStage,
    });
    expect(writeBuildCode).toHaveBeenCalled();
    const [image, question, , version] = writeBuildCode.mock.calls[0]!;
    expect(String(image)).toMatch(/^data:image\//);
    expect(question).toContain('Draft score');
    expect(question).toContain(`(${c.prior.archetype})`);
    expect(version).toBeUndefined(); // the live default prompt (v3)
    // The writer's body is out of range: no gain, the fitted draft is what ships.
    expect(onCode).not.toHaveBeenCalled();
    // PQ-T60: the draft previews at once, each lost round reports its stop.
    expect(onStage.mock.calls[0]![0]).toMatchObject({ phase: 'first', state: 'running', index: 1 });
    expect(onStage.mock.calls[0]![0].recipe.parts.length).toBeGreaterThan(0);
    expect(onStage.mock.calls.some(([e]) => e.state === 'done' && e.stop === 'error')).toBe(true);
    expect(shape.mode).toBe('recipe');
    expect(shape.recipe!.parts.length).toBeGreaterThan(0);
  });
});
