import { describe, expect, it } from 'vitest';
import { ObjectRecipeSchema, type ObjectRecipe } from '@/lib/object-shape';
import {
  FURNITURE_FIXTURES as RECORDED,
  SEAT_TOUR_FIXTURES,
  TABLE_STORAGE_TOUR_FIXTURES,
} from '../__fixtures__/teams/furniture';
import { renderFlat } from '../flat-render';
import { iou } from '../silhouette-fit';
import { runTeam, type AskTeamTool } from '../team/team';
import { FURNITURE_TEAMS, furnitureModel, isFurnitureTeam } from '../team/teams';
import { parseUpholstery, SEAT_TEAM } from '../team/teams/seat';
import { bedFrameTop, parseBedding, type BedReading } from '../team/teams/bed';
import { seatHeight, type SeatReading } from '../team/teams/seat';
import { isWaterfall, type TableReading } from '../team/teams/table';
import { hasPosts, type StorageReading } from '../team/teams/storage';
import { partsBounds, stool, stoolTopFor } from '../furniture';
import { furnitureParts } from '../team/teams';
import tourMock from '../tour-mock/tour-mock.json';

const TOUR = tourMock as unknown as Record<string, { recipe: ObjectRecipe }>;
const ATLAS = 'data:image/jpeg;base64,AAAA';
import {
  APPLIANCE_FIXTURES,
  FIXTURE_FIXTURES,
  STRUCTURE_FIXTURES,
  TERRAIN_FIXTURES,
  TEXTILE_FIXTURES,
} from '../__fixtures__/teams/parts';
import { TOUR_OUTLINES } from '@/features/vision-insert/ui/xr/tour/tour-outlines';
import { outlineFrame } from '../tour-mock/skin';
import type { PartsOutline } from '../team/teams';
import { parseDrape, textileParts, type TextileReading } from '../team/teams/textile';
import { fixtureParts, type FixtureReading } from '../team/teams/fixture';
import { parseLattice, structureParts, type StructureReading } from '../team/teams/structure';
import { terrainParts, type TerrainReading } from '../team/teams/terrain';
import { applianceParts, type ApplianceReading } from '../team/teams/appliance';

const FURNITURE_FIXTURES = [
  ...RECORDED,
  ...SEAT_TOUR_FIXTURES,
  ...TABLE_STORAGE_TOUR_FIXTURES,
  ...TEXTILE_FIXTURES,
  ...FIXTURE_FIXTURES,
  ...STRUCTURE_FIXTURES,
  ...TERRAIN_FIXTURES,
  ...APPLIANCE_FIXTURES,
];

/** The tour outline of an object as the real path hands it: box fractions, box pixel aspect (pano 2:1). */
function tourOutline(id: string): PartsOutline {
  const { box, rings } = outlineFrame(TOUR_OUTLINES[id]!);
  return {
    rings: rings.map((r) => r.map(([x, y]) => [(x - box.x) / box.w, (y - box.y) / box.h] as const)),
    aspect: (box.w * 2) / box.h,
  };
}

/** The recorded answer of each tool, as the model would send it. */
const replay =
  (answers: Record<string, unknown>): AskTeamTool<string> =>
  async (tool) =>
    answers[tool] === undefined ? null : JSON.stringify(answers[tool]);

/** Front silhouettes on the same grid, each framed on its own bounds. */
const front = (r: ObjectRecipe) =>
  renderFlat({ ...r, yaw: undefined }, 1, 64, 64, { yaw: 0, pitch: 0 }).mask;
const side = (r: ObjectRecipe) =>
  renderFlat({ ...r, yaw: undefined }, 1, 64, 64, { yaw: Math.PI / 2, pitch: 0 }).mask;

async function build(id: string) {
  const fx = FURNITURE_FIXTURES.find((f) => f.id === id)!;
  const { team } = FURNITURE_TEAMS[fx.team];
  const { reading } = await runTeam(
    team as unknown as Parameters<typeof runTeam>[0],
    replay(fx.answers),
    { label: fx.label, views: ['front', 'side'], images: ['front.png', 'side.png'] }
  );
  const target = TOUR[fx.id]!.recipe;
  const model = furnitureModel(
    fx.team,
    reading as never,
    target.proportions,
    ATLAS,
    fx.outline ? tourOutline(fx.id) : undefined
  );
  return { fx, reading, target, model };
}

