import { describe, expect, it, vi } from 'vitest';
import { fitRecipe, type ObjectRecipe, type RecipePart } from '@/lib/object-shape';
import { recipeToScript } from '@/lib/shape-script';
import {
  FINAL_GATE,
  FINAL_STAGE,
  HOUSE_STAGES,
  type Proposer,
  type StageScorer,
  type StageSpec,
  houseCanEdit,
  houseStageScorer,
  runShapeStages,
  withFinalStage,
} from '../shape-stages';
import { facadeHouseRecipe, measureElevation } from '../facade-house';
import { THATCHED_FRONT } from '../__fixtures__/elevation';

type S = 'massing' | 'roof';
const wall: RecipePart = {
  shape: 'box',
  at: [0, -0.2, 0],
  size: [0.6, 0.6, 0.6],
  color: '#e6dccb',
  kind: 'wall',
  front: true,
};
const roof: RecipePart = {
  shape: 'hip',
  ridge: 0.3,
  at: [0, 0.3, 0],
  size: [0.9, 0.4, 0.7],
  color: '#c8a060',
  kind: 'roof',
};
const seed = recipeToScript({ proportions: { w: 1, h: 0.7, d: 0.6 }, parts: [wall, roof] });
const STAGES: StageSpec<S>[] = [
  { id: 'massing', kinds: ['wall'], gate: 0.99 },
  { id: 'roof', kinds: ['roof'], gate: 0.99 },
];
// Targets: walls 0.8 wide, ridge 0.9.
const find = (r: ObjectRecipe, k: string) => r.parts.find((p) => p.kind === k)!;
const score: StageScorer<S> = (r, stage) => {
  const m = 1 - Math.abs(find(r, 'wall').size[0] - 0.8);
  const f = 1 - Math.abs((find(r, 'roof').ridge ?? 0) - 0.9);
  return { stage: stage === 'massing' ? m : f, overall: (m + f) / 2 };
};
/** Scripted answers: `answers[stage][round - 1]`, empty patch when missing. */
const scripted =
  (answers: Partial<Record<S, unknown[][]>>): Proposer<S> =>
  async ({ stage, round }) =>
    answers[stage.id]?.[round - 1] ?? [];

