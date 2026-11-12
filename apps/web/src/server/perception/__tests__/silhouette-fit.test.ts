// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ObjectKit } from '@/lib/object-kit';
import { SDF_BALL, SDF_PERSON, sdfPart, sdfRecipe } from '@/test/sdf-blobs';
import { nelderMead } from '../nelder-mead';
import {
  chamfer,
  convexHull,
  edgeDistance,
  emptyMask,
  fillPolygons,
  fitSilhouette,
  iou,
  renderRecipe,
  ringsMask,
} from '../silhouette-fit';

const box = { x: 0, y: 0, w: 1, h: 1 };
const colors = { main: '#c9a36a', secondary: '#6e6a62', accent: '#ffffff' };

/** Row of `n` even gables: walls up to `eave` (from the top), ridges at the top (box fractions). */
function rowOutline(n: number, eave: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [0, 1],
    [1, 1],
    [1, eave],
  ];
  for (let i = n - 1; i >= 0; i--) pts.push([(i + 0.5) / n, 0], [i / n, eave]);
  return pts;
}

describe('nelderMead (PF-T6)', () => {
  it('finds the minimum of a bowl and of Rosenbrock, deterministic', () => {
    const bowl = nelderMead(([x, y]) => (x! - 1) ** 2 + (y! + 2) ** 2, [0, 0], [0.5, 0.5], {
      maxEvals: 200,
      tol: 1e-10,
    });
    expect(bowl.x[0]).toBeCloseTo(1, 3);
    expect(bowl.x[1]).toBeCloseTo(-2, 3);
    const rosen = ([x, y]: number[]) => 100 * (y! - x! ** 2) ** 2 + (1 - x!) ** 2;
    const a = nelderMead(rosen, [-1, 1], [0.5, 0.5], { maxEvals: 600, tol: 1e-12 });
    expect(a.fx).toBeLessThan(1e-3);
    expect(nelderMead(rosen, [-1, 1], [0.5, 0.5], { maxEvals: 600, tol: 1e-12 })).toEqual(a);
  });

  it('stops at the evaluation budget', () => {
    expect(
      nelderMead(([x]) => x! ** 2, [5], [1], { maxEvals: 10, tol: 0 }).evals
    ).toBeLessThanOrEqual(11);
  });
});

describe('raster, IoU, chamfer', () => {
  it('fills a triangle to half the grid; hull drops inner points', () => {
    const m = emptyMask(64, 64);
    fillPolygons(m, [
      [
        [0, 0],
        [64, 64],
        [0, 64],
      ],
    ]);
    const filled = m.data.reduce((s, v) => s + v, 0);
    expect(Math.abs(filled - 2048) / 2048).toBeLessThan(0.05);
    expect(
      convexHull([
        [0, 0],
        [2, 0],
        [1, 1],
        [2, 2],
        [0, 2],
      ])
    ).toHaveLength(4);
  });

  it('identical masks → IoU 1, chamfer 0; disjoint → IoU 0', () => {
    const a = ringsMask([rowOutline(3, 0.4)], box, 96, 64);
    expect(iou(a, a)).toBe(1);
    expect(chamfer(a, edgeDistance(a))).toBe(0);
    const left = ringsMask(
      [
        [
          [0, 0],
          [0.4, 0],
          [0.4, 1],
          [0, 1],
        ],
      ],
      box,
      96,
      64
    );
    const right = ringsMask(
      [
        [
          [0.6, 0],
          [1, 0],
          [1, 1],
          [0.6, 1],
        ],
      ],
      box,
      96,
      64
    );
    expect(iou(left, right)).toBe(0);
    expect(chamfer(left, edgeDistance(right))).toBeGreaterThan(0.1);
  });

  it('a one-box recipe fills its whole box', () => {
    const m = renderRecipe(
      {
        proportions: { w: 1, h: 0.5, d: 0.5 },
        parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#cccccc' }],
      },
      2,
      64,
      32
    );
    expect(m.data.every((v) => v === 1)).toBe(true);
  });
});

