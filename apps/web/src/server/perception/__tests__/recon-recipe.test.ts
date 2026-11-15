import { describe, expect, it } from 'vitest';
import { MAX_VIEW_PARTS } from '@/lib/object-shape';
import type { Solid } from '../recon/carve';
import type { Palette } from '../recon/palette';
import { solidsToRecipe } from '../recon/recipe';

const span = (lo: number, hi: number, rows: number) => ({
  start: 0,
  lo: Array.from({ length: rows }, () => lo),
  hi: Array.from({ length: rows }, () => hi),
});

describe('solids to recipe', () => {
  it('keeps a model whose gables would pass the parts limit (PQ-T74)', () => {
    const box = { x0: 0, x1: 40, y0: 0, y1: 20, z0: 0, z1: 30 };
    const roof: Solid = {
      role: 'volume',
      cls: 0,
      shape: 'hull',
      box,
      front: span(0, 39, 20),
      roof: true,
      visible: 100,
    };
    // Each gable detail of the roof gives two parts: 60 of them alone pass the limit.
    const gables: Solid[] = Array.from({ length: 60 }, () => ({
      role: 'detail',
      cls: 1,
      shape: 'extrude',
      box: { x0: 10, x1: 20, y0: 5, y1: 15, z0: 28, z1: 30 },
      front: span(10, 19, 10),
      face: 'front',
      on: 0,
      roof: true,
      visible: 10,
    }));
    const classes = ['#8a4b38', '#d8cfc0'].map((hex) => ({
      hex,
      lab: [50, 0, 0] as [number, number, number],
      share: 0.5,
      paper: false,
    }));
    const palette: Palette = { classes, labels: {} };
    const { recipe, classOf } = solidsToRecipe([roof, ...gables], palette, { W: 40, H: 20, D: 30 });
    expect(recipe.parts).toHaveLength(MAX_VIEW_PARTS);
    expect(classOf).toHaveLength(MAX_VIEW_PARTS);
    expect(recipe.parts[0]!.shape).toBe('hip');
  });
});
