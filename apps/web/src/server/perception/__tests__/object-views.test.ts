// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const museImage = vi.fn();
vi.mock('../facade-specialist', () => ({
  museImage: (...a: unknown[]) => museImage(...a),
  museImageReady: () => true,
}));

import { clipRing, hullLoops, spanAt } from '@/lib/hull';
import { ObjectRecipeSchema, recipeIssue } from '@/lib/object-shape';
import { kitToRecipe } from '@/lib/object-kit';
import sharp from 'sharp';
import { MAX_MISSING, knownConcept, parseViewsCheck, viewsCheckQuestion } from '../views-check';
import {
  ROUND_VIEW_ARCHETYPES,
  VIEW_ARCHETYPES,
  VIEW_CHECK_ROUND_MS,
  VIEW_HULL_ARCHETYPES,
  applyViewsCheck,
  checkViewsModel,
  measureObjectViews,
  objectSidePrompt,
  roundViewRecipe,
  sideLooksNew,
  keepPlausibleSide,
  sideDepthPlausible,
  SIDE_DEPTH_MAX_FACTOR,
  sparkDepthRatio,
  viewIou,
  viewsRecipe,
  PERSON_TORSO,
} from '../object-views';

import { FRONT, KIT, SIDE, box, front, side, type Pt } from '../__fixtures__/views';

describe('hull helpers (PV-H)', () => {
  it('reads the outer span of a ring on a line', () => {
    expect(spanAt(FRONT, 0.8)).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.8, 6)]);
    expect(spanAt(FRONT, 2)).toBeNull();
  });

  it('builds one counter-clockwise loop per slice, rising z', () => {
    const pts = FRONT.map(([u, v]) => [u - 0.5, v - 0.5] as Pt);
    const sec = SIDE.map(([u, v]) => [0.5 - u, v - 0.5] as Pt);
    const loops = hullLoops(pts, sec, 10, 6);
    expect(loops.length).toBe(10);
    expect(loops[1]!.z).toBeGreaterThan(loops[0]!.z);
    const ring = loops[5]!.loop;
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
    expect(a).toBeGreaterThan(0);
  });
});

