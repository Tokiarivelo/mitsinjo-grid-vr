// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
vi.mock('server-only', () => ({}));
import { scoreDetail, type GridPart } from '../detail-score';
import { renderFlat, type FlatRender } from '../flat-render';
import { detailParts, gridParts, scoreRecipe } from '../score-shape';
import { GOLDEN_SHAPES } from '../__fixtures__/shape';
import { runGolden } from './golden-run';

const N = 96;
const BODY: RecipePart = {
  shape: 'box',
  at: [0, 0.05, 0],
  size: [0.9, 0.5, 0.6],
  color: '#b03030',
  front: true,
  kind: 'body',
};
const wheel = (x: number): RecipePart => ({
  shape: 'cylinder',
  axis: 'z',
  at: [x, -0.25, 0.25],
  size: [0.22, 0.22, 0.12],
  color: '#1c1c1c',
  kind: 'wheel',
});
const WINDOW: RecipePart = {
  shape: 'box',
  at: [-0.18, 0.15, 0.31],
  size: [0.26, 0.16, 0.02],
  color: '#8fa3b5',
  kind: 'window',
};
const DOOR: RecipePart = {
  shape: 'box',
  at: [0.22, 0.02, 0.31],
  size: [0.2, 0.3, 0.02],
  color: '#5a1a1a',
  kind: 'door',
};
const TRUTH = [BODY, wheel(-0.3), wheel(0.3), WINDOW, DOOR];
const recipe = (parts: RecipePart[]): ObjectRecipe => ({
  proportions: { w: 1, h: 1, d: 1 },
  parts,
});
const render = (parts: RecipePart[]) => renderFlat(recipe(parts), 1, N, N);

/** The « photo »: the true model drawn flat, its outline, and SAM boxes = its visible part boxes. */
const photo = render(TRUTH);
const crop = { cols: N, rows: N, rgb: photo.rgb };
const CONCEPT = { wheel: 'wheel', window: 'window', door: 'door' } as const;
function samBoxes(r: FlatRender, parts: RecipePart[]): GridPart[] {
  return parts.flatMap((p, k) => {
    const concept = CONCEPT[p.kind as keyof typeof CONCEPT];
    if (!concept) return [];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
    r.part.forEach((v, i) => {
      if (v !== k) return;
      const [c, row] = [i % N, Math.floor(i / N)];
      [x0, y0, x1, y1] = [
        Math.min(x0, c),
        Math.min(y0, row),
        Math.max(x1, c + 1),
        Math.max(y1, row + 1),
      ];
    });
    return x1 > 0 ? [{ concept, x0, y0, x1, y1 }] : [];
  });
}
const SAM = samBoxes(photo, TRUTH);
const detail = (parts: RecipePart[]) =>
  scoreDetail({
    render: render(parts),
    crop,
    outline: photo.mask,
    parts: detailParts(recipe(parts)),
    samParts: SAM,
  });

describe('detail score (PQ-T2)', () => {
  it('sees every part of the true model', () => {
    expect(SAM.map((s) => s.concept).sort()).toEqual(['door', 'wheel', 'wheel', 'window']);
    const d = detail(TRUTH);
    expect(d.partRecall).toBe(1);
    expect(d.partPrecision).toBe(1);
    expect(d.partDeltaE).toBeLessThan(1);
    expect(d.interiorEdgeF1).toBeGreaterThan(0.9);
  });

  it('a model with one wheel removed loses recall', () => {
    const d = detail([BODY, wheel(-0.3), WINDOW, DOOR]);
    expect(d.partRecall).toBe(0.75);
    expect(d.partPrecision).toBe(1);
  });

  it('a model with an invented window loses precision', () => {
    const extra: RecipePart = { ...WINDOW, at: [0.22, 0.2, 0.32], size: [0.12, 0.08, 0.02] };
    const d = detail([...TRUTH, extra]);
    expect(d.partRecall).toBe(1);
    expect(d.partPrecision).toBeLessThan(1);
  });

  it('ignores parts inferred on hidden sides', () => {
    const extra: RecipePart = {
      ...WINDOW,
      at: [0.22, 0.2, 0.32],
      size: [0.12, 0.08, 0.02],
      status: 'inferred',
    };
    expect(detail([...TRUTH, extra]).partPrecision).toBe(1);
  });

  it('a model with the door line added gains interior edge F1', () => {
    const without = detail([BODY, wheel(-0.3), wheel(0.3), WINDOW]).interiorEdgeF1!;
    const withDoor = detail(TRUTH).interiorEdgeF1!;
    expect(withDoor).toBeGreaterThan(without);
  });

  it('a matched part of the wrong colour raises the part ΔE', () => {
    const d = detail([BODY, wheel(-0.3), wheel(0.3), { ...WINDOW, color: '#f0e040' }, DOOR]);
    expect(d.partRecall).toBe(1);
    expect(d.partDeltaE).toBeGreaterThan(5);
  });

  it('leaves the part numbers out without SAM parts', () => {
    const d = scoreDetail({
      render: photo,
      crop,
      outline: photo.mask,
      parts: detailParts(recipe(TRUTH)),
      samParts: [],
    });
    expect(d.partRecall).toBeUndefined();
    expect(d.partPrecision).toBeUndefined();
    expect(d.partDeltaE).toBeUndefined();
    expect(d.interiorEdgeF1).toBeGreaterThan(0.9);
  });

  it('guesses wheel and panel kinds on untagged kit parts', () => {
    const untagged = TRUTH.map((p) => {
      const copy = { ...p };
      delete copy.kind;
      return copy;
    });
    expect(detailParts(recipe(untagged)).map((p) => p.kinds)).toEqual([
      [],
      ['wheel'],
      ['wheel'],
      ['window', 'door'],
      ['window', 'door'],
    ]);
  });

  it('maps part masks from crop fractions onto the fit grid', () => {
    const geom = {
      photoW: 1000,
      photoH: 500,
      box: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
      crop: { left: 100, top: 50, width: 600, height: 300, outWidth: 600, outHeight: 300 },
    };
    const [g] = gridParts(
      [{ concept: 'wheel', box: { x: 1 / 6, y: 1 / 6, w: 1 / 3, h: 1 / 3 } }],
      geom,
      100,
      50
    );
    expect(g!.concept).toBe('wheel');
    expect(g!.x0).toBeCloseTo(0);
    expect(g!.y0).toBeCloseTo(0);
    expect(g!.x1).toBeCloseTo(50);
    expect(g!.y1).toBeCloseTo(25);
    expect(gridParts([{ concept: 'door', box: { x: 0, y: 0, w: 0, h: 1 } }], geom, 10, 10)).toEqual(
      []
    );
  });

  it('scoreRecipe attaches the detail numbers (no part masks → interior edges only)', async () => {
    const { shape, photo: p, target } = await runGolden(GOLDEN_SHAPES[3]!);
    const s = (await scoreRecipe(p, target, shape.recipe!))!;
    expect(s.score.detail?.interiorEdgeF1).toBeGreaterThanOrEqual(0);
    expect(s.score.detail?.partRecall).toBeUndefined();
  });
});