describe('fitSilhouette (PF-T6)', () => {
  const aspect = 1.5;

  it('row of 3 from Spark, no measured roof → 3 even gables kept, eave fitted, IoU ≥ 0.85', () => {
    const kit: ObjectKit = {
      archetype: 'house',
      proportions: { w: 1, h: 0.66, d: 0.5 },
      colors,
      details: { units: 3 },
    };
    const fit = fitSilhouette({ kit, rings: [rowOutline(3, 0.55)], box, aspect, canYaw: true })!;
    expect(fit.recipe.parts.filter((p) => p.shape === 'prism')).toHaveLength(3);
    expect(fit.iou).toBeGreaterThanOrEqual(0.85);
    expect(fit.iou).toBeGreaterThanOrEqual(fit.iouStart);
  });

  it('measured gables, eave guessed too high → the eave moves down, IoU rises', () => {
    const roof = {
      eave: 0.25,
      gables: [0, 1].map((i) => ({ x0: i / 2, x1: (i + 1) / 2, peak: (i + 0.5) / 2, top: 0 })),
    };
    const kit: ObjectKit = {
      archetype: 'house',
      proportions: { w: 1, h: 0.66, d: 0.5 },
      colors,
      roof,
    };
    const fit = fitSilhouette({ kit, rings: [rowOutline(2, 0.5)], box, aspect, canYaw: false })!;
    expect(fit.iou).toBeGreaterThan(fit.iouStart);
    expect(fit.iou).toBeGreaterThanOrEqual(0.9);
  });

  it('a tree is never turned; empty outline → null; fast and deterministic', () => {
    const tree: ObjectKit = { archetype: 'tree', proportions: { w: 0.8, h: 1, d: 0.8 }, colors };
    const disc = Array.from({ length: 24 }, (_, i) => {
      const a = (2 * Math.PI * i) / 24;
      return [0.5 + 0.5 * Math.cos(a), 0.35 + 0.35 * Math.sin(a)] as [number, number];
    });
    const t0 = performance.now();
    const fit = fitSilhouette({
      kit: tree,
      rings: [disc],
      box,
      aspect: 0.8,
      yaw0: 0.5,
      canYaw: false,
    })!;
    expect(performance.now() - t0).toBeLessThan(300);
    expect(fit.recipe.yaw).toBeUndefined();
    expect(fit.evals).toBeLessThanOrEqual(150 + 3);
    expect(fitSilhouette({ kit: tree, rings: [disc], box, aspect: 0.8, canYaw: false })).toEqual(
      fitSilhouette({ kit: tree, rings: [disc], box, aspect: 0.8, canYaw: false })
    );
    expect(fitSilhouette({ kit: tree, rings: [], box, aspect: 0.8, canYaw: false })).toBeNull();
  });
});

describe('extrude points (PR-2.1)', () => {
  it('a triangle ring renders its hull: centre filled, about half the grid', () => {
    const m = renderRecipe(
      {
        proportions: { w: 1, h: 1, d: 1 },
        parts: [
          {
            shape: 'extrude',
            at: [0, 0, 0],
            size: [1, 1, 1],
            color: '#cccccc',
            points: [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0, 0.5],
            ],
          },
        ],
      },
      1,
      32,
      32
    );
    const filled = m.data.reduce((s, v) => s + v, 0);
    expect(filled).toBeGreaterThan(400);
    expect(filled).toBeLessThan(650);
    expect(m.data[16 * 32 + 16]).toBe(1);
  });

  it('a cone-profile lathe hulls exactly like a cone', () => {
    const at = { proportions: { w: 1, h: 1, d: 1 } } as const;
    const lathe = renderRecipe(
      {
        ...at,
        parts: [
          {
            shape: 'lathe',
            at: [0, 0, 0],
            size: [1, 1, 1],
            color: '#cccccc',
            profile: [
              [0.5, -0.5],
              [0, 0.5],
            ],
          },
        ],
      },
      1,
      32,
      32
    );
    const cone = renderRecipe(
      {
        ...at,
        parts: [{ shape: 'cone', at: [0, 0, 0], size: [1, 1, 1], color: '#cccccc' }],
      },
      1,
      32,
      32
    );
    expect([...lathe.data]).toEqual([...cone.data]);
  });
});

describe('sdf outline (PQ-T53 §8)', () => {
  it('an sdf ball hulls like the same-sized sphere', () => {
    const ball = renderRecipe(sdfRecipe(SDF_BALL), 1, 64, 64);
    const sphere = renderRecipe(
      {
        proportions: { w: 1, h: 1, d: 1 },
        parts: [{ shape: 'sphere', at: [0, 0, 0], size: [0.7, 0.7, 0.7], color: '#cccccc' }],
      },
      1,
      64,
      64
    );
    expect(iou(ball, sphere)).toBeGreaterThan(0.98);
  });

  it('a person-like union fills the grid centre, deterministically', () => {
    const a = renderRecipe(sdfRecipe(SDF_PERSON), 1, 64, 64);
    const b = renderRecipe(sdfRecipe(SDF_PERSON), 1, 64, 64);
    expect([...a.data]).toEqual([...b.data]);
    expect(a.data.reduce((s, v) => s + v, 0)).toBeGreaterThan(500);
    expect(a.data[32 * 64 + 32]).toBe(1);
  });

  it('without blobs the fit falls back to the host box', () => {
    const m = renderRecipe(
      {
        proportions: { w: 1, h: 1, d: 1 },
        parts: [{ ...sdfPart(SDF_BALL), blobs: undefined }],
      },
      1,
      32,
      32
    );
    // The full box hull: every pixel filled.
    expect(m.data.every((v) => v === 1)).toBe(true);
  });
});
