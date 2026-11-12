import { describe, expect, it, vi } from 'vitest';
import { fitRecipe } from '@/lib/object-shape';
import { compileScript, recipeToScript } from '@/lib/shape-script';
import {
  MAX_STAGE_OPS,
  SHAPE_SCRIPT_JSON_SCHEMA,
  SHAPE_SCRIPT_PROMPT_VERSION,
  SHAPE_SCRIPT_SYSTEM_PROMPT,
  describeComponent,
  parseStageOps,
  shapeScriptSystemPrompt,
  stageQuestion,
} from '../shape-script-prompt';
import {
  facadeStageLoop,
  stageNotes,
  stageSheet,
  sparkStageProposer,
  type StageProgress,
} from '../shape-stages-spark';
import { HOUSE_STAGES, houseStageScorer, runShapeStages } from '../shape-stages';
import { facadeHouseRecipe, measureElevation } from '../facade-house';
import { scoreElevation } from '../elevation-score';
import { THATCHED_FRONT } from '../__fixtures__/elevation';

const g = THATCHED_FRONT;
const front = measureElevation(g.masks)!;
const built = fitRecipe(
  { ...facadeHouseRecipe({ front, side: null, colors: g.colors }), source: 'facade' },
  0
);
const { components } = compileScript(recipeToScript(built));

