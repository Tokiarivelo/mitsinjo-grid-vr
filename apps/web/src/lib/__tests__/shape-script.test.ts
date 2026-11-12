import { describe, expect, it } from 'vitest';
import { MAX_COMPONENTS, ObjectRecipeSchema, type RecipePart } from '../object-shape';
import {
  CUT_THICKNESS,
  compileScript,
  componentsOfKind,
  recipeToScript,
  type ShapeOp,
  type ShapeScript,
} from '../shape-script';

const P = { w: 1, h: 0.7, d: 0.6 };
const wall: RecipePart = {
  shape: 'box',
  at: [0, -0.2, 0],
  size: [0.8, 0.6, 0.6],
  color: '#e6dccb',
  material: 'plaster',
  kind: 'wall',
  front: true,
};
const roof: RecipePart = {
  shape: 'hip',
  ridge: 0.6,
  at: [0, 0.3, 0],
  size: [0.9, 0.4, 0.7],
  color: '#c8a060',
  material: 'thatch',
  kind: 'roof',
};
const chimney: RecipePart = {
  shape: 'box',
  at: [0.3, 0.35, 0],
  size: [0.06, 0.3, 0.06],
  color: '#9a4b3a',
  material: 'brick',
  kind: 'chimney',
};
const script = (...ops: unknown[]): ShapeScript => ({ proportions: P, ops });
const base: ShapeOp[] = [
  { op: 'add', id: 'wall', part: wall },
  { op: 'add', id: 'roof', part: roof },
];
const partOf = (r: ReturnType<typeof compileScript>, id: string) =>
  r.components.find((c) => c.id === id)?.part;

describe('compileScript ops (PG-T13)', () => {
  it('add builds a valid recipe in insertion order', () => {
    const r = compileScript(script(...base));
    expect(r.dropped).toEqual([]);
    expect(r.recipe!.parts).toEqual([wall, roof]);
    expect(ObjectRecipeSchema.safeParse(r.recipe).success).toBe(true);
  });

  it('set changes fields, keeps the rest; material sets material and colour', () => {
    const r = compileScript(
      script(
        ...base,
        { op: 'set', id: 'roof', bulge: 0.15, ridge: 0.8 },
        { op: 'material', id: 'wall', material: 'brick', color: '#a0522d' }
      )
    );
    expect(partOf(r, 'roof')).toMatchObject({ bulge: 0.15, ridge: 0.8, material: 'thatch' });
    expect(partOf(r, 'wall')).toMatchObject({ material: 'brick', color: '#a0522d' });
  });

  it('remove drops the component and its children', () => {
    const r = compileScript(
      script(
        ...base,
        { op: 'cut', id: 'window', wall: 'wall', kind: 'window', u: 0.25, v: 0.6, w: 0.2, h: 0.3 },
        { op: 'remove', id: 'wall' }
      )
    );
    expect(r.components.map((c) => c.id)).toEqual(['roof']);
  });

  it('cut puts an opening on the wall face at (u, v), sized by face shares', () => {
    const r = compileScript(
      script(...base, {
        op: 'cut',
        id: 'door',
        wall: 'wall',
        kind: 'door',
        u: 0.5,
        v: 0.3,
        w: 0.15,
        h: 0.5,
        leaves: 2,
        glazed: 0.4,
      })
    );
    const d = partOf(r, 'door')!;
    expect(d.kind).toBe('door');
    expect(d.material).toBe('wood');
    expect(d.leaves).toBe(2);
    expect(d.glazed).toBe(0.4);
    expect(d.size[0]).toBeCloseTo(0.15 * 0.8, 9);
    expect(d.size[1]).toBeCloseTo(0.5 * 0.6, 9);
    expect(d.size[2]).toBe(CUT_THICKNESS);
    // Centre on the face plane, half its thickness out; v 0.3 up the wall.
    expect(d.at[2]).toBeCloseTo(0.3 + CUT_THICKNESS / 2, 9);
    expect(d.at[1]).toBeCloseTo(-0.2 - 0.3 + 0.3 * 0.6, 9);
    expect(r.components.find((c) => c.id === 'door')!.parent).toBe('wall');
  });

  it('cut on the right face is thin along x, outward', () => {
    const r = compileScript(
      script(...base, {
        op: 'cut',
        id: 'side',
        wall: 'wall',
        kind: 'window',
        face: 'right',
        u: 0.5,
        v: 0.5,
        w: 0.3,
        h: 0.3,
      })
    );
    const s = partOf(r, 'side')!;
    expect(s.size[0]).toBe(CUT_THICKNESS);
    expect(s.at[0]).toBeGreaterThan(0.4);
    expect(s.size[2]).toBeCloseTo(0.3 * 0.6, 9);
  });

  it('attach sets a chimney on the roof top at (u, v)', () => {
    const r = compileScript(
      script(
        ...base,
        // Short stack: on the roof top its centre stays inside the ±0.6 recipe bound.
        { op: 'add', id: 'chimney', part: { ...chimney, size: [0.06, 0.1, 0.06] } },
        {
          op: 'attach',
          id: 'chimney',
          parent: 'roof',
          face: 'top',
          u: 0.75,
          v: 0.5,
        }
      )
    );
    const c = partOf(r, 'chimney')!;
    expect(c.at[0]).toBeCloseTo(0.25 * 0.9, 9);
    expect(r.components.find((x) => x.id === 'chimney')!.parent).toBe('roof');
  });

  it('repeat makes numbered copies step apart', () => {
    const r = compileScript(
      script(
        ...base,
        { op: 'cut', id: 'window', wall: 'wall', kind: 'window', u: 0.2, v: 0.6, w: 0.1, h: 0.2 },
        { op: 'repeat', id: 'window', count: 3, axis: 'x', step: 0.25 }
      )
    );
    expect(componentsOfKind(r.components, ['window'])).toEqual(['window', 'window.2', 'window.3']);
    expect(partOf(r, 'window.3')!.at[0] - partOf(r, 'window')!.at[0]).toBeCloseTo(0.5, 9);
  });
});

