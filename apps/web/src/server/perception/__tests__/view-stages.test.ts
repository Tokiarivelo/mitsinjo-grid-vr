// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
import { kitToRecipe } from '@/lib/object-kit';
import { PART_KINDS, SHAPE_STAGE_IDS, type ObjectRecipe } from '@/lib/object-shape';
import {
  VIEW_ARCHETYPES,
  VIEW_PART_CONCEPTS,
  cellGrid,
  roundViewRecipe,
  viewIou,
  viewsRecipe,
} from '../object-views';
import { viewStageLoop } from '../shape-stages-spark';
import {
  CONCEPT_KIND,
  VIEW_STAGES,
  matchPartBoxes,
  scoreViews,
  tagRoundParts,
  viewStageNotes,
} from '../view-stages';
import { KIT, front, side } from '../__fixtures__/views';

const car = viewsRecipe({ front, side }, KIT);
const views = { front, side };

describe('view stages (PG-T20)', () => {
  it('every views archetype has stages; every concept asked maps to a kind a stage scores', () => {
    for (const a of VIEW_ARCHETYPES) expect(VIEW_STAGES[a]?.length).toBeGreaterThan(0);
    for (const stages of Object.values(VIEW_STAGES))
      for (const st of stages!) {
        expect(SHAPE_STAGE_IDS).toContain(st.id);
        for (const k of st.kinds) expect(PART_KINDS).toContain(k);
      }
    const scored = new Set(
      Object.values(VIEW_STAGES).flatMap((s) => s!.flatMap((st) => [...st.kinds]))
    );
    for (const c of Object.values(VIEW_PART_CONCEPTS).flatMap((v) => [...v!.front, ...v!.side])) {
      expect(CONCEPT_KIND[c], c).toBeDefined();
      expect(scored.has(CONCEPT_KIND[c]!), c).toBe(true);
    }
  });

  it('matches drawn and built boxes: missing or extra parts cost as much as misplaced ones', () => {
    const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const b = { x: 0.6, y: 0.1, w: 0.2, h: 0.2 };
    expect(matchPartBoxes([a, b], [a, b])!.score).toBeCloseTo(1, 9);
    expect(matchPartBoxes([a, b], [a, b])!.matched).toBe(2);
    expect(matchPartBoxes([a, b], [a])!.score).toBeCloseTo(0.5, 6);
    expect(matchPartBoxes([a], [a, b])!.score).toBeCloseTo(0.5, 6);
    expect(matchPartBoxes([], [a])).toBeNull();
  });

  it('tags the car built from its views by kind (body, wheels with rims, glass, lights…)', () => {
    const kinds = car.parts.map((p) => p.kind);
    expect(kinds[0]).toBe('body');
    expect(kinds.filter((k) => k === 'wheel').length).toBeGreaterThanOrEqual(4);
    expect(car.parts.filter((p) => p.kind === 'wheel').every((p) => p.rim)).toBe(true);
    expect(kinds).toContain('window');
    expect(kinds).toContain('light');
  });

  it('scores the car per stage on its views; losing the wheels lowers the wheels stage only', () => {
    const stages = VIEW_STAGES.vehicle!;
    const s = scoreViews(car, views, stages);
    expect(s.silhouette).toBeCloseTo(
      (viewIou(car, front, 'front') + viewIou(car, side, 'side')) / 2,
      2
    );
    expect(s.stages.body).toBe(s.silhouette);
    expect(s.measured).toEqual(expect.arrayContaining(['glass', 'wheels', 'details']));
    expect(s.stages.wheels!).toBeGreaterThan(0.3);
    const noWheels: ObjectRecipe = { ...car, parts: car.parts.filter((p) => p.kind !== 'wheel') };
    const t = scoreViews(noWheels, views, stages);
    expect(t.stages.wheels!).toBeLessThan(s.stages.wheels!);
    expect(t.stages.glass!).toBeCloseTo(s.stages.glass!, 6);
    expect(t.overall).toBeLessThan(s.overall);
    expect(viewStageNotes(s)[0]).toMatch(/^silhouette overlap \d+ %$/);
    expect(
      viewStageNotes(s).some((n) => /^wheels: \d+ drawn, \d+ built, \d+ matched$/.test(n))
    ).toBe(true);
  });

  it('a stage with nothing drawn is not measured (passes its gate)', () => {
    const bare = { front: { ...front, parts: [] }, side: { ...side, parts: [] } };
    const s = scoreViews(car, bare, VIEW_STAGES.vehicle!);
    expect(s.measured).toEqual([]);
    expect(s.stages.wheels).toBe(1);
    expect(s.overall).toBe(s.silhouette);
  });

  it('tags round objects: tree → trunk + crown, lamp post → body + head', () => {
    const ring: Array<[number, number]> = [
      [0.45, 0],
      [0.55, 0],
      [0.55, 0.35],
      [1, 0.5],
      [0.8, 1],
      [0.2, 1],
      [0, 0.5],
      [0.45, 0.35],
    ];
    const tree = roundViewRecipe(
      { aspect: 0.8, ring },
      { ...KIT, archetype: 'tree', colors: { ...KIT.colors } }
    );
    const kinds = new Set(tree.parts.map((p) => p.kind));
    expect(kinds).toEqual(new Set(['trunk', 'crown']));
    const lamp = tagRoundParts(
      'lamp_post',
      kitToRecipe({ ...KIT, archetype: 'lamp_post', proportions: { w: 0.2, h: 1, d: 0.2 } })
    );
    expect(lamp.parts.map((p) => p.kind)).toEqual(['body', 'head', 'head', 'body']);
  });

  it('a solar panel patch gets a cell grid of about square cells', () => {
    expect(cellGrid({ x: 0, y: 0, w: 1, h: 1 }, 2)).toEqual([6, 3]);
    expect(cellGrid({ x: 0, y: 0, w: 1, h: 1 }, 1)).toEqual([6, 6]);
  });
});

