// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { ObjectRecipe } from '@/lib/object-shape';
import { CODE_PROMPT_VERSION } from '../shape-code';
import { CODE_ROUNDS_MAX, codeRoundValid, codeSeedFor, refineWithCode } from '../shape-code-loop';
import type { CodeParams } from '../code-sandbox';

const part = (color = '#ffffff') => ({
  shape: 'box' as const,
  at: [0, 0, 0] as [number, number, number],
  size: [0.2, 0.2, 0.2] as [number, number, number],
  color,
});
const DRAFT: ObjectRecipe = {
  proportions: { w: 1, h: 0.8, d: 0.6 },
  parts: [part()],
  source: 'facade',
};
const BETTER: ObjectRecipe = {
  proportions: { w: 1, h: 0.8, d: 0.6 },
  parts: [part(), part('#000000')],
  source: 'code',
};
const PARAMS: CodeParams = {
  seed: 7,
  proportions: DRAFT.proportions,
  colors: { main: '#ffffff', secondary: '#000000', accent: '#ff0000' },
};
const STATS = { apiCalls: 1, instances: 1, triangles: 12, dropped: 0 };

async function runLoop({
  bodies,
  scores,
  exec = async (code: string) =>
    code === 'good'
      ? { ok: true as const, recipe: BETTER, issues: [], stats: STATS }
      : { ok: false as const, reason: 'boom' },
  roundsMax,
  signal,
}: {
  bodies: Array<string | null>;
  scores: Array<number | null>;
  exec?: (
    code: string,
    params: CodeParams
  ) => Promise<
    | { ok: true; recipe: ObjectRecipe; issues: []; stats: typeof STATS }
    | { ok: false; reason: string }
  >;
  roundsMax?: number;
  signal?: AbortSignal;
}) {
  const questions: string[] = [];
  let calls = 0;
  const out = await refineWithCode({
    label: 'house',
    draft: DRAFT,
    baseScore: 0.8,
    params: PARAMS,
    sheet: async () => 'data:image/png;base64,x',
    writeCode: async (_image, question) => {
      questions.push(question);
      return { code: bodies[Math.min(calls++, bodies.length - 1)] ?? null };
    },
    score: async (r) => (r === BETTER ? (scores.shift() ?? null) : 0.8),
    execute: exec,
    ...(roundsMax !== undefined ? { roundsMax } : {}),
    ...(signal ? { signal } : {}),
  });
  return { out, questions, calls };
}

