import 'server-only';

import sharp from 'sharp';
import { flatWaterRecipe, kitToRecipe, type KitArchetype, type ObjectKit } from '@/lib/object-kit';
import {
  SHAPE_TIMEOUT_MS,
  formatDuration,
  type ObjectRecipe,
  type ObjectShape,
  type PartMask,
  type ShapeTarget,
} from '@/lib/object-shape';
import type { PerceptionClient } from './client';
import { renderFlat, THREE_QUARTER, type FlatRender } from './flat-render';
import { anatomyMissing, type DetailScore } from './detail-score';
import { listedConcept } from './object-graph';
import { PART_CONCEPTS, fetchPartMasks, partMasksTimeout } from './part-masks';
import { askPartQuestions } from './part-question';
import { STOP_DETAIL } from './shape-report';
import { cropForShape } from './shape-crop';
import type { Mask } from './silhouette-fit';
import type { ModelScore, RgbGrid } from './model-score';
import { runObjectShape, type ObjectShapeOptions } from './object-shape';
import type { PhotoForRegions } from './region';
import { detailParts, scoreRecipe } from './score-shape';
import {
  CRITIC_PROMPT_CARDS_VERSION,
  CRITIC_PROMPT_VERSION,
  criticQuestion,
  mergeKitPatch,
} from './shape';

/**
 * Spark visual critic, shared half (PR-0.6): the side-by-side image (photo crop | flat render)
 * and one patch request. Meta models do not render 3D; we render, Spark judges. The live round
 * lives in `runObjectShape` (1 round, score < 70; ≥ 20 s left only with an explicit budget), the
 * offline rounds in `criticReplay` (captures, ≤ 3); both keep the patch only when the score rises.
 */

/** Critic image width (px); the skill asks for a 256-wide flat render. */
export const CRITIC_WIDTH = 256;
/** Live round gates: score below this, this much time left. */
export const CRITIC_SCORE_MAX = 70;
export const CRITIC_TIME_MIN_MS = 20_000;

/** Critic sheet tile width (px) of version 2 (PQ-T14): 512 so a part the size of a window frame shows. */
export const CRITIC_TILE = 512;
/** Rounds one object may get: the live one, then up to 2 more kept only on gain (PQ-T14). */
export const CRITIC_ROUNDS = 3;

/**
 * Does the critic run? The score under 70, or (version 2) a detail gate missed: part recall or precision
 * under its `STOP_DETAIL` value, or a blank band. Without a detail score only the score decides.
 */
export function criticFires(score: number, detail?: DetailScore): boolean {
  if (score < CRITIC_SCORE_MAX) return true;
  if (!detail) return false;
  return (
    (detail.partRecall !== undefined && detail.partRecall < STOP_DETAIL.partRecall) ||
    (detail.partPrecision !== undefined && detail.partPrecision < STOP_DETAIL.partPrecision) ||
    (detail.blankBands ?? 0) > 0
  );
}

/** Render background → white, so dark parts stay visible to the judge. */
function onWhite(r: FlatRender): Buffer {
  const out = Buffer.from(r.rgb);
  for (let i = 0; i < r.mask.data.length; i++) {
    if (!r.mask.data[i]) {
      out[i * 3] = 255;
      out[i * 3 + 1] = 255;
      out[i * 3 + 2] = 255;
    }
  }
  return out;
}

/**
 * Crop (left) | flat render at the photo view (right), one PNG data URL. The render is rebuilt
 * at critic width (the fit grid is coarser); the crop is scaled to the same height.
 */
