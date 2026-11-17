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
const FURNITURE_FIXTURES = [...RECORDED, ...SEAT_TOUR_FIXTURES, ...TABLE_STORAGE_TOUR_FIXTURES];

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
  const model = furnitureModel(fx.team, reading as never, target.proportions, ATLAS);
  return { fx, reading, target, model };
}

describe('furniture teams (PQ-T89)', () => {
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
      console.info(`[PQ-T89] ${id}: front ${f.toFixed(2)}, side ${s.toFixed(2)}`);
      expect(Math.min(f, s)).toBeGreaterThanOrEqual(fx.minIou);
      if (fx.minIou < 0.85) expect(fx.limit).toBeTruthy();
    });
  });
});
