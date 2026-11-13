import 'server-only';

import type { ObjectRecipe, PartKind, ShapeStageId } from '@/lib/object-shape';
import type { CodeRoundEvent } from './shape-code-loop';
import type { StageProgress } from './shape-stages-spark';

/**
 * Route-B progress on the existing stage events (PQ-T60, PQ-T66): the draft previews at once, then
 * each kept round is "sculpted" into the viewer, its parts arriving in the order the code built
 * them (volumes, then roofs, openings, details), a few at a time. The viewer prints each batch
 * bottom-up and outlines what was just added or changed. No new event, no new UI.
 *
 * The reveal runs on its own queue: the code loop never waits for it, so the next writer round
 * starts at once (a round takes a minute, a reveal a few seconds). `flush()` waits for the queue.
 */

/** A kept round's parts arrive in this many batches. */
export const SCULPT_STEPS = 6;
/** Longer than the viewer's print wipe (900 ms), so each batch finishes printing before the next. */
export const SCULPT_STEP_MS = 1000;

/** Part kinds a code round works on, by stage: framed and pulsed in the viewer while it runs. */
export const STAGE_FOCUS: Partial<Record<ShapeStageId, ReadonlyArray<PartKind>>> = {
  massing: ['wall', 'body'],
  roof: ['roof'],
  openings: ['window', 'door'],
  accessories: ['chimney', 'plinth', 'step', 'frame'],
  body: ['body', 'wall', 'trunk', 'crown'],
};

export interface SculptBatch {
  /** The model so far: the first `upTo` parts, in build order. */
  recipe: ObjectRecipe;
  /** Kinds of the parts this batch added. */
  kinds: PartKind[];
}

/**
 * The partial models leading to `full`, in build order: at most `steps − 1` of them, each longer
 * than the one before, never the full model itself (that one ends the round).
 */
export function sculptBatches(full: ObjectRecipe, steps = SCULPT_STEPS): SculptBatch[] {
  const n = full.parts.length;
  const count = Math.min(steps, n);
  const out: SculptBatch[] = [];
  let from = 0;
  for (let i = 1; i < count; i++) {
    const upTo = Math.max(from + 1, Math.ceil((n * i) / count));
    if (upTo >= n) break;
    out.push({
      recipe: { ...full, parts: full.parts.slice(0, upTo) },
      kinds: [...new Set(full.parts.slice(from, upTo).flatMap((p) => (p.kind ? [p.kind] : [])))],
    });
    from = upTo;
  }
  return out;
}

export interface CodeProgressInput {
  /** Stage id shown for each round, in order; its length is the round budget. */
  stages: ReadonlyArray<ShapeStageId>;
  /** What the viewer must receive for a recipe (measures carried over, drawn parts marked). */
  shown: (r: ObjectRecipe) => ObjectRecipe;
  onStage?: ((e: StageProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
  /** Pause between two batches (tests pass 0). */
  stepMs?: number;
}

export function codeProgress({
  stages,
  shown,
  onStage,
  signal,
  stepMs = SCULPT_STEP_MS,
}: CodeProgressInput) {
  const total = stages.length;
  const stageOf = (round: number) => stages[Math.min(total, Math.max(1, round)) - 1]!;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const focus = (stage: ShapeStageId) =>
    STAGE_FOCUS[stage] ? { kinds: [...STAGE_FOCUS[stage]!] } : {};
  const pause = () =>
    stepMs > 0 ? new Promise<void>((r) => setTimeout(r, stepMs)) : Promise.resolve();
  /** Events leave in order, one reveal after the other; a failing listener never breaks the loop. */
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job).catch(() => undefined);
  };

  return {
    total,
    /** The draft, on screen while the first round is written. */
    start(draft: ObjectRecipe) {
      onStage?.({
        phase: 'first',
        index: 1,
        total,
        stage: stageOf(1),
        state: 'running',
        ...focus(stageOf(1)),
        recipe: shown(draft),
      });
    },
    /** One ended round. Returns at once; the reveal plays on the queue. */
    round(e: CodeRoundEvent) {
      if (!onStage) return;
      const index = Math.min(total, e.round);
      const stage = stageOf(e.round);
      const full = e.kept && e.recipe ? shown(e.recipe) : null;
      enqueue(async () => {
        if (full) {
          for (const batch of sculptBatches(full)) {
            if (signal?.aborted) break;
            onStage({
              phase: 'first',
              index,
              total,
              stage,
              state: 'running',
              ...(batch.kinds.length ? { kinds: batch.kinds } : {}),
              recipe: batch.recipe,
            });
            await pause();
          }
        }
        onStage({
          phase: 'first',
          index,
          total,
          stage,
          state: 'done',
          before: clamp01(e.baseScore),
          ...(e.score !== null ? { after: clamp01(e.score) } : {}),
          ...(e.kept ? {} : { stop: e.score === null ? ('error' as const) : ('no_gain' as const) }),
          ...(full ? { recipe: full } : {}),
        });
        if (e.round < total) {
          const next = stageOf(e.round + 1);
          // What the next round works on: the viewer frames and pulses those parts meanwhile.
          onStage({
            phase: 'first',
            index: e.round + 1,
            total,
            stage: next,
            state: 'running',
            ...focus(next),
          });
        }
      });
    },
    /** Resolves once every queued event has left (call before the answer). */
    flush: () => queue,
  };
}
