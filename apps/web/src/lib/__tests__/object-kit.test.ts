import { APPLIANCE_CATEGORIES } from '@mitsinjo/engine';
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPE_SIZE_MM,
  archetypeOf,
  clampEstimatedDepth,
  decalWidth,
  defaultArchetype,
  KIT_ARCHETYPES,
  kitToRecipe,
  ObjectKitSchema,
  resolveGeneratorColors,
  TAIL_LIGHT_COLOR,
  WHEEL_COLOR,
  type ObjectKit,
} from '../object-kit';
import { fitRecipe, ObjectRecipeSchema, recipeIssue } from '../object-shape';
import { SCENERY_TYPES } from '../vision';

const kit = (archetype: ObjectKit['archetype'], details?: ObjectKit['details']): ObjectKit => ({
  archetype,
  proportions: { w: 1, h: 0.7, d: 0.6 },
  colors: { main: '#c9a36a', secondary: '#6e6a62', accent: '#ffffff' },
  ...(details ? { details } : {}),
});

describe('kitToRecipe (PV-T9b)', () => {
  it('every archetype gives a valid, usable recipe with the photo on one part', () => {
    for (const a of KIT_ARCHETYPES) {
      for (const details of [
        undefined,
        { windows: 8, doors: 3, wheels: 6, legs: 4, floors: 4, chimney: true },
      ]) {
        const r = kitToRecipe(kit(a, details));
        expect(ObjectRecipeSchema.safeParse(r).success, a).toBe(true);
        expect(r.parts.length).toBeLessThanOrEqual(12);
        expect(r.parts.filter((p) => p.front)).toHaveLength(1);
        expect(recipeIssue(fitRecipe(r, 1.2)), a).toBeNull();
      }
    }
  });

  it('uses the kit colours and counts: a house with 4 windows and a chimney', () => {
    const r = kitToRecipe(kit('house', { windows: 4, doors: 1, chimney: true }));
    expect(r.parts.filter((p) => p.color === '#ffffff')).toHaveLength(4);
    expect(r.parts[0]).toMatchObject({ color: '#c9a36a', front: true });
    expect(r.parts.length).toBe(1 + 3 + 1 + 4 + 1);
    expect(kitToRecipe(kit('house'))).toEqual(kitToRecipe(kit('house')));
  });

  it('every detection maps to an archetype (hint for Spark, mock)', () => {
    for (const c of APPLIANCE_CATEGORIES) expect(KIT_ARCHETYPES).toContain(defaultArchetype(c));
    for (const s of SCENERY_TYPES) expect(KIT_ARCHETYPES).toContain(defaultArchetype('other', s));
    expect(defaultArchetype('lamp')).toBe('lamp_post');
    expect(defaultArchetype('other', 'building')).toBe('house');
    expect(defaultArchetype('other', undefined, 'Purple vintage car')).toBe('vehicle');
    expect(defaultArchetype('other', undefined, 'Mini Cooper')).toBe('vehicle');
    expect(defaultArchetype('other', undefined, 'Old Stone Cottage')).toBe('house');
    expect(ObjectKitSchema.safeParse({ ...kit('tree'), colors: { main: 'red' } }).success).toBe(
      false
    );
  });

  it('builds realistic vehicles (classic car, van, truck, motorbike) within 12 parts', () => {
    for (const sub of [undefined, 'hatchback', 'vintage', 'sedan', 'van', 'truck', 'motorbike']) {
      const r = kitToRecipe({ ...kit('vehicle'), subtype: sub });
      expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
      expect(r.parts.length).toBeLessThanOrEqual(12);
      expect(r.parts.filter((p) => p.front)).toHaveLength(1);
      expect(recipeIssue(fitRecipe(r, 1.8))).toBeNull();
    }
  });

  it('fixed signal colours pass through untouched, role colours still map', () => {
    const r = kitToRecipe({ ...kit('vehicle'), subtype: 'sedan' });
    const tails = r.parts.filter((p) => p.color === TAIL_LIGHT_COLOR);
    expect(tails).toHaveLength(2);
    for (const t of tails) expect(t.material).toBeUndefined();
    // Roles still map to the kit colours and materials.
    const r2 = kitToRecipe({
      ...kit('vehicle'),
      subtype: 'sedan',
      materials: { main: 'metal', secondary: 'glass', accent: 'rubber' },
    });
    expect(r2.parts.find((p) => p.front)).toMatchObject({ color: '#c9a36a', material: 'metal' });
    expect(r2.parts.filter((p) => p.color === TAIL_LIGHT_COLOR)).toHaveLength(2);
  });
});

