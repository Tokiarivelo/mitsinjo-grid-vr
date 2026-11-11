// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ObjectRecipe } from '@/lib/object-shape';
import { classifyGloss, highlightGap, MIN_GLOSS_CELLS, measureRecipeGloss } from '../gloss-measure';
import type { RgbGrid } from '../model-score';

/** 200 cells around L* 50 with the given spikes. */
const cells = (spikes: number[] = []) => [...Array(200 - spikes.length).fill(50), ...spikes];

describe('gloss-measure (PQ-T26)', () => {
  it('a region with a sharp highlight is gloss, a flat one is matt', () => {
    expect(classifyGloss(cells([95, 95]))).toBe('gloss');
    expect(classifyGloss(cells())).toBe('matt');
  });

  it('a soft sheen in between is satin', () => {
    expect(classifyGloss(cells([50 + 22, 50 + 22]))).toBe('satin');
  });

  it('too few cells are not classed; an empty list has no gap', () => {
    expect(classifyGloss(Array(MIN_GLOSS_CELLS - 1).fill(50))).toBeNull();
    expect(highlightGap([])).toBe(0);
  });

  it('measures per material on the cells each part covers', () => {
    const cols = 20;
    const rows = 20;
    const rgb = Buffer.alloc(cols * rows * 3, 120);
    // The right half (the metal part) holds white specular pixels, the left half (the plaster) is flat.
    for (let j = 0; j < rows; j++)
      for (let i = 10; i < cols; i++)
        if ((i + j) % 25 === 0) rgb.fill(255, (j * cols + i) * 3, (j * cols + i) * 3 + 3);
    const grid: RgbGrid = { cols, rows, rgb };
    const recipe: Pick<ObjectRecipe, 'parts'> = {
      parts: [
        {
          shape: 'box',
          at: [-0.25, 0, 0],
          size: [0.5, 1, 1],
          color: '#888888',
          material: 'plaster',
        },
        { shape: 'box', at: [0.25, 0, 0], size: [0.5, 1, 1], color: '#888888', material: 'metal' },
        { shape: 'box', at: [0, 0, 0], size: [0.1, 0.1, 1], color: '#888888' },
      ],
    };
    const out = measureRecipeGloss(grid, [], { x: 0, y: 0, w: 1, h: 1 }, recipe);
    expect(out.plaster).toBe('matt');
    expect(out.metal).toBe('gloss');
  });
});