describe('stage prompt (PG-T15)', () => {
  it('is versioned, names the ops and never asks for energy values', () => {
    expect(SHAPE_SCRIPT_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
    for (const op of ['set', 'cut', 'remove', 'repeat', 'material', 'attach'])
      expect(SHAPE_SCRIPT_SYSTEM_PROMPT).toContain(op);
    expect(SHAPE_SCRIPT_SYSTEM_PROMPT).toMatch(/Never give metres, watts/);
    expect(SHAPE_SCRIPT_JSON_SCHEMA.schema.properties.ops.maxItems).toBe(MAX_STAGE_OPS);
  });

  it('has a views variant (PG-T20): the three-row sheet, same ops and rules', () => {
    const views = shapeScriptSystemPrompt('views');
    expect(views).toContain('three rows');
    expect(views).toContain('back drawing (the front drawing mirrored)');
    expect(views).not.toContain('three tiles');
    expect(shapeScriptSystemPrompt()).toBe(SHAPE_SCRIPT_SYSTEM_PROMPT);
    expect(views).toMatch(/Never give metres, watts/);
  });

  it('the question lists editable and locked components with their values', () => {
    const q = stageQuestion({
      label: 'rural "thatched"\nhouse',
      stage: 'openings',
      round: 2,
      score: { stage: 0.71, overall: 0.88 },
      components,
      editable: components.filter((c) => c.part.kind === 'window').map((c) => c.id),
      notes: ['openings 3 drawn, 3 built, 3 matched'],
    });
    expect(q).toContain("rural 'thatched' house");
    expect(q).toContain('Stage: openings (round 2). Stage score 71 %, whole model 88 %.');
    const [edit, locked] = q.split('Locked (read-only):');
    expect(edit).toContain('window (window box on wall)');
    expect(edit).not.toMatch(/^roof /m);
    expect(locked).toMatch(/^roof \(roof hip\)/m);
    expect(q).toContain('Measured: openings 3 drawn');
  });

  it('describes a component with its assembly options', () => {
    const door = components.find((c) => c.part.kind === 'door')!;
    expect(describeComponent(door)).toMatch(
      /^door \(door box on wall\) at \[.*\] size \[.*\] wood/
    );
  });

  it('parses ops, keeps box adds only, caps the list, rejects non-JSON', () => {
    expect(parseStageOps('not json')).toBeNull();
    expect(parseStageOps('{"nope": []}')).toBeNull();
    const ops = parseStageOps(
      JSON.stringify({
        ops: [
          { op: 'set', id: 'roof', bulge: 0.1 },
          { op: 'add', id: 'x', part: { shape: 'extrude', points: [] } },
          {
            op: 'add',
            id: 'step',
            part: { shape: 'box', at: [0, 0, 0], size: [0.1, 0.1, 0.1], color: '#888888' },
          },
          { op: 'eval', id: 'x' },
          'junk',
          ...Array.from({ length: 20 }, (_, i) => ({ op: 'remove', id: `w${i}` })),
        ],
      })
    )!;
    expect(ops).toHaveLength(MAX_STAGE_OPS);
    expect((ops[0] as { op: string }).op).toBe('set');
    expect((ops[1] as { id: string }).id).toBe('step');
  });
});

describe('stage sheet + Spark proposer (PG-T15)', () => {
  it('draws drawing | model | diff as one JPEG, label map when no drawing', async () => {
    const s = scoreElevation(built, front, { roofRings: g.masks.roof!.rings! });
    const url = await stageSheet(built, s, null);
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(stageNotes(s)[0]).toMatch(/^openings 3 drawn, \d built, \d matched$/);
  });

  it('runs a loop round through Spark: sheet + question in, ops out, kept only if better', async () => {
    const proposeShapeOps = vi.fn<
      (img: string, q: string) => Promise<{ result: { ops: unknown[] | null } }>
    >(async () => ({ result: { ops: [{ op: 'set', id: 'roof', ridge: 0 }] } }));
    const res = await runShapeStages({
      seed: recipeToScript(built),
      stages: HOUSE_STAGES.filter((s) => s.id === 'roof'),
      score: houseStageScorer(front, g.masks.roof!.rings!),
      budgetMs: 10_000,
      propose: sparkStageProposer({
        proposeShapeOps,
        front,
        roofRings: g.masks.roof!.rings!,
        drawing: null,
        label: 'thatched house',
      }),
    });
    if (res.stages[0]!.stop !== 'gate') {
      expect(proposeShapeOps).toHaveBeenCalled();
      const [img, q] = proposeShapeOps.mock.calls[0]!;
      expect(img).toMatch(/^data:image\/jpeg/);
      expect(q).toContain('Stage: roof (round 1)');
    }
    // A flattened ridge never beats the measured one: the seed is kept.
    expect(res.recipe).toEqual(built);
  });

  it('an unusable answer is an empty patch', async () => {
    const propose = sparkStageProposer({
      proposeShapeOps: async () => ({ result: { ops: null } }),
      front,
      drawing: null,
      label: 'house',
    });
    const ops = await propose({
      stage: HOUSE_STAGES[0]!,
      round: 1,
      recipe: built,
      components,
      editable: [],
      locked: [],
      score: { stage: 0.5, overall: 0.5 },
      signal: new AbortController().signal,
    });
    expect(ops).toEqual([]);
  });
});

describe('facadeStageLoop (PG-T18)', () => {
  const base = {
    recipe: { ...built, swatches: { thatch: 'data:image/png;base64,AA' } },
    front,
    roofRings: g.masks.roof!.rings!,
    label: 'thatched house',
    drawing: async () => null,
  };

  it('no time in the first answer: every stage left for the background, with progress events', async () => {
    const proposeShapeOps = vi.fn(async () => ({ result: { ops: [] } }));
    const first = vi.fn();
    const out = await facadeStageLoop({
      ...base,
      proposeShapeOps,
      firstBudgetMs: 1_000,
      onProgress: first,
    });
    expect(out.recipe).toBe(base.recipe);
    expect(first).not.toHaveBeenCalled();
    expect(out.rest!.stages).toEqual(['massing', 'roof', 'openings', 'accessories', 'final']);
    expect(out.rest!.total).toBe(5);
    const events: Array<{ phase: string; state: string; index: number }> = [];
    const done = await out.rest!.run({ budgetMs: 10_000, onProgress: (e) => events.push(e) });
    expect(done.cause).toBeUndefined();
    expect(done.recipe.swatches).toEqual(base.recipe.swatches);
    expect(events.every((e) => e.phase === 'background')).toBe(true);
    expect(events.filter((e) => e.state === 'done').length).toBe(5);
    // Only the final check asks the deep-reasoning model.
    const refined = proposeShapeOps.mock.calls.filter(
      (c) => (c as unknown[])[3] && ((c as unknown[])[3] as { refine?: boolean }).refine
    );
    expect(refined.length).toBe(1);
    expect(String((refined[0] as unknown[])[1])).toContain('Stage: final (round 1)');
    expect(String((refined[0] as unknown[])[1])).toContain('Final check');
  });

  it('with time: stages run in the first answer, only the final check is left', async () => {
    const proposeShapeOps = vi.fn(async () => ({ result: { ops: [] } }));
    const events: Array<{ phase: string }> = [];
    const out = await facadeStageLoop({
      ...base,
      proposeShapeOps,
      firstBudgetMs: 30_000,
      onProgress: (e) => events.push(e),
    });
    expect(out.rest!.stages).toEqual(['final']);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.phase === 'first')).toBe(true);
    expect(events.some((e) => (e as { stage?: string }).stage === 'final')).toBe(false);
    expect(out.recipe.swatches).toEqual(base.recipe.swatches);
  });

  it('streams the seed model at loop start, so the viewer paints while stage 1 asks Spark', async () => {
    const proposeShapeOps = vi.fn(async () => ({ result: { ops: [] } }));
    const events: StageProgress[] = [];
    await facadeStageLoop({
      ...base,
      proposeShapeOps,
      firstBudgetMs: 30_000,
      onProgress: (e) => events.push(e),
    });
    expect(events[0]).toMatchObject({
      phase: 'first',
      state: 'running',
      stage: 'massing',
      recipe: base.recipe,
    });
  });

  it('an aborted background run ends with cause aborted', async () => {
    const out = await facadeStageLoop({
      ...base,
      proposeShapeOps: () => new Promise(() => {}),
      firstBudgetMs: 0,
    });
    const ctrl = new AbortController();
    const p = out.rest!.run({ budgetMs: 10_000, signal: ctrl.signal, onProgress: () => {} });
    ctrl.abort();
    expect((await p).cause).toBe('aborted');
  });
});