describe('vehicle rears (PR-2.11)', () => {
  const lenses = (subtype?: string) =>
    kitToRecipe({ ...kit('vehicle'), ...(subtype ? { subtype } : {}) }).parts.filter(
      (p) => p.shape === 'cylinder' && p.axis === 'x'
    );

  it('sedan, van and pickup carry two red lenses at −x mirroring the headlights', () => {
    for (const sub of [undefined, 'sedan', 'van', 'pickup']) {
      const r = kitToRecipe({ ...kit('vehicle'), ...(sub ? { subtype: sub } : {}) });
      const tails = r.parts.filter((p) => p.color === TAIL_LIGHT_COLOR);
      expect(tails, sub ?? 'default').toHaveLength(2);
      const heads = lenses(sub).filter((p) => p.color !== TAIL_LIGHT_COLOR);
      expect(heads).toHaveLength(2);
      for (const t of tails) {
        expect(t.shape).toBe('cylinder');
        expect(t.at[0]).toBeCloseTo(-0.49, 9);
        const mirror = heads.find((h) => Math.abs(h.at[2]! - t.at[2]!) < 1e-9)!;
        expect(mirror.at[0]).toBeCloseTo(0.49, 9);
        expect([t.at[1], t.size[0], t.size[1], t.size[2]]).toEqual([
          mirror.at[1],
          mirror.size[0],
          mirror.size[1],
          mirror.size[2],
        ]);
      }
      expect(r.parts.length).toBeLessThanOrEqual(12);
      expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
      expect(recipeIssue(fitRecipe(r, 1.8))).toBeNull();
    }
  });

  it('each rear is distinct: sedan trunk slope, van rear bumper, pickup bed; bike has none', () => {
    const sedan = kitToRecipe({ ...kit('vehicle'), subtype: 'sedan' });
    // Trunk slope prism at the back, no bumper boxes left (they were coplanar and invisible).
    const trunk = sedan.parts.find((p) => p.shape === 'prism' && p.at[0]! < 0)!;
    expect(trunk.apex).toBe(1);
    expect(
      sedan.parts.filter((p) => p.shape === 'box' && !p.front && p.size[2]! > 0.5)
    ).toHaveLength(1);
    const van = kitToRecipe({ ...kit('vehicle'), subtype: 'van' });
    const vanBumpers = van.parts.filter((p) => p.shape === 'box' && p.size[0] === 0.04);
    expect(vanBumpers).toHaveLength(1);
    expect(vanBumpers[0]!.at[0]).toBeLessThan(0);
    const pickup = kitToRecipe({ ...kit('vehicle'), subtype: 'pickup' });
    expect(pickup.parts.some((p) => p.shape === 'box' && p.at[0]! < 0 && p.at[1]! > 0)).toBe(true);
    expect(pickup.parts.filter((p) => p.shape === 'box' && p.size[0] === 0.04)).toHaveLength(0);
    const bike = kitToRecipe({ ...kit('vehicle'), subtype: 'motorbike' });
    expect(bike.parts.filter((p) => p.color === TAIL_LIGHT_COLOR)).toHaveLength(0);
  });

  it('a 6-wheel van keeps its wheels and drops the red lenses first', () => {
    const r = kitToRecipe({ ...kit('vehicle', { wheels: 6 }), subtype: 'van' });
    expect(r.parts).toHaveLength(12);
    expect(r.parts.filter((p) => p.shape === 'cylinder' && p.axis === 'z')).toHaveLength(6);
    expect(r.parts.filter((p) => p.color === TAIL_LIGHT_COLOR)).toHaveLength(0);
  });
});

