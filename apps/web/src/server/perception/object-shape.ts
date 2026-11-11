import 'server-only';

import { elevationForCheckpoint, type StageLoopContext } from './stage-checkpoint';

import {
  MAX_RECIPE_PARTS,
  clampParts,
  SHAPE_TIMEOUT_MS,
  fitRecipe,
  frontPartIndex,
  recipeIssue,
  type DimStatus,
  type ObjectRecipe,
  type ObjectShape,
  type PartCoverage,
  type ShapeStep,
  type ShapeTarget,
} from '@/lib/object-shape';
import { archetypeOf, kitToRecipe, type KitArchetype, type ObjectKit } from '@/lib/object-kit';
import { pathToRings } from '@/lib/vision';
import type { PerceptionClient } from './client';
import { measureKitColors, type ObjectPixels } from './color-measure';
import type { PhotoForRegions } from './region';
import { measurePerspective, type Perspective } from './perspective';
import { measureRepetition, type GrayGrid, type Repetition } from './repetition';
import { measureRoof, type RoofMeasure } from './roofline';
import {
  confidence,
  ledByMeasurement,
  mixColors,
  mixNumber,
  mixRecipe,
  modelDoubts,
  pickCount,
} from './fusion';
import { coverageForBox, needsFreeParts } from './free-recipe';
import { conditionsFacts, conditionsTrust, measurePhotoConditions } from './photo-conditions';
import { fitGrid, fitSilhouette, ringsMask } from './silhouette-fit';
import {
  EDGE_COLUMNS,
  sampleNativeGray,
  sampleObjectGray,
  sampleObjectPixels,
  sampleObjectRgb,
} from './shape-colors';
import { conceptOf, fetchOutlineForBox, samRetries, type OutlineCrop } from './outline';
import { applyConstraints, buildGraph, notBuilt, partCoverage, repairGraph } from './object-graph';
import { deduceHiddenSides } from './hidden-sides';
import { enforcePartBudget, masksOnObject, partCeiling } from './mask-geometry';
import { cropForShape, cropRectForShape } from './shape-crop';
import { extractSwatches } from './photo-swatches';
import { withLatheBody } from './lathe-body';
import { fetchFacadeMasks, type FacadeMasks } from './facade-masks';
import { depthRatio, facadeHouseRecipe, wallTimber, type Elevation } from './facade-house';
import { STAGE_SAFETY_MS } from './shape-stages';
import {
  facadeStageLoop,
  photoStageLoop,
  viewStageLoop,
  type StageProgress,
  type StagesContinuation,
} from './shape-stages-spark';
import { formatElevationScore, scoreElevation, type ScoredElevation } from './elevation-score';
import { ELEVATION_ARCHETYPES, measureFacadeElevations } from './facade-views';
import { photoTarget, tagPhotoParts } from './photo-stages';
import { fetchPartMasks, partMasksTimeout } from './part-masks';
import { fitPartParams, hasPartGroups, preparePartFit } from './part-fit';
import { REGION_GRID, measureRegionColors, withRegionColors } from './region-colors';
import { withMaskChimney } from './mask-chimney';
import { withMaskPanels } from './mask-panels';
import { withMaskWheels } from './mask-wheels';
import { withProfileBody } from './profile-body';
import { scoreRecipe } from './score-shape';
import { voteKits } from './kit-vote';
import { askFamilies, asFamily } from './kit-ask';
import type { ShapeResult } from './schemas';
import { env } from '@/lib/env';
import { generateImaginedViews } from './views-generation';
import {
  ROUND_VIEW_ARCHETYPES,
  VIEW_ARCHETYPES,
  VIEWS_TOTAL_MS,
  checkViewsModel,
  imageBytes,
  measureObjectViews,
  roundViewRecipe,
  keepPlausibleSide,
  markDrawnInferred,
  sparkDepthRatio,
  viewIou,
  viewsRecipe,
} from './object-views';

export { SHAPE_TIMEOUT_MS };

/** Archetypes whose roof is read on the outline (PF-T3). A pitched `building` becomes a `house`. */
const ROOFED: ReadonlyArray<ObjectKit['archetype']> = ['house', 'building'];

/** Kit + roofline measured on the SAM outline, or the kit unchanged (no outline, flat top, not a house). */
export function withMeasuredRoof(
  kit: ObjectKit,
  target: Pick<ShapeTarget, 'box' | 'outline'>,
  aspect: number
): { kit: ObjectKit; measure: RoofMeasure | null } {
  if (!target.outline || !ROOFED.includes(kit.archetype)) return { kit, measure: null };
  const rings = pathToRings(target.outline).filter((r) => r.length >= 3);
  const measure = rings.length ? measureRoof(rings, target.box, aspect) : null;
  if (!measure) return { kit, measure };
  return { kit: { ...kit, archetype: 'house', roof: measure.roof }, measure };
}

/**
 * Kit + houses in the row and windows per house (PF-T4), houses only (a flat building's window columns
 * are not houses). Units: the measured gables when ≥ 2 (seen directly), else the edge period when
 * trusted (PF-T7, `R(P)` confidence ≥ ½) or Spark has no count, else Spark's count. Windows: measured per house × units (≤ 8), else Spark's.
 */
export function withMeasuredRepetition(
  kit: ObjectKit,
  grid: GrayGrid | null
): { kit: ObjectKit; repetition: Repetition | null } {
  if (kit.archetype !== 'house' || !grid) return { kit, repetition: null };
  const repetition = measureRepetition(grid, kit.roof?.eave ?? 0.4);
  const gables = kit.roof?.gables.length ?? 0;
  const units =
    gables >= 2
      ? gables
      : repetition.units >= 2
        ? pickCount(
            repetition.units,
            kit.details?.units,
            ledByMeasurement(confidence.repetition(repetition.strength), modelDoubts(kit, 'counts'))
          )
        : kit.details?.units;
  const details = { ...kit.details };
  if (units) details.units = units;
  if (repetition.windowsPerUnit) {
    details.windows = Math.min(8, repetition.windowsPerUnit * (units ?? 1));
  }
  return { kit: { ...kit, details }, repetition };
}

/** Archetypes with straight facade lines (PF-T5): a tree's or a person's edges point nowhere. */
const STRAIGHT: ReadonlyArray<ObjectKit['archetype']> = [
  'house',
  'building',
  'cabinet',
  'machine',
  'vehicle',
  'screen',
];

/**
 * Measured yaw of a straight-edged object, or null (round archetype, no grid, too few lines). A house
 * with a measured roof is read below its eave: gable slopes meet at the ridge like facade lines and gave
 * a false 57° on a head-on cottage row (golden set, PF-T9).
 */
