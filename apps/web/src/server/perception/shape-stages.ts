import type { ObjectRecipe, PartKind } from '@/lib/object-shape';
import { microPatch, type OpTrial } from './stage-steps';
type Ring = ReadonlyArray<readonly [number, number]>;
import { type ElevationStage, scoreElevation, sideFacing } from './elevation-score';
import type { Elevation } from './facade-house';
import {
  type Component,
  type ComponentId,
  type ShapeScript,
  compileScript,
} from '@/lib/shape-script';

/**
 * Staged agent loop (PG-T16): the model is improved one stage at a time (massing → roof →
 * openings → accessories). Per stage, up to `maxRounds` rounds: the proposer (Spark, PG-T15)
 * answers patch ops for the stage's components only, the engine compiles them op by op with
 * smaller steps (`microPatch`), and the ops that raise the stage score without lowering the
 * overall score are kept. A stage stops at its gate, after `STAGE_MAX_MISSES` rounds without
 * gain (the retry is told what each op did), at `maxRounds`, when a further round would leave no
 * time for one round of each later stage (`rounds`: breadth first, the final check always gets
 * its turn), or when the shared time budget runs out (the rest keeps the seed). Deterministic given the same proposer answers. Pure apart from the
 * injected proposer and clock.
 */

export interface StageSpec<S extends string = string> {
  id: S;
  /** Part kinds this stage may add or change; every other component is locked. */
  kinds: ReadonlyArray<PartKind>;
  /** Accept the stage at this score (0–1). */
  gate: number;
}

/** What one stage measures, from the recipe: its own score and the overall one (both 0–1). */
export type StageScorer<S extends string = string> = (
  recipe: ObjectRecipe,
  stage: S
) => { stage: number; overall: number };

export interface ProposeContext<S extends string = string> {
  stage: StageSpec<S>;
  round: number;
  recipe: ObjectRecipe;
  components: ReadonlyArray<Component>;
  /** Components the patch may touch (the stage's kinds). */
  editable: ReadonlyArray<ComponentId>;
  /** Components the patch must leave alone (accepted stages, other kinds). */
  locked: ReadonlyArray<ComponentId>;
  score: { stage: number; overall: number };
  signal: AbortSignal;
  /** What the previous round of this stage did, op by op (a retry after no gain). */
  feedback?: RoundFeedback;
}

/** The previous round's patch, op by op: Spark sees what helped and what did not. */
export interface RoundFeedback {
  round: number;
  /** The round raised the stage score (part of its ops kept). */
  kept: boolean;
  trials: OpTrial[];
  /** Ops refused before compiling (they created parts outside the stage). */
  refused: number;
}

/** Answers patch ops for the stage (raw: compiled and checked here). */
export type Proposer<S extends string = string> = (ctx: ProposeContext<S>) => Promise<unknown[]>;

export type StageStop =
  | 'gate'
  | 'no_gain'
  | 'rounds'
  | 'timeout'
  | 'error'
  | 'skipped'
  /** The same op was proposed twice and the second time gained nothing (PQ-T38). */
  | 'repeat'
  /** An op undid the previous kept op (PQ-T38). */
  | 'back_and_forth';

export interface StageResult<S extends string = string> {
  id: S;
  before: number;
  after: number;
  rounds: number;
  /** Patches kept (score rose). */
  kept: number;
  stop: StageStop;
  /** Patch ops the compiler or the stage guard refused, all rounds. */
  dropped: number;
  /** The last round's ops, one by one (log). */
  trials?: OpTrial[];
}

export interface StagesResult<S extends string = string> {
  script: ShapeScript;
  recipe: ObjectRecipe;
  stages: StageResult<S>[];
  overall: { before: number; after: number };
  /** Where the time ran out: the stage and round to run next (a later call resumes there). */
  resume?: { stage: S; round: number };
}

