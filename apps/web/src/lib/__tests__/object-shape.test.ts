import { describe, expect, it } from 'vitest';
import {
  boundForRoof,
  clampParts,
  fitRecipe,
  formatDuration,
  frontPartIndex,
  ObjectRecipeSchema,
  recipeIssue,
  sdfBlobOuter,
  ShapeTimingEventSchema,
  silhouetteRings,
  wallTintFor,
  type ObjectRecipe,
  type SdfBlob,
} from '../object-shape';
import { pathToRings } from '../vision';

const fridge: ObjectRecipe = {
  proportions: { w: 0.5, h: 1, d: 0.5 },
  parts: [
    { shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#eeeeee' },
    { shape: 'box', at: [0.4, 0.1, 0.5], size: [0.04, 0.3, 0.04], color: '#888888', front: true },
  ],
};

describe('pathToRings (shared)', () => {
  it('reads M/L/Z paths and the H/V commands of boxPath', () => {
    expect(pathToRings('M0 0L1 0L1 1ZM5 5L6 6Z')).toEqual([
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ]);
    expect(pathToRings('M0.1 0.2H0.5V0.6H0.1Z')).toEqual([
      [
        [0.1, 0.2],
        [0.5, 0.2],
        [0.5, 0.6],
        [0.1, 0.6],
      ],
    ]);
  });
});

describe('fitRecipe + recipeIssue (PV-T9)', () => {
  // What Spark sends for a lamp post: thin parts, nothing near 8 % of the box, head sticking out.
  const lampPost: ObjectRecipe = {
    proportions: { w: 0.3, h: 1, d: 0.3 },
    parts: [
      {
        shape: 'cylinder',
        at: [0, -0.05, 0],
        size: [0.1, 0.8, 0.1],
        color: '#555555',
        front: true,
      },
      { shape: 'box', at: [0.2, 0.4, 0], size: [0.4, 0.04, 0.05], color: '#555555' },
      { shape: 'cone', at: [0.4, 0.38, 0], size: [0.2, 0.1, 0.2], color: '#eeeeaa' },
    ],
  };

  it('keeps a thin lamp post (was rejected) and stretches its parts to fill the box', () => {
    const fit = fitRecipe(lampPost, 0.19);
    expect(recipeIssue(fit)).toBeNull();
    expect(ObjectRecipeSchema.safeParse(fit).success).toBe(true);
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(...fit.parts.map((p) => p.at[i]! - p.size[i]! / 2));
      const hi = Math.max(...fit.parts.map((p) => p.at[i]! + p.size[i]! / 2));
      expect(lo).toBeCloseTo(-0.5, 5);
      expect(hi).toBeCloseTo(0.5, 5);
    }
  });

  it('keeps the recipe source: free provenance survives the fit', () => {
    const free = { ...fridge, source: 'free' as const };
    expect(fitRecipe(free, 2).source).toBe('free');
    expect(fitRecipe(fridge, 2)).not.toHaveProperty('source');
  });

  it('takes width / height from the photo box, depth stays relative to height', () => {
    const fit = fitRecipe(fridge, 2);
    expect(fit.proportions.w).toBe(1);
    expect(fit.proportions.h).toBeCloseTo(0.5);
    expect(fit.proportions.d).toBeCloseTo(0.25);
    // No photo aspect → the model's proportions.
    expect(fitRecipe(fridge, 0).proportions).toEqual(fridge.proportions);
  });

  it('a fitting fridge stays the same; only an almost empty recipe is refused', () => {
    const body = { ...fridge, parts: [fridge.parts[0]!] };
    expect(fitRecipe(body, 0.5)).toEqual(body);
    expect(recipeIssue(fitRecipe(fridge, 0.5))).toBeNull();
    const wire: ObjectRecipe = {
      ...fridge,
      parts: [
        { shape: 'box', at: [0, 0, 0], size: [1, 0.01, 0.01], color: '#888888' },
        { shape: 'box', at: [0, 0.4, 0], size: [0.01, 0.2, 1], color: '#888888' },
      ],
    };
    expect(recipeIssue(fitRecipe(wire, 0))).toBe('no_body');
  });

  it('schema refuses bad colours and out-of-range values', () => {
    expect(
      ObjectRecipeSchema.safeParse({ ...fridge, parts: [{ ...fridge.parts[0]!, color: 'red' }] })
        .success
    ).toBe(false);
    expect(
      ObjectRecipeSchema.safeParse({ ...fridge, parts: [{ ...fridge.parts[0]!, size: [2, 1, 1] }] })
        .success
    ).toBe(false);
  });
});