describe('runShapeStages (PG-T16)', () => {
  it('keeps improving patches and stops a stage at its gate', async () => {
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: 5_000,
      propose: scripted({
        massing: [
          [{ op: 'set', id: 'wall', size: [0.7, 0.6, 0.6] }],
          [{ op: 'set', id: 'wall', size: [0.8, 0.6, 0.6] }],
        ],
        roof: [[{ op: 'set', id: 'roof', ridge: 0.9 }]],
      }),
    });
    expect(res.stages.map((s) => [s.id, s.kept, s.stop])).toEqual([
      ['massing', 2, 'gate'],
      ['roof', 1, 'gate'],
    ]);
    expect(find(res.recipe, 'wall').size[0]).toBeCloseTo(0.8, 9);
    expect(res.overall.after).toBeGreaterThan(res.overall.before);
  });

  it('the score never goes down: a worse patch is dropped, the model kept', async () => {
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: 5_000,
      propose: scripted({
        massing: [[{ op: 'set', id: 'wall', size: [0.3, 0.6, 0.6] }]],
        roof: [[{ op: 'set', id: 'roof', ridge: 0.1 }]],
      }),
    });
    expect(res.stages.map((s) => s.stop)).toEqual(['no_gain', 'no_gain']);
    expect(res.recipe.parts).toEqual([wall, roof]);
    expect(res.overall.after).toBe(res.overall.before);
  });

  it('locks hold: the roof stage cannot move the walls nor add a chimney', async () => {
    const res = await runShapeStages({
      seed,
      stages: [STAGES[1]!],
      score,
      budgetMs: 5_000,
      propose: scripted({
        roof: [
          [
            { op: 'set', id: 'wall', size: [0.8, 0.6, 0.6] },
            {
              op: 'add',
              id: 'chimney',
              part: { ...wall, front: undefined, kind: 'chimney', size: [0.05, 0.2, 0.05] },
            },
            { op: 'set', id: 'roof', ridge: 0.6 },
          ],
        ],
      }),
    });
    expect(find(res.recipe, 'wall').size[0]).toBe(0.6);
    expect(res.recipe.parts.some((p) => p.kind === 'chimney')).toBe(false);
    expect(find(res.recipe, 'roof').ridge).toBe(0.6);
    expect(res.stages[0]!.dropped).toBe(2);
  });

  it('out of time: returns the best so far, later stages keep the seed', async () => {
    let t = 0;
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: 30,
      now: () => t,
      propose: async ({ stage }) => {
        if (stage.id === 'massing') {
          t = 40; // this answer lands after the budget's clock
          return [{ op: 'set', id: 'wall', size: [0.8, 0.6, 0.6] }];
        }
        return [{ op: 'set', id: 'roof', ridge: 0.9 }];
      },
    });
    expect(res.stages[0]!.kept).toBe(1);
    expect(res.stages[1]!.stop).toBe('timeout');
    expect(find(res.recipe, 'roof').ridge).toBe(0.3);
  });

  it('a hanging proposer is cut at the deadline', async () => {
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: 30,
      propose: () => new Promise(() => {}),
    });
    expect(res.stages.map((s) => s.stop)).toEqual(['timeout', 'timeout']);
    expect(res.recipe.parts).toEqual([wall, roof]);
  });

  it('no time limit: a slow answer is waited for, only a cancel stops it (before: cut at 3 min, live 2026-11-03)', async () => {
    const slow: Proposer<S> = ({ stage }) =>
      new Promise((r) =>
        setTimeout(
          () => r(stage.id === 'massing' ? [{ op: 'set', id: 'wall', size: [0.8, 0.6, 0.6] }] : []),
          20
        )
      );
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: Number.POSITIVE_INFINITY,
      propose: slow,
    });
    expect(res.stages.map((s) => s.stop)).not.toContain('timeout');
    expect(res.stages[0]!.kept).toBe(1);
    const ctrl = new AbortController();
    const cancelled = runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: Number.POSITIVE_INFINITY,
      signal: ctrl.signal,
      propose: () => new Promise(() => {}),
    });
    ctrl.abort();
    expect((await cancelled).stages.map((s) => s.stop)).toEqual(['skipped', 'skipped']);
  });

  it('cut by the time: reports the stage and round to resume; a resumed run starts there', async () => {
    let t = 0;
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: 100,
      roundReserveMs: 50,
      now: () => t,
      propose: async ({ stage }) => {
        t += 60; // the first round uses the time a second one would need
        return stage.id === 'massing' ? [{ op: 'set', id: 'wall', size: [0.7, 0.6, 0.6] }] : [];
      },
    });
    expect(res.stages[0]!.kept).toBe(1);
    expect(res.resume).toEqual({ stage: 'massing', round: 2 });
    const rounds: number[] = [];
    const again = await runShapeStages({
      seed: recipeToScript(res.recipe),
      stages: STAGES,
      score,
      budgetMs: 5_000,
      startRound: res.resume!.round,
      propose: async ({ stage, round }) => {
        if (stage.id === 'massing') rounds.push(round);
        return stage.id === 'massing' ? [{ op: 'set', id: 'wall', size: [0.8, 0.6, 0.6] }] : [];
      },
    });
    expect(rounds[0]).toBe(2);
    expect(again.resume).toBeUndefined();
    expect(find(again.recipe, 'wall').size[0]).toBeCloseTo(0.8, 9);
  });

  it('breadth first: a stage stops before a round that would starve the later stages', async () => {
    let t = 0;
    const asked: string[] = [];
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      // Room for 3 rounds of 40: massing round 1, then 80 left < 40 × (1 + 1 later stage)? no:
      // 80 ≥ 80, round 2 runs; after it 40 left < 80 → massing stops, the roof still gets a round.
      budgetMs: 120,
      now: () => t,
      propose: async ({ stage, round }) => {
        t += 40;
        asked.push(`${stage.id}${round}`);
        return stage.id === 'massing'
          ? [{ op: 'set', id: 'wall', size: [0.6 + 0.05 * round, 0.6, 0.6] }]
          : [{ op: 'set', id: 'roof', ridge: 0.9 }];
      },
    });
    expect(asked).toEqual(['massing1', 'massing2', 'roof1']);
    expect(res.stages.map((s) => s.stop)).toEqual(['rounds', 'gate']);
    expect(res.resume).toBeUndefined();
  });

  it('without a clock limit the share rule never stops a stage', async () => {
    const asked: number[] = [];
    await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: Infinity,
      propose: async ({ stage, round }) => {
        if (stage.id === 'massing') asked.push(round);
        return stage.id === 'massing'
          ? [{ op: 'set', id: 'wall', size: [0.6 + 0.05 * round, 0.6, 0.6] }]
          : [];
      },
    });
    expect(asked).toEqual([1, 2, 3]);
  });

  it('a round cut at the deadline is asked again on resume', async () => {
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: 30,
      propose: () => new Promise(() => {}),
    });
    expect(res.resume).toEqual({ stage: 'massing', round: 1 });
  });

  it('a failing proposer ends its stage; the next stage still runs', async () => {
    const res = await runShapeStages({
      seed,
      stages: STAGES,
      score,
      budgetMs: 5_000,
      propose: async ({ stage }) => {
        if (stage.id === 'massing') throw new Error('bad json');
        return [{ op: 'set', id: 'roof', ridge: 0.9 }];
      },
    });
    expect(res.stages.map((s) => s.stop)).toEqual(['error', 'gate']);
  });

  it('a stage already at its gate asks nothing; onStage reports each stage', async () => {
    const propose = vi.fn(scripted({}));
    const onStage = vi.fn();
    await runShapeStages({
      seed,
      stages: [{ id: 'massing', kinds: ['wall'], gate: 0.5 }, STAGES[1]!],
      score,
      budgetMs: 5_000,
      propose,
      onStage,
    });
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose.mock.calls[0]![0].stage.id).toBe('roof');
    expect(onStage.mock.calls.map((c) => c[0].id)).toEqual(['massing', 'roof']);
  });

  it('is deterministic for the same answers, and tells the proposer what it may edit', async () => {
    const answers = {
      massing: [[{ op: 'set', id: 'wall', size: [0.75, 0.6, 0.6] }]],
      roof: [[{ op: 'set', id: 'roof', ridge: 0.7 }], [{ op: 'set', id: 'roof', ridge: 0.8 }]],
    };
    const seen: string[][] = [];
    const run = () =>
      runShapeStages({
        seed,
        stages: STAGES,
        score,
        budgetMs: 5_000,
        propose: async (ctx) => {
          seen.push([...ctx.editable, '|', ...ctx.locked]);
          return scripted(answers)(ctx);
        },
      });
    const a = await run();
    const b = await run();
    expect(a.recipe).toEqual(b.recipe);
    expect(a.stages).toEqual(b.stages);
    expect(seen[0]).toEqual(['wall', '|', 'roof']);
    expect(seen.at(-1)).toEqual(['roof', '|', 'wall']);
  });
});