export interface RunStagesOptions<S extends string = string> {
  seed: ShapeScript;
  stages: ReadonlyArray<StageSpec<S>>;
  score: StageScorer<S>;
  propose: Proposer<S>;
  /** Shared time budget for every stage, ms. */
  budgetMs: number;
  maxRounds?: number;
  /** Clock (tests); defaults to `Date.now`. */
  now?: () => number;
  signal?: AbortSignal;
  /** Called when a stage starts asking the proposer (not for stages skipped at the gate or out of time). */
  onStageStart?: (stage: StageSpec<S>, index: number) => void;
  /** Called after each stage ends, with the model at that point (progressive build, PG-T17). */
  onStage?: (result: StageResult<S>, recipe: ObjectRecipe, index: number) => void;
  /** Components the stage may edit beyond its kinds (default all): what the score cannot see stays locked. */
  canEdit?: (c: Component) => boolean;
  /** Round the first stage starts at (a resumed loop, default 1). */
  startRound?: number;
  /** A round starts only with this much of the budget left (else the loop stops to be resumed). */
  roundReserveMs?: number;
}

/** Most rounds per stage. */
export const STAGE_ROUNDS = 3;
/** A patch must raise the stage score by at least this much to be kept. */
export const STAGE_MIN_GAIN = 0.005;

/**
 * Rounds in a row without gain before a stage stops: the next round gets the op-by-op feedback
 * (an empty answer, « already matches », stops at once).
 */
export const STAGE_MAX_MISSES = 2;

/** Live request: stages start only with this much of the shape budget left (one Spark round). */
export const STAGE_MIN_MS = 15_000;
/** Live request: stop the stages this long before the shape deadline (answer + render). */
export const STAGE_SAFETY_MS = 4_000;

/** Stages of a house built from its elevation (scores from `scoreElevation().stages`). */
export const HOUSE_STAGES: ReadonlyArray<
  StageSpec<'massing' | 'roof' | 'openings' | 'accessories'>
> = [
  // Raised (user 2026-11-05): the builder's seed passed every old gate (97 / 95 / 99 / 80 %), so
  // the stages never asked Spark and nothing changed on screen.
  { id: 'massing', kinds: ['wall', 'plinth'], gate: 0.98 },
  { id: 'roof', kinds: ['roof'], gate: 0.97 },
  { id: 'openings', kinds: ['window', 'door'], gate: 0.97 },
  { id: 'accessories', kinds: ['chimney', 'step'], gate: 0.92 },
];

/** Last stage of every loop: the whole model checked and re-refined (Muse Wonder, background only). */
export const FINAL_STAGE = 'final' as const;
export type FinalStage = typeof FINAL_STAGE;
/** Gate of the final check: Wonder always looks, unless the whole model already scores 100 %. */
export const FINAL_GATE = 1;

/**
 * Appends the final stage: every kind of the earlier stages is editable, and its stage score
 * is the whole-model score, so a patch is kept only when the whole model gets better.
 */
export function withFinalStage<S extends string>(
  stages: ReadonlyArray<StageSpec<S>>,
  score: StageScorer<S>
): { stages: ReadonlyArray<StageSpec<S | FinalStage>>; score: StageScorer<S | FinalStage> } {
  const kinds = [...new Set(stages.flatMap((st) => st.kinds))];
  const first = stages[0]?.id;
  return {
    stages: [...stages, { id: FINAL_STAGE, kinds, gate: FINAL_GATE }],
    score: (recipe, stage) => {
      if (stage !== FINAL_STAGE) return score(recipe, stage as S);
      if (first === undefined) return { stage: 1, overall: 1 };
      const { overall } = score(recipe, first);
      return { stage: overall, overall };
    },
  };
}

const kindOfOp = (op: unknown): PartKind | 'unknown' | null => {
  if (!op || typeof op !== 'object') return null;
  const o = op as { op?: unknown; kind?: unknown; part?: { kind?: unknown } };
  if (o.op === 'cut') return typeof o.kind === 'string' ? (o.kind as PartKind) : 'unknown';
  if (o.op === 'add')
    return typeof o.part?.kind === 'string' ? (o.part.kind as PartKind) : 'unknown';
  return null;
};

/** Stable key of an op: same op, same target, same values. */
export const opKey = (op: unknown): string => JSON.stringify(op ?? null);

/** Ops that only restate a field value of `set` ops, for undo detection. */
const setFields = (op: unknown): { id: string; fields: Record<string, unknown> } | null => {
  if (!op || typeof op !== 'object') return null;
  const { op: name, id, ...fields } = op as Record<string, unknown>;
  return name === 'set' && typeof id === 'string' ? { id, fields } : null;
};