describe('frontPartIndex', () => {
  it('uses the part marked front, else the biggest one', () => {
    expect(frontPartIndex(fridge)).toBe(1);
    // Small handle first, big body second, nothing marked → the body.
    const unmarked: ObjectRecipe = {
      ...fridge,
      parts: [{ ...fridge.parts[1]!, front: undefined }, fridge.parts[0]!],
    };
    expect(frontPartIndex(unmarked)).toBe(1);
  });
});

describe('silhouetteRings (fallback)', () => {
  const box = { x: 0.2, y: 0.4, w: 0.4, h: 0.2 };

  it('maps the SAM outline into box fractions, largest ring first', () => {
    const outline = 'M0.5 0.5L0.52 0.5L0.52 0.52ZM0.2 0.4L0.6 0.4L0.6 0.6L0.2 0.6Z';
    const rings = silhouetteRings({ box, outline });
    expect(rings).toHaveLength(2);
    expect(rings[0]!.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
  });

  it('uses the box when there is no outline, and nothing for an empty box', () => {
    expect(silhouetteRings({ box })[0]!.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(silhouetteRings({ box: { x: 0, y: 0, w: 0, h: 0 } })).toEqual([]);
  });
});

describe('fitRecipe with a measured yaw (PF-T5)', () => {
  const cube: ObjectRecipe = {
    proportions: { w: 1, h: 0.5, d: 0.4 },
    parts: [{ shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#cccccc', front: true }],
  };

  it('solves the true front width: w·cos + d·sin = box width', () => {
    const yaw = Math.PI / 6;
    const r = fitRecipe(cube, 2.4, yaw);
    const { w, h, d } = r.proportions;
    expect(w * Math.cos(yaw) + d * Math.sin(yaw)).toBeCloseTo(2.4 * h, 6);
    // Narrower than the box suggests head-on (2.4 h).
    expect(w / h).toBeLessThan(2.4);
    expect(r.yaw).toBeCloseTo(yaw, 9);
    expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
  });

  it('depth that cannot fit shrinks; the front keeps ≥ 30 % of the box width', () => {
    const deep = { ...cube, proportions: { w: 1, h: 0.3, d: 1 } };
    const r = fitRecipe(deep, 0.8, -Math.PI / 3);
    const { w, h, d } = r.proportions;
    expect(w / h).toBeGreaterThanOrEqual(0.3 * 0.8 - 1e-9);
    expect(w * Math.cos(Math.PI / 3) + d * Math.sin(Math.PI / 3)).toBeCloseTo(0.8 * h, 6);
  });

  it('no yaw → same as before, no `yaw` field', () => {
    expect(fitRecipe(cube, 2, 0)).toEqual(fitRecipe(cube, 2));
    expect(fitRecipe(cube, 2)).not.toHaveProperty('yaw');
  });
});

describe('extrude points (PR-2.1)', () => {
  const tri: [number, number][] = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0, 0.5],
  ];
  const part = (over: Record<string, unknown>) => ({
    shape: 'extrude',
    at: [0, 0, 0],
    size: [1, 1, 1],
    color: '#eeeeee',
    ...over,
  });
  const parse = (parts: unknown[]) =>
    ObjectRecipeSchema.safeParse({ proportions: { w: 1, h: 1, d: 1 }, parts }).success;

  it('extrude takes a 3–64 point ring, and only extrude takes one', () => {
    expect(parse([part({ points: tri })])).toBe(true);
    expect(parse([{ ...part({}), shape: 'box' }])).toBe(true);
    expect(parse([part({})])).toBe(false);
    expect(parse([{ ...part({ points: tri }), shape: 'box' }])).toBe(false);
    expect(parse([part({ points: tri.slice(0, 2) })])).toBe(false);
    expect(
      parse([part({ points: Array.from({ length: 65 }, () => [0, 0] as [number, number]) })])
    ).toBe(false);
    expect(parse([part({ points: [...tri, [0.6, 0]] })])).toBe(false);
  });
});

describe('lathe profile (PR-2.3)', () => {
  const prof: [number, number][] = [
    [0, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [0, 0.5],
  ];
  const part = (over: Record<string, unknown>) => ({
    shape: 'lathe',
    at: [0, 0, 0],
    size: [1, 1, 1],
    color: '#eeeeee',
    ...over,
  });
  const parse = (parts: unknown[]) =>
    ObjectRecipeSchema.safeParse({ proportions: { w: 1, h: 1, d: 1 }, parts }).success;

  it('lathe takes a non-decreasing 2–32 point profile, and only lathe takes one', () => {
    expect(parse([part({ profile: prof })])).toBe(true);
    expect(parse([part({})])).toBe(false);
    expect(parse([{ ...part({ profile: prof }), shape: 'cylinder' }])).toBe(false);
    expect(parse([part({ profile: prof.slice(0, 1) })])).toBe(false);
    expect(
      parse([
        part({
          profile: Array.from({ length: 33 }, (_, i) => [0.5, -0.5 + i / 32] as [number, number]),
        }),
      ])
    ).toBe(false);
    expect(parse([part({ profile: [...prof.slice(0, 2), [0.5, -0.5]] })])).toBe(true);
    expect(parse([part({ profile: [...prof.slice(0, 3), [0.5, 0]] })])).toBe(false);
    expect(parse([part({ profile: [...prof.slice(0, 3), [0.6, 0.5]] })])).toBe(false);
  });
});

describe('clampParts (last guard before shipping)', () => {
  const base = {
    proportions: { w: 1, h: 1, d: 1 },
    parts: [
      {
        shape: 'box' as const,
        at: [0, 0, 0] as [number, number, number],
        size: [1, 1, 1] as [number, number, number],
        color: '#ffffff',
      },
    ],
  };

  it('returns the same recipe when every part is in range', () => {
    const r = ObjectRecipeSchema.parse(base);
    expect(clampParts(r)).toEqual({ recipe: r, clamped: [] });
    expect(clampParts(r).recipe).toBe(r);
  });

  it('a part squeezed flat or pushed out comes back into the schema (house-front regression)', () => {
    const r = {
      ...base,
      parts: [
        ...base.parts,
        {
          shape: 'box' as const,
          at: [0.9, 0, 0] as [number, number, number],
          size: [0.1, 0.004, 0.02] as [number, number, number],
          color: '#000000',
        },
      ],
    };
    const out = clampParts(r as never);
    expect(out.clamped).toEqual([1]);
    expect(out.recipe.parts[1]!.size[1]).toBe(0.01);
    expect(out.recipe.parts[1]!.at[0]).toBe(0.6);
    expect(() => ObjectRecipeSchema.parse(out.recipe)).not.toThrow();
  });
});

describe('formatDuration (PQ-T42)', () => {
  it('reads milliseconds below a second, one decimal above', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(47)).toBe('47 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(3440)).toBe('3.4 s');
    expect(formatDuration(15000)).toBe('15.0 s');
  });
});

describe('ShapeTimingEventSchema (PQ-T42)', () => {
  it('accepts a known phase with a non-negative duration', () => {
    expect(ShapeTimingEventSchema.safeParse({ phase: 'kit', ms: 3200 }).success).toBe(true);
    expect(ShapeTimingEventSchema.safeParse({ phase: 'nope', ms: 3 }).success).toBe(false);
    expect(ShapeTimingEventSchema.safeParse({ phase: 'fit', ms: -1 }).success).toBe(false);
  });
});

describe('boundForRoof (PQ-T43)', () => {
  it('thatch deepest, tile and slate pitched, concrete shallowest, default legacy', () => {
    expect(boundForRoof('thatch')).toBe(0.07);
    expect(boundForRoof('tile')).toBe(0.04);
    expect(boundForRoof('slate')).toBe(0.04);
    expect(boundForRoof('concrete')).toBe(0.02);
    expect(boundForRoof('glass')).toBe(0.03);
    expect(boundForRoof(undefined)).toBe(0.03);
  });

  it('the schema takes an overhang option within its max', () => {
    const roof = {
      shape: 'prism',
      at: [0, 0.25, 0],
      size: [1, 0.5, 1],
      color: '#6e6a62',
      kind: 'roof',
      overhang: 0.05,
    } as const;
    expect(
      ObjectRecipeSchema.safeParse({ proportions: { w: 1, h: 1, d: 1 }, parts: [roof] }).success
    ).toBe(true);
    expect(
      ObjectRecipeSchema.safeParse({
        proportions: { w: 1, h: 1, d: 1 },
        parts: [{ ...roof, overhang: 0.5 }],
      }).success
    ).toBe(false);
  });
});

describe('wallTintFor (PQ-T44)', () => {
  const wall = { shape: 'box', kind: 'wall' } as const;
  const tints = { front: '#ff0000', left: '#00ff00', right: '#0000ff' };

  it('front and rear read front, sides read their side, tops keep base', () => {
    expect(wallTintFor(wall, tints, [0, 0, 1])).toBe('#ff0000');
    expect(wallTintFor(wall, tints, [0, 0, -1])).toBe('#ff0000');
    expect(wallTintFor(wall, tints, [-1, 0, 0])).toBe('#00ff00');
    expect(wallTintFor(wall, tints, [1, 0, 0])).toBe('#0000ff');
    expect(wallTintFor(wall, tints, [0, 1, 0])).toBeNull();
    expect(wallTintFor(wall, tints, [0, -1, 0])).toBeNull();
  });

  it('absent tints, non-walls and missing faces keep the part colour', () => {
    expect(wallTintFor(wall, undefined, [0, 0, 1])).toBeNull();
    expect(wallTintFor(wall, {}, [0, 0, 1])).toBeNull();
    expect(wallTintFor({ shape: 'prism', kind: 'roof' }, tints, [0, 0, 1])).toBeNull();
    expect(wallTintFor({ shape: 'box' }, tints, [0, 0, 1])).toBeNull();
    expect(wallTintFor({ shape: 'box', front: true }, tints, [-1, 0, 0])).toBe('#00ff00');
  });

  it('wallTints schema takes per-face hex, rejects the rest', () => {
    const wall = { shape: 'box', at: [0, 0, 0], size: [1, 1, 1], color: '#aaaaaa' };
    const base = { proportions: { w: 1, h: 1, d: 1 }, parts: [wall] };
    expect(ObjectRecipeSchema.safeParse({ ...base, wallTints: { front: '#ff0000' } }).success).toBe(
      true
    );
    expect(ObjectRecipeSchema.safeParse({ ...base, wallTints: { front: 'red' } }).success).toBe(
      false
    );
  });
});

describe('sdf blobs (PQ-T53 §8)', () => {
  const ball: SdfBlob = { kind: 'sphere', c: [0, 0, 0], r: 0.3 };
  const part = (over: Record<string, unknown>) => ({
    shape: 'sdf',
    at: [0, 0, 0],
    size: [1, 1, 1],
    color: '#eeeeee',
    ...over,
  });
  const parse = (parts: unknown[]) =>
    ObjectRecipeSchema.safeParse({ proportions: { w: 1, h: 1, d: 1 }, parts }).success;

  it('sdf takes 1–12 blobs, and only sdf takes them', () => {
    expect(parse([part({ blobs: [ball] })])).toBe(true);
    expect(parse([part({ blobs: Array.from({ length: 12 }, () => ball) })])).toBe(true);
    expect(parse([part({})])).toBe(false);
    expect(parse([{ ...part({ blobs: [ball] }), shape: 'box' }])).toBe(false);
    expect(parse([part({ blobs: [] })])).toBe(false);
    expect(parse([part({ blobs: Array.from({ length: 13 }, () => ball) })])).toBe(false);
  });

  it('each kind parses: capsule, ellipsoid, rounded box', () => {
    const blobs: SdfBlob[] = [
      { kind: 'capsule', c: [0, 0, 0], axis: 'y', halfLen: 0.2, r: 0.1 },
      { kind: 'ellipsoid', c: [0, 0, 0], radii: [0.1, 0.2, 0.15] },
      { kind: 'box', c: [0, 0, 0], size: [0.4, 0.2, 0.3], r: 0.02 },
    ];
    expect(parse([part({ blobs })])).toBe(true);
  });

  it('dropout guard: radii under one cell, thin boxes and wide blends are refused', () => {
    expect(parse([part({ blobs: [{ ...ball, r: 0.03 }] })])).toBe(false);
    expect(
      parse([
        part({
          blobs: [{ kind: 'box', c: [0, 0, 0], size: [0.4, 0.07, 0.3], r: 0 } as SdfBlob],
        }),
      ])
    ).toBe(false);
    expect(parse([part({ blobs: [{ ...ball, k: 0.2 }] })])).toBe(false);
    expect(
      parse([
        part({
          blobs: [{ kind: 'box', c: [0, 0, 0], size: [0.4, 0.2, 0.3], r: 0.2 } as SdfBlob],
        }),
      ])
    ).toBe(false);
  });

  it('extent rule: outer box plus blend margin stays in unit space', () => {
    expect(parse([part({ blobs: [{ ...ball, c: [0.25, 0, 0] }] })])).toBe(false);
    expect(parse([part({ blobs: [{ ...ball, c: [0.2, 0, 0] }] })])).toBe(true);
    expect(parse([part({ blobs: [{ ...ball, c: [0.15, 0, 0], k: 0.1 }] })])).toBe(false);
    expect(parse([part({ blobs: [{ ...ball, c: [0.1, 0, 0], k: 0.1 }] })])).toBe(true);
  });

  it('sdfBlobOuter: half-extents per kind, capsule along its axis', () => {
    expect(sdfBlobOuter(ball)).toEqual({ half: [0.3, 0.3, 0.3], k: 0 });
    const cap: SdfBlob = {
      kind: 'capsule',
      c: [0, 0, 0],
      axis: 'x',
      halfLen: 0.2,
      r: 0.1,
      k: 0.05,
    };
    const outer = sdfBlobOuter(cap);
    expect(outer.k).toBe(0.05);
    expect(outer.half[0]).toBeCloseTo(0.3, 12);
    expect(outer.half[1]).toBe(0.1);
    expect(outer.half[2]).toBe(0.1);
  });
});
