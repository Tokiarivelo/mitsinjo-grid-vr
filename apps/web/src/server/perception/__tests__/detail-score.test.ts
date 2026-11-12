// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
vi.mock('server-only', () => ({}));
import {
  anatomyMissing,
  anatomyRecall,
  bandDifference,
  degenerateView,
  scoreDetail,
  ssim,
  type GridPart,
} from '../detail-score';
import { kitToRecipe } from '@/lib/object-kit';
import { iou } from '../silhouette-fit';
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

describe('inside the outline, by height band (PQ-T36)', () => {
  it('SSIM is 1 on equal samples and drops on a flat copy of a contrasted one', () => {
    expect(ssim([0.2, 0.8, 0.2, 0.8], [0.2, 0.8, 0.2, 0.8])).toBeCloseTo(1, 6);
    expect(ssim([0.2, 0.8, 0.2, 0.8], [0.5, 0.5, 0.5, 0.5])).toBeLessThan(0.1);
  });

  it('a model with its window deleted drops in the window band while IoU stays', () => {
    const without = [BODY, wheel(-0.3), wheel(0.3), DOOR];
    const r = render(without);
    expect(iou(r.mask, photo.mask)).toBeGreaterThan(0.99);
    const full = bandDifference(render(TRUTH), crop, photo.mask)!;
    const holed = bandDifference(r, crop, photo.mask)!;
    expect(full.every((b) => b.ssim > 0.99)).toBe(true);
    // The body spans y −0.2…0.3 and the window 0.07…0.23: bands 0–2 of 8 from the top.
    const d = detail(without);
    expect(d.bandSsim).toBeLessThan(0.9);
    expect([0, 1, 2]).toContain(d.worstBand);
    expect(holed.slice(3).every((b) => b.ssim > 0.99)).toBe(true);
    expect(holed[d.worstBand!]!.ssim).toBeLessThan(full[d.worstBand!]!.ssim);
    expect(d.blankBands).toBe(0);
  });

  it('counts a band the model leaves blank', () => {
    const low = render([{ ...BODY, at: [0, -0.1, 0], size: [0.9, 0.3, 0.6] }]);
    const d = scoreDetail({
      render: low,
      crop,
      outline: photo.mask,
      parts: detailParts(recipe([BODY])),
      samParts: [],
    });
    expect(d.blankBands).toBeGreaterThan(0);
  });
});

describe('degenerate view (PQ-T36)', () => {
  it('a paper-thin car fails, the same car with its depth passes', () => {
    const car = recipe(TRUTH);
    expect(degenerateView(car, 'vehicle').fail).toBeNull();
    const thin = {
      ...car,
      proportions: { ...car.proportions, d: 0.04 },
    };
    const v = degenerateView(thin, 'vehicle');
    expect(v.fail).toBe('thin');
    expect(v.sideShare).toBeLessThan(0.15);
  });

  it('a TV is flat by nature and passes', () => {
    const tv = kitToRecipe({
      archetype: 'screen',
      proportions: { w: 1, h: 0.6, d: 0.05 },
      colors: { main: '#111111', secondary: '#222222', accent: '#333333' },
    });
    expect(degenerateView(tv, 'screen').fail).toBeNull();
  });

  it('a part floating off the body at 45° is caught', () => {
    const floating: RecipePart = {
      ...BODY,
      at: [0, 0.5, 0],
      size: [0.1, 0.1, 0.1],
      kind: 'light',
    };
    const v = degenerateView(recipe([BODY, floating]), 'vehicle');
    expect(v.pieces45).toBeGreaterThan(1);
    expect(v.fail).toBe('detached');
  });
});

describe('anatomy recall (PQ-T46)', () => {
  // TRUTH: body, two wheels, one window, one door.
  const parts = () => detailParts(recipe(TRUTH));

  it('counts the closed-list parts answered present that the model builds', () => {
    expect(anatomyRecall(['wheels', 'rear window', 'door'], parts())).toBe(1);
    expect(anatomyRecall(['wheels', 'grille'], parts())).toBe(0.5);
    expect(anatomyRecall(['Side Mirrors', 'wheels', 'wheels'], parts())).toBe(0.5);
    expect(anatomyRecall([], parts())).toBeUndefined();
  });

  it('names the missing parts by their exact closed-list name', () => {
    expect(anatomyMissing(['wheels', 'grille', 'side mirrors'], parts())).toEqual([
      'grille',
      'side mirrors',
    ]);
    expect(anatomyMissing(['windshield', 'tail lights'], parts())).toEqual(['tail lights']);
  });

  it('scoreDetail reports it beside the SAM numbers, absent without an inventory', () => {
    const d = scoreDetail({
      render: photo,
      crop,
      outline: photo.mask,
      parts: parts(),
      samParts: SAM,
      anatomy: ['wheels', 'grille'],
    });
    expect(d.anatomyRecall).toBe(0.5);
    expect(d.partRecall).toBe(1);
    expect(detail(TRUTH).anatomyRecall).toBeUndefined();
  });

  it('a template car builds its rear window through the generic map (E5 success)', () => {
    const car = kitToRecipe({
      archetype: 'vehicle',
      subtype: 'sedan',
      proportions: { w: 1, h: 0.4, d: 0.45 },
      colors: { main: '#a33327', secondary: '#cfd6dd', accent: '#1c1c1e' },
    });
    const names = [
      'windshield',
      'rear window',
      'side windows',
      'wheels',
      'headlights',
      'tail lights',
    ];
    expect(anatomyMissing(names, detailParts(car))).toEqual([]);
  });
});