/**
 * PQ-T38: `next` undoes `prev` when both are `set` ops on one component and `next` writes
 * back a value `before` the kept op (`prev` changed field f from X to Y; `next` sets f to X).
 * `originals` holds the field values the component had before `prev`.
 */
export function undoesOp(
  next: unknown,
  prev: unknown,
  originals: Record<string, unknown> | undefined
): boolean {
  const a = setFields(next);
  const b = setFields(prev);
  if (!a || !b || a.id !== b.id || !originals) return false;
  const names = Object.keys(a.fields).filter((k) => k in b.fields);
  return (
    names.length > 0 &&
    names.every((k) => JSON.stringify(a.fields[k]) === JSON.stringify(originals[k]))
  );
}

/** Patch ops that create components outside the stage's kinds are refused before compiling. */
function guardPatch(ops: unknown[], kinds: ReadonlyArray<PartKind>) {
  const kept: unknown[] = [];
  let refused = 0;
  for (const op of ops) {
    const k = kindOfOp(op);
    if (k !== null && (k === 'unknown' || !kinds.includes(k))) refused++;
    else kept.push(op);
  }
  return { kept, refused };
}

/**
 * Rejects after `ms` (never when infinite: `setTimeout` would fire at once past 2^31 ms), or
 * when `signal` aborts; the timer never outlives the race.
 */
function withDeadline<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const timer = Number.isFinite(ms)
      ? setTimeout(() => reject(new Error('timeout')), Math.max(0, ms))
      : undefined;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
}

