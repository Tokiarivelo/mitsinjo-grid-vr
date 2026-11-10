// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
vi.mock('server-only', () => ({}));
import { hexToRgb } from '../color-measure';
import { renderFlat } from '../flat-render';
import {
  edgeMap,
  SCORE_WEIGHTS,
  SCORE_WEIGHTS_DETAIL,
  SCORE_WEIGHTS_LANDMARKS,
  scoreModel,
  weightDetail,
  type ModelScore,
  type RgbGrid,
} from '../model-score';
import { scoreRecipe } from '../score-shape';
import { emptyMask, type Mask } from '../silhouette-fit';
import { GOLDEN_SHAPES } from '../__fixtures__/shape';
import { runGolden } from './golden-run';

const N = 64;
const part = (over: Partial<RecipePart>): RecipePart => ({
  shape: 'box',
  at: [0, 0, 0],
  size: [0.6, 0.6, 0.6],
  color: '#3060c0',
  ...over,
});
const recipe = (parts: RecipePart[]): ObjectRecipe => ({
  proportions: { w: 1, h: 1, d: 1 },
  parts,
});

/** A photo painted from rectangles (grid fractions) over a background. */
function photo(bg: string, rects: Array<[number, number, number, number, string]>): RgbGrid {
  const rgb = new Uint8Array(N * N * 3);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const [x, y] = [(c + 0.5) / N, (r + 0.5) / N];
      const hit = rects.findLast(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
      rgb.set(hexToRgb(hit ? hit[4] : bg), (r * N + c) * 3);
    }
  }
  return { cols: N, rows: N, rgb };
}
const maskOf = (x0: number, y0: number, x1: number, y1: number): Mask => {
  const m = emptyMask(N, N);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const [x, y] = [(c + 0.5) / N, (r + 0.5) / N];
      if (x >= x0 && x < x1 && y >= y0 && y < y1) m.data[r * N + c] = 1;
    }
  return m;
};

const SKY = '#a0c0e0';
const square = [0.2, 0.2, 0.8, 0.8] as const;

describe('scoreModel (PR-0.2)', () => {
  it('a model that matches the photo scores ~100', () => {
    const s = scoreModel(
      renderFlat(recipe([part({})]), 1, N, N),
      photo(SKY, [[...square, '#3060c0']]),
      maskOf(...square)
    );
    expect(s.iou).toBe(1);
    expect(s.edgeF1).toBeGreaterThan(0.95);
    expect(s.deltaE).toBeLessThan(1);
    expect(s.score).toBeGreaterThanOrEqual(98);
  });

  it('a wrong colour costs the colour term only', () => {
    const s = scoreModel(
      renderFlat(recipe([part({ color: '#c03030' })]), 1, N, N),
      photo(SKY, [[...square, '#3060c0']]),
      maskOf(...square)
    );
    expect(s.iou).toBe(1);
    expect(s.deltaE).toBeGreaterThan(25);
    expect(s.score).toBeLessThanOrEqual(76);
  });

  it('a window on the photo that the model lacks lowers the edge F1', () => {
    const plain = photo(SKY, [[...square, '#3060c0']]);
    const windowed = photo(SKY, [
      [...square, '#3060c0'],
      [0.35, 0.3, 0.65, 0.5, '#101820'],
    ]);
    const render = renderFlat(recipe([part({})]), 1, N, N);
    const a = scoreModel(render, plain, maskOf(...square));
    const b = scoreModel(render, windowed, maskOf(...square));
    expect(b.edgeF1).toBeLessThan(a.edgeF1 - 0.1);
    expect(b.score).toBeLessThan(a.score);
  });

  it('a shifted model loses IoU and score', () => {
    const s = scoreModel(
      renderFlat(recipe([part({ at: [0.25, 0, 0] })]), 1, N, N),
      photo(SKY, [[...square, '#3060c0']]),
      maskOf(...square)
    );
    expect(s.iou).toBeLessThan(0.5);
    expect(s.score).toBeLessThan(70);
  });

  it('background edges far from the outline are ignored', () => {
    const region = maskOf(0, 0, 0.5, 1);
    const busy = photo(SKY, [[0.7, 0.1, 0.9, 0.3, '#000000']]);
    expect(edgeMap(busy, region).data.some((v) => v === 1)).toBe(false);
    expect(edgeMap(busy).data.some((v) => v === 1)).toBe(true);
  });

  it('without landmarks the term stays undefined (classic weights)', () => {
    const s = scoreModel(
      renderFlat(recipe([part({})]), 1, N, N),
      photo(SKY, [[...square, '#3060c0']]),
      maskOf(...square)
    );
    expect(s.landmark).toBeUndefined();
    expect('landmark' in s).toBe(false);
    expect(s.score).toBeGreaterThanOrEqual(98);
  });
});