describe('canEdit', () => {
  it('keeps components the score cannot see locked (side-wall windows)', async () => {
    const side: RecipePart = {
      shape: 'box',
      at: [0.305, -0.2, 0],
      size: [0.01, 0.15, 0.12],
      color: '#334455',
      material: 'glass',
      kind: 'window',
    };
    const front: RecipePart = { ...side, at: [0, -0.2, 0.305], size: [0.12, 0.15, 0.01] };
    const s0 = recipeToScript({
      proportions: { w: 1, h: 0.7, d: 0.6 },
      parts: [wall, roof, front, side],
    });
    const seen: string[][] = [];
    const res = await runShapeStages<'openings'>({
      seed: s0,
      stages: [{ id: 'openings', kinds: ['window'], gate: 0.99 }],
      score: (r) => {
        const n = r.parts.filter((p) => p.kind === 'window').length;
        return { stage: n === 1 ? 0.9 : 0.5, overall: 0.5 };
      },
      budgetMs: 5_000,
      canEdit: houseCanEdit,
      propose: async (ctx) => {
        seen.push([...ctx.editable]);
        // Removing the side window would « help » this score: refused by the lock.
        return ctx.components
          .filter((c) => c.part.size[0] < c.part.size[2] && c.part.kind === 'window')
          .map((c) => ({ op: 'remove', id: c.id }));
      },
    });
    expect(seen[0]).toHaveLength(1);
    expect(res.recipe.parts.filter((p) => p.kind === 'window')).toHaveLength(2);
  });
});

describe('houseStageScorer + HOUSE_STAGES on the thatched drawing', () => {
  it('scores the seed per stage and a worse roof lowers the roof stage', async () => {
    const g = THATCHED_FRONT;
    const front = measureElevation(g.masks)!;
    const built = fitRecipe(
      { ...facadeHouseRecipe({ front, side: null, colors: g.colors }), source: 'facade' },
      0
    );
    const scorer = houseStageScorer(front, g.masks.roof?.rings);
    const s = scorer(built, 'roof');
    expect(s.stage).toBeGreaterThan(0.6);
    expect(s.overall).toBeGreaterThan(0.8);
    // A patch that flattens the roof ridge is refused by the loop.
    const res = await runShapeStages({
      seed: recipeToScript(built),
      stages: HOUSE_STAGES.filter((st) => st.id === 'roof'),
      score: scorer,
      budgetMs: 5_000,
      propose: async () => [{ op: 'set', id: 'roof', ridge: 0 }],
    });
    expect(res.stages[0]!.stop).toMatch(/no_gain|gate/);
    expect(res.recipe).toEqual(built);
  });
});