export async function runShapeStages<S extends string>({
  seed,
  stages,
  score,
  propose,
  budgetMs,
  maxRounds = STAGE_ROUNDS,
  now = Date.now,
  signal,
  onStageStart,
  onStage,
  canEdit = () => true,
  startRound = 1,
  roundReserveMs = 0,
}: RunStagesOptions<S>): Promise<StagesResult<S>> {
  const deadline = now() + budgetMs;
  const first = compileScript(seed);
  if (!first.recipe) throw new Error('seed script compiles to nothing');
  let script: ShapeScript = { ...seed, ops: [...seed.ops] };
  let recipe = first.recipe;
  let components = first.components;
  const overallBefore = score(recipe, stages[0]?.id as S).overall;
  const results: StageResult<S>[] = [];
  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onParentAbort, { once: true });
  let outOfTime = false;
  let resume: StagesResult<S>['resume'];

  try {
    for (const [index, stage] of stages.entries()) {
      let current = score(recipe, stage.id);
      const result: StageResult<S> = {
        id: stage.id,
        before: current.stage,
        after: current.stage,
        rounds: 0,
        kept: 0,
        stop: 'rounds',
        dropped: 0,
      };
      if (outOfTime || signal?.aborted) {
        result.stop = outOfTime ? 'timeout' : 'skipped';
        if (outOfTime) resume ??= { stage: stage.id, round: 1 };
      } else if (current.stage >= stage.gate) {
        result.stop = 'gate';
      } else {
        onStageStart?.(stage, index);
        let misses = 0;
        /** Ops tried in earlier rounds of this stage, and the last kept ops with the values they replaced. */
        const tried = new Set<string>();
        let lastKept: Array<{ op: unknown; originals: Record<string, unknown> | undefined }> = [];
        let feedback: RoundFeedback | undefined;
        /** Duration of this stage's last round (ms), for the breadth-first share. */
        let lastRoundMs: number | undefined;
        const firstRound = index === 0 ? startRound : 1;
        for (let round = firstRound; round <= maxRounds; round++) {
          const left = deadline - now();
          if (left <= Math.max(0, roundReserveMs)) {
            outOfTime = true;
            result.stop = 'timeout';
            resume ??= { stage: stage.id, round };
            break;
          }
          // Out of time is checked first (resumed later); this only shares the time left.
          const later = stages.length - index - 1;
          if (
            round > firstRound &&
            later > 0 &&
            lastRoundMs !== undefined &&
            left < lastRoundMs * (1 + later)
          ) {
            // Another round here would starve the later stages (and the final check).
            result.stop = 'rounds';
            break;
          }
          const editable = components
            .filter((c) => c.part.kind && stage.kinds.includes(c.part.kind) && canEdit(c))
            .map((c) => c.id);
          const locked = components.map((c) => c.id).filter((id) => !editable.includes(id));
          result.rounds = round;
          const roundStart = now();
          let raw: unknown[];
          try {
            raw = await withDeadline(
              propose({
                stage,
                round,
                recipe,
                components,
                editable,
                locked,
                score: current,
                signal: ctrl.signal,
                ...(feedback ? { feedback } : {}),
              }),
              left,
              ctrl.signal
            );
          } catch (err) {
            const timeout = err instanceof Error && err.message === 'timeout';
            if (timeout) {
              outOfTime = true;
              // The cut round never answered: a resumed loop asks it again.
              resume ??= { stage: stage.id, round };
            }
            result.stop = timeout ? 'timeout' : signal?.aborted ? 'skipped' : 'error';
            break;
          }
          const { kept: patch, refused } = guardPatch(Array.isArray(raw) ? raw : [], stage.kinds);
          // PQ-T38: an op that undoes the last kept op, or one already tried without gain, ends the stage.
          const backAndForth = patch.some((op) =>
            lastKept.some((k) => undoesOp(op, k.op, k.originals))
          );
          const repeated = patch.length > 0 && patch.every((op) => tried.has(opKey(op)));
          if (backAndForth || repeated) {
            result.stop = backAndForth ? 'back_and_forth' : 'repeat';
            break;
          }
          const before = components;
          // Op by op, with smaller steps: one bad or overshooting op no longer sinks the round.
          const step = microPatch({
            script,
            patch,
            locked: new Set(locked),
            components,
            current,
            score: (r) => score(r, stage.id),
          });
          lastRoundMs = now() - roundStart;
          result.dropped += refused + step.dropped;
          result.trials = step.trials;
          const gained =
            step.out?.recipe &&
            step.after.stage >= current.stage + STAGE_MIN_GAIN &&
            step.after.overall >= current.overall;
          feedback = { round, kept: Boolean(gained), trials: step.trials, refused };
          // An op kept at a part of its step may be asked again: the next round moves it further.
          patch.forEach((op, i) => {
            const t = step.trials[i];
            const partial = gained && t?.outcome === 'kept' && (t.share ?? 1) < 1;
            if (!partial) tried.add(opKey(op));
          });
          if (gained && step.out?.recipe) {
            lastKept = (step.ops as unknown[]).map((op) => {
              const f = setFields(op);
              const comp = f && before.find((c) => c.id === f.id);
              const originals: Record<string, unknown> = {};
              if (f && comp) {
                for (const k of Object.keys(f.fields))
                  originals[k] = (comp.part as unknown as Record<string, unknown>)[k];
              }
              return { op, originals: f && comp ? originals : undefined };
            });
            script = { ...script, ops: [...script.ops, ...(step.ops as ShapeScript['ops'])] };
            recipe = step.out.recipe;
            components = step.out.components;
            current = step.after;
            result.kept++;
            result.after = step.after.stage;
            result.stop = 'rounds';
            misses = 0;
            if (step.after.stage >= stage.gate) {
              result.stop = 'gate';
              break;
            }
          } else {
            result.stop = 'no_gain';
            misses++;
            if (!patch.length || misses >= STAGE_MAX_MISSES) break;
          }
        }
      }
      results.push(result);
      onStage?.(result, recipe, index);
    }
  } finally {
    ctrl.abort();
    signal?.removeEventListener('abort', onParentAbort);
  }
  return {
    script,
    recipe,
    stages: results,
    overall: { before: overallBefore, after: score(recipe, stages[0]?.id as S).overall },
    ...(resume ? { resume } : {}),
  };
}

/** House stages see the front only: side-wall openings stay as built (locked). */
export const houseCanEdit = (c: Component) => !sideFacing(c.part);

/**
 * House stage scorer: the recipe's front elevation against the measured drawing (PG-T2), stage
 * share from `stages`, overall = elevation score / 100.
 */
export function houseStageScorer(
  front: Elevation,
  roofRings?: ReadonlyArray<Ring>
): StageScorer<ElevationStage> {
  return (recipe, stage) => {
    const s = scoreElevation(recipe, front, roofRings ? { roofRings } : {});
    return { stage: s.stages[stage], overall: s.score / 100 };
  };
}