describe('viewsRecipe (PV-H)', () => {
  it('a person wears its top colour on the torso (before: one grey hull for a woman in pink)', () => {
    const rect: Pt[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const person = {
      archetype: 'person' as const,
      proportions: { w: 0.3, h: 1, d: 0.2 },
      colors: { main: '#d7cfcb', secondary: '#f6bab5', accent: '#594637' },
      materials: { main: 'fabric' as const, secondary: 'fabric' as const },
    };
    const views = {
      front: { box: { x: 0, y: 0, w: 1, h: 1 }, aspect: 0.3, ring: rect, parts: [] },
      side: { box: { x: 0, y: 0, w: 1, h: 1 }, aspect: 0.2, ring: rect, parts: [] },
    };
    const r = viewsRecipe(views, person);
    expect(r.parts[0]).toMatchObject({ shape: 'hull', color: '#d7cfcb' });
    const top = r.parts.filter((p) => p.color === '#f6bab5');
    expect(top).toHaveLength(4);
    for (const p of top) expect(p.shape).toBe('hull');
    expect(PERSON_TORSO[0]).toBeLessThan(PERSON_TORSO[1]);
    // Top and trousers of one colour family: no patch.
    const plain = viewsRecipe(views, {
      ...person,
      colors: { ...person.colors, secondary: '#d4ccc8' },
    });
    expect(plain.parts).toHaveLength(1);
  });

  it('rebuilds the whole car: hull body, 4 wheels, glass, lights, bumper, longer than wide', () => {
    const r = viewsRecipe({ front, side }, KIT);
    expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
    expect(recipeIssue(r)).toBeNull();
    expect(r.source).toBe('views');
    expect(r.parts[0]).toMatchObject({ shape: 'hull', front: true, color: '#5a4aca' });
    expect(r.parts.filter((p) => p.material === 'rubber')).toHaveLength(4);
    expect(r.parts.filter((p) => p.material === 'glass').length).toBeGreaterThanOrEqual(4);
    expect(r.parts.some((p) => p.material === 'metal' && p.shape === 'box')).toBe(true);
    expect(r.parts.length).toBeLessThanOrEqual(12);
    // Side glass, windshield and grille hug the body: skin patches, not flat boxes.
    const skins = r.parts.filter((p) => p.shape === 'hull' && !p.front);
    expect(skins.map((p) => p.material).sort()).toEqual(['glass', 'glass', 'glass', 'metal']);
    expect(r.proportions.d / r.proportions.w).toBeCloseTo(2.9 / 1.3, 1);
    expect(r.dimStatus?.depth).toBe('measured');
  });

  it('matches both drawn silhouettes, the side the right way round', () => {
    const r = viewsRecipe({ front, side }, KIT);
    expect(viewIou(r, front, 'front')).toBeGreaterThan(0.85);
    expect(viewIou(r, side, 'side')).toBeGreaterThan(0.85);
    // Mirrored profile (hood at the back) scores worse: the side is read front-left.
    const mirrored = { ...side, ring: SIDE.map(([u, v]) => [1 - u, v] as Pt) };
    expect(viewIou(r, mirrored, 'side')).toBeLessThan(viewIou(r, side, 'side'));
  });

  it('front only: the front extruded to Spark depth (a vehicle kit w is its length)', () => {
    expect(sparkDepthRatio(KIT)).toBeCloseTo(1 / 0.48, 2);
    expect(sparkDepthRatio({ archetype: 'cabinet', proportions: { w: 1, h: 1, d: 0.6 } })).toBe(
      0.6
    );
    const r = viewsRecipe({ front, side: null }, KIT);
    expect(r.parts[0]!.shape).toBe('extrude');
    expect(r.dimStatus?.depth).toBe('estimated');
    expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
  });

  it('front only: a vehicle still gets 4 wheels from the front drawing (before: none, live 2026-11-03)', () => {
    const r = viewsRecipe({ front, side: null }, KIT);
    const wheels = r.parts.filter((p) => p.kind === 'wheel');
    expect(wheels).toHaveLength(4);
    expect(wheels.every((w) => w.status === 'inferred' && w.rim)).toBe(true);
    // Two axles, front and rear, each with a left and a right wheel.
    expect(new Set(wheels.map((w) => w.at[2].toFixed(3))).size).toBe(2);
    expect(new Set(wheels.map((w) => Math.sign(w.at[0]))).size).toBe(2);
    // Not for a cabinet, nor when the side shows the wheels.
    const cab = viewsRecipe({ front, side: null }, { ...KIT, archetype: 'cabinet' });
    expect(cab.parts.some((p) => p.kind === 'wheel')).toBe(false);
    const both = viewsRecipe({ front, side }, KIT);
    expect(
      both.parts.filter((p) => p.kind === 'wheel').every((w) => w.at[2] !== wheels[0]!.at[2])
    ).toBe(true);
  });

  it('a part box mostly off the object is dropped, the rest cut to the body (before: a topiary plinth read as bumper floated under the car, live 2026-11-03)', () => {
    const plinth = {
      ...front,
      parts: [
        ...front.parts.filter((p) => p.concept !== 'bumper'),
        { concept: 'bumper', box: box(0.15, 0.87, 1, 0.31) },
      ],
    };
    expect(viewsRecipe({ front: plinth, side }, KIT).parts.some((p) => p.kind === 'bumper')).toBe(
      false
    );
    // A bumper a little wider than the body is kept, as wide as the body at its height.
    const wide = {
      ...front,
      parts: [
        ...front.parts.filter((p) => p.concept !== 'bumper'),
        { concept: 'bumper', box: box(-0.1, 0.72, 1.2, 0.1) },
      ],
    };
    const r = viewsRecipe({ front: wide, side }, KIT);
    const body = r.parts[0]!;
    const bump = r.parts.find((p) => p.kind === 'bumper')!;
    expect(bump.at[0] - bump.size[0] / 2).toBeGreaterThanOrEqual(
      body.at[0] - body.size[0] / 2 - 1e-6
    );
    expect(bump.at[0] + bump.size[0] / 2).toBeLessThanOrEqual(body.at[0] + body.size[0] / 2 + 1e-6);
  });

  it('skin patches stay on the body outline (before: side glass stuck out past the roof, live 2026-11-03)', () => {
    const tall = {
      ...side,
      parts: [
        ...side.parts.filter((p) => p.concept !== 'window'),
        { concept: 'window', box: box(0.25, -0.1, 0.6, 0.5) },
      ],
    };
    const r = viewsRecipe({ front, side: tall }, KIT);
    const body = r.parts[0]!;
    const skins = r.parts.filter((p) => p.shape === 'hull' && !p.front);
    expect(skins.filter((p) => p.kind === 'window').length).toBeGreaterThanOrEqual(2);
    const on = (
      ring: ReadonlyArray<readonly [number, number]>,
      [a, y]: readonly [number, number]
    ) => {
      const s = spanAt(ring, y);
      return !!s && a >= s[0] - 1e-6 && a <= s[1] + 1e-6;
    };
    for (const p of skins) {
      // The patch's cut side (front outline or side profile) lies inside the body's.
      const frontCut = p.points!.every((q) => on(body.points!, q));
      const sideCut = p.section!.every((q) => on(body.section!, q));
      expect(frontCut || sideCut).toBe(true);
    }
  });

  it('cuts a ring to a box', () => {
    const sq: Pt[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const c = clipRing(sq, 0.5, 2, -1, 0.5);
    expect(Math.min(...c.map((p) => p[0]))).toBeCloseTo(0.5);
    expect(Math.max(...c.map((p) => p[1]))).toBeCloseTo(0.5);
    expect(clipRing(sq, 2, 3, 0, 1)).toEqual([]);
  });

  it('a side that is a redrawn front is no side', () => {
    expect(sideLooksNew(front, { ...side, aspect: 1.32 })).toBe(false);
    expect(sideLooksNew(front, side)).toBe(true);
  });

  it('asks Muse Image for the side, front to the left, never energy', () => {
    const p = objectSidePrompt('purple "vintage" car');
    expect(p).toContain('front pointing to the LEFT');
    expect(p).not.toContain('"');
    expect(p).not.toMatch(/watt|kw/i);
  });
});

describe('measureObjectViews (PV-H)', () => {
  const W = 1200;
  const H = 800;
  const path = (ring: Pt[], [x, y, w, h]: [number, number, number, number]) =>
    'M ' + ring.map(([u, v]) => `${x + u * w} ${y + (1 - v) * h}`).join(' L ') + ' Z';
  const inst = ([x, y, w, h]: [number, number, number, number], outline?: string) => ({
    box: { x1: x * W, y1: y * H, x2: (x + w) * W - 1, y2: (y + h) * H - 1 },
    confidence: 0.9,
    ...(outline ? { outline } : {}),
  });
  const reply = (instances: ReturnType<typeof inst>[]) => ({
    source: 'meta' as const,
    model: 'sam',
    concept: 'x',
    imageWidth: W,
    imageHeight: H,
    instances,
    count: instances.length,
    boxCoverage: 0.3,
  });
  const FB: [number, number, number, number] = [0.3, 0.2, 0.4, 0.46];
  const SB: [number, number, number, number] = [0.05, 0.3, 0.9, 0.4];
  const segment = vi.fn(async (url: string, concept: string) => {
    const isSide = url.startsWith('data:image/png');
    if (concept === 'car')
      return reply([inst(isSide ? SB : FB, path(isSide ? SIDE : FRONT, isSide ? SB : FB))]);
    if (concept === 'wheel' && isSide)
      return reply([inst([0.15, 0.58, 0.14, 0.12]), inst([0.7, 0.58, 0.14, 0.12])]);
    return reply([]);
  });

  beforeEach(() => {
    museImage.mockReset();
    segment.mockClear();
  });

  it('measures the front, draws and measures the side', async () => {
    museImage.mockResolvedValue(Buffer.from('side'));
    const sides: Buffer[] = [];
    const v = await measureObjectViews(segment, 'https://x/front.png', 'vehicle', 'car', 'car', {
      onSideView: (p) => sides.push(p),
    });
    expect(museImage).toHaveBeenCalledTimes(1);
    expect(sides).toHaveLength(1);
    // Box = the outline's own bounds (the drawn ring tops out at 0.95).
    expect(v?.front.aspect).toBeCloseTo((0.4 * W) / (0.95 * 0.46 * H), 2);
    expect(v?.side?.aspect).toBeCloseTo((0.9 * W) / (0.95 * 0.4 * H), 2);
    expect(v?.side?.parts.filter((p) => p.concept === 'wheel')).toHaveLength(2);
    expect(v?.front.ring[0]![1]).toBeCloseTo(0.15 / 0.95, 2);
  });

  it('side v2 (PQ-T16): two drawings per attempt, each measured, one kept (PR #13 review)', async () => {
    museImage.mockResolvedValue(Buffer.from('side'));
    const sides: Buffer[] = [];
    const v = await measureObjectViews(segment, 'https://x/front.png', 'vehicle', 'car', 'car', {
      onSideView: (p) => sides.push(p),
      sideV2: { candidates: 2 },
    });
    // Both candidates of an attempt are asked with the Side view card, not the v1 prompt.
    expect(museImage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(museImage.mock.calls.length % 2).toBe(0);
    expect(sides.length).toBe(museImage.mock.calls.length);
    expect(JSON.stringify(museImage.mock.calls[0])).toContain('car');
    // A kept side is one the gate accepts (same height, top line); a refused pair leaves the front alone.
    if (v?.side) expect(v.sidePng).not.toBeNull();
    else expect(v?.front).toBeDefined();
  });

  it('keeps the front alone when Muse Image is unavailable', async () => {
    museImage.mockRejectedValue(new Error('down'));
    const v = await measureObjectViews(segment, 'https://x/front.png', 'vehicle', 'car', 'car');
    expect(v?.side).toBeNull();
  });

  it('houses keep their elevations; a mock SAM answer gives nothing', async () => {
    expect(VIEW_HULL_ARCHETYPES).not.toContain('house');
    expect(await measureObjectViews(segment, 'u', 'house', 'house', 'house')).toBeNull();
    const mock = vi.fn(async () => ({
      ...reply([inst(FB, path(FRONT, FB))]),
      source: 'mock' as const,
    }));
    expect(await measureObjectViews(mock, 'u', 'vehicle', 'car', 'car')).toBeNull();
  });
});

describe('AI views check (PV-H)', () => {
  it('parses what Spark says is missing: plain names, per view, capped, colours kept', () => {
    const c = parseViewsCheck(
      JSON.stringify({
        missing: [
          { part: 'Side Mirror!', view: 'front', color: '#C8CDD2', material: 'metal' },
          { part: 'side mirror', view: 'front' },
          { part: 'rear bumper', view: 'side', color: 'grey', material: 'gold' },
          { part: 'x', view: 'top' },
          { part: 'a', view: 'side' },
          { part: 'b', view: 'side' },
          { part: 'c', view: 'side' },
        ],
        redrawSide: true,
      })
    )!;
    expect(c.missing).toHaveLength(MAX_MISSING);
    expect(c.missing[0]).toEqual({
      part: 'side mirror',
      view: 'front',
      color: '#c8cdd2',
      material: 'metal',
    });
    expect(c.missing[1]).toEqual({ part: 'rear bumper', view: 'side' });
    expect(c.redrawSide).toBe(true);
    expect(parseViewsCheck('the model is fine')).toBeNull();
  });

  it('maps known parts to the builder rules, others become patches', () => {
    expect(knownConcept('rear tire')).toBe('wheel');
    expect(knownConcept('windscreen')).toBe('windshield');
    expect(knownConcept('side mirror')).toBeNull();
    expect(knownConcept('rear bumper')).toBeNull();
    expect(viewsCheckQuestion('car', { front: 0.87, side: 0.81 })).toContain(
      'front 87 %, side 81 %'
    );
  });

  it('a part SAM finds on the side becomes a patch on both sides, in the colour read', async () => {
    const sidePng = await sharp({
      create: { width: 120, height: 60, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const views = { front, side, frontUrl: 'data:image/png;base64,AA', sidePng };
    const segment = vi.fn(async (_u: string, concept: string) => ({
      source: 'meta' as const,
      model: 'sam',
      concept,
      imageWidth: 1000,
      imageHeight: 1000,
      instances:
        concept === 'side mirror'
          ? [{ box: { x1: 300, y1: 450, x2: 349, y2: 499 }, confidence: 0.9 }]
          : [],
      count: 1,
      boxCoverage: 0.01,
    }));
    const fixed = await applyViewsCheck(
      segment,
      views,
      {
        missing: [
          { part: 'side mirror', view: 'side', color: '#aa1111', material: 'metal' },
          { part: 'spoiler', view: 'side' },
        ],
        redrawSide: false,
      },
      'car',
      'car',
      []
    );
    expect(fixed?.applied).toEqual(['side mirror (side)']);
    const r = viewsRecipe(fixed!.views, KIT);
    const mirrors = r.parts.filter((p) => p.color === '#aa1111' && p.shape === 'hull');
    expect(mirrors).toHaveLength(2);
    expect(mirrors.map((p) => p.status).sort()).toEqual(['inferred', 'measured']);
  });

  it('checks, fixes, and keeps the round when the silhouette holds; mock answers change nothing', async () => {
    const png = await sharp({
      create: { width: 200, height: 160, channels: 3, background: '#8060c0' },
    })
      .png()
      .toBuffer();
    const sidePng = await sharp({
      create: { width: 300, height: 100, channels: 3, background: '#8060c0' },
    })
      .png()
      .toBuffer();
    const views = {
      front,
      side,
      frontUrl: `data:image/png;base64,${png.toString('base64')}`,
      sidePng,
    };
    const recipe = viewsRecipe(views, KIT);
    const segmentImage = vi.fn(async (_u: string, concept: string) => ({
      source: 'meta' as const,
      model: 'sam',
      concept,
      imageWidth: 1000,
      imageHeight: 1000,
      instances:
        concept === 'side mirror'
          ? [{ box: { x1: 300, y1: 400, x2: 339, y2: 439 }, confidence: 0.9 }]
          : [],
      count: 1,
      boxCoverage: 0.01,
    }));
    const sheets: string[] = [];
    const checkViews = vi.fn(async (url: string) => {
      sheets.push(url);
      return {
        source: 'meta' as const,
        model: 'muse-spark',
        check:
          sheets.length === 1
            ? {
                missing: [{ part: 'side mirror', view: 'side' as const, color: '#aa1111' }],
                redrawSide: false,
              }
            : { missing: [], redrawSide: false },
      };
    });
    const out = await checkViewsModel(
      { checkViews, segmentImage },
      recipe,
      views,
      KIT,
      'car',
      'car'
    );
    expect(sheets[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(checkViews).toHaveBeenCalledTimes(2);
    // The mirror pair joins; built recipes have room (24) so nothing measured gives way.
    expect(out.recipe.parts).toHaveLength(recipe.parts.length + 2);
    expect(out.recipe.parts.filter((p) => p.color === '#aa1111')).toHaveLength(2);

    const mock = vi.fn(async () => ({ source: 'mock' as const, model: 'mock', check: null }));
    const same = await checkViewsModel(
      { checkViews: mock, segmentImage },
      recipe,
      views,
      KIT,
      'car',
      'car'
    );
    expect(same.recipe).toBe(recipe);
  }, 30_000);

  it('rear parts read on the side go on the back face: a band, or a pair of lamps', () => {
    const withBack = {
      front,
      side: {
        ...side,
        parts: [
          ...side.parts,
          { concept: 'rear bumper', box: box(0.93, 0.75, 0.07, 0.1), look: { color: '#bbbbbb' } },
          { concept: 'taillight', box: box(0.95, 0.45, 0.04, 0.1), look: { color: '#cc2222' } },
        ],
      },
    };
    const r = viewsRecipe(withBack, KIT);
    const back = (c: string) => r.parts.filter((p) => p.color === c);
    expect(back('#bbbbbb')).toHaveLength(1);
    expect(back('#cc2222')).toHaveLength(2);
    // On the back: every section point sits behind the middle.
    for (const p of [...back('#bbbbbb'), ...back('#cc2222')])
      expect(Math.max(...p.section!.map(([z]) => z))).toBeLessThan(0);
  });

  it('skips a round with no time left, and never asks SAM again for a part it already measured', async () => {
    const views = { front, side, frontUrl: 'data:image/png;base64,AA', sidePng: null };
    const recipe = viewsRecipe(views, KIT);
    const checkViews = vi.fn();
    const segmentImage = vi.fn();
    const out = await checkViewsModel(
      { checkViews, segmentImage },
      recipe,
      views,
      KIT,
      'car',
      'car',
      {
        deadline: Date.now() + 1000,
      }
    );
    expect(checkViews).not.toHaveBeenCalled();
    expect(out.recipe).toBe(recipe);
    const none = await applyViewsCheck(
      segmentImage,
      views,
      { missing: [{ part: 'front bumper', view: 'front' }], redrawSide: false },
      'car',
      'car',
      []
    );
    expect(none).toBeNull();
    expect(segmentImage).not.toHaveBeenCalled();
  });

  it('bounds the check call by the views deadline, not only by the request (Vercel 300 s kill, 2026-11-03)', async () => {
    const png = await sharp({
      create: { width: 300, height: 100, channels: 3, background: '#8060c0' },
    })
      .png()
      .toBuffer();
    const views = {
      front,
      side,
      frontUrl: `data:image/png;base64,${png.toString('base64')}`,
      sidePng: png,
    };
    const recipe = viewsRecipe(views, KIT);
    const checkViews = vi.fn(async (_img: string, _q: string, _signal?: AbortSignal) => ({
      source: 'meta' as const,
      model: 'spark',
      check: { missing: [], redrawSide: false },
    }));
    const request = new AbortController().signal;
    await checkViewsModel({ checkViews, segmentImage: vi.fn() }, recipe, views, KIT, 'car', 'car', {
      signal: request,
      deadline: Date.now() + VIEW_CHECK_ROUND_MS + 60_000,
    });
    const sent = checkViews.mock.calls[0]![2];
    expect(sent).toBeInstanceOf(AbortSignal);
    expect(sent).not.toBe(request);
  });
});

describe('round objects from their 2D view (PG-T19)', () => {
  /** Drawn tree, object-box fractions (u right, v up): thin trunk, wide round crown. */
  const TREE: Pt[] = [
    [0.45, 0],
    [0.55, 0],
    [0.55, 0.3],
    [0.85, 0.35],
    [1, 0.55],
    [0.9, 0.85],
    [0.5, 1],
    [0.1, 0.85],
    [0, 0.55],
    [0.15, 0.35],
    [0.45, 0.3],
  ];
  const TREE_KIT = {
    archetype: 'tree' as const,
    proportions: { w: 0.6, h: 1, d: 0.6 },
    colors: { main: '#3f7a3a', secondary: '#6b4a2f', accent: '#5a8a40' },
  };

  it('trees, bushes, poles and lamp posts are built from the view; panels on the hull path', () => {
    for (const a of ['tree', 'bush', 'pole', 'lamp_post'] as const) {
      expect(ROUND_VIEW_ARCHETYPES).toContain(a);
      expect(VIEW_ARCHETYPES).toContain(a);
    }
    expect(VIEW_HULL_ARCHETYPES).toContain('panel');
    expect(VIEW_ARCHETYPES).not.toContain('house');
  });

  it('a tree: lathe crown from the drawn silhouette, drawing proportions, trunk kept', () => {
    const r = roundViewRecipe({ aspect: 0.8, ring: TREE }, TREE_KIT);
    expect(ObjectRecipeSchema.safeParse(r).success).toBe(true);
    expect(recipeIssue(r)).toBeNull();
    expect(r.source).toBe('views');
    expect(r.proportions.w / r.proportions.h).toBeCloseTo(0.8, 2);
    expect(r.proportions.d).toBeCloseTo(r.proportions.w, 6);
    const body = r.parts.find((p) => p.front)!;
    expect(body.shape).toBe('lathe');
    expect(body.color).toBe(TREE_KIT.colors.main);
    // The trunk (secondary colour) is still there under the crown.
    expect(r.parts.some((p) => p.color === TREE_KIT.colors.secondary)).toBe(true);
    // Template canopy fillers inside the lathe are gone (fewer parts than the template).
    expect(r.parts.length).toBeLessThan(kitToRecipe(TREE_KIT).parts.length);
  });

  it('round objects draw no side (their side is their front)', async () => {
    museImage.mockReset();
    const W = 1000;
    const H = 1000;
    const segment = vi.fn(async (_u: string, concept: string) => ({
      source: 'meta' as const,
      model: 'sam',
      concept,
      imageWidth: W,
      imageHeight: H,
      instances:
        concept === 'tree'
          ? [
              {
                box: { x1: 300, y1: 100, x2: 699, y2: 899 },
                confidence: 0.9,
                outline:
                  'M ' +
                  TREE.map(([u, v]) => `${300 + u * 400} ${100 + (1 - v) * 800}`).join(' L ') +
                  ' Z',
              },
            ]
          : [],
      count: concept === 'tree' ? 1 : 0,
      boxCoverage: 0.3,
    }));
    const v = await measureObjectViews(segment, 'https://x/tree.png', 'tree', 'mango tree', 'tree');
    expect(museImage).not.toHaveBeenCalled();
    expect(v?.side).toBeNull();
    expect(v?.front.aspect).toBeCloseTo(0.5, 1);
  });
});

describe('side depth guard (fridge drawn 3.4 × deeper than wide, 2026-11-04)', () => {
  // The logged run: Spark w 0.46, h 1, d 0.38; front aspect 0.46, side drawn 3.44 × the front.
  const fridge = { archetype: 'cabinet' as const, proportions: { w: 0.46, h: 1, d: 0.38 } };
  const frontView = { aspect: 0.46 };

  it('rejects the logged side (depth 3.44 vs Spark 0.83)', () => {
    expect(sideDepthPlausible(frontView, { aspect: 0.46 * 3.44 }, fridge)).toBe(false);
  });

  it('keeps a side close to Spark, within × SIDE_DEPTH_MAX_FACTOR both ways', () => {
    const spark = sparkDepthRatio(fridge);
    expect(sideDepthPlausible(frontView, { aspect: 0.46 * spark }, fridge)).toBe(true);
    const edge = SIDE_DEPTH_MAX_FACTOR * 0.99;
    expect(sideDepthPlausible(frontView, { aspect: 0.46 * spark * edge }, fridge)).toBe(true);
    expect(sideDepthPlausible(frontView, { aspect: (0.46 * spark) / edge }, fridge)).toBe(true);
    expect(sideDepthPlausible(frontView, { aspect: (0.46 * spark) / 2.5 }, fridge)).toBe(false);
  });

  it('a vehicle compares length / width the same way as sparkDepthRatio', () => {
    const car = { archetype: 'vehicle' as const, proportions: { w: 1, h: 0.4, d: 0.45 } };
    const spark = sparkDepthRatio(car);
    expect(sideDepthPlausible({ aspect: 1 }, { aspect: spark }, car)).toBe(true);
    expect(sideDepthPlausible({ aspect: 1 }, { aspect: spark * 3 }, car)).toBe(false);
  });

  it('keepPlausibleSide drops the bad side and its image, keeps a good one untouched', () => {
    const png = Buffer.from('x');
    const bad = { front: frontView, side: { aspect: 0.46 * 3.44 }, sidePng: png };
    expect(keepPlausibleSide(bad as never, fridge, 'fridge')).toMatchObject({
      side: null,
      sidePng: null,
    });
    const good = {
      front: frontView,
      side: { aspect: 0.46 * sparkDepthRatio(fridge) },
      sidePng: png,
    };
    expect(keepPlausibleSide(good as never, fridge, 'fridge')).toBe(good);
    const none = { front: frontView, side: null, sidePng: null };
    expect(keepPlausibleSide(none as never, fridge, 'fridge')).toBe(none);
  });
});