describe('compileScript errors, locks, budget (PG-T13)', () => {
  it('a bad op is dropped with its reason, the others apply', () => {
    const r = compileScript(
      script(
        ...base,
        { op: 'set', id: 'nothing', bulge: 0.1 },
        { op: 'add', id: 'wall', part: wall },
        { op: 'cut', id: 'w', wall: 'roof', kind: 'window', u: 0.5, v: 0.5, w: 0.1, h: 0.1 },
        { op: 'set', id: 'roof', bulge: 5 },
        { op: 'explode', id: 'roof' },
        'garbage',
        { op: 'set', id: 'roof', bulge: 0.1 }
      )
    );
    expect(r.dropped.map((d) => d.reason)).toEqual([
      'unknown_id',
      'duplicate_id',
      'not_a_wall',
      'invalid',
      'invalid',
      'invalid',
    ]);
    expect(partOf(r, 'roof')!.bulge).toBe(0.1);
  });

  it('locked components are read-only, and their parent cannot be removed', () => {
    const seed = [
      ...base,
      { op: 'cut', id: 'window', wall: 'wall', kind: 'window', u: 0.3, v: 0.6, w: 0.2, h: 0.2 },
    ];
    const r = compileScript(
      script(
        ...seed,
        { op: 'set', id: 'window', grid: [2, 4] },
        { op: 'remove', id: 'wall' },
        { op: 'set', id: 'roof', bulge: 0.2 }
      ),
      { locked: new Set(['window']), lockedFrom: seed.length }
    );
    expect(r.dropped.map((d) => [d.index, d.reason])).toEqual([
      [3, 'locked'],
      [4, 'locked'],
    ]);
    expect(r.components.map((c) => c.id)).toEqual(['wall', 'roof', 'window']);
    expect(partOf(r, 'window')!.grid).toBeUndefined();
    expect(partOf(r, 'roof')!.bulge).toBe(0.2);
  });

  it('no more than MAX_COMPONENTS components', () => {
    const many = Array.from({ length: MAX_COMPONENTS + 3 }, (_, i) => ({
      op: 'add',
      id: `p${i}`,
      part: { ...chimney, kind: undefined, at: [0, 0, 0] },
    }));
    const r = compileScript(script(...many));
    expect(r.components).toHaveLength(MAX_COMPONENTS);
    expect(r.dropped.filter((d) => d.reason === 'budget')).toHaveLength(3);
    const rep = compileScript(
      script(...many.slice(0, MAX_COMPONENTS - 1), {
        op: 'repeat',
        id: 'p0',
        count: 4,
        axis: 'x',
        step: 0.01,
      })
    );
    expect(rep.dropped.map((d) => d.reason)).toEqual(['budget']);
  });

  it('nothing left → null recipe, no throw', () => {
    expect(compileScript(script()).recipe).toBeNull();
    expect(
      compileScript(script(...base, { op: 'remove', id: 'wall' }, { op: 'remove', id: 'roof' }))
        .recipe
    ).toBeNull();
  });
});