describe('landmarks (PR-0.8)', () => {
  const wheel = part({
    shape: 'cylinder',
    axis: 'z',
    at: [-0.2, -0.2, 0.3],
    size: [0.2, 0.2, 0.1],
    color: '#1c1c1e',
  });
  const body = part({});
  const img = photo(SKY, [[...square, '#3060c0']]);
  const mask = maskOf(...square);
  /** Rendered centroid of a part, in grid pixels. */
  const centroid = (render: ReturnType<typeof renderFlat>, k: number) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < render.part.length; i++) {
      if (render.part[i] !== k) continue;
      sx += i % N;
      sy += Math.floor(i / N);
      n++;
    }
    return { x: sx / n, y: sy / n, n };
  };

  it('a part on its mask scores ~1, a shifted part scores lower', () => {
    const render = renderFlat(recipe([body, wheel]), 1, N, N);
    const c = centroid(render, 1);
    expect(c.n).toBeGreaterThan(4);
    const lm = [{ part: 1, x: c.x, y: c.y }];
    const base = scoreModel(render, img, mask, lm);
    expect(base.landmark).toBeCloseTo(1, 2);
    const shifted = renderFlat(recipe([body, { ...wheel, at: [0.2, -0.2, 0.3] }]), 1, N, N);
    const bad = scoreModel(shifted, img, mask, lm);
    expect(bad.landmark).toBeLessThan(0.5);
    expect(bad.score).toBeLessThan(base.score);
  });

  it('hidden parts and unknown indices are skipped, not punished', () => {
    const render = renderFlat(recipe([body, wheel]), 1, N, N);
    const c = centroid(render, 1);
    const lone = scoreModel(render, img, mask, [{ part: 1, x: c.x, y: c.y }]);
    const padded = scoreModel(render, img, mask, [
      { part: 1, x: c.x, y: c.y },
      { part: 9, x: 0, y: 0 },
    ]);
    expect(padded.landmark).toBe(lone.landmark);
    expect(padded.score).toBe(lone.score);
  });
});

describe('scoreRecipe on the golden set (PR-0.2)', () => {
  it('scores every object, and the boxy car lower than the fridge', async () => {
    const scores: Record<string, number> = {};
    for (const c of GOLDEN_SHAPES) {
      const { shape, photo: p, target } = await runGolden(c);
      const { score: s } = (await scoreRecipe(p, target, shape.recipe!))!;
      expect(s.iou, c.name).toBeGreaterThan(0.6);
      expect(s.score, c.name).toBeGreaterThan(0);
      scores[c.name] = s.score;
    }
    expect(scores.car).toBeLessThan(scores.fridge!);
  }, 20_000);

  it('is null without an outline', async () => {
    const { shape, photo: p, target } = await runGolden(GOLDEN_SHAPES[2]!);
    expect(await scoreRecipe(p, { box: target.box }, shape.recipe!)).toBeNull();
  });
});

describe('detail weights (PQ-T6)', () => {
  const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
  const base: ModelScore = { iou: 0.8, edgeF1: 0.5, deltaE: 10, score: 66 };

  it('every weight set sums to 1', () => {
    for (const w of [SCORE_WEIGHTS, SCORE_WEIGHTS_LANDMARKS, SCORE_WEIGHTS_DETAIL])
      expect(sum(w)).toBeCloseTo(1, 10);
  });

  it('without part masks the classic score stays', () => {
    expect(weightDetail(base)).toBe(base);
    const noParts = { ...base, detail: { interiorEdgeF1: 0.3 } };
    expect(weightDetail(noParts)).toBe(noParts);
  });

  it('with part masks, missing parts pull the score down', () => {
    const all = weightDetail({ ...base, detail: { partRecall: 1, partPrecision: 1 } });
    const half = weightDetail({ ...base, detail: { partRecall: 0.5, partPrecision: 1 } });
    // 100 × (0.3·0.8 + 0.25·0.5 + 0.2·(1 − 10/25) + 0.25·1) = 73.5
    expect(all.score).toBe(74);
    expect(half.score).toBeLessThan(all.score);
  });
});