describe('part-plan teams (PQ-T89, PQ-T90)', () => {
  it('are registered by their class', () => {
    for (const id of ['seat', 'table', 'storage', 'bed']) expect(isFurnitureTeam(id)).toBe(true);
    expect(isFurnitureTeam('car')).toBe(false);
    expect(SEAT_TEAM.tools).toEqual(['profile', 'legs', 'upholstery', 'finishes']);
  });

  it('defaults an unusable own answer', () => {
    expect(parseUpholstery('nope').back).toBe('straight');
    expect(
      parseUpholstery('{"upholstery":{"seatCushions":9,"arms":"both","back":"x"}}')
    ).toMatchObject({ seatCushions: 6, arms: 'both', back: 'straight' });
    expect(parseBedding(null)).toEqual({ pillows: 2, headboard: false, blanket: true });
  });

  it('gives no reading without a profile', async () => {
    const { reading } = await runTeam(
      SEAT_TEAM as unknown as Parameters<typeof runTeam>[0],
      replay({ pilot: { kind: 'sofa', parts: [] } }),
      { label: 'Sofa', views: ['front'], images: ['front.png'] }
    );
    expect(reading).toBeNull();
  });

  const read = <O>(o: O, extra: Partial<SeatReading> = {}) => ({
    kind: 'chair',
    parts: [] as string[],
    profile: [{ view: 'front' as const, body: [0, 0, 1, 1] as [number, number, number, number] }],
    legs: [],
    finishes: [],
    own: o,
    ...extra,
  });
  const leg = (kind: string, section: string, y1 = 1) => ({
    kind,
    view: 'front' as const,
    box: [0, 0.1, 0.05, y1] as [number, number, number, number],
    count: 2,
    section,
  });

  it('reads a stool top back from its outline', () => {
    for (const top of [0.3, 0.38, 0.8]) {
      const [w] = partsBounds(stool(0.75, top, '#000', '#000', true)).dims;
      expect(stoolTopFor(w)).toBeCloseTo(top, 3);
    }
  });

  it('sizes a chair from its seat line (bar chair above 58 %)', () => {
    const r = (seat: number) =>
      read(
        {},
        {
          profile: [{ view: 'front', body: [0, 0, 1, 1], lines: { seat: 1 - seat } }],
        }
      ) as unknown as SeatReading;
    expect(seatHeight(r(0.5), 'chair')).toBeCloseTo(0.9);
    expect(seatHeight(r(0.65), 'chair')).toBeCloseTo(0.75 / 0.65);
    expect(seatHeight(r(0.5), 'sofa')).toBeCloseTo(0.9);
    expect(seatHeight(read({}) as unknown as SeatReading, 'stool')).toBe(0.7);
  });

  it('puts the bed frame under the mattress line, else under the pillows', () => {
    const bed = (own: object, lines?: Record<string, number>) =>
      read(own, {
        profile: [{ view: 'front', body: [0, 0, 1, 1], ...(lines ? { lines } : {}) }],
      }) as unknown as BedReading;
    const b = { pillows: 2, headboard: false, blanket: true };
    expect(bedFrameTop(bed(b, { mattress: 0.4 }), 1)).toBeCloseTo(0.6 - 0.22);
    expect(bedFrameTop(bed(b), 0.9)).toBeCloseTo(0.9 - 0.62);
    expect(bedFrameTop(bed({ ...b, headboard: true }), 1.2)).toBe(0.25);
    expect(bedFrameTop(bed(b), 0.5)).toBe(0.12);
  });

  it('tells waterfall ends and rack posts from legs', () => {
    const t = (legs: object[], parts: string[] = []) =>
      read({}, { legs, parts } as never) as unknown as TableReading;
    expect(isWaterfall(t([leg('frame', 'flat')]))).toBe(true);
    expect(isWaterfall(t([leg('frame', 'flat', 0.8)]))).toBe(false);
    expect(isWaterfall(t([leg('leg', 'round')], ['waterfall']))).toBe(true);
    expect(isWaterfall(t([leg('leg', 'flat')]))).toBe(false);
    const st = (legs: object[]) => read({}, { legs } as never) as unknown as StorageReading;
    expect(hasPosts(st([leg('frame', 'square')]))).toBe(true);
    expect(hasPosts(st([leg('frame', 'flat')]))).toBe(false);
    expect(hasPosts(st([]))).toBe(false);
  });

  it('fits the built outline to the measured proportions', async () => {
    const { reading, target } = await build('bedroom-chair-director');
    const p = target.proportions;
    const [w, h, d] = partsBounds(furnitureParts('seat', reading as never, p)).dims;
    expect(w / h).toBeCloseTo(p.w / p.h, 2);
    expect(d / h).toBeCloseTo(p.d / p.h, 2);
  });

  it('reads a drape, every field defaulted', () => {
    expect(parseDrape(null)).toEqual({
      hang: 'rod',
      rods: 0,
      folds: 'soft',
      pool: false,
      tied: false,
    });
    expect(parseDrape('{"drape":{"hang":"x","rods":9,"pool":true}}')).toMatchObject({
      hang: 'rod',
      rods: 4,
      pool: true,
    });
  });

  it('builds a curtain under its rolls, a sweep on the floor, a flat rug', () => {
    const r = (kind: string, drape: object, finishes: object[] = []) =>
      ({
        ...read(parseDrape(JSON.stringify({ drape })), { kind, finishes } as never),
      }) as never as TextileReading;
    const p = { w: 1, h: 0.8, d: 0.05 };
    const hung = textileParts(
      r('backdrop', { hang: 'stand', rods: 2 }, [{ finish: 'roll', color: '#AA0000' }]),
      p
    );
    expect(hung.map((x) => x.concept)).toEqual(['curtain', 'rail', 'rail']);
    expect(hung[0]!.silhouette?.band?.[0]).toBeCloseTo(0.07);
    expect(hung.slice(1).map((x) => x.color)).toEqual(['#aa0000', '#aa0000']);
    const sweep = textileParts(r('backdrop', { hang: 'stand', rods: 0, pool: true }), p);
    expect(sweep).toHaveLength(1);
    expect(sweep[0]!.silhouette?.section).toHaveLength(6);
    const flat = textileParts(r('rug', { hang: 'floor', rods: 0 }), { w: 1, h: 0.02, d: 0.7 });
    expect(flat[0]!.size[1]).toBeCloseTo(0.04);
    expect(flat[0]!.size[0] / flat[0]!.size[2]).toBeCloseTo(1 / 0.7);
  });

  it('builds a door per leaf read, a frame as deep as measured', () => {
    const fx = (kind: string, own: object[]) =>
      read(own, { kind } as never) as unknown as FixtureReading;
    const leaf = (x0: number, x1: number, kind = 'leaf') => ({
      view: 'front',
      kind,
      box: [x0, 0, x1, 1] as [number, number, number, number],
    });
    const two = fixtureParts(fx('door', [leaf(0, 0.5), leaf(0.5, 1)]), { w: 0.6, h: 1, d: 0.05 });
    expect(two.filter((x) => x.concept === 'door')).toHaveLength(2);
    for (const d of [0.03, 0.06]) {
      const [, h, z] = partsBounds(fixtureParts(fx('window', []), { w: 0.6, h: 1, d })).dims;
      expect(z / h).toBeCloseTo(d, 2);
    }
  });

  it('reads a lattice, scales a fence by its boards, fixes open colours', () => {
    expect(parseLattice(null).posts).toEqual([0, 1]);
    expect(
      parseLattice(
        '{"lattice":{"pattern":"x","bars":200,"posts":[-1,0.5,"a"],"arms":[[0.2,2],[1]]}}'
      )
    ).toMatchObject({ pattern: 'bars', bars: 80, posts: [0, 0.5], arms: [[0.2, 1]] });
    const st = (kind: string, lattice: object) =>
      read(parseLattice(JSON.stringify({ lattice })), {
        kind,
      } as never) as unknown as StructureReading;
    const [w] = partsBounds(
      structureParts(st('fence', { pattern: 'boards', bars: 10 }), { w: 1, h: 0.3, d: 0.01 })
    ).dims;
    expect(w).toBeCloseTo(4, 1);
    const rail = structureParts(st('railing', { pattern: 'scroll', bars: 8 }), {
      w: 1,
      h: 0.2,
      d: 0.01,
    });
    expect(rail.every((x) => x.fixed)).toBe(true);
  });

  it('builds a rock on its outline, a tyre and a stump by kind', () => {
    const t = (kind: string) => read({}, { kind } as never) as unknown as TerrainReading;
    const p = { w: 1, h: 0.4, d: 0.9 };
    expect(terrainParts(t('rock'), p)[0]!.silhouette?.section).toHaveLength(7);
    expect(terrainParts(t('log'), p)[0]!.silhouette).toEqual({});
    expect(terrainParts(t('tyre'), p).map((x) => x.concept)).toEqual(['wheel', undefined]);
    const [w, h] = partsBounds(terrainParts(t('stump'), p)).dims;
    expect(w / h).toBeCloseTo(1 / 0.4, 1);
  });

  it('builds an air unit from its slots, a hood on its canopy, a body with its details', () => {
    const ap = (kind: string, own: object[], extra: object = {}) =>
      read(own, { kind, ...extra } as never) as unknown as ApplianceReading;
    const slots = { view: 'front', kind: 'slots', box: [0, 0, 1, 0.5], panes: [6, 2] };
    const unit = applianceParts(ap('air_conditioner', [slots]), { w: 1, h: 0.25, d: 0.13 });
    expect(unit.filter((x) => x.kind === 'grille')).toHaveLength(1 + 6 + 5);
    const lines = { profile: [{ view: 'front', body: [0, 0, 1, 1], lines: { canopy: 0.4 } }] };
    const h = applianceParts(ap('hood', [], lines), { w: 0.7, h: 1, d: 0.7 })[0]!;
    expect(h.shape).toBe('lathe');
    const handle = { view: 'front', kind: 'handle', box: [0.1, 0.1, 0.15, 0.3] };
    const legs = [{ kind: 'plinth', view: 'front', box: [0, 0.9, 1, 1], count: 1 }];
    const fridge = applianceParts(ap('fridge', [handle], { legs }), { w: 0.4, h: 1, d: 0.4 });
    expect(fridge.map((x) => x.concept)).toEqual(['door', 'base', 'handle']);
  });

  it('cuts silhouette parts from the outline, boxes without one', async () => {
    const { reading, target } = await build('loft-curtain');
    const cut = furnitureModel(
      'textile',
      reading as never,
      target.proportions,
      undefined,
      tourOutline('loft-curtain')
    )!;
    expect(cut.parts[0]!.shape).toBe('hull');
    const plain = furnitureModel('textile', reading as never, target.proportions)!;
    expect(plain.parts[0]!.shape).toBe('box');
  });

  describe.each(FURNITURE_FIXTURES.map((f) => f.id))('%s', (id) => {
    it('builds a valid model of named parts wearing the drawings', async () => {
      const { fx, reading, model } = await build(id);
      expect(reading).not.toBeNull();
      expect(model).not.toBeNull();
      expect(ObjectRecipeSchema.safeParse(model).success).toBe(true);
      expect(model!.skin?.atlas).toBe(ATLAS);
      expect(model!.skin?.pieces).toHaveLength(model!.parts.length);
      for (const c of fx.concepts) expect(model!.skin!.pieces, c).toContain(c);
    });

    it('matches the tour model front and side (IoU, see the limits below)', async () => {
      const { fx, model, target } = await build(id);
      const f = iou(front(model!), front(target));
      const s = iou(side(model!), side(target));
      console.info(`[IOU] ${id}: front ${f.toFixed(2)}, side ${s.toFixed(2)}`);
      expect(Math.min(f, s)).toBeGreaterThanOrEqual(fx.minIou);
      if (fx.minIou < 0.85) expect(fx.limit).toBeTruthy();
    });
  });
});