describe('compileScript constraints (PR-2.14)', () => {
  it('an opening moved off its wall is clamped back inside the face span', () => {
    const r = compileScript(
      script(
        ...base,
        { op: 'cut', id: 'window', wall: 'wall', kind: 'window', u: 0.5, v: 0.5, w: 0.2, h: 0.2 },
        { op: 'set', id: 'window', at: [0.55, -0.2, 0.31] }
      )
    );
    const w = partOf(r, 'window')!;
    expect(w.at[0] + w.size[0] / 2).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(r.adjusted).toEqual(['window']);
  });

  it('a floating chimney drops onto the roof; one inside it stays put', () => {
    const r = compileScript(
      script(...base, {
        op: 'add',
        id: 'chimney',
        part: { ...chimney, at: [0.3, 0.6, 0], size: [0.06, 0.1, 0.06] },
      })
    );
    const c = partOf(r, 'chimney')!;
    expect(c.at[1] - c.size[1] / 2).toBeLessThan(0.5);
    expect(r.adjusted).toEqual(['chimney']);
    expect(
      compileScript(script(...base, { op: 'add', id: 'chimney', part: chimney })).adjusted
    ).toEqual([]);
  });
});

describe('fuzz: bad ops never throw (PG-T13)', () => {
  // Seeded LCG: deterministic.
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  const junk = () =>
    pick([
      undefined,
      null,
      3,
      'x',
      -2,
      2,
      0.5,
      [],
      {},
      [1, 2],
      '#zzzzzz',
      true,
      'wall',
      'roof',
      'window',
    ]);
  const ops = ['add', 'set', 'remove', 'attach', 'cut', 'repeat', 'material', 'nope'];
  const fields = [
    'id',
    'part',
    'parent',
    'at',
    'size',
    'face',
    'u',
    'v',
    'w',
    'h',
    'kind',
    'wall',
    'count',
    'axis',
    'step',
    'material',
    'color',
    'grid',
    'bulge',
  ];

  it('500 random scripts compile without throwing and always give a valid recipe or null', () => {
    for (let n = 0; n < 500; n++) {
      const list: unknown[] = [...base];
      for (let k = 0; k < 8; k++) {
        const o: Record<string, unknown> = { op: pick(ops) };
        for (const f of fields) if (rnd() < 0.4) o[f] = junk();
        if (rnd() < 0.5) o.id = pick(['wall', 'roof', 'window', 'w2']);
        list.push(o);
      }
      const r = compileScript(script(...list));
      if (r.recipe) expect(ObjectRecipeSchema.safeParse(r.recipe).success).toBe(true);
    }
  });
});

describe('recipeToScript (PG-T14)', () => {
  it('round-trips a recipe: same parts, named by kind, openings parented to the wall', () => {
    const door: RecipePart = {
      shape: 'box',
      at: [0, -0.35, 0.3075],
      size: [0.15, 0.3, 0.015],
      color: '#6b4a2f',
      material: 'wood',
      kind: 'door',
      leaves: 2,
    };
    const win = (x: number): RecipePart => ({
      shape: 'box',
      at: [x, -0.15, 0.3075],
      size: [0.12, 0.18, 0.015],
      color: '#2b3440',
      material: 'glass',
      kind: 'window',
      grid: [2, 4],
    });
    const recipe = {
      proportions: P,
      parts: [wall, roof, door, chimney, win(-0.25), win(0.25)],
      source: 'facade' as const,
      yaw: 0.1,
    };
    const s = recipeToScript(recipe);
    expect(s.ops.map((o) => (o as { id: string }).id)).toEqual([
      'wall',
      'roof',
      'door',
      'chimney',
      'window',
      'window.2',
    ]);
    expect((s.ops[4] as { parent?: string }).parent).toBe('wall');
    const r = compileScript(s);
    expect(r.dropped).toEqual([]);
    expect(r.adjusted).toEqual([]);
    expect(r.recipe).toEqual(recipe);
  });

  it('parts without kind get their shape name (body for the front part)', () => {
    const s = recipeToScript({
      proportions: P,
      parts: [
        { ...wall, kind: undefined },
        { ...chimney, kind: undefined, shape: 'cylinder' },
      ],
    });
    expect(s.ops.map((o) => (o as { id: string }).id)).toEqual(['body', 'cylinder']);
  });
});

