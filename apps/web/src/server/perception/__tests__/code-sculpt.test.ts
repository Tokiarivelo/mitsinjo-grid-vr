// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { ObjectRecipe, RecipePart } from '@/lib/object-shape';
import { codeProgress, sculptBatches, SCULPT_STEPS } from '../code-progress';
import type { CodeRoundEvent } from '../shape-code-loop';
import type { StageProgress } from '../shape-stages-spark';

const part = (kind: RecipePart['kind'], i: number): RecipePart => ({
  shape: 'box',
  at: [0, i * 0.05, 0],
  size: [0.2, 0.05, 0.2],
  color: '#888888',
  material: 'plaster',
  kind,
});
const recipe = (kinds: Array<RecipePart['kind']>): ObjectRecipe => ({
  proportions: { w: 1, h: 0.8, d: 0.6 },
  parts: kinds.map(part),
});
const KINDS: Array<RecipePart['kind']> = [
  'wall',
  'wall',
  'wall',
  'roof',
  'roof',
  'window',
  'window',
  'window',
  'door',
  'chimney',
  'frame',
  'frame',
];
const round = (over: Partial<CodeRoundEvent>): CodeRoundEvent =>
  ({
    round: 1,
    kept: true,
    score: 0.8,
    baseScore: 0.6,
    recipe: recipe(KINDS),
    rawBody: 'return [];',
    question: '',
    issues: [],
    bytes: 0,
    ms: 0,
    writeMs: 0,
    execMs: 0,
    scoreMs: 0,
    ...over,
  }) as CodeRoundEvent;

describe('sculptBatches (PQ-T66)', () => {
  it('grows in build order and never reaches the full model', () => {
    const full = recipe(KINDS);
    const batches = sculptBatches(full);
    expect(batches).toHaveLength(SCULPT_STEPS - 1);
    const sizes = batches.map((b) => b.recipe.parts.length);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(sizes.at(-1)).toBeLessThan(full.parts.length);
    // Each batch is a prefix: the code's own build order, volumes first.
    for (const b of batches)
      expect(b.recipe.parts).toEqual(full.parts.slice(0, b.recipe.parts.length));
    expect(batches[0]!.kinds).toEqual(['wall']);
    expect(batches[1]!.kinds).toEqual(['wall', 'roof']);
  });

  it('has nothing to reveal for a one-part model', () => {
    expect(sculptBatches(recipe(['body']))).toEqual([]);
    expect(sculptBatches(recipe(['wall', 'roof']))).toHaveLength(1);
  });
});

describe('codeProgress (PQ-T60, PQ-T66)', () => {
  const run = (stepMs = 0) => {
    const events: StageProgress[] = [];
    const live = codeProgress({
      stages: ['massing', 'roof', 'openings'],
      shown: (r) => r,
      onStage: (e) => events.push(e),
      stepMs,
    });
    return { events, live };
  };

  it('previews the draft with the kinds the first round works on', () => {
    const { events, live } = run();
    live.start(recipe(['wall']));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ index: 1, total: 3, stage: 'massing', state: 'running' });
    expect(events[0]!.kinds).toEqual(['wall', 'body']);
    expect(events[0]!.recipe!.parts).toHaveLength(1);
  });

  it('streams a kept round part by part, then the full model, then the next stage', async () => {
    const { events, live } = run();
    live.round(round({}));
    await live.flush();
    const partial = events.slice(0, SCULPT_STEPS - 1);
    expect(partial.every((e) => e.state === 'running' && e.stage === 'massing')).toBe(true);
    expect(partial.map((e) => e.recipe!.parts.length)).toEqual([2, 4, 6, 8, 10]);
    expect(partial[2]!.kinds).toEqual(['roof', 'window']);
    const done = events[SCULPT_STEPS - 1]!;
    expect(done).toMatchObject({ state: 'done', index: 1, before: 0.6, after: 0.8 });
    expect(done.recipe!.parts).toHaveLength(KINDS.length);
    expect(done.stop).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ index: 2, stage: 'roof', state: 'running' });
    expect(events.at(-1)!.kinds).toEqual(['roof']);
    expect(events.at(-1)!.recipe).toBeUndefined();
  });

  it('reports a dropped round without touching the model', async () => {
    const { events, live } = run();
    live.round(round({ kept: false, score: 0.55 }));
    live.round(round({ round: 2, kept: false, score: null, recipe: null }));
    await live.flush();
    expect(events.filter((e) => e.recipe)).toEqual([]);
    expect(events.filter((e) => e.state === 'done').map((e) => e.stop)).toEqual([
      'no_gain',
      'error',
    ]);
  });

  it('never makes the code loop wait, and keeps rounds in order', async () => {
    vi.useFakeTimers();
    try {
      const { events, live } = run(1000);
      live.round(round({}));
      live.round(round({ round: 2, baseScore: 0.8, score: 0.9 }));
      // Both calls returned at once: only the first batch has left.
      await vi.advanceTimersByTimeAsync(0);
      expect(events).toHaveLength(1);
      await vi.runAllTimersAsync();
      await live.flush();
      const done = events.filter((e) => e.state === 'done').map((e) => e.index);
      expect(done).toEqual([1, 2]);
      const firstOfRound2 = events.findIndex((e) => e.index === 2 && e.recipe);
      expect(firstOfRound2).toBeGreaterThan(events.findIndex((e) => e.state === 'done'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops revealing when the request is aborted, the full model still lands', async () => {
    const events: StageProgress[] = [];
    const ctl = new AbortController();
    const live = codeProgress({
      stages: ['body'],
      shown: (r) => r,
      onStage: (e) => events.push(e),
      signal: ctl.signal,
      stepMs: 0,
    });
    ctl.abort();
    live.round(round({}));
    await live.flush();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ state: 'done' });
    expect(events[0]!.recipe!.parts).toHaveLength(KINDS.length);
  });
});