describe('vehicle glazing (PQ-T43)', () => {
  const wheels = (subtype?: string) =>
    kitToRecipe({ ...kit('vehicle'), ...(subtype ? { subtype } : {}) }).parts.filter(
      (p) => p.shape === 'cylinder' && p.axis === 'z' && p.at[1]! < 0
    );

  it('no wheel uses the accent role: all are dark rubber, accent means glass', () => {
    for (const sub of [undefined, 'sedan', 'van', 'pickup', 'motorbike']) {
      const ws = wheels(sub);
      expect(ws.length).toBeGreaterThan(0);
      for (const w of ws) expect(w).toMatchObject({ color: WHEEL_COLOR, material: 'rubber' });
    }
  });

  it('classic car: glass cabin band, windscreen and rear slope, still 12 parts', () => {
    const r = kitToRecipe({ ...kit('vehicle'), subtype: 'sedan' });
    const cabin = r.parts.find((p) => p.shape === 'box' && !p.front && p.size[2]! > 0.5)!;
    expect(cabin.color).toBe('#ffffff');
    const slopes = r.parts.filter((p) => p.shape === 'prism');
    expect(slopes).toHaveLength(2);
    for (const s of slopes) expect(s.color).toBe('#ffffff');
    expect(r.parts).toHaveLength(12);
  });

  it('van: trim bumper, glass windshield; motorbike: flyscreen', () => {
    const van = kitToRecipe({ ...kit('vehicle'), subtype: 'van' });
    expect(van.parts.find((p) => p.shape === 'box' && p.size[0] === 0.04)).toMatchObject({
      color: '#6e6a62',
    });
    expect(van.parts.find((p) => p.shape === 'prism')!.color).toBe('#ffffff');
    const bike = kitToRecipe({ ...kit('vehicle'), subtype: 'motorbike' });
    const screen = bike.parts.find((p) => p.shape === 'box' && p.size[0] === 0.02)!;
    expect(screen).toMatchObject({ color: '#ffffff' });
    expect(bike.parts).toHaveLength(8);
  });
});

describe('decalWidth (PF-T1)', () => {
  it('never lets 8 windows overlap (regression: grey bar on the cottage row)', () => {
    const w = decalWidth(8, 0.76, 0.11);
    expect(w).toBeLessThan(0.76 / 7);
    expect(decalWidth(3, 0.76, 0.11)).toBe(0.11);
    expect(decalWidth(1, 0.76, 0.11)).toBe(0.11);
  });
});

describe('measured roof (PF-T3)', () => {
  const roof = {
    eave: 0.5,
    gables: [0, 1, 2].map((i) => ({ x0: i / 3, x1: (i + 1) / 3, peak: (i + 0.5) / 3, top: 0.1 })),
  };

  it('replaces the stepped slabs with one prism per gable, walls up to the eave', () => {
    const r = kitToRecipe({ ...kit('house', { windows: 3, chimney: true }), roof });
    expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
    const prisms = r.parts.filter((p) => p.shape === 'prism');
    expect(prisms).toHaveLength(3);
    // Walls: bottom of the box (−0.5) to the eave (0.5 − 0.5 = 0).
    expect(r.parts[0]).toMatchObject({ at: [0, -0.25, 0], size: [1, 0.5, 1], front: true });
    prisms.forEach((p, i) => {
      expect(p.at[0]).toBeCloseTo((i + 0.5) / 3 - 0.5, 6);
      expect(p.at[1] - p.size[1] / 2).toBeCloseTo(0, 6);
      expect(p.at[1] + p.size[1] / 2).toBeCloseTo(0.4, 6);
      expect(p.apex).toBeCloseTo(0.5, 6);
      expect(p.color).toBe('#6e6a62');
    });
    // Windows stay on the walls.
    for (const w of r.parts.filter((p) => p.color === '#ffffff')) expect(w.at[1]).toBeLessThan(0);
    expect(recipeIssue(fitRecipe(r, 2))).toBeNull();
  });

  it('6 gables + chimney + windows + door stay within 12 parts', () => {
    const six = {
      eave: 0.5,
      gables: Array.from({ length: 6 }, (_, i) => ({
        x0: i / 6,
        x1: (i + 1) / 6,
        peak: (i + 0.5) / 6,
        top: 0.1,
      })),
    };
    const r = kitToRecipe({ ...kit('house', { windows: 8, chimney: true }), roof: six });
    expect(r.parts.length).toBeLessThanOrEqual(12);
    expect(r.parts.filter((p) => p.shape === 'prism')).toHaveLength(6);
  });

  it('no roof → the stepped house is unchanged', () => {
    expect(kitToRecipe(kit('house')).parts.some((p) => p.shape === 'prism')).toBe(false);
  });
});