describe('generator ops (PQ-T50 §7.3)', () => {
  const trunk = {
    op: 'sweep',
    id: 'trunk',
    kind: 'trunk',
    color: '#6d4a27',
    seed: 7,
    points: [
      [0, -0.5, 0],
      [0, -0.06, 0],
    ],
    r0: 0.075,
    r1: 0.045,
  } as const;

  it('a sweep op grows a host bounded by what grew', () => {
    const r = compileScript(script(trunk));
    expect(r.dropped).toEqual([]);
    const part = partOf(r, 'trunk')!;
    expect(part.generator?.op).toBe('sweep');
    // Host box spans the tube: y from base to tip, thin in x/z.
    expect(part.at[1]).toBeCloseTo(-0.28, 2);
    expect(part.size[1]).toBeCloseTo(0.44, 1);
    expect(part.size[0]).toBeLessThan(0.2);
    expect(part.color).toBe('#6d4a27');
  });

  it('scatter and drape ops grow crowns and strands; branch counts its levels', () => {
    const r = compileScript(
      script(
        {
          op: 'scatter',
          id: 'crown',
          kind: 'crown',
          color: '#3e7a34',
          seed: 42,
          volume: { shape: 'ellipsoid', at: [0, 0.2, 0], size: [0.9, 0.56, 0.9] },
          count: 48,
          size: 0.085,
          orientation: 'random',
          colors: ['#3e7a34'],
        },
        {
          op: 'drape',
          id: 'fringe',
          color: '#3e7a34',
          seed: 5,
          points: [[0.1, 0.4, 0]],
          strands: 2,
          length: 0.3,
          waviness: 0.1,
          thickness: 0.01,
        },
        {
          op: 'branch',
          id: 'limbs',
          color: '#6d4a27',
          seed: 21,
          at: [0, -0.1, 0],
          dir: [0, 1, 0],
          length: 0.22,
          radius: 0.03,
          levels: 2,
          count: 3,
          angle: 0.6,
          droop: 0.15,
          decay: 0.7,
        }
      )
    );
    expect(r.dropped).toEqual([]);
    expect(r.components).toHaveLength(3);
    expect(partOf(r, 'crown')!.generator?.op).toBe('scatter');
    expect(partOf(r, 'fringe')!.generator?.op).toBe('drape');
    expect(partOf(r, 'limbs')!.generator?.op).toBe('branch');
  });

  it('bad generator params drop as invalid, duplicates and overflow as usual', () => {
    const bad = compileScript(
      script({ ...trunk, id: 't1', points: [[[0, 0, 0]]] }, { ...trunk, id: 't2', r0: 9 })
    );
    expect(bad.dropped.map((d) => d.reason)).toEqual(['invalid', 'invalid']);
    expect(bad.recipe).toBeNull();
    const dupe = compileScript(script(trunk, trunk));
    expect(dupe.dropped).toEqual([{ index: 1, reason: 'duplicate_id', id: 'trunk' }]);
  });
});

describe('set with a generator (PQ-T51 §7.3)', () => {
  const body: RecipePart = {
    shape: 'box',
    at: [0, -0.06, 0],
    size: [1, 0.48, 0.9],
    color: '#b03a2e',
    kind: 'body',
    front: true,
  };

  it('grows a loft against the component box, which the expansion replaces', () => {
    const r = compileScript(
      script(
        { op: 'add', id: 'body', part: body },
        {
          op: 'set',
          id: 'body',
          generator: {
            op: 'loft',
            seed: 3,
            axis: 'x',
            stations: [
              { width: 0.7, height: 0.3, radius: 0 },
              { width: 0.9, height: 0.48, radius: 0 },
              { width: 0.8, height: 0.4, radius: 0 },
            ],
          },
        }
      )
    );
    expect(r.dropped).toEqual([]);
    const grown = partOf(r, 'body')!;
    expect(grown.generator?.op).toBe('loft');
    expect(grown.at).toEqual(body.at);
    expect(ObjectRecipeSchema.safeParse(r.recipe).success).toBe(true);
  });

  it('grows an inset against the wall, kept beside it at expansion', async () => {
    const { expandGenerators } = await import('../object-generators');
    const r = compileScript(
      script(
        { op: 'add', id: 'wall', part: wall },
        {
          op: 'set',
          id: 'wall',
          generator: {
            op: 'inset',
            seed: 11,
            face: 'front',
            u: 0.5,
            v: 0.5,
            w: 0.3,
            h: 0.4,
            depth: -0.04,
          },
        }
      )
    );
    expect(r.dropped).toEqual([]);
    const { parts } = expandGenerators(r.recipe!.parts);
    expect(parts).toHaveLength(2);
    expect(parts[1]!.color).not.toBe(wall.color);
  });

  it('bad generator params drop the set at the op gate', () => {
    const r = compileScript(
      script(
        { op: 'add', id: 'body', part: body },
        { op: 'set', id: 'body', generator: { op: 'loft', seed: 3, axis: 'x', stations: [] } }
      )
    );
    expect(r.dropped).toEqual([{ index: 1, reason: 'invalid', id: 'body' }]);
    expect(partOf(r, 'body')).toEqual(body);
  });
});
