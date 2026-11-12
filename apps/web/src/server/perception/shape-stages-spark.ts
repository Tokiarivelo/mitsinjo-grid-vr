import type { StageLoopContext } from './stage-checkpoint';
import sharp from 'sharp';
import type { ObjectRecipe, ShapeStageEvent, ShapeStageId } from '@/lib/object-shape';
import { trialsLog } from './stage-steps';
import { recipeToScript } from '@/lib/shape-script';
import {
  type ElevationStage,
  type ScoredElevation,
  elevationDiff,
  scoreElevation,
} from './elevation-score';
import type { Elevation } from './facade-house';
import { env } from '@/lib/env';
import { stageQuestion } from './shape-script-prompt';
import {
  FINAL_STAGE,
  type FinalStage,
  HOUSE_STAGES,
  STAGE_MIN_MS,
  type Proposer,
  type StageResult,
  type StageScorer,
  type StageSpec,
  houseCanEdit,
  houseStageScorer,
  runShapeStages,
  withFinalStage,
} from './shape-stages';
import type { ShapeOpsOptions } from './backend';
import type { KitArchetype } from '@/lib/object-kit';
import type { Component } from '@/lib/shape-script';
import {
  judgedPhotoStages,
  photoCanEdit,
  photoStageScorer,
  scorePhoto,
  tagPhotoParts,
  type PhotoTarget,
} from './photo-stages';
import { viewsSheet, type ObjectViews } from './object-views';
import type { StageSheet } from './shape-script-prompt';
import {
  photoStages,
  VIEW_STAGES,
  type ViewStage,
  scoreViews,
  viewStageNotes,
  viewStageScorer,
} from './view-stages';

/**
 * Spark as the stage proposer (PG-T15): builds the stage sheet (drawing | model | diff), asks
 * `proposeShapeOps`, and hands the raw ops to the runner (which compiles and scores them).
 * Every loop ends with the `final` stage: the whole model checked and re-refined by Muse Wonder
 * (`refine`), in the background only, kept only when the whole-model score rises.
 */

/** Stage call options: the final stage asks the deep-reasoning model. */
const callOptions = (stage: string): ShapeOpsOptions => ({ refine: stage === FINAL_STAGE });

type Ring = ReadonlyArray<readonly [number, number]>;

/** Grey levels of the drawing's concepts when no drawing image is at hand (label map). */
const LABEL_GREY = [200, 160, 120, 70, 90, 30];
/** Tiles are drawn at this zoom (nearest), so Spark sees the 128-row grids crisp. */
const SHEET_ZOOM = 3;