describe('row of houses (PF-T4)', () => {
  it('units without a roof → one even gable per house, door + windows per house, ≤ 12 parts', () => {
    for (const units of [2, 3, 4, 6, 8]) {
      const r = kitToRecipe(kit('house', { units, windows: 2 * units }));
      expect(ObjectRecipeSchema.safeParse(r).success, `${units}`).toBe(true);
      expect(r.parts.length).toBeLessThanOrEqual(12);
      expect(r.parts.filter((p) => p.shape === 'prism')).toHaveLength(Math.min(6, units));
      expect(recipeIssue(fitRecipe(r, 3))).toBeNull();
    }
  });

  it('2 houses × 2 windows: each house has its door and windows inside its own width', () => {
    const r = kitToRecipe(kit('house', { units: 2, windows: 4 }));
    const decals = r.parts.filter((p) => p.at[2] > 0.5);
    expect(decals.filter((p) => p.color === '#ffffff')).toHaveLength(4);
    expect(decals.filter((p) => p.color === '#6e6a62')).toHaveLength(2);
    for (const d of decals) {
      const unit = Math.floor((d.at[0] + 0.5) * 2);
      const lo = unit / 2 - 0.5;
      expect(d.at[0] - d.size[0] / 2).toBeGreaterThan(lo);
      expect(d.at[0] + d.size[0] / 2).toBeLessThan(lo + 1 / 2);
    }
    // No two decals overlap.
    const xs = decals
      .filter((p) => p.color === '#ffffff')
      .map((p) => [p.at[0] - p.size[0] / 2, p.at[0] + p.size[0] / 2] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]![0]).toBeGreaterThan(xs[i - 1]![1]);
  });

  it('3 houses: the 12-part budget keeps one door + one window per house', () => {
    const r = kitToRecipe(kit('house', { units: 3, windows: 6 }));
    expect(r.parts).toHaveLength(12 - 2);
    expect(r.parts.filter((p) => p.at[2] > 0.5)).toHaveLength(6);
  });

  it('units 1 (or absent) keeps the single-house facade', () => {
    expect(kitToRecipe(kit('house', { units: 1 }))).toEqual(kitToRecipe(kit('house')));
  });
});

