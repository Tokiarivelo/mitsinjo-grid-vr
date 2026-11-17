import { describe, expect, it } from 'vitest';
import { ObjectRecipeSchema, type ObjectRecipe } from '@/lib/object-shape';
import { FURNITURE_FIXTURES } from '../__fixtures__/teams/furniture';
import { renderFlat } from '../flat-render';
import { iou } from '../silhouette-fit';
import { runTeam, type AskTeamTool } from '../team/team';
import { FURNITURE_TEAMS, furnitureModel, isFurnitureTeam } from '../team/teams';
import { parseUpholstery, SEAT_TEAM } from '../team/teams/seat';
import { parseBedding } from '../team/teams/bed';
import tourMock from '../tour-mock/tour-mock.json';

const TOUR = tourMock as unknown as Record<string, { recipe: ObjectRecipe }>;
const ATLAS = 'data:image/jpeg;base64,AAAA';

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
