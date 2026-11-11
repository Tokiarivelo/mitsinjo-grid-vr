// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { ObjectRecipe } from '@/lib/object-shape';
import {
  classifyGloss,
  highlightGap,
  MIN_GLOSS_CELLS,
  measureRecipeGloss,
  SPECULAR_MATERIALS,
} from '../gloss-measure';
import type { RgbGrid } from '../model-score';

/** 200 cells around L* 50 with the given spikes. */
const cells = (spikes: number[] = []) => [...Array(200 - spikes.length).fill(50), ...spikes];

describe('gloss-measure (PQ-T26)', () => {
  it('a region with a sharp highlight is gloss, a flat one is matt', () => {
    expect(classifyGloss(cells([95, 95]))).toBe('gloss');
    expect(classifyGloss(cells())).toBe('matt');
  });

  it('a soft sheen in between is satin', () => {
    expect(classifyGloss(cells([50 + 10, 50 + 10]))).toBe('satin');
  });

  it('too few cells are not classed; an empty list has no gap', () => {
    expect(classifyGloss(Array(MIN_GLOSS_CELLS - 1).fill(50))).toBeNull();
    expect(highlightGap([])).toBe(0);
  });

  it('measures per material on the cells each part covers', () => {
    const cols = 20;
    const rows = 20;
    const rgb = Buffer.alloc(cols * rows * 3, 120);
    // The right half (the metal part) holds white specular pixels, the left half (the plastic) is flat.
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
          material: 'plastic',
        },
        { shape: 'box', at: [0.25, 0, 0], size: [0.5, 1, 1], color: '#888888', material: 'metal' },
        { shape: 'box', at: [0, 0, 0], size: [0.1, 0.1, 1], color: '#888888' },
      ],
    };
    const out = measureRecipeGloss(grid, [], { x: 0, y: 0, w: 1, h: 1 }, recipe);
    expect(out.plastic).toBe('matt');
    expect(out.metal).toBe('gloss');
  });
  /** A 20 × 20 grid painted by `at(i, j)` (grey level), and a recipe of two halves in the given materials. */
  const halves = (
    at: (i: number, j: number) => number,
    left: NonNullable<ObjectRecipe['parts'][number]['material']>,
    right: NonNullable<ObjectRecipe['parts'][number]['material']>
  ) => {
    const cols = 20;
    const rows = 20;
    const rgb = Buffer.alloc(cols * rows * 3);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) rgb.fill(at(i, j), (j * cols + i) * 3, (j * cols + i) * 3 + 3);
    const part = (x: number, material: typeof left) => ({
      shape: 'box' as const,
      at: [x, 0, 0] as [number, number, number],
      size: [0.5, 1, 1] as [number, number, number],
      color: '#888888',
      material,
    });
    return measureRecipeGloss(
      { cols, rows, rgb },
      [],
      { x: 0, y: 0, w: 1, h: 1 },
      { parts: [part(-0.25, left), part(0.25, right)] }
    );
  };

  it('two flat parts of one material in different colours are not a highlight (dark pole, pale cap)', () => {
    const out = halves((i) => (i < 10 ? 40 : 230), 'metal', 'metal');
    expect(out.metal).toBe('matt');
  });

  it('a two-tone surface (livery, mortar) is not gloss: the bright share is wide, not a highlight', () => {
    const out = halves((i, j) => (i < 10 && j % 4 === 0 ? 240 : 60), 'painted', 'plastic');
    expect(out.painted).not.toBe('gloss');
  });

  it('rough materials are never classed: a bright spot on plaster or foliage is not a reflection', () => {
    const spots = (i: number, j: number) => ((i + j) % 25 === 0 ? 255 : 120);
    const out = halves(spots, 'plaster', 'foliage');
    expect(out).toEqual({});
    expect(halves(spots, 'brick', 'painted')).toEqual({ painted: 'gloss' });
    for (const m of ['stone', 'brick', 'plaster', 'wood', 'thatch', 'foliage', 'fabric'] as const)
      expect(SPECULAR_MATERIALS).not.toContain(m);
  });
  it('glass without a highlight keeps its default look: flat light does not make it matt', () => {
    expect(halves(() => 120, 'glass', 'plastic')).toEqual({ plastic: 'matt' });
  });
  it('a window on a door takes its own cells: the pale glass is not a highlight of the paint', () => {
    const cols = 20;
    const rows = 20;
    const rgb = Buffer.alloc(cols * rows * 3, 90);
    // A pale 4 × 4 window in the middle of a flat dark door.
    for (let j = 8; j < 12; j++)
      for (let i = 8; i < 12; i++) rgb.fill(235, (j * cols + i) * 3, (j * cols + i) * 3 + 3);
    const door = {
      shape: 'box' as const,
      at: [0, 0, 0] as [number, number, number],
      size: [1, 1, 1] as [number, number, number],
      color: '#5a5a5a',
      material: 'painted' as const,
    };
    const pane = {
      ...door,
      size: [0.2, 0.2, 0.02] as [number, number, number],
      kind: 'window' as const,
    };
    const at = { x: 0, y: 0, w: 1, h: 1 };
    const grid: RgbGrid = { cols, rows, rgb };
    expect(measureRecipeGloss(grid, [], at, { parts: [door] }).painted).toBe('gloss');
    // The pane is listed after the door and has no material: it still takes its cells.
    const { material: _m, ...bare } = pane;
    expect(measureRecipeGloss(grid, [], at, { parts: [door, bare] }).painted).toBe('matt');
  });
});