describe('four-face fallback + overhang (PQ-T43)', () => {
  const roof1 = { eave: 0.5, gables: [{ x0: 0, x1: 1, peak: 0.5, top: 0.1 }] };

  it('single gable: wall-color gable ends and draft overhang; full mirror waits (starved)', () => {
    const r = kitToRecipe({ ...kit('house', { windows: 3, doors: 1 }), roof: roof1 });
    const prisms = r.parts.filter((p) => p.shape === 'prism');
    expect(prisms).toHaveLength(3);
    const ends = prisms.filter((p) => p.color === '#c9a36a');
    expect(ends).toHaveLength(2);
    for (const e of ends) {
      expect(e).toMatchObject({ kind: 'roof', overhang: 0 });
      expect(e.size[2]).toBeCloseTo(0.025, 9);
      expect(Math.abs(e.at[2]!)).toBeCloseTo(0.4875, 9);
    }
    const mid = prisms.find((p) => p.color === '#6e6a62')!;
    expect(mid).toMatchObject({ kind: 'roof', overhang: 0.03 });
    expect(mid.size[2]).toBeCloseTo(0.88, 9);
    // 4 + 4 + 4 does not fit room 8: front-only, hidden-sides owns the other faces.
    expect(r.parts).toHaveLength(8);
    expect(r.parts.filter((p) => p.at[2]! < -0.5)).toHaveLength(0);
  });

  it('eaves draft clamps to the roofing bound; thatch defaults deepest', () => {
    const overhangOf = (k: ObjectKit) =>
      kitToRecipe(k).parts.find((p) => p.shape === 'prism' && p.color === '#6e6a62')!.overhang;
    expect(
      overhangOf({
        ...kit('house', { windows: 2, eaves: 0.1 }),
        materials: { secondary: 'tile' },
        roof: roof1,
      })
    ).toBe(0.04);
    expect(
      overhangOf({
        ...kit('house', { windows: 2 }),
        materials: { secondary: 'thatch' },
        roof: roof1,
      })
    ).toBe(0.07);
  });

  it('rear mirror and sides ship whole with inferred status when they fit', () => {
    const r = kitToRecipe({ ...kit('house', { windows: 2, doors: 0 }), roof: roof1 });
    expect(r.parts).toHaveLength(12);
    const front = r.parts.filter((p) => p.at[2]! > 0.5);
    const rear = r.parts.filter((p) => p.at[2]! < -0.5);
    expect(front).toHaveLength(2);
    expect(rear).toHaveLength(2);
    for (const p of front) expect(p.status).toBeUndefined();
    for (const p of rear) expect(p.status).toBe('inferred');
    expect(rear.map((p) => p.at[0]).sort()).toEqual(front.map((p) => p.at[0]).sort());
    const sides = r.parts.filter((p) => Math.abs(p.at[0]!) > 0.5);
    expect(sides).toHaveLength(4);
    expect(sides.filter((p) => p.at[0]! > 0)).toHaveLength(2);
    for (const p of sides) {
      expect(p.status).toBe('inferred');
      expect(p.at[1]).toBe(front[0]!.at[1]);
    }
  });

  it('rows stay front-only with roof-colored gables; building mirrors when room allows', () => {
    const row = kitToRecipe(kit('house', { units: 2, windows: 4 }));
    const prisms = row.parts.filter((p) => p.shape === 'prism');
    expect(prisms).toHaveLength(2);
    for (const p of prisms) {
      expect(p.color).toBe('#6e6a62');
      expect(p.size[2]).toBe(1);
    }
    expect(row.parts.filter((p) => p.at[2]! < -0.5)).toHaveLength(0);
    const hall = kitToRecipe(kit('building', { floors: 1, windows: 1 }));
    expect(hall.parts).toHaveLength(6);
    const rear = hall.parts.filter((p) => p.at[2]! < -0.5);
    expect(rear).toHaveLength(1);
    expect(rear[0]!.status).toBe('inferred');
    expect(hall.parts.filter((p) => Math.abs(p.at[0]!) > 0.5)).toHaveLength(2);
  });
});

describe('materials (AI)', () => {
  it('each part takes the material and colour of its role: stone walls, slate roof, glass windows', () => {
    const r = kitToRecipe({
      ...kit('house', { windows: 2, doors: 1 }),
      materials: { main: 'stone', secondary: 'slate', accent: 'glass' },
    });
    const walls = r.parts.find((p) => p.front)!;
    expect(walls).toMatchObject({ material: 'stone', color: '#c9a36a' });
    const windows = r.parts.filter((p) => p.color === '#ffffff');
    expect(windows.length).toBe(2);
    for (const w of windows) expect(w.material).toBe('glass');
    expect(r.parts.some((p) => p.material === 'slate')).toBe(true);
    expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
  });

  it('no materials → parts have none, colours unchanged (as before)', () => {
    const r = kitToRecipe(kit('cabinet'));
    expect(r.parts.every((p) => p.material === undefined)).toBe(true);
    expect(r.parts[0]!.color).toBe('#c9a36a');
  });
});