/** Plain measured hints for the question (openings drawn vs built, per-concept IoU). */
export function stageNotes(s: ScoredElevation): string[] {
  const o = s.openings;
  const concepts = Object.entries(s.concepts)
    .map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)} %`)
    .join(', ');
  return [
    `openings ${o.target} drawn, ${o.render} built, ${o.matched} matched`,
    ...(concepts ? [`overlap per part: ${concepts}`] : []),
  ];
}

/**
 * Drawing | model | diff (JPEG data URL). The drawing tile is the validated elevation image
 * resized to the score grid, else the label map read on it. Never throws: null on failure.
 */
export async function stageSheet(
  recipe: ObjectRecipe,
  s: ScoredElevation,
  drawing: Buffer | null
): Promise<string | null> {
  try {
    const { cols, rows, label } = s.target;
    const [w, h] = [cols * SHEET_ZOOM, rows * SHEET_ZOOM];
    const raw = (b: Buffer) =>
      sharp(b, { raw: { width: cols, height: rows, channels: 3 } })
        .resize(w, h, { kernel: 'nearest' })
        .png()
        .toBuffer();
    const labels = Buffer.alloc(cols * rows * 3, 255);
    label.forEach((v, i) => {
      if (v >= 0) labels.fill(LABEL_GREY[v]!, i * 3, i * 3 + 3);
    });
    const built = Buffer.from(s.render.rgb);
    s.render.mask.data.forEach((v, i) => {
      if (!v) built.fill(255, i * 3, i * 3 + 3);
    });
    const tiles = await Promise.all([
      drawing
        ? sharp(drawing).resize(w, h).flatten({ background: '#ffffff' }).png().toBuffer()
        : raw(labels),
      raw(built),
      raw(Buffer.from(elevationDiff(recipe, s).rgb)),
    ]);
    const jpg = await sharp({
      create: { width: w * 3, height: h, channels: 3, background: '#ffffff' },
    })
      .composite(tiles.map((input, i) => ({ input, left: i * w, top: 0 })))
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpg.toString('base64')}`;
  } catch (err) {
    console.warn('[vision] 3D stage sheet failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export interface SparkStageInput {
  /** `perception.proposeShapeOps` bound to its backend. */
  proposeShapeOps: (
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    opts?: ShapeOpsOptions
  ) => Promise<{ result: { ops: unknown[] | null } }>;
  front: Elevation;
  roofRings?: ReadonlyArray<Ring>;
  /** The validated front drawing (PNG / JPEG bytes), when at hand. */
  drawing: Buffer | null;
  label: string;
}

/** A runner proposer that asks Spark for each stage round; empty patch when unusable. */
export function sparkStageProposer(input: SparkStageInput): Proposer<ElevationStage | FinalStage> {
  return async (ctx) => {
    const scored = scoreElevation(
      ctx.recipe,
      input.front,
      input.roofRings ? { roofRings: input.roofRings } : {}
    );
    const sheet = await stageSheet(ctx.recipe, scored, input.drawing);
    if (!sheet) return [];
    const question = stageQuestion({
      label: input.label,
      stage: ctx.stage.id,
      round: ctx.round,
      score: ctx.score,
      components: ctx.components,
      editable: ctx.editable,
      ...(ctx.feedback ? { feedback: ctx.feedback } : {}),
      cards: env.SHAPE_LOOP_CARDS,
      notes: stageNotes(scored),
    });
    const { result } = await input.proposeShapeOps(
      sheet,
      question,
      ctx.signal,
      callOptions(ctx.stage.id)
    );
    return result.ops ?? [];
  };
}

/** One stage event of a staged loop, as streamed (`shape_stage`, without the job id). */
export type StageProgress = Omit<ShapeStageEvent, 'jobId'>;

/** Where a background run stopped for time: the stages still to run, from `round` of the first. */
export interface StagesResume {
  stages: ShapeStageId[];
  round: number;
  /** The model so far (patches kept before the cut). */
  recipe: ObjectRecipe;
}

/** The stages left after the first answer, to run in the background (PG-T18). */
export interface StagesContinuation {
  total: number;
  /** Stage ids still to run. */
  stages: ShapeStageId[];
  /** Every stage id of the loop, in order (progress positions, a resumed loop's stage list). */
  all: ShapeStageId[];
  /** What the loop is built from, to resume it in another request (set by the pipeline). */
  context?: StageLoopContext;
  run(opts: {
    budgetMs: number;
    signal?: AbortSignal;
    onProgress: (e: StageProgress) => void;
    /** Round the first stage starts at (a resumed loop). */
    startRound?: number;
    /** A round starts only with this much budget left; else the run stops with `resume`. */
    roundReserveMs?: number;
  }): Promise<{
    recipe: ObjectRecipe;
    cause?: 'timeout' | 'error' | 'aborted';
    /** Set when the budget ran out: run these later (`resumeStages`) instead of stopping. */
    resume?: StagesResume;
  }>;
}

interface LoopTiming {
  /** Time left for the first answer's stages (ms); below `STAGE_MIN_MS` every stage waits. */
  firstBudgetMs: number;
  signal?: AbortSignal;
  onProgress?: (e: StageProgress) => void;
  /** Full stage order (a resumed loop runs a tail of it): progress positions and `total`. */
  order?: ReadonlyArray<ShapeStageId>;
  /** A resumed loop (checkpoint): the full stage list it was built with and the stages left. */
  resumeAt?: { all: ReadonlyArray<ShapeStageId>; stages: ReadonlyArray<ShapeStageId> };
}

/** The loop's stages, restricted to the ones left when it resumes from a checkpoint. */
function resumedStages<S extends ShapeStageId>(
  looped: { stages: ReadonlyArray<StageSpec<S>> },
  resumeAt: LoopTiming['resumeAt']
): Pick<StagedLoopInput<S>, 'stages' | 'order'> {
  if (!resumeAt) return { stages: looped.stages };
  return {
    stages: looped.stages.filter((st) => resumeAt.stages.includes(st.id)),
    order: resumeAt.all,
  };
}

export interface StagedLoopInput<S extends ShapeStageId> extends LoopTiming {
  recipe: ObjectRecipe;
  stages: ReadonlyArray<StageSpec<S>>;
  score: StageScorer<S>;
  propose: Proposer<S>;
  canEdit?: (c: Component) => boolean;
}

/**
 * A staged loop split in two (PG-T16…T18, any archetype since PG-T20): the stages that fit the
 * first answer's budget run now, the others come back as a continuation for the background.
 * Swatches and dimension statuses of the built model are kept on every staged model.
 */
export async function stagedLoop<S extends ShapeStageId>(
  input: StagedLoopInput<S>
): Promise<{ recipe: ObjectRecipe; rest: StagesContinuation | null }> {
  const order: ReadonlyArray<ShapeStageId> = input.order ?? input.stages.map((st) => st.id);
  const total = order.length;
  const keep = (r: ObjectRecipe): ObjectRecipe => ({
    ...r,
    ...(input.recipe.swatches ? { swatches: input.recipe.swatches } : {}),
    ...(input.recipe.dimStatus ? { dimStatus: input.recipe.dimStatus } : {}),
  });
  const position = (id: S) => order.indexOf(id) + 1;
  const stream = (phase: StageProgress['phase'], emit?: (e: StageProgress) => void) => ({
    onStageStart: (st: StageSpec<S>) =>
      emit?.({
        phase,
        index: position(st.id),
        total,
        stage: st.id,
        state: 'running',
        kinds: [...st.kinds],
      }),
    onStage: (res: StageResult<S>, recipe: ObjectRecipe) => {
      if (res.stop === 'timeout' || res.stop === 'skipped') return;
      if (res.trials?.length)
        console.info(`[vision] 3D stage ${res.id} ops, one by one: ${trialsLog(res.trials)}`);
      emit?.({
        phase,
        index: position(res.id),
        total,
        stage: res.id,
        state: 'done',
        before: clamp01(res.before),
        after: clamp01(res.after),
        stop: res.stop,
        ...(res.kept ? { recipe: keep(recipe) } : {}),
      });
    },
  });
  const common = {
    score: input.score,
    propose: input.propose,
    ...(input.canEdit ? { canEdit: input.canEdit } : {}),
  };
  let recipe = input.recipe;
  let remaining: ReadonlyArray<StageSpec<S>> = input.stages;
  // The final check (Wonder, slow) never holds the first answer: it always runs in the background.
  const now = input.stages.filter((st) => st.id !== FINAL_STAGE);
  const final = input.stages.filter((st) => st.id === FINAL_STAGE);
  if (input.firstBudgetMs >= STAGE_MIN_MS && now.length) {
    // Live preview: the seed streams at once, so the viewer paints the rough model while the
    // first stage still asks Spark (same `shape_stage` event, `running` + recipe — no protocol change).
    input.onProgress?.({
      phase: 'first',
      index: position(now[0]!.id),
      total,
      stage: now[0]!.id,
      state: 'running',
      kinds: [...now[0]!.kinds],
      recipe: keep(input.recipe),
    });
    const first = await runShapeStages({
      ...common,
      seed: recipeToScript(recipe),
      stages: now,
      budgetMs: input.firstBudgetMs,
      ...(input.signal ? { signal: input.signal } : {}),
      ...stream('first', input.onProgress),
    });
    recipe = keep(first.recipe);
    remaining = [
      ...now.filter((_, i) => {
        const stop = first.stages[i]?.stop;
        return stop === 'timeout' || stop === 'skipped';
      }),
      ...final,
    ];
  }
  if (!remaining.length) return { recipe, rest: null };
  const seed = recipe;
  return {
    recipe,
    rest: {
      total,
      stages: remaining.map((st) => st.id),
      all: [...order],
      run: async ({ budgetMs, signal, onProgress, startRound, roundReserveMs }) => {
        try {
          const res = await runShapeStages({
            ...common,
            seed: recipeToScript(seed),
            stages: remaining,
            budgetMs,
            ...(signal ? { signal } : {}),
            ...(startRound ? { startRound } : {}),
            ...(roundReserveMs ? { roundReserveMs } : {}),
            ...stream('background', onProgress),
          });
          const recipe = keep(res.recipe);
          if (signal?.aborted) return { recipe, cause: 'aborted' as const };
          // Out of time: hand back where to go on, nothing is lost (the request limit, not a failure).
          if (res.resume) {
            const from = remaining.findIndex((st) => st.id === res.resume!.stage);
            return {
              recipe,
              resume: {
                stages: remaining.slice(Math.max(0, from)).map((st) => st.id),
                round: res.resume.round,
                recipe,
              },
            };
          }
          const cause = res.stages.some((st) => st.stop === 'timeout')
            ? ('timeout' as const)
            : undefined;
          return { recipe, ...(cause ? { cause } : {}) };
        } catch (err) {
          console.warn(
            '[vision] 3D background stages failed:',
            err instanceof Error ? err.message : err
          );
          return { recipe: seed, cause: 'error' };
        }
      },
    },
  };
}

/** Fetches the drawing once, on the first round that needs it. */
function lazyDrawing(get: () => Promise<Buffer | null>) {
  let drawing: Promise<Buffer | null> | null = null;
  return () => (drawing ??= get().catch(() => null));
}

export interface FacadeLoopInput extends Omit<SparkStageInput, 'drawing'>, LoopTiming {
  recipe: ObjectRecipe;
  /** Fetched once, on the first round that needs it. */
  drawing: () => Promise<Buffer | null>;
}

/** The facade house loop (PG-T16…T18): elevation stages, side-wall openings locked. */
export function facadeStageLoop(input: FacadeLoopInput) {
  const drawing = lazyDrawing(input.drawing);
  const propose: Proposer<ElevationStage | FinalStage> = async (ctx) =>
    sparkStageProposer({ ...input, drawing: await drawing() })(ctx);
  const looped = withFinalStage(HOUSE_STAGES, houseStageScorer(input.front, input.roofRings));
  return stagedLoop({
    ...input,
    ...looped,
    ...resumedStages(looped, input.resumeAt),
    propose,
    canEdit: houseCanEdit,
  });
}

export interface ViewLoopInput extends LoopTiming {
  recipe: ObjectRecipe;
  archetype: KitArchetype;
  views: ObjectViews;
  label: string;
  /** `perception.proposeShapeOps` bound to its backend (views sheet). */
  proposeShapeOps: (
    imageUrl: string,
    question: string,
    signal?: AbortSignal,
    sheet?: StageSheet,
    opts?: ShapeOpsOptions
  ) => Promise<{ result: { ops: unknown[] | null } }>;
}

/**
 * Objects built from their 2D view (PG-T20): the archetype's stages (`VIEW_STAGES`), scored on
 * the views (`scoreViews`), Spark sees the views sheet (drawings | model). Null when the
 * archetype has no stage list or no stage is measured on the drawings (nothing to improve).
 */
export function viewStageLoop(input: ViewLoopInput) {
  const stages = VIEW_STAGES[input.archetype];
  if (!stages?.length) return null;
  const views = { front: input.views.front, side: input.views.side };
  const first = scoreViews(input.recipe, views, stages);
  // Only the body and the stages with drawn parts can be judged (a resumed loop keeps its list).
  const judged = input.resumeAt
    ? stages.filter((st) => input.resumeAt!.all.includes(st.id))
    : stages.filter((st) => st.id === 'body' || first.measured.includes(st.id));
  if (!judged.length) return null;
  const looped = withFinalStage(judged, viewStageScorer(views, judged));
  const propose: Proposer<ViewStage | FinalStage> = async (ctx) => {
    const sheet = await viewsSheet(ctx.recipe, input.views, ctx.signal);
    if (!sheet) return [];
    const question = stageQuestion({
      label: input.label,
      stage: ctx.stage.id,
      round: ctx.round,
      score: ctx.score,
      components: ctx.components,
      editable: ctx.editable,
      ...(ctx.feedback ? { feedback: ctx.feedback } : {}),
      cards: env.SHAPE_LOOP_CARDS,
      notes: viewStageNotes(scoreViews(ctx.recipe, views, judged)),
    });
    const { result } = await input.proposeShapeOps(
      sheet,
      question,
      ctx.signal,
      'views',
      callOptions(ctx.stage.id)
    );
    return result.ops ?? [];
  };
  return stagedLoop({ ...input, ...looped, ...resumedStages(looped, input.resumeAt), propose });
}

export interface PhotoLoopInput extends LoopTiming {
  recipe: ObjectRecipe;
  archetype: KitArchetype;
  target: PhotoTarget;
  label: string;
  /** `perception.proposeShapeOps` bound to its backend (photo sheet). */
  proposeShapeOps: ViewLoopInput['proposeShapeOps'];
}

/**
 * The photo-path loop (PQ-T19): the archetype's stages scored on the photo (`scorePhoto`), Spark sees the
 * photo | model | difference | ¾ sheet. Parts the photo cannot see are locked (`photoCanEdit`). Null when
 * no stage is judged beyond the body with nothing to improve, or the archetype has no stage list.
 */
export function photoStageLoop(input: PhotoLoopInput) {
  const judged = input.resumeAt
    ? (photoStages(input.archetype) ?? []).filter((st) => input.resumeAt!.all.includes(st.id))
    : judgedPhotoStages(input.archetype, input.target);
  if (!judged.length) return null;
  const recipe = tagPhotoParts(input.recipe, input.archetype);
  const looped = withFinalStage(judged, photoStageScorer(input.target, judged));
  const propose: Proposer<ViewStage | FinalStage> = async (ctx) => {
    // Dynamic: the critic module imports the pipeline that imports this one.
    const { criticSheet } = await import('./spark-critic');
    const sheet = await criticSheet(
      input.target.crop,
      ctx.recipe,
      input.target.aspect,
      input.target.outline
    ).catch(() => null);
    if (!sheet) return [];
    const question = stageQuestion({
      label: input.label,
      stage: ctx.stage.id,
      round: ctx.round,
      score: ctx.score,
      components: ctx.components,
      editable: ctx.editable,
      ...(ctx.feedback ? { feedback: ctx.feedback } : {}),
      cards: env.SHAPE_LOOP_CARDS,
      notes: viewStageNotes(scorePhoto(ctx.recipe, input.target, judged)),
    });
    const { result } = await input.proposeShapeOps(
      sheet,
      question,
      ctx.signal,
      'photo',
      callOptions(ctx.stage.id)
    );
    return result.ops ?? [];
  };
  return stagedLoop({
    ...input,
    recipe,
    ...looped,
    ...resumedStages(looped, input.resumeAt),
    propose,
    canEdit: photoCanEdit,
  });
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