export function measuredYaw(
  kit: Pick<ObjectKit, 'archetype' | 'roof'>,
  grid: GrayGrid | null,
  box: ShapeTarget['box'],
  photo: Pick<PhotoForRegions, 'width' | 'height'>
): Perspective | null {
  if (!grid || !STRAIGHT.includes(kit.archetype)) return null;
  const rows = kit.roof ? ([Math.max(0, kit.roof.eave - 0.03), 1] as const) : undefined;
  return measurePerspective(grid, box, photo.width, photo.height, rows);
}

export interface ObjectShapeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Live progress (SSE `shape_step`). */
  onStep?: (step: ShapeStep) => void;
  /** Whether to render the 6 canonical 2D imagined views (defaults to false so core math stays in budget). */
  withViews?: boolean;
  /** Observes Spark's kit answer when present (PR-0.4 capture; routes leave this unset). */
  onKit?: (kit: ObjectKit) => void;
  /** Observes the side elevation Muse Image drew from the facade (end-to-end eval only). */
  onSideView?: (png: Buffer) => void;
  /** Gets the measured front elevation and its score against the model (end-to-end eval only). */
  onElevation?: (front: Elevation, score: ScoredElevation) => void;
  /** Facade house loop progress (PG-T17, SSE `shape_stage`). */
  onStage?: (e: StageProgress) => void;
  /** Gets the staged loop's seed model and measured drawing (stage capture, eval only). */
  onStageSeed?: (seed: ObjectRecipe, front: Elevation) => void;
  /** Stages that did not fit the first answer: the caller runs them in the background (PG-T18). */
  onStagesLeft?: (rest: StagesContinuation) => void;
  /**
   * Kit prompt version for the kit and the free-parts calls (default: `KIT_PROMPT_VERSION`). Routes leave
   * it unset; evals pass 2 to run the whole pipeline on the Muse cards (PQ-T12).
   */
  promptVersion?: number;
  /** Kit samples voting (PQ-T18, default `SHAPE_KIT_SAMPLES`): 2 asks the kit twice when ≥ 40 s are left. */
  kitSamples?: number;
  /** Critic prompt version of `shapeWithCritic` (PQ-T14): 2 = cards + 2 × 2 sheet + extra rounds; default 1. */
  criticPromptVersion?: number;
}

/** The second kit sample is asked only with at least this budget (PQ-T18). */
const SECOND_SAMPLE_MIN_MS = 40_000;

/**
 * Selected object → its 3D shape (PV-T9), Meta models only. One Spark call on a crop around the object
 * returns a kit → parts recipe, fitted to the photo box (`fitRecipe`); archetypes without a real kit
 * template get a second call on the same crop where Spark lists the parts itself (PV-T9c, free recipe).
 * Colours are measured on the photo
 * pixels inside the SAM outline while Spark thinks (PF-T2), and replace Spark's guessed colours; houses get the roofline
 * read on that outline (PF-T3) and the houses / windows counted by edge repetition (PF-T4); straight-edged objects are turned by the yaw read on
 * their vanishing points (PF-T5); with an outline, the template parameters are then fitted to it
 * (PF-T6, `fit.iou`). Fallbacks → `silhouette` mode, built in
 * the browser from the SAM outline (no extra call), with a precise `reason`: `timeout` (past
 * `SHAPE_TIMEOUT_MS`), `provider_error` + `detail` (`http_429`…), `spend_cap`, `malformed`, `no_body`.
 * Mock mode: fixed recipe per category, not checked. Never throws.
 */