describe('real size ranges (PT-8)', () => {
  it('clamps a Spark depth out of range: a fridge 3 × deeper than wide comes back ≤ 1.5 × its width', () => {
    // 600 wide × 1800 high, Spark says 1800 deep; ratio bound = max depth / min width = 750 / 500.
    const p = clampEstimatedDepth('cabinet', { w: 1 / 3, h: 1, d: 1 });
    expect(p.d / p.w).toBeCloseTo(750 / 500, 6);
    expect(p.w / p.h).toBeCloseTo(1 / 3, 6); // width / height untouched
    expect(Math.max(p.w, p.h, p.d)).toBe(1);
  });

  it('lifts a paper-thin tank to its real minimum', () => {
    const p = clampEstimatedDepth('tank', { w: 1, h: 1, d: 0.05 });
    expect(p.d).toBeGreaterThan(0.2);
  });

  it('keeps a plausible depth, and archetypes without a range, unchanged', () => {
    const fridge = { w: 0.35, h: 1, d: 0.35 };
    expect(clampEstimatedDepth('cabinet', fridge)).toBe(fridge);
    const car = { w: 1, h: 0.3, d: 0.05 };
    expect(clampEstimatedDepth('vehicle', car)).toBe(car);
    for (const a of Object.keys(ARCHETYPE_SIZE_MM)) {
      const r = ARCHETYPE_SIZE_MM[a as ObjectKit['archetype']]!;
      for (const [lo, hi] of [r.w, r.h, r.d]) expect(lo).toBeLessThan(hi);
    }
  });

  it('never touches a measured depth: the fitted recipe keeps it', () => {
    // A drawn side view measured this cabinet 3 × deeper than wide: measured wins, no clamp downstream.
    const measured = fitRecipe(
      { ...kitToRecipe(kit('cabinet')), proportions: { w: 0.33, h: 1, d: 1 } },
      0
    );
    expect(measured.proportions.d).toBeCloseTo(1, 6);
  });
});

describe('flatWaterRecipe', () => {
  it('lays a river flat (before: a standing block 0.34 high)', async () => {
    const { flatWaterRecipe, WATER_SHEET } = await import('../object-kit');
    const river = {
      proportions: { w: 1, h: 0.34, d: 0.18 },
      parts: [
        {
          shape: 'cylinder' as const,
          at: [0, 0, 0] as [number, number, number],
          size: [1, 1, 1] as [number, number, number],
          color: '#3a4a2e',
        },
      ],
    };
    const r = flatWaterRecipe(river);
    expect(r.proportions.w).toBe(1);
    expect(r.proportions.d).toBeCloseTo(0.34, 6);
    expect(r.proportions.h).toBeCloseTo(0.34 * WATER_SHEET, 6);
    expect(r.parts).toEqual([
      {
        shape: 'box',
        at: [0, 0, 0],
        size: [1, 1, 1],
        color: '#3a4a2e',
        material: 'water',
        front: true,
      },
    ]);
  });
});

describe('archetypeOf (PQ-T41)', () => {
  const fridge = { category: 'fridge' as const, label: 'fridge' };
  it("the operator's family wins when it is a known one", () => {
    expect(archetypeOf({ ...fridge, archetype: 'vehicle' })).toBe('vehicle');
  });
  it('an unknown or missing pick falls back to the detection', () => {
    const hint = defaultArchetype('fridge', undefined, 'fridge');
    expect(archetypeOf(fridge)).toBe(hint);
    expect(archetypeOf({ ...fridge, archetype: 'spaceship' })).toBe(hint);
    expect(archetypeOf({ ...fridge, archetype: '' })).toBe(hint);
  });
});

describe('plant templates (PQ-T50 §7.3)', () => {
  it('the tree grows its trunk (sweep), canopy spheres untouched', () => {
    const recipe = kitToRecipe(kit('tree'));
    expect(recipe.parts).toHaveLength(5);
    expect(recipe.parts.map((p) => p.generator?.op ?? 'plain')).toEqual([
      'plain',
      'sweep',
      'plain',
      'plain',
      'plain',
    ]);
    expect(recipe.parts[1]!.color).toBe('#6e6a62');
    expect(ObjectRecipeSchema.safeParse(recipe).success).toBe(true);
  });

  it('the bush template is unchanged (shells await outline-driven volumes)', () => {
    const recipe = kitToRecipe(kit('bush'));
    expect(recipe.parts).toHaveLength(2);
    expect(recipe.parts.every((p) => !p.generator)).toBe(true);
  });

  it('generator palettes resolve role tokens (never #00000x leaves)', () => {
    const colors = { main: '#c9a36a', secondary: '#6e6a62', accent: '#ffffff' };
    const shell = resolveGeneratorColors(
      {
        op: 'scatter',
        seed: 1,
        volume: { shape: 'box', at: [0, 0, 0], size: [0.5, 0.5, 0.5] },
        count: 4,
        size: 0.05,
        orientation: 'random',
        colors: ['#000001', '#000003'],
      },
      colors
    );
    expect(shell.op).toBe('scatter');
    if (shell.op === 'scatter') expect(shell.colors).toEqual(['#c9a36a', '#ffffff']);
    const trunk = resolveGeneratorColors(
      {
        op: 'sweep',
        seed: 1,
        points: [
          [0, 0, 0],
          [0, 0.2, 0],
        ],
        r0: 0.05,
        r1: 0.04,
        color: '#000002',
      },
      colors
    );
    if (trunk.op === 'sweep') expect(trunk.color).toBe('#6e6a62');
  });
});