describe('shape-code-loop (PQ-T45)', () => {
  it('replaces the draft on gain and stores the winning body', async () => {
    const { out, calls } = await runLoop({ bodies: ['good'], scores: [0.85] });
    expect(out.recipe).toBe(BETTER);
    expect(out.code).toBe('good');
    expect(out.promptVersion).toBe(CODE_PROMPT_VERSION);
    expect(out.seed).toBe(7);
    // One gain then fruitless rounds until the stall stop: the writer is asked again.
    expect(calls).toBeGreaterThan(1);
    expect(out.rounds[0]).toMatchObject({ round: 1, kept: true, score: 0.85 });
  });

  it('keeps the draft when no round gains', async () => {
    const { out } = await runLoop({ bodies: ['good'], scores: [0.79] });
    expect(out.recipe).toBe(DRAFT);
    expect(out.code).toBeNull();
    expect(out.rounds.every((r) => !r.kept)).toBe(true);
  });

  it('stops after 3 rounds without gain', async () => {
    const { out, calls } = await runLoop({ bodies: ['good'], scores: [0.79] });
    expect(calls).toBe(3);
    expect(out.rounds).toHaveLength(3);
  });

  it('counts null answers and failed executions as no gain', async () => {
    const { out, calls } = await runLoop({ bodies: [null, 'bad', null], scores: [] });
    expect(calls).toBe(3);
    expect(out.recipe).toBe(DRAFT);
    expect(out.rounds.map((r) => r.reason)).toEqual(['no code', 'boom', 'no code']);
  });

  it('sends the current code and the dropped parts to the next round', async () => {
    const dropped = [
      {
        ok: true as const,
        recipe: BETTER,
        issues: [{ index: 2, reason: 'color: Invalid' }],
        stats: STATS,
      },
    ];
    let n = 0;
    const again = async () => dropped[Math.min(n++, dropped.length - 1)]!;
    const { questions } = await runLoop({
      bodies: ['good', 'good'],
      scores: [0.85, 0.85],
      exec: again as never,
    });
    expect(questions[1]).toMatch(/Current code[\s\S]*good/);
    expect(questions[1]).toMatch(/2: color: Invalid/);
  });

  it('respects roundsMax and an aborted signal', async () => {
    const one = await runLoop({ bodies: ['good'], scores: [0.85], roundsMax: 1 });
    expect(one.calls).toBe(1);
    const controller = new AbortController();
    controller.abort();
    const stopped = await runLoop({ bodies: ['good'], scores: [0.85], signal: controller.signal });
    expect(stopped.calls).toBe(0);
    expect(stopped.out.rounds).toHaveLength(0);
    expect(CODE_ROUNDS_MAX).toBe(5);
  });

  it('seeds deterministically per object id', () => {
    expect(codeSeedFor('house-front')).toBe(codeSeedFor('house-front'));
    expect(codeSeedFor('house-front')).not.toBe(codeSeedFor('car-side'));
  });

  it('times every round and splits writer / exec / score (PQ-T55)', async () => {
    const { out } = await runLoop({ bodies: ['good', 'bad', null], scores: [0.79] });
    expect(out.rounds).toHaveLength(3);
    for (const r of out.rounds) {
      expect(r.ms).toBeGreaterThanOrEqual(0);
      expect(r.writeMs).toBeGreaterThanOrEqual(0);
      expect(r.execMs).toBeGreaterThanOrEqual(0);
      expect(r.scoreMs).toBeGreaterThanOrEqual(0);
      expect(r.writeMs + r.execMs + r.scoreMs).toBeLessThanOrEqual(r.ms);
    }
    // The no-code round never reaches the sandbox or the yardstick.
    expect(out.rounds[2]).toMatchObject({ reason: 'no code', execMs: 0, scoreMs: 0 });
  });

  it('records model and cost when the writer reports usage (PQ-T55)', async () => {
    const out = await refineWithCode({
      label: 'house',
      draft: DRAFT,
      baseScore: 0.8,
      params: PARAMS,
      sheet: async () => 'data:image/png;base64,x',
      writeCode: async () => ({
        code: 'good',
        model: 'muse-spark-1.3',
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      }),
      score: async () => 0.79,
      execute: async () => ({ ok: true as const, recipe: BETTER, issues: [], stats: STATS }),
      roundsMax: 1,
    });
    expect(out.rounds[0]?.model).toBe('muse-spark-1.3');
    // 1 M in × $1.25 + 1 M out × $4.25.
    expect(out.rounds[0]?.costUsd).toBeCloseTo(5.5, 6);
  });

  it('passes the archetype to the writer question (PQ-T55)', async () => {
    const questions: string[] = [];
    await refineWithCode({
      label: 'willow',
      archetype: 'tree',
      draft: DRAFT,
      baseScore: 0.8,
      params: PARAMS,
      sheet: async () => 'data:image/png;base64,x',
      writeCode: async (_image, question) => {
        questions.push(question);
        return { code: null };
      },
      score: async () => null,
      roundsMax: 1,
    });
    expect(questions[0]).toMatch(/willow \(tree\)/);
  });

  it('counts a round valid when its body executed (PQ-T55)', () => {
    expect(codeRoundValid({ bytes: 0, score: null, reason: 'no code' })).toBe(false);
    expect(codeRoundValid({ bytes: 12, score: null, reason: 'boom' })).toBe(false);
    expect(codeRoundValid({ bytes: 12, score: 0.8 })).toBe(true);
    expect(codeRoundValid({ bytes: 12, score: null, reason: 'unscorable' })).toBe(true);
  });
});

describe('goal and frame (PQ-T58)', () => {
  it('stops as soon as the best score reaches the goal, and sends the frame every round', async () => {
    const questions: string[] = [];
    const out = await refineWithCode({
      label: 'house',
      draft: DRAFT,
      baseScore: 0.5,
      params: PARAMS,
      goal: 0.9,
      frameText: 'Frame: x 0–1',
      sheet: async () => 'data:image/png;base64,AA==',
      writeCode: async (_img, q) => {
        questions.push(q);
        return { code: 'good' };
      },
      score: async () => 0.95,
      execute: async () => ({ ok: true as const, recipe: BETTER, issues: [], stats: STATS }),
      roundsMax: 5,
    });
    // Round 1 gains (0.5 → 0.95 ≥ goal): no second Wonder call.
    expect(questions).toHaveLength(1);
    expect(questions[0]).toContain('Frame: x 0–1');
    expect(out.rounds).toHaveLength(1);
    expect(out.code).toBe('good');
  });
});