describe('withFinalStage (final check, Muse Wonder)', () => {
  const looped = withFinalStage(STAGES, score);
  /** Each stage left untouched; the final round answers `final`. */
  const finalOnly =
    (final: unknown[]): Proposer<S | typeof FINAL_STAGE> =>
    async ({ stage }) =>
      stage.id === FINAL_STAGE ? final : [];

  it('appends the final stage: every earlier kind editable, scored on the whole model', () => {
    const last = looped.stages.at(-1)!;
    expect(last).toEqual({ id: FINAL_STAGE, kinds: ['wall', 'roof'], gate: FINAL_GATE });
    const recipe = { proportions: { w: 1, h: 0.7, d: 0.6 }, parts: [wall, roof] };
    const whole = score(recipe, 'massing').overall;
    expect(looped.score(recipe, FINAL_STAGE)).toEqual({ stage: whole, overall: whole });
    expect(looped.score(recipe, 'roof')).toEqual(score(recipe, 'roof'));
  });

  it('re-refines several parts in one patch when the whole model gets better', async () => {
    const res = await runShapeStages({
      seed,
      ...looped,
      budgetMs: 5_000,
      propose: finalOnly([
        { op: 'set', id: 'wall', size: [0.8, 0.6, 0.6] },
        { op: 'set', id: 'roof', ridge: 0.9 },
      ]),
    });
    const final = res.stages.at(-1)!;
    expect(final.id).toBe(FINAL_STAGE);
    expect(final.kept).toBe(1);
    expect(find(res.recipe, 'wall').size[0]).toBeCloseTo(0.8, 9);
    expect(find(res.recipe, 'roof').ridge).toBeCloseTo(0.9, 9);
  });

  it('a final patch that makes the whole model worse is dropped (model kept)', async () => {
    const res = await runShapeStages({
      seed,
      ...looped,
      budgetMs: 5_000,
      propose: finalOnly([{ op: 'set', id: 'wall', size: [0.2, 0.6, 0.6] }]),
    });
    expect(res.stages.at(-1)).toMatchObject({ id: FINAL_STAGE, kept: 0, stop: 'repeat' });
    expect(find(res.recipe, 'wall').size[0]).toBeCloseTo(0.6, 9);
  });

  it('passes without asking once the whole model is at the gate', async () => {
    const propose = vi.fn(async () => []);
    const perfect: StageScorer<S> = () => ({ stage: 1, overall: 1 });
    const res = await runShapeStages({
      seed,
      ...withFinalStage(STAGES, perfect),
      budgetMs: 5_000,
      propose,
    });
    expect(res.stages.at(-1)).toMatchObject({ id: FINAL_STAGE, stop: 'gate' });
    expect(propose).not.toHaveBeenCalled();
  });
});

describe('stage stop reasons (PQ-T38)', () => {
  it('stops on a repeated op that gained nothing', async () => {
    const bad = [{ op: 'set', id: 'wall', size: [0.3, 0.6, 0.6] }];
    const res = await runShapeStages({
      seed,
      stages: [STAGES[0]!],
      score,
      budgetMs: 5_000,
      maxRounds: 5,
      propose: scripted({ massing: [bad, bad, bad] }),
    });
    // Round 1 no gain, round 2 repeats it: own stop reason, round 3 never asked.
    expect(res.stages[0]!.stop).toBe('repeat');
    expect(res.stages[0]!.rounds).toBe(2);
  });

  it('stops when an op undoes the previous kept op', async () => {
    const res = await runShapeStages({
      seed,
      stages: [STAGES[0]!],
      score,
      budgetMs: 5_000,
      maxRounds: 5,
      propose: scripted({
        massing: [
          [{ op: 'set', id: 'wall', size: [0.7, 0.6, 0.6] }],
          [{ op: 'set', id: 'wall', size: [0.6, 0.6, 0.6] }],
        ],
      }),
    });
    expect(res.stages[0]!.stop).toBe('back_and_forth');
    expect(res.stages[0]!.kept).toBe(1);
    expect(find(res.recipe, 'wall').size[0]).toBeCloseTo(0.7, 9);
  });
});