describe('template part kinds (PQ-T46)', () => {
  it('the car declares glass, wheels and lights: the rear slope is a window', () => {
    const r = kitToRecipe({ ...kit('vehicle'), subtype: 'sedan' });
    const kinds = r.parts.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'window')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'wheel')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'light')).toHaveLength(4);
    // The rear prism (x < 0, apex 1) reads as a rear window through the generic map.
    const rear = r.parts.find((p) => p.shape === 'prism' && p.at[0] < 0);
    expect(rear?.kind).toBe('window');
    // The glasshouse band stays kindless: it is glazing, not a framed opening.
    expect(r.parts.find((p) => p.shape === 'box' && !p.front)?.kind).toBeUndefined();
  });

  it('vans, trucks and bikes declare their wheels and lights too', () => {
    for (const sub of ['van', 'truck', 'motorbike']) {
      const r = kitToRecipe({ ...kit('vehicle'), subtype: sub });
      expect(
        r.parts.some((p) => p.kind === 'wheel'),
        sub
      ).toBe(true);
      expect(
        r.parts.some((p) => p.kind === 'light'),
        sub
      ).toBe(true);
    }
    const van = kitToRecipe({ ...kit('vehicle'), subtype: 'van' });
    expect(van.parts.some((p) => p.kind === 'bumper')).toBe(true);
  });

  it('houses declare walls, roof, openings and chimney', () => {
    const r = kitToRecipe(kit('house', { windows: 4, doors: 1, chimney: true }));
    const kinds = r.parts.map((p) => p.kind);
    expect(kinds).toContain('wall');
    expect(kinds).toContain('roof');
    expect(kinds).toContain('chimney');
    expect(kinds.filter((k) => k === 'window').length).toBeGreaterThanOrEqual(4);
    expect(kinds.filter((k) => k === 'door').length).toBeGreaterThanOrEqual(1);
  });
});

describe('lofted vehicle template (PQ-T51 §7.3)', () => {
  it('the classic car body is a 4-station loft, tapered at nose and tail', () => {
    const recipe = kitToRecipe(kit('vehicle'));
    expect(recipe.parts).toHaveLength(12);
    const body = recipe.parts[0]!;
    expect(body.generator?.op).toBe('loft');
    if (body.generator?.op === 'loft') {
      expect(body.generator.axis).toBe('x');
      expect(body.generator.stations).toHaveLength(4);
      const mid = body.generator.stations[1]!;
      const nose = body.generator.stations[3]!;
      expect(mid.width).toBeGreaterThan(nose.width);
      expect(mid.height).toBeGreaterThan(nose.height);
    }
    expect(recipe.parts.slice(1).every((p) => !p.generator)).toBe(true);
    expect(ObjectRecipeSchema.safeParse(recipe).success).toBe(true);
  });

  it('van, pickup and two-wheel branches stay plain (unmeasured, no golden)', () => {
    for (const details of [
      { subtype: 'van' },
      { subtype: 'pickup' },
      { subtype: 'motorbike', wheels: 2 },
    ] as const) {
      const recipe = kitToRecipe(kit('vehicle', details));
      expect(recipe.parts.every((p) => !p.generator)).toBe(true);
    }
  });
});

describe('trees named by their species (PQ-T79)', () => {
  it.each(['baobab', 'acacia tree', 'eucalyptus', 'oak', 'mango', 'banana plant', 'coconut palm'])(
    '« %s » is a tree',
    (label) => {
      expect(defaultArchetype('other', undefined, label)).toBe('tree');
    }
  );
  it('a hedge or a flower bed stays a bush', () => {
    expect(defaultArchetype('other', undefined, 'gardenia bush')).toBe('bush');
    expect(defaultArchetype('other', undefined, 'flower bed')).toBe('bush');
  });
});