export async function criticImage(
  crop: RgbGrid,
  recipe: ObjectRecipe,
  aspect: number
): Promise<string> {
  const rows = Math.min(512, Math.max(32, Math.round(CRITIC_WIDTH / Math.max(0.1, aspect))));
  const render = renderFlat(recipe, aspect, CRITIC_WIDTH, rows);
  const left = sharp(Buffer.from(crop.rgb as Uint8Array), {
    raw: { width: crop.cols, height: crop.rows, channels: 3 },
  }).resize({ height: rows });
  const right = sharp(onWhite(render), {
    raw: { width: CRITIC_WIDTH, height: rows, channels: 3 },
  }).png();
  const [l, r] = await Promise.all([left.png().toBuffer(), right.toBuffer()]);
  const lm = await sharp(l).metadata();
  const width = (lm.width ?? CRITIC_WIDTH) + CRITIC_WIDTH;
  const png = await sharp({
    create: { width, height: rows, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: l, left: 0, top: 0 },
      { input: r, left: lm.width ?? CRITIC_WIDTH, top: 0 },
    ])
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Difference tile: grey where photo and model agree, red where the photo has the object and the model
 * does not, blue where the model draws what the photo does not (the Critic card's legend).
 */
export function differenceTile(model: FlatRender, outline: Mask): Buffer {
  const n = model.mask.cols * model.mask.rows;
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const photo = outline.data[i] ? 1 : 0;
    const built = model.mask.data[i] ? 1 : 0;
    const c = photo && !built ? [220, 40, 40] : built && !photo ? [40, 80, 220] : [160, 160, 160];
    out.set(c, i * 3);
  }
  return out;
}

/**
 * The 2 × 2 sheet of the Critic card (PQ-T14): photo | model, same view / difference | model ¾, tiles
 * `CRITIC_TILE` wide. One PNG data URL.
 */
export async function criticSheet(
  crop: RgbGrid,
  recipe: ObjectRecipe,
  aspect: number,
  outline: Mask
): Promise<string> {
  const w = CRITIC_TILE;
  const h = Math.min(CRITIC_TILE * 2, Math.max(64, Math.round(w / Math.max(0.1, aspect))));
  // Same grid for the model and the difference, so the tiles line up with the outline mask.
  const same = renderFlat(recipe, aspect, outline.cols, outline.rows);
  const raw = (buf: Uint8Array | Uint8ClampedArray, cols: number, rows: number) =>
    sharp(Buffer.from(buf), { raw: { width: cols, height: rows, channels: 3 } })
      .resize({ width: w, height: h, fit: 'fill' })
      .png()
      .toBuffer();
  const corner = renderFlat(recipe, aspect, w >> 1, h >> 1, THREE_QUARTER);
  const [photo, model, diff, three] = await Promise.all([
    raw(crop.rgb as Uint8Array, crop.cols, crop.rows),
    raw(onWhite(same), same.mask.cols, same.mask.rows),
    raw(differenceTile(same, outline), same.mask.cols, same.mask.rows),
    raw(onWhite(corner), corner.mask.cols, corner.mask.rows),
  ]);
  const png = await sharp({
    create: { width: w * 2, height: h * 2, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: photo, left: 0, top: 0 },
      { input: model, left: w, top: 0 },
      { input: diff, left: 0, top: h },
      { input: three, left: w, top: h },
    ])
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * Live shape with one critic round (PR-0.6): run, score against the used outline, and when the
 * score is below 70 with ≥ 20 s left, patch → re-fit → keep only when the score rises. The
 * scoring sits outside `runObjectShape`, so the 300 ms shape-math budget is untouched. Mock and
 * outline-less runs never round (no kit, or nothing to score against). With an explicit budget the
 * round needs ≥ 20 s left; unbounded runs always round. Never throws.
 */
export async function shapeWithCritic(
  ...args: Parameters<typeof shapeWithCriticRound>
): Promise<ObjectShape> {
  const shape = await shapeWithCriticRound(...args);
  return shape.mode === 'recipe' && shape.recipe && shape.kit?.archetype === 'water'
    ? { ...shape, recipe: flatWaterRecipe(shape.recipe) }
    : shape;
}

async function shapeWithCriticRound(
  perception: CriticPerception,
  photo: PhotoForRegions | null,
  fullImageUrl: string,
  target: ShapeTarget,
  opts: ObjectShapeOptions = {}
): Promise<ObjectShape> {
  const started = Date.now();
  let shape = await runObjectShape(perception, photo, fullImageUrl, target, opts);
  // Version 1: one round. Version 2 (PQ-T14): up to `CRITIC_ROUNDS`, each kept only on gain.
  // Version 3 (PQ-T52) rides the version-1 round: the anatomy fix needs no extra rounds.
  const rounds =
    (opts.criticPromptVersion ?? CRITIC_PROMPT_VERSION) === CRITIC_PROMPT_CARDS_VERSION
      ? CRITIC_ROUNDS
      : 1;
  for (let r = 0; r < rounds; r++) {
    const roundStart = Date.now();
    let ran = false;
    const next = await criticRound(
      perception,
      photo,
      fullImageUrl,
      target,
      opts,
      shape,
      started,
      () => {
        ran = true;
      }
    );
    // A skipped round costs nothing and reports nothing; a run one reports even when dropped.
    if (ran) {
      const ms = Date.now() - roundStart;
      console.info(
        `[vision] 3D critic for "${target.label}": round ${r + 1} ${formatDuration(ms)}`
      );
      opts.onTiming?.('critic', ms);
    }
    if (next === shape) break;
    shape = next;
  }
  return shape;
}

type CriticPerception = Pick<
  PerceptionClient,
  'describeShape' | 'describeParts' | 'criticizeShape'
> &
  Partial<Pick<PerceptionClient, 'segmentImage' | 'checkViews' | 'askPart'>>;

/** One critic round over `shape`: the same object back when nothing was kept. */
async function criticRound(
  perception: CriticPerception,
  photo: PhotoForRegions | null,
  fullImageUrl: string,
  target: ShapeTarget,
  opts: ObjectShapeOptions,
  shape: ObjectShape,
  started: number,
  /** Called once the round passes its skip guards (PQ-T42: only run rounds are timed). */
  onRan?: () => void
): Promise<ObjectShape> {
  const timeoutMs = opts.timeoutMs ?? SHAPE_TIMEOUT_MS;
  const version = opts.criticPromptVersion ?? CRITIC_PROMPT_VERSION;
  try {
    if (
      !photo ||
      shape.mode !== 'recipe' ||
      !shape.recipe ||
      !shape.kit ||
      !shape.outline ||
      // Free recipes have no template to patch: rebuilding from a patched kit would swap the
      // imagined parts for the crude placeholder ones.
      shape.recipe.source === 'free' ||
      // Route-B recipes rebuild from code, not from the kit: a kit patch would replay the
      // draft the code already beat (PQ-T45).
      shape.recipe.source === 'code' ||
      // Facade / views recipes are measured on the drawn views, not on the photo: nothing to patch.
      shape.recipe.source === 'facade' ||
      shape.recipe.source === 'views' ||
      (timeoutMs ?? Infinity) - (Date.now() - started) < CRITIC_TIME_MIN_MS
    ) {
      return shape;
    }
    onRan?.();
    const scored = await scoreRecipe(
      photo,
      { box: target.box, outline: shape.outline },
      shape.recipe,
      shape.partMasks
    );
    if (!scored) return shape;
    if (
      version === CRITIC_PROMPT_CARDS_VERSION
        ? !criticFires(scored.score.score, scored.score.detail)
        : scored.score.score >= CRITIC_SCORE_MAX
    )
      return shape;
    const w = target.box.w * photo.width;
    const h = target.box.h * photo.height;
    if (!(w > 0 && h > 0)) return shape;
    const answer = await requestPatch(
      perception,
      version === CRITIC_PROMPT_CARDS_VERSION
        ? await criticSheet(scored.crop, shape.recipe, w / h, scored.outline)
        : await criticImage(scored.crop, shape.recipe, w / h),
      shape.kit,
      scored.score,
      opts.signal,
      version
    );
    if (!answer) return shape;
    const { patch, missingParts } = answer;
    // No re-check of the budget here: the patch is paid for, and the retry below carries no
    // LLM call (stubbed kit, same photo) — only the 5 s SAM batch plus local math — so it runs
    // even when the patch arrived past the budget (live: 146 ms over). The expired budget used
    // to crash the retry (AbortSignal.timeout of a negative "delay", "shape failed") and the
    // fix died with it; the clamp in runObjectShape keeps the signal construction safe instead.
    const remainingMs =
      timeoutMs === null || !Number.isFinite(timeoutMs) ? null : timeoutMs - (Date.now() - started);
    // PQ-T52: the named anatomy ids, verified against the build, asked one by one in parallel,
    // chased when a builder places them. Runs even without a patch: denied ids still correct
    // the inventory, and confirmed ones may rebuild the model on their own.
    const fix: AnatomyFix = missingParts.length
      ? await fixMissingAnatomy(perception, photo, target, shape.kit, shape.recipe, missingParts, {
          ...(opts.signal ? { signal: opts.signal } : {}),
          timeoutMs: remainingMs,
        })
      : { extraMasks: [], denied: [] };
    if (!patch && !fix.extraMasks.length) return withDeniedFlips(shape, fix.denied);
    const patched = patch ? mergeKitPatch(shape.kit, patch) : shape.kit;
    const retry = await runObjectShape(
      {
        describeShape: async () => ({
          recipe: kitToRecipe(patched),
          kit: patched,
          source: shape.source,
          model: shape.model,
        }),
        // The retry is kit-driven by design: no second imagination round off the patched kit.
        describeParts: async () => ({ recipe: null, source: shape.source, model: shape.model }),
        // No spread: the client is a class, its methods live on the prototype.
        ...(perception.segmentImage
          ? { segmentImage: perception.segmentImage.bind(perception) }
          : {}),
      },
      photo,
      fullImageUrl,
      target,
      { ...opts, timeoutMs: remainingMs, extraPartMasks: fix.extraMasks }
    );
    if (retry.mode !== 'recipe' || !retry.recipe || !retry.outline)
      return withDeniedFlips(shape, fix.denied);
    const rescored = await scoreRecipe(
      photo,
      { box: target.box, outline: retry.outline },
      retry.recipe,
      retry.partMasks
    );
    if (rescored && rescored.score.score > scored.score.score) {
      const what = [
        ...(patch ? Object.keys(patch) : []),
        ...(fix.extraMasks.length ? [`${fix.extraMasks.length} chased masks`] : []),
      ].join(', ');
      console.info(
        `[vision] 3D critic kept: score ${scored.score.score} → ${rescored.score.score} (${what})`
      );
      return withDeniedFlips(retry, fix.denied);
    }
    console.info(
      `[vision] 3D critic dropped: score ${scored.score.score} → ${rescored?.score.score ?? 'n/a'}`
    );
    return withDeniedFlips(shape, fix.denied);
  } catch (err) {
    console.warn('[vision] 3D critic round failed:', err instanceof Error ? err.message : err);
    return shape;
  }
}

/**
 * SAM concepts a mask builder places, per archetype (PQ-T52): the gates of `withMaskWheels`
 * (vehicle wheels), `withMaskPanels` (vehicle windows, house windows and doors — vehicles skip
 * doors, PR-2.7) and `withMaskChimney` (house chimneys). A confirmed missing part is chased only
 * for these pairs; anything else stays « seen, not built » until a builder places it. Effective
 * coverage today: none — every placed concept is already measured (`PART_CONCEPTS`) — so the
 * chase below activates when builders outrun the measured concepts (vehicle doors need a
 * placement-side decision first; a zone-crop chase needs a PQ-T8-style eval).
 */
export const PLACED_CONCEPTS: Partial<Record<KitArchetype, ReadonlyArray<string>>> = {
  vehicle: ['wheel', 'window'],
  house: ['window', 'door', 'chimney'],
};

/** Closed id → SAM concept when `listedConcept` misses (a door line is found by chasing its door). */
const ANATOMY_CHASE: Readonly<Record<string, string>> = {
  'door lines': 'door',
};

/** The SAM concept to chase for a closed anatomy id. Pure. */
export function chaseConcept(id: string): string {
  return ANATOMY_CHASE[id] ?? listedConcept(id);
}

/**
 * Named ids the recipe really lacks (PQ-T52, E11): the critic's word against the built parts —
 * a named part the model does build is the critic erring, and is dropped. Pure.
 */
export function verifyMissingAnatomy(named: ReadonlyArray<string>, recipe: ObjectRecipe): string[] {
  if (!named.length) return [];
  return anatomyMissing(named, detailParts(recipe));
}

export interface AnatomyFix {
  /** SAM masks of confirmed parts a builder places: the retry's `extraPartMasks`. */
  extraMasks: PartMask[];
  /** Ids the short question denied: the kit inventory flips them to `absent`. */
  denied: string[];
}

/**
 * One fix round per verified-missing id (PQ-T52, E9/E11): a short question on the zone crop for
 * each (in parallel); denied ids correct the inventory, confirmed ones are SAM-chased when a
 * builder places their concept and the pipeline did not measure it already. Never throws.
 */
export async function fixMissingAnatomy(
  perception: Partial<Pick<PerceptionClient, 'askPart' | 'segmentImage'>>,
  photo: PhotoForRegions,
  target: ShapeTarget,
  kit: ObjectKit,
  recipe: ObjectRecipe,
  missing: ReadonlyArray<string>,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number | null } = {}
): Promise<AnatomyFix> {
  const empty: AnatomyFix = { extraMasks: [], denied: [] };
  const verified = verifyMissingAnatomy(missing, recipe);
  if (!verified.length) return empty;
  const built = missing.filter((id) => !verified.includes(id));
  console.info(
    `[vision] 3D critic missing for "${target.label}": ${verified.join(', ')}` +
      (built.length ? ` (already built: ${built.join(', ')})` : '')
  );
  const ask = perception.askPart?.bind(perception);
  if (!ask) return empty;
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const whereOf = (id: string) => kit.anatomy?.find((a) => norm(a.part) === id)?.where;
  let cropUrl: string;
  try {
    cropUrl = await cropForShape(photo, target.box);
  } catch {
    return empty;
  }
  const asked = await askPartQuestions(
    async (imageUrl, question, s) => (await ask(imageUrl, question, s)).answer,
    cropUrl,
    verified.map((part) => {
      const where = whereOf(part);
      return where ? { part, where } : { part };
    }),
    { ...(signal ? { signal } : {}) }
  );
  const denied: string[] = [];
  const confirmed: string[] = [];
  for (const { part, answer } of asked) {
    if (!answer) continue;
    (answer.present ? confirmed : denied).push(part);
  }
  if (denied.length)
    console.info(`[vision] 3D critic denied for "${target.label}": ${denied.join(', ')} → absent`);
  // Chase only what a builder places and the pipeline did not measure already.
  const placed = PLACED_CONCEPTS[kit.archetype] ?? [];
  const measured = new Set(PART_CONCEPTS[kit.archetype] ?? []);
  const segment = perception.segmentImage?.bind(perception);
  const toChase: string[] = [];
  for (const part of confirmed) {
    const concept = chaseConcept(part);
    if (!placed.includes(concept)) {
      console.info(
        `[vision] 3D critic confirmed for "${target.label}": ${part}, no placer — stays not built`
      );
      continue;
    }
    if (measured.has(concept)) {
      console.info(`[vision] 3D critic confirmed for "${target.label}": ${part}, already measured`);
      continue;
    }
    toChase.push(concept);
  }
  const extraMasks =
    toChase.length && segment
      ? await chaseMasks(segment, cropUrl, kit.archetype, toChase, target.label, timeoutMs ?? null)
      : [];
  return { extraMasks, denied };
}

/**
 * SAM-chase of confirmed concepts on the crop (PQ-T52): one batch per concept, misses and
 * failures logged per concept. Never throws. No live caller reaches it today (every placed
 * concept is already measured) — it activates with the builders, and is tested directly.
 */
export async function chaseMasks(
  segment: PerceptionClient['segmentImage'],
  cropUrl: string,
  archetype: KitArchetype,
  concepts: ReadonlyArray<string>,
  label: string,
  timeoutMs: number | null = null
): Promise<PartMask[]> {
  const out: PartMask[] = [];
  for (const concept of concepts) {
    const masks = await fetchPartMasks(segment, cropUrl, archetype, {
      concepts: [concept],
      timeoutMs: partMasksTimeout(timeoutMs),
    }).catch((): PartMask[] => []);
    if (masks.length) {
      console.info(`[vision] 3D critic chase for "${label}": ${concept} ×${masks.length}`);
      out.push(...masks);
    } else {
      console.info(
        `[vision] 3D critic chase for "${label}": ${concept}, no mask — stays not built`
      );
    }
  }
  return out;
}

/**
 * The inventory corrected by denied short answers (PQ-T52): ids the zone crop does not show flip
 * from `present` to `absent`. A soft signal rescued by a second look (the kit's first look said
 * present); geometry never changes here. Pure.
 */
export function withDeniedFlips(shape: ObjectShape, denied: ReadonlyArray<string>): ObjectShape {
  if (!denied.length || shape.mode !== 'recipe' || !shape.kit?.anatomy) return shape;
  const ids = new Set(denied);
  let flipped = 0;
  const anatomy = shape.kit.anatomy.map((a) => {
    const id = a.part.trim().toLowerCase().replace(/\s+/g, ' ');
    if (a.state === 'present' && ids.has(id)) {
      flipped++;
      return { ...a, state: 'absent' as const };
    }
    return a;
  });
  if (!flipped) return shape;
  return { ...shape, kit: { ...shape.kit, anatomy } };
}

/** What one critic answer carries: the kit patch, and (version 3) the named missing parts. */
export interface CriticAnswer {
  patch: Partial<ObjectKit> | null;
  missingParts: string[];
}

/**
 * One patch request: the side-by-side image + kit + scores → the kit fields to change plus the
 * named missing anatomy ids, or null (mock, match, or an unusable reply). Never throws: a failed
 * round keeps the recipe.
 */
export async function requestPatch(
  client: Pick<PerceptionClient, 'criticizeShape'>,
  imageUrl: string,
  kit: ObjectKit,
  score: ModelScore,
  signal?: AbortSignal,
  version: number = CRITIC_PROMPT_VERSION
): Promise<CriticAnswer | null> {
  try {
    const out = await client.criticizeShape(
      imageUrl,
      criticQuestion(
        kit,
        {
          score: score.score,
          iou: score.iou,
          edgeF1: score.edgeF1,
          deltaE: score.deltaE,
        },
        version
      ),
      signal,
      { promptVersion: version, archetype: kit.archetype }
    );
    const missingParts = out.missingParts ?? [];
    if (!out.patch && !missingParts.length) return null;
    return { patch: out.patch, missingParts };
  } catch (err) {
    console.warn('[vision] 3D critic failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