export async function runObjectShape(
  perception: Pick<PerceptionClient, 'describeShape' | 'describeParts'> &
    Partial<Pick<PerceptionClient, 'segmentImage' | 'checkViews' | 'proposeShapeOps'>>,
  photo: PhotoForRegions | null,
  fullImageUrl: string,
  target: ShapeTarget,
  {
    signal,
    timeoutMs = SHAPE_TIMEOUT_MS,
    onStep,
    withViews,
    onKit,
    onSideView,
    onElevation,
    onStage,
    onStageSeed,
    onStagesLeft,
    promptVersion,
    kitSamples = env.SHAPE_KIT_SAMPLES,
  }: ObjectShapeOptions = {}
): Promise<ObjectShape> {
  /** Logs each ended stage (first answer and background). */
  const logStage = (e: StageProgress) => {
    if (e.state === 'done')
      console.info(
        `[vision] 3D stage ${e.index}/${e.total} ${e.stage} (${e.phase}) for "${target.label}": ${e.before?.toFixed(2)}→${e.after?.toFixed(2)} (${e.stop}${e.recipe ? ', model updated' : ''})`
      );
  };
  /** First-answer stage events: logged and streamed (PG-T17). */
  const stageProgress = (e: StageProgress) => {
    logStage(e);
    onStage?.(e);
  };
  /**
   * PQ-T23: a model built from a clean front (drawn where the photo shows nothing) has its drawn parts
   * `inferred`: applied once the 2D path is done (the views check and the staged loop stamp `measured`
   * on what they add), and on every background stage update.
   */
  const drawn = (r: ObjectRecipe): ObjectRecipe => (target.cleanFront ? markDrawnInferred(r) : r);
  /**
   * Runs a staged loop (PG-T16…T20): the first answer's stages now, the rest handed to the
   * caller for the background (`onStagesLeft`, logged the same way). Never worse than `seed`.
   */
  const followStages = async (
    start: () => Promise<{ recipe: ObjectRecipe; rest: StagesContinuation | null }> | null,
    seed: ObjectRecipe,
    /** What the loop is built from: lets a later request resume it (Vercel limit). */
    context?: StageLoopContext
  ): Promise<ObjectRecipe> => {
    try {
      const loop = await start();
      if (!loop) return seed;
      if (loop.rest) {
        console.info(
          `[vision] 3D stages left for the background for "${target.label}": ${loop.rest.stages.join(', ')}`
        );
        const rest = loop.rest;
        onStagesLeft?.({
          ...rest,
          ...(context ? { context } : {}),
          run: (o) =>
            rest.run({
              ...o,
              onProgress: (e) => {
                logStage(e);
                o.onProgress(e.recipe ? { ...e, recipe: drawn(e.recipe) } : e);
              },
            }),
        });
      }
      return loop.recipe;
    } catch (err) {
      console.warn(
        '[vision] 3D stages failed, keeping the seed:',
        err instanceof Error ? err.message : err
      );
      return seed;
    }
  };

  /** `ask` is set once the kit shows doubt about the family (PQ-T41) and rides on every recipe answer. */
  const base: { detectionId: string; ask?: ObjectShape['ask'] } = { detectionId: target.id };
  const silhouette = (
    reason: NonNullable<ObjectShape['reason']>,
    source: Pick<ObjectShape, 'source' | 'model' | 'fallback' | 'detail'>
  ): ObjectShape => ({ ...base, mode: 'silhouette', reason, ...source });

  try {
    onStep?.('crop');
    const { w, h } = target.box;
    const aspect = photo && h > 0 ? (w * photo.width) / (h * photo.height) : 0;
    let imageUrl = fullImageUrl;
    // The crop doubles as the outline fallback's pixels (FIX 2) — only when the crop itself
    // succeeded, else the rect would remap the whole photo into nonsense.
    let outlineCrop: OutlineCrop | undefined;
    if (photo) {
      try {
        imageUrl = await cropForShape(photo, target.box);
        outlineCrop = {
          url: imageUrl,
          rect: cropRectForShape(photo.width, photo.height, target.box),
          photoW: photo.width,
          photoH: photo.height,
        };
      } catch (err) {
        console.warn('[vision] shape crop failed, sending the whole photo:', err);
      }
    }
    // PR-2.20: without an outline every box pixel counts (hedge outvotes the car): segment the
    // photo for this object while Spark thinks. Best effort, usually free (SAM's 8 s deadline
    // resolves long before Spark answers); the box is always kept, only the outline is adopted.
    const fetchedOutline: Promise<string | undefined> =
      !target.outline && photo && perception.segmentImage
        ? fetchOutlineForBox(
            perception.segmentImage.bind(perception),
            fullImageUrl,
            conceptOf(target),
            target.box,
            {
              ...(outlineCrop ? { crop: outlineCrop } : {}),
              retries: samRetries(target),
            }
          ).then(
            (hit) => hit ?? undefined,
            () => undefined
          )
        : Promise.resolve(target.outline);
    // PQ-T7: size, sharpness and exposure of the box, measured before the call so Spark is told them.
    const preGrid: GrayGrid | null = photo
      ? await sampleObjectGray(photo, target.box, target.outline, EDGE_COLUMNS).catch(() => null)
      : null;
    // The box at the photo's own resolution, for the sharpness (same box before and after the call).
    const nativeGrid: GrayGrid | null = photo
      ? await sampleNativeGray(photo, target.box).catch(() => null)
      : null;
    const preConditions = photo
      ? measurePhotoConditions({
          widthPx: target.box.w * photo.width,
          heightPx: target.box.h * photo.height,
          grid: preGrid,
          nativeGrid,
          hasOutline: false,
        })
      : null;
    onStep?.('model');
    const started = Date.now();
    const timeout = AbortSignal.timeout(Math.max(0, timeoutMs));
    const askKit = () =>
      perception.describeShape(
        imageUrl,
        {
          label: target.label,
          category: target.category,
          ...(target.scenery ? { scenery: target.scenery } : {}),
          ...(aspect > 0 ? { aspect } : {}),
          ...(preConditions ? { facts: conditionsFacts(preConditions) } : {}),
          ...(target.facadeUrl ? { facadeUrl: target.facadeUrl } : {}),
          ...(target.archetype ? { archetype: target.archetype } : {}),
          ...(promptVersion ? { promptVersion } : {}),
        },
        signal ? AbortSignal.any([signal, timeout]) : timeout
      );
    const shapeCall = askKit();
    // PQ-T18: a second sample in parallel when asked and the budget allows it (≥ 40 s).
    const secondCall: Promise<ShapeResult | null> | null =
      kitSamples >= 2 && timeoutMs >= SECOND_SAMPLE_MIN_MS ? askKit().catch(() => null) : null;
    // 2D facade validated (user 2026-11-02): the house is rebuilt from its elevations — front
    // measured by SAM while Muse Image draws the side, then the side measured — in parallel
    // with Spark. Null for other archetypes, the mock, or a facade SAM cannot read.
    const hint = archetypeOf(target);
    const elevations =
      target.facadeUrl && perception.segmentImage && ELEVATION_ARCHETYPES.includes(hint)
        ? measureFacadeElevations(
            perception.segmentImage.bind(perception),
            target.facadeUrl,
            hint,
            {
              ...(signal ? { signal } : {}),
              ...(onSideView ? { onSideView } : {}),
              ...(env.SHAPE_SIDE_V2 ? { sideCards: true } : {}),
            }
          ).catch(() => null)
        : Promise.resolve(null);
    // PV-H: any other object with a validated 2D view → hull of that view and its drawn side.
    const views =
      target.facadeUrl && perception.segmentImage && VIEW_ARCHETYPES.includes(hint)
        ? measureObjectViews(
            perception.segmentImage.bind(perception),
            target.facadeUrl,
            hint,
            target.label,
            conceptOf(target),
            {
              ...(signal ? { signal } : {}),
              ...(onSideView ? { onSideView } : {}),
              ...(env.SHAPE_SIDE_V2 ? { sideV2: { candidates: 2 } } : {}),
            }
          ).catch(() => null)
        : Promise.resolve(null);
    const fetched = await fetchedOutline;
    const shaped = fetched && !target.outline ? { ...target, outline: fetched } : target;
    if (shaped !== target) {
      console.info(`[vision] 3D outline for "${target.label}" segmented on demand`);
    }
    // Pixels sampled in parallel with Spark (sharp, a few ms); a failure only keeps Spark's colours.
    const pixels: Promise<ObjectPixels | null> = photo
      ? sampleObjectPixels(photo, shaped.box, shaped.outline).catch((err) => {
          console.warn('[vision] colour sample failed:', err instanceof Error ? err.message : err);
          return null;
        })
      : Promise.resolve(null);
    const gray: Promise<GrayGrid | null> = photo
      ? sampleObjectGray(photo, shaped.box, shaped.outline).catch((err) => {
          console.warn('[vision] grey sample failed:', err instanceof Error ? err.message : err);
          return null;
        })
      : Promise.resolve(null);
    // Same box and outline as the pre-call grid (no outline fetched on demand): not sampled twice.
    const edges: Promise<GrayGrid | null> =
      photo && !(shaped === target && preGrid)
        ? sampleObjectGray(photo, shaped.box, shaped.outline, EDGE_COLUMNS).catch(() => null)
        : Promise.resolve(preGrid);
    let found = await shapeCall;
    let splitOther: KitArchetype | undefined;
    if (secondCall && found.kit && found.source === 'meta') {
      // A late second sample is not waited for: the first answer stands alone.
      const left = Math.max(0, timeoutMs / 2 - (Date.now() - started));
      const late = new Promise<null>((r) => setTimeout(() => r(null), left));
      const second = await Promise.race([secondCall, late]);
      const other = second?.kit && second.source === 'meta' ? second.kit : null;
      const vote = await voteKits(found.kit, other, async (kit) => {
        if (!photo || !shaped.outline) return null;
        const r = await scoreRecipe(
          photo,
          { box: shaped.box, outline: shaped.outline },
          kitToRecipe(kit)
        );
        return r ? r.score.score : null;
      });
      if (vote.kit !== found.kit) {
        found = { ...found, kit: vote.kit, recipe: kitToRecipe(vote.kit) };
      }
      splitOther = vote.outcome === 'split' ? vote.other : undefined;
      if (vote.outcome !== 'single') {
        console.info(
          `[vision] 3D kit vote for "${target.label}": ${vote.outcome}${vote.disagreed.length ? ` (${vote.disagreed.join(',')})` : ''}`
        );
      }
    }
    // PQ-T41: the operator's pick wins over the model; a doubtful family becomes a question.
    const chosen = asFamily(target.archetype);
    if (found.kit && chosen && found.kit.archetype !== chosen) {
      const kit = { ...found.kit, archetype: chosen };
      found = { ...found, kit, recipe: kitToRecipe(kit) };
    }
    const pair =
      found.kit && found.source === 'meta'
        ? askFamilies(found.kit, splitOther ?? hint, {
            split: splitOther !== undefined,
            chosen: chosen !== undefined,
          })
        : null;
    if (pair) base.ask = { archetypes: pair };
    const finalGrid = await edges;
    // PQ-T7: the conditions ride on every recipe answer (facade house, views, photo pipeline alike),
    // otherwise the "photo too small / blurred" hint never shows for the objects that take those paths.
    const conditionsFor = (archetype: KitArchetype | undefined, yaw: number | null) =>
      photo && preConditions
        ? measurePhotoConditions({
            widthPx: target.box.w * photo.width,
            heightPx: target.box.h * photo.height,
            grid: finalGrid,
            nativeGrid,
            hasOutline: !!shaped.outline,
            ...(archetype ? { archetype } : {}),
            yaw,
          })
        : undefined;
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (found.kit) onKit?.(found.kit);
    const source = {
      source: found.source,
      model: found.model,
      ...(found.fallback ? { fallback: found.fallback } : {}),
      ...(found.failure ? { detail: found.failure } : {}),
    };
    if (found.fallback === 'provider_error' || found.fallback === 'spend_cap') {
      const reason = found.failure === 'timeout' ? 'timeout' : found.fallback;
      console.info(
        `[vision] 3D recipe for "${target.label}": ${reason}${found.failure ? ` (${found.failure})` : ''} after ${seconds} s, silhouette`
      );
      return silhouette(reason, source);
    }
    // Free recipe (PV-T9c): archetypes without a real kit template (person, animal, bush,
    // water, other) get their part list imagined by the LLM on the same crop, still under
    // the `model` step. Best effort: a failure keeps the kit recipe.
    let freeRecipe: ObjectRecipe | null = null;
    if (found.kit && needsFreeParts(found.kit.archetype)) {
      try {
        const coverage = coverageForBox(target.box, photo);
        const parts = await perception.describeParts(
          imageUrl,
          {
            label: target.label,
            archetype: found.kit.archetype,
            ...(coverage ? { coverage } : {}),
            ...(target.facadeUrl ? { facadeUrl: target.facadeUrl } : {}),
            ...(promptVersion ? { promptVersion } : {}),
          },
          signal ? AbortSignal.any([signal, timeout]) : timeout
        );
        freeRecipe = parts.recipe;
        console.info(
          freeRecipe
            ? `[vision] 3D free parts for "${target.label}": ${freeRecipe.parts.length} parts (${found.kit.archetype}${coverage ? `, ${coverage}` : ''})`
            : `[vision] 3D free parts for "${target.label}" unusable, keeping the kit recipe`
        );
      } catch (err) {
        console.warn(
          '[vision] 3D free parts failed, keeping the kit recipe:',
          err instanceof Error ? err.message : err
        );
      }
    }
    onStep?.('fit');
    if (!found.recipe) return silhouette('malformed', source);
    if (found.source === 'meta') {
      let built = freeRecipe ?? found.recipe;
      let finalKit = found.kit;
      const px = found.kit ? await pixels : null;
      const elev =
        found.kit && ELEVATION_ARCHETYPES.includes(found.kit.archetype) ? await elevations : null;
      // PG-T22: half-timbered walls take their plaster colour, not plaster + beams averaged.
      let shadowShare = 0;
      const plaster = !!elev && !!wallTimber(elev.front, found.kit?.details);
      const measuredColors =
        found.kit && px
          ? measureKitColors(px, found.kit.archetype, {
              plaster,
              litSurface: !plaster,
              onShadowShare: (share) => (shadowShare = share),
            })
          : null;
      const conf = {
        colors: px
          ? ledByMeasurement(
              Math.round(
                confidence.colors(px.y.length, !!shaped.outline) *
                  conditionsTrust(preConditions ?? undefined) *
                  100
              ) / 100,
              modelDoubts(found.kit, 'colors')
            )
          : 0,
        yaw: 0,
        fit: 0,
      };
      // PF-T7: measured colours mixed with Spark's by mask coverage.
      const colors =
        found.kit && measuredColors
          ? mixColors(measuredColors, found.kit.colors, conf.colors)
          : null;
      if (found.kit && colors) {
        console.info(
          `[vision] 3D colours measured for "${target.label}" (${px!.y.length} px${target.outline ? ', outline' : ''}): ${colors.main} ${colors.secondary} ${colors.accent}${shadowShare > 0 ? `, ${Math.round(shadowShare * 100)} % shadow read apart` : ''}`
        );
      }
      if (found.kit && elev) {
        const kit = colors ? { ...found.kit, colors } : found.kit;
        const { front, side } = elev;
        // Yaw read below the eave, like a measured roof: the slopes point nowhere.
        const eaveShare = (front.eave - front.top) / (front.bottom - front.top);
        const persp = photo
          ? measuredYaw(
              {
                archetype: kit.archetype,
                roof: { eave: eaveShare, gables: [{ x0: 0, x1: 1, peak: 0.5, top: 0 }] },
              },
              await edges,
              target.box,
              photo
            )
          : null;
        const yaw0 = persp ? mixNumber(persp.yaw, 0, confidence.perspective(persp.inliers)) : 0;
        const measured = facadeHouseRecipe({
          front,
          side,
          colors: kit.colors,
          ...(kit.materials ? { materials: kit.materials } : {}),
          ...(kit.partMaterials ? { partMaterials: kit.partMaterials } : {}),
          ...(kit.details ? { details: kit.details } : {}),
          sparkDepth: kit.proportions.d / kit.proportions.w,
        });
        let recipe: ObjectRecipe = fitRecipe({ ...measured, source: 'facade' }, 0, yaw0);
        const template: DimStatus = 'estimated';
        recipe = {
          ...recipe,
          dimStatus: {
            eave: 'measured',
            depth: side ? 'inferred' : template,
            yaw: persp ? 'measured' : template,
            scale: template,
          },
        };
        if (photo) {
          try {
            const swatches = await extractSwatches(photo, shaped, recipe);
            if (Object.keys(swatches).length > 0) recipe.swatches = swatches;
          } catch (err) {
            console.warn('[vision] swatches failed:', err instanceof Error ? err.message : err);
          }
        }
        // PG-T16…T18: staged loop (Spark patches, kept only when the elevation stage score
        // rises). Stages that fit the first answer's budget run now; the others continue in the
        // background (`onStagesLeft`). The seed is today's builder, so never worse.
        if (perception.proposeShapeOps) {
          const proposeShapeOps = perception.proposeShapeOps.bind(perception);
          onStageSeed?.(recipe, front);
          recipe = await followStages(
            () =>
              facadeStageLoop({
                recipe,
                front,
                ...(front.roofRings ? { roofRings: front.roofRings } : {}),
                label: target.label,
                proposeShapeOps: async (img, q, sig, opts) => ({
                  result: await proposeShapeOps(img, q, sig, 'elevation', opts),
                }),
                drawing: () =>
                  target.facadeUrl ? imageBytes(target.facadeUrl, signal) : Promise.resolve(null),
                firstBudgetMs: started + timeoutMs - STAGE_SAFETY_MS - Date.now(),
                ...(signal ? { signal } : {}),
                onProgress: stageProgress,
              }),
            recipe,
            {
              label: target.label,
              loop: {
                kind: 'facade',
                front: elevationForCheckpoint(front),
                ...(target.facadeUrl ? { facadeUrl: target.facadeUrl } : {}),
              },
            }
          );
        }
        recipe = drawn(recipe);
        // PG-T2: the model against the drawing it was built from (the staged loop's yardstick).
        const elevScore = scoreElevation(recipe, front, {
          ...(front.roofRings ? { roofRings: front.roofRings } : {}),
        });
        onElevation?.(front, elevScore);
        console.info(`[vision] 3D ${formatElevationScore(elevScore)} for "${target.label}"`);
        const roofPart = recipe.parts.find((p) => p.shape === 'hip' || p.shape === 'prism');
        console.info(
          `[vision] 3D facade house for "${target.label}": ${recipe.parts.length} parts, roof ${roofPart ? `${roofPart.shape}${roofPart.shape === 'hip' ? ` ridge ${roofPart.ridge?.toFixed(2)}${roofPart.clip ? ` half-hip ${roofPart.clip.toFixed(2)}` : ''}` : ''}` : 'flat'}, ${front.windows.length} windows, ${front.doors.length} door(s), ${front.chimneys.length} chimney(s), side ${side ? `${side.windows.length} windows, depth ${depthRatio(front, side)?.toFixed(2)}` : 'none'} vs Spark ${(kit.proportions.d / kit.proportions.w).toFixed(2)}, w:h:d ${[recipe.proportions.w, recipe.proportions.h, recipe.proportions.d].map((v) => v.toFixed(2)).join(':')}, yaw ${Math.round((yaw0 * 180) / Math.PI)}° (${seconds} s Spark)`
        );
        const facadeConditions = conditionsFor(found.kit?.archetype, recipe.yaw ?? null);
        return {
          ...base,
          mode: 'recipe',
          recipe,
          kit: found.kit,
          ...(shaped.outline ? { outline: shaped.outline } : {}),
          ...(facadeConditions ? { conditions: facadeConditions } : {}),
          ...source,
        };
      }
      const measured =
        found.kit && VIEW_ARCHETYPES.includes(found.kit.archetype) ? await views : null;
      const seen =
        measured && found.kit ? keepPlausibleSide(measured, found.kit, target.label) : null;
      if (found.kit && seen) {
        const kit = colors ? { ...found.kit, colors } : found.kit;
        // Round objects (PG-T19): lathe of the drawn silhouette, no side, no views check.
        const round = ROUND_VIEW_ARCHETYPES.includes(kit.archetype);
        let recipe = round ? roundViewRecipe(seen.front, kit) : viewsRecipe(seen, kit);
        // After the build, the AI checks every side against the drawings and the model is fixed.
        if (!round && perception.checkViews && perception.segmentImage) {
          onStep?.('check');
          const checked = await checkViewsModel(
            {
              checkViews: perception.checkViews.bind(perception),
              segmentImage: perception.segmentImage.bind(perception),
            },
            recipe,
            seen,
            kit,
            target.label,
            conceptOf(target),
            { ...(signal ? { signal } : {}), deadline: started + VIEWS_TOTAL_MS }
          );
          recipe = checked.recipe;
          seen.front = checked.views.front;
          // The check can redraw the side: the same depth guard applies.
          const kept = keepPlausibleSide(
            { front: checked.views.front, side: checked.views.side, sidePng: seen.sidePng },
            kit,
            target.label
          );
          seen.side = kept.side;
          seen.sidePng = kept.sidePng;
        }
        // PG-T20: the archetype's stages, scored part by part on the views.
        if (perception.proposeShapeOps) {
          const proposeShapeOps = perception.proposeShapeOps.bind(perception);
          const seed = recipe;
          recipe = await followStages(
            () =>
              viewStageLoop({
                recipe: seed,
                archetype: kit.archetype,
                views: seen,
                label: target.label,
                proposeShapeOps: async (img, q, sig, sheet, opts) => ({
                  result: await proposeShapeOps(img, q, sig, sheet, opts),
                }),
                firstBudgetMs: started + VIEWS_TOTAL_MS - STAGE_SAFETY_MS - Date.now(),
                ...(signal ? { signal } : {}),
                onProgress: stageProgress,
              }),
            seed,
            {
              label: target.label,
              loop: {
                kind: 'views',
                archetype: kit.archetype,
                front: seen.front,
                side: seen.side,
                frontUrl: seen.frontUrl,
                sidePng: seen.sidePng ? seen.sidePng.toString('base64') : null,
              },
            }
          );
        }
        recipe = drawn(recipe);
        const iou = {
          front: viewIou(recipe, seen.front, 'front'),
          side: seen.side ? viewIou(recipe, seen.side, 'side') : null,
        };
        const counts = new Map<string, number>();
        for (const p of [...seen.front.parts, ...(seen.side?.parts ?? [])])
          counts.set(p.concept, (counts.get(p.concept) ?? 0) + 1);
        console.info(
          `[vision] 3D views for "${target.label}": ${recipe.parts[0]!.shape} body, ${recipe.parts.length} parts, side ${seen.side ? `drawn (length/width ${(seen.side.aspect / seen.front.aspect).toFixed(2)})` : `none (Spark depth ${sparkDepthRatio(kit).toFixed(2)})`}, SAM ${[...counts].map(([c, n]) => `${c}×${n}`).join(', ') || 'no parts'}; silhouette IoU front ${iou.front}${iou.side !== null ? `, side ${iou.side}` : ''}, w:h:d ${[recipe.proportions.w, recipe.proportions.h, recipe.proportions.d].map((v) => v.toFixed(2)).join(':')} (${seconds} s Spark)`
        );
        const issue = recipeIssue(recipe);
        if (!issue) {
          const viewsConditions = conditionsFor(found.kit.archetype, recipe.yaw ?? null);
          return {
            ...base,
            mode: 'recipe',
            recipe,
            kit: found.kit,
            ...(shaped.outline ? { outline: shaped.outline } : {}),
            ...(viewsConditions ? { conditions: viewsConditions } : {}),
            ...source,
          };
        }
        console.info(`[vision] 3D views recipe rejected (${issue}), photo pipeline`);
      }
      let roofMeasured = false;
      if (found.kit) {
        const { kit, measure } = withMeasuredRoof(
          colors ? { ...found.kit, colors } : found.kit,
          shaped,
          aspect
        );
        roofMeasured = !!measure;
        if (measure) {
          console.info(
            `[vision] 3D roof measured for "${target.label}": ${measure.roof.gables.length} gables, pitch ${measure.pitch}°, eave ${measure.roof.eave}`
          );
        }
        const rep = withMeasuredRepetition(kit, await gray);
        if (rep.repetition) {
          console.info(
            `[vision] 3D repetition for "${target.label}": units=${rep.kit.details?.units ?? 1} (R=${rep.repetition.strength}), windows=${rep.kit.details?.windows ?? '-'}`
          );
        }
        finalKit = rep.kit;
        // Never over a free recipe: the rebuild expresses the (crude) kit template.
        if ((colors || measure || rep.repetition) && !freeRecipe) built = kitToRecipe(rep.kit);
      }
      // PR-2.5: the archetype's part concepts segmented on the crop (wheels, windows…),
      // best effort — skipped without a photo or a segmenting client.
      let partMasks: import('@/lib/object-shape').PartMask[] | undefined;
      // The masks that sit on the object (PQ-T19 target); set where the graph reads them.
      let objectMasks: import('@/lib/object-shape').PartMask[] = [];
      const segmentImage = perception.segmentImage?.bind(perception);
      // Windows and doors measured on the validated 2D facade (straight on, unoccluded),
      // segmented while the photo masks run: they place the house's panels when present.
      let facadeMasks: FacadeMasks | null = null;
      if (finalKit && photo && segmentImage) {
        [partMasks, facadeMasks] = await Promise.all([
          fetchPartMasks(segmentImage, imageUrl, finalKit.archetype, {
            timeoutMs: partMasksTimeout(started + timeoutMs - Date.now()),
          }),
          target.facadeUrl
            ? fetchFacadeMasks(
                segmentImage,
                target.facadeUrl,
                finalKit.archetype,
                conceptOf(target)
              )
            : Promise.resolve(null),
        ]);
        if (facadeMasks) {
          const counts = new Map<string, number>();
          for (const m of facadeMasks.masks)
            counts.set(m.concept, (counts.get(m.concept) ?? 0) + 1);
          const b = facadeMasks.geom.box;
          console.info(
            `[vision] 3D facade masks for "${target.label}": ${[...counts].map(([c, n]) => `${c}×${n}`).join(', ')} (object box ${[b.x, b.y, b.w, b.h].map((v) => v.toFixed(2)).join(',')})`
          );
        }
        if (partMasks.length > 0) {
          const counts = new Map<string, number>();
          for (const m of partMasks) counts.set(m.concept, (counts.get(m.concept) ?? 0) + 1);
          console.info(
            `[vision] 3D masks for "${target.label}": ${[...counts].map(([c, n]) => `${c}×${n}`).join(', ')}`
          );
        }
      }
      const persp =
        finalKit && photo ? measuredYaw(finalKit, await edges, target.box, photo) : null;
      if (persp) {
        console.info(
          `[vision] 3D perspective for "${target.label}": yaw=${Math.round((persp.yaw * 180) / Math.PI)}° (${persp.inliers}${persp.inliersSide ? ` + ${persp.inliersSide}` : ''} lines, f=${persp.focal}${persp.focalMeasured ? ' measured' : ''})`
        );
      }
      const rings = shaped.outline ? pathToRings(shaped.outline).filter((r) => r.length >= 3) : [];
      conf.yaw = persp ? confidence.perspective(persp.inliers) : 0;
      // Spark gives no yaw: its prior is « facing the camera ».
      const yaw0 = persp ? mixNumber(persp.yaw, 0, conf.yaw) : 0;
      // No outline fit over a free recipe either: the optimizer only knows kit templates,
      // and the mix would swap the imagined parts for the fitted crude ones.
      const fit =
        finalKit && rings.length && !freeRecipe
          ? fitSilhouette({
              kit: finalKit,
              rings,
              box: target.box,
              aspect,
              yaw0,
              canYaw: persp !== null,
            })
          : null;
      const start = fitRecipe(built, aspect, yaw0);
      conf.fit = fit
        ? ledByMeasurement(confidence.fit(fit.iou), modelDoubts(finalKit, 'proportions'))
        : 0;
      let recipe = fit ? mixRecipe(fit.recipe, start, conf.fit) : start;
      if (fit) {
        console.info(
          `[vision] 3D fit for "${target.label}": iou=${fit.iou} (start ${fit.iouStart}, ${fit.evals} evals) units=${finalKit?.details?.units ?? 1} yaw=${Math.round(((recipe.yaw ?? 0) * 180) / Math.PI)}° · confidence colours ${conf.colors}, yaw ${conf.yaw}, fit ${conf.fit}`
        );
      }
      // PR-2.2 + PR-2.4 + PR-2.6 + PR-2.7 + PR-2.10 + PR-2.14: side-seen and round bodies
      // follow the SAM outline, wheels, panels and chimneys follow their masks, constraints keep
      // every reshape coherent; the shipped silhouette is re-scored.
      let fitIou = fit?.iou;
      if (finalKit) {
        let reshaped: 'profile' | 'lathe' | 'wheels' | 'panels' | 'chimney' | 'fit' | null = null;
        let fitGains = '';
        let panelsFrom: 'photo' | 'facade' = 'photo';
        // PR-2.14: coherence after every reshape; a fix also re-scores (silhouette moved).
        let constrainedFix = false;
        const constrain = (r: ObjectRecipe) => {
          const q = applyConstraints(finalKit.archetype, r);
          if (q !== r) constrainedFix = true;
          return q;
        };
        const profiled = withProfileBody(finalKit.archetype, recipe, target, aspect);
        if (profiled !== recipe) {
          recipe = profiled;
          reshaped = 'profile';
        }
        const lathed = withLatheBody(finalKit.archetype, recipe, target);
        if (lathed !== recipe) {
          recipe = lathed;
          reshaped = 'lathe';
        }
        if (((partMasks && partMasks.length > 0) || facadeMasks) && photo) {
          partMasks ??= [];
          const geom = {
            photoW: photo.width,
            photoH: photo.height,
            box: target.box,
            crop: cropRectForShape(photo.width, photo.height, target.box),
          };
          const wheeled = withMaskWheels(finalKit.archetype, recipe, partMasks, geom);
          if (wheeled !== recipe) {
            recipe = wheeled;
            reshaped = 'wheels';
          }
          recipe = constrain(recipe);
          // The facade's windows and doors win over the photo's (no occlusion, no perspective);
          // the photo's masks stay the fallback when the facade gives no usable panel.
          const fromFacade = facadeMasks
            ? withMaskPanels(finalKit.archetype, recipe, facadeMasks.masks, facadeMasks.geom, {
                frontal: true,
              })
            : recipe;
          const panelled =
            fromFacade !== recipe
              ? fromFacade
              : withMaskPanels(finalKit.archetype, recipe, partMasks, geom);
          if (panelled !== recipe) {
            recipe = panelled;
            reshaped = 'panels';
            panelsFrom = fromFacade !== panelled ? 'photo' : 'facade';
          }
          recipe = constrain(recipe);
          const stacked = withMaskChimney(finalKit.archetype, recipe, partMasks, geom);
          if (stacked !== recipe) {
            recipe = stacked;
            reshaped = 'chimney';
          }
          recipe = constrain(recipe);
          // PR-2.8: each part from its own mask's pixels. Best effort, never throws; no
          // re-score — colours don't move the silhouette IoU.
          try {
            const grid = await sampleObjectRgb(photo, target.box, REGION_GRID, REGION_GRID);
            const rings = shaped.outline
              ? pathToRings(shaped.outline).filter((r) => r.length >= 3)
              : [];
            const regions = measureRegionColors(grid, rings, partMasks, geom, photo, target.box);
            const recoloured = withRegionColors(
              finalKit.archetype,
              recipe,
              partMasks,
              regions,
              geom
            );
            if (recoloured !== recipe) recipe = recoloured;
          } catch (err) {
            console.warn('[vision] region colours failed:', err);
          }
        }
        // PR-2.9: per-part parameters (wheels, cabin, eave) by coordinate descent on the
        // model score. Best effort, kept only when the score rises; no groups = no cost.
        if (photo && target.outline && hasPartGroups(finalKit.archetype, recipe)) {
          try {
            const terms = await preparePartFit(photo, shaped);
            if (terms) {
              const fitted = fitPartParams(recipe, finalKit.archetype, terms);
              if (fitted.recipe !== recipe) {
                recipe = fitted.recipe;
                reshaped = 'fit';
                fitGains = fitted.groups.map((g) => `${g.name} +${g.gain.toFixed(1)}`).join(', ');
              }
            }
          } catch (err) {
            console.warn('[vision] part fit failed:', err);
          }
        }
        recipe = constrain(recipe);
        if (reshaped || constrainedFix) {
          if (reshaped) {
            const main = recipe.parts[frontPartIndex(recipe)]!;
            const panelCounts = (panelsFrom === 'facade' ? facadeMasks!.masks : (partMasks ?? []))
              .filter((m) => m.concept === 'window' || m.concept === 'door')
              .reduce(
                (acc, m) => ({ ...acc, [m.concept]: (acc[m.concept] ?? 0) + 1 }),
                {} as Record<string, number>
              );
            console.info(
              reshaped === 'profile'
                ? `[vision] 3D profile for "${target.label}": outline body, ${main.points?.length ?? 0} pts`
                : reshaped === 'lathe'
                  ? `[vision] 3D lathe for "${target.label}": outline body, ${main.profile?.length ?? 0} rows`
                  : reshaped === 'wheels'
                    ? `[vision] 3D wheels for "${target.label}": ${partMasks?.filter((m) => m.concept === 'wheel').length ?? 0} mask(s), ${recipe.parts.length} parts`
                    : reshaped === 'chimney'
                      ? `[vision] 3D chimney for "${target.label}": ${partMasks?.filter((m) => m.concept === 'chimney').length ?? 0} mask(s), ${recipe.parts.length} parts`
                      : reshaped === 'fit'
                        ? `[vision] 3D part fit for "${target.label}": ${fitGains}`
                        : `[vision] 3D panels for "${target.label}": ${
                            Object.entries(panelCounts)
                              .map(([c, n]) => `${c}×${n}`)
                              .join(', ') || 'none'
                          }, ${recipe.parts.length} parts (from the ${panelsFrom})`
            );
          } else {
            console.info(`[vision] 3D constraints for "${target.label}": coherence fixes applied`);
          }
          if (photo) {
            try {
              const re = await scoreRecipe(
                photo,
                { box: shaped.box, outline: shaped.outline },
                recipe,
                partMasks
              );
              if (re) fitIou = re.score.iou;
            } catch (err) {
              console.warn('[vision] profile rescore failed:', err);
            }
          }
        }
      }
      const issue = recipeIssue(recipe);
      if (issue) {
        console.info(`[vision] 3D recipe for "${target.label}" rejected (${issue}), silhouette`);
        return silhouette(issue, source);
      }
      // PR-2.16: hidden-side deduction from the fitted recipe (rule-based, pre-S4): back
      // facade, gable-end windows, sedan rear door. Needs a photo (nothing measured means
      // nothing to deduce from); newcomers carry no budget protection, so the visible model
      // never loses a part to a hidden one. The graph pass below stamps them inferred.
      if (finalKit && photo) {
        const deduced = deduceHiddenSides(finalKit.archetype, recipe, {
          yaw: recipe.yaw ?? 0,
          colors: finalKit.colors,
          room: MAX_RECIPE_PARTS - recipe.parts.length,
          farRoom: partCeiling(recipe) - recipe.parts.length,
        });
        if (deduced.length > 0) {
          const before = recipe.parts.length;
          const kept = enforcePartBudget([...recipe.parts, ...deduced], recipe.parts, {
            max: partCeiling(recipe),
          });
          recipe = applyConstraints(finalKit.archetype, { ...recipe, parts: kept.parts });
          console.info(
            `[vision] 3D hidden sides for "${target.label}": +${recipe.parts.length - before} part(s)`
          );
        }
      }
      // PR-2.15: dimension statuses from the final measurements, never the LLM. Template and
      // fit values read estimated, a single view never measures depth, the box-fit scale is
      // estimated (metric scale arrives with free placement).
      let coverage: PartCoverage[] | undefined;
      const conditions = conditionsFor(finalKit?.archetype, recipe.yaw ?? null);
      if (conditions) {
        console.info(
          `[vision] 3D photo conditions for "${target.label}": ${conditionsFacts(conditions).join(', ')}`
        );
      }
      if (finalKit) {
        // PQ-T37: hard geometry gates fixed by rule (floating parts pulled in, fused twins merged).
        const repair = repairGraph(finalKit.archetype, recipe);
        if (repair.recipe !== recipe) {
          console.info(
            `[vision] 3D graph repair for "${target.label}": pulled ${repair.pulled.length} floating part(s), merged ${repair.merged.length} duplicate(s)`
          );
          recipe = repair.recipe;
        }
        // Only the masks on the object: a neighbour's windows are not this model's parts.
        const onObject =
          partMasks?.length && photo
            ? masksOnObject(
                partMasks,
                shaped.outline ? pathToRings(shaped.outline).filter((r) => r.length >= 3) : [],
                {
                  photoW: photo.width,
                  photoH: photo.height,
                  box: shaped.box,
                  crop: cropRectForShape(photo.width, photo.height, shaped.box),
                }
              )
            : (partMasks ?? []);
        // PQ-T37: the parts the kit listed under evidence.visibleParts join the SAM masks.
        const listed = finalKit.evidence?.visibleParts ?? [];
        objectMasks = onObject;
        const missing = notBuilt(recipe, onObject, listed);
        if (onObject.length || listed.length) coverage = partCoverage(recipe, onObject, listed);
        if (missing.length)
          console.info(`[vision] 3D seen, not built for "${target.label}": ${missing.join(', ')}`);
        const graph = buildGraph(finalKit.archetype, recipe, {
          outline: !!shaped.outline,
          photo: !!photo,
          ...(partMasks?.length ? { masks: partMasks } : {}),
          ...(photo
            ? {
                geom: {
                  photoW: photo.width,
                  photoH: photo.height,
                  box: shaped.box,
                  crop: cropRectForShape(photo.width, photo.height, shaped.box),
                },
              }
            : {}),
        });
        const template: DimStatus = photo ? 'estimated' : 'unknown';
        recipe = {
          ...recipe,
          parts: recipe.parts.map((p, i) => ({ ...p, status: graph.nodes[i]!.status })),
          dimStatus: {
            ...(finalKit.archetype === 'house'
              ? { eave: roofMeasured ? ('measured' as const) : template }
              : {}),
            depth: template,
            yaw: conf.yaw > 0 ? ('measured' as const) : template,
            scale: template,
          },
        };
      }
      // A fitting step can squeeze a part under the schema minimum (house-front capture, PQ-T1).
      const safe = clampParts(recipe);
      if (safe.clamped.length) {
        console.info(
          `[vision] 3D clamp for "${target.label}": part(s) ${safe.clamped.map((i) => `${i} (${recipe.parts[i]!.kind ?? recipe.parts[i]!.shape})`).join(', ')} out of range`
        );
        recipe = safe.recipe;
      }
      // PQ-T19: the staged loop on the photo — stages scored on the outline and the part masks,
      // parts the photo cannot see locked. First stages now, the rest in the background; the seed
      // wins when no stage kept a change (the kinds the loop tags are not worth a different model).
      if (finalKit && photo && shaped.outline && perception.proposeShapeOps) {
        const proposeShapeOps = perception.proposeShapeOps.bind(perception);
        const archetype = finalKit.archetype;
        const rings = pathToRings(shaped.outline).filter((r) => r.length >= 3);
        const { cols, rows } = fitGrid(aspect);
        const crop =
          rings.length && aspect > 0
            ? await sampleObjectRgb(photo, shaped.box, cols, rows).catch(() => null)
            : null;
        const photoT =
          crop &&
          photoTarget({
            aspect,
            crop,
            outline: ringsMask(rings, shaped.box, cols, rows),
            masks: objectMasks,
            geom: {
              photoW: photo.width,
              photoH: photo.height,
              box: shaped.box,
              crop: cropRectForShape(photo.width, photo.height, shaped.box),
            },
          });
        if (photoT) {
          const seed = recipe;
          const tagged = tagPhotoParts(seed, archetype);
          const looped = await followStages(
            () =>
              photoStageLoop({
                recipe: seed,
                archetype,
                target: photoT,
                label: target.label,
                proposeShapeOps: async (img, q, sig, sheet, opts) => ({
                  result: await proposeShapeOps(img, q, sig, sheet, opts),
                }),
                firstBudgetMs: started + timeoutMs - STAGE_SAFETY_MS - Date.now(),
                ...(signal ? { signal } : {}),
                onProgress: stageProgress,
              }),
            seed
          );
          if (JSON.stringify(looped.parts) !== JSON.stringify(tagged.parts)) recipe = looped;
        }
      }
      if (photo) {
        try {
          const swatches = await extractSwatches(photo, shaped, recipe);
          if (Object.keys(swatches).length > 0) {
            recipe.swatches = swatches;
          }
        } catch (err) {
          console.warn('[vision] swatches failed:', err instanceof Error ? err.message : err);
        }
      }
      console.info(
        `[vision] 3D recipe for "${target.label}": ${recipe.parts.length} parts in ${seconds} s (${found.model})${found.kit?.materials ? `, materials ${Object.values(found.kit.materials).join('/')}` : ''}${recipe.swatches ? `, swatches ${Object.keys(recipe.swatches).join('/')}` : ''}`
      );
      let imaginedViews: import('@/lib/object-shape').ImaginedAngleView[] | undefined;
      if (withViews) {
        try {
          imaginedViews = await generateImaginedViews(recipe, target, aspect);
        } catch (err) {
          console.warn('[vision] 6-angle views generation failed:', err);
        }
      }
      return {
        ...base,
        mode: 'recipe',
        recipe,
        ...(imaginedViews ? { imaginedViews } : {}),
        ...(fitIou !== undefined ? { fit: { iou: fitIou } } : {}),
        ...(partMasks ? { partMasks } : {}),
        ...(found.kit ? { kit: found.kit } : {}),
        ...(shaped.outline ? { outline: shaped.outline } : {}),
        ...(coverage ? { coverage } : {}),
        ...(conditions ? { conditions } : {}),
        ...source,
      };
    }
    let fallbackViews: import('@/lib/object-shape').ImaginedAngleView[] | undefined;
    if (withViews) {
      try {
        fallbackViews = await generateImaginedViews(found.recipe, target, aspect);
      } catch {
        // Best effort for mock
      }
    }
    return {
      ...base,
      mode: 'recipe',
      recipe: found.recipe,
      ...(fallbackViews ? { imaginedViews: fallbackViews } : {}),
      ...source,
    };
  } catch (err) {
    console.warn('[vision] shape failed:', err instanceof Error ? err.message : err);
    return silhouette('provider_error', { source: 'mock', model: 'none' });
  }
}