describe('viewStageLoop (PG-T20)', () => {
  let seen: Parameters<typeof viewStageLoop>[0]['views'];
  beforeAll(async () => {
    const png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    seen = {
      front,
      side,
      frontUrl: `data:image/png;base64,${png.toString('base64')}`,
      sidePng: null,
    };
  });

  it('no stage list or nothing measured → no loop', () => {
    const base = {
      recipe: car,
      views: seen,
      label: 'car',
      firstBudgetMs: 30_000,
      proposeShapeOps: async () => ({ result: { ops: [] } }),
    };
    expect(viewStageLoop({ ...base, archetype: 'house' })).toBeNull();
  });

  it('runs the measured stages, keeps the seed on empty patches, streams progress', async () => {
    const events: Array<{ stage: string; state: string }> = [];
    const proposeShapeOps = vi.fn(async () => ({ result: { ops: [] } }));
    const out = await viewStageLoop({
      recipe: car,
      archetype: 'vehicle',
      views: seen,
      label: 'car',
      firstBudgetMs: 30_000,
      proposeShapeOps,
      onProgress: (e) => events.push(e),
    })!;
    // The final Wonder check never runs in the first answer.
    expect(out.rest!.stages).toEqual(['final']);
    expect(out.recipe.parts).toEqual(car.parts);
    const done = events.filter((e) => e.state === 'done').map((e) => e.stage);
    expect(done).toEqual(expect.arrayContaining(['body', 'glass', 'wheels', 'details']));
  }, 60_000);

  it('keeps a patch that brings a missing part back', async () => {
    const noLights: ObjectRecipe = { ...car, parts: car.parts.filter((p) => p.kind !== 'light') };
    // Headlights only: the tail lights are mirrored in by the rear (PQ-T24).
    const lights = car.parts.filter((p) => p.kind === 'light' && p.status !== 'inferred');
    expect(lights.length).toBe(2);
    const out = await viewStageLoop({
      recipe: noLights,
      archetype: 'vehicle',
      views: seen,
      label: 'car',
      firstBudgetMs: 30_000,
      proposeShapeOps: async (_img, q) => ({
        result: {
          ops: q.includes('Stage: details (round 1)')
            ? lights.map((p, i) => ({
                op: 'add',
                id: `light.n${i}`,
                part: { shape: 'box', at: p.at, size: p.size, color: p.color, kind: 'light' },
              }))
            : [],
        },
      }),
    })!;
    expect(out.recipe.parts.filter((p) => p.kind === 'light').length).toBe(2);
  }, 60_000);
});
