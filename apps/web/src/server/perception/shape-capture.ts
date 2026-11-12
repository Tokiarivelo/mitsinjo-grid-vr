import 'server-only';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { kitToRecipe, ObjectKitSchema, type ObjectKit } from '@/lib/object-kit';
import {
  ObjectRecipeSchema,
  PartMaskSchema,
  ShapeTargetSchema,
  type ObjectRecipe,
  type PartMask,
} from '@/lib/object-shape';
import type { PerceptionClient } from './client';
import { CODE_MAX_BYTES } from './code-sandbox';
import { presentAnatomy } from './fusion';
import { pathToRings } from './mask-outline';
import { runObjectShape } from './object-shape';
import { boxUnionCoverage } from './parse-sam';
import type { PhotoForRegions } from './region';
import type { NormBox } from './schemas';
import { scoreRecipe, type RecipeScore } from './score-shape';
import { mergeKitPatch } from './shape';
import type { CropRect } from './shape-crop';
import { criticImage, requestPatch } from './spark-critic';
import { photoSize } from './vision-request';

/**
 * The winning route-B construction code (PQ-T45, §8bis): replayed offline through the sandbox
 * with the same seed, no Meta call. Absent when no round beat the draft (or route B skipped).
 */
export const ShapeCodeSchema = z.object({
  /** The `build()` body. */
  text: z.string().min(1).max(CODE_MAX_BYTES),
  /** Seed the code ran with (`codeSeedFor` of the target id). */
  seed: z.number().int(),
  /** Writer prompt version that produced `text` (PQ-T5). */
  promptVersion: z.number().int().min(1),
});
export type ShapeCode = z.infer<typeof ShapeCodeSchema>;

/** One live 3D run, frozen for offline replay (PR-0.4): no API cost per loop iteration. */
export const ShapeCaptureSchema = z.object({
  version: z.literal(1),
  /** Fixture id (`make shape-capture … ID=car1`), also the file name. */
  id: z.string().min(1).max(64),
  capturedAt: z.string(),
  source: z.literal('meta'),
  model: z.string(),
  /** Prepared photo the target box and outline are fractions of. */
  photo: z.object({ width: z.number().int().min(1), height: z.number().int().min(1) }),
  target: ShapeTargetSchema,
  /** Spark's kit answer (what the loop patches and replays). */
  kit: ObjectKitSchema,
  /** Kit prompt version that produced `kit` (PQ-T5); absent on captures older than versions. */
  promptVersion: z.number().int().min(1).optional(),
  recipe: ObjectRecipeSchema.optional(),
  fit: z.object({ iou: z.number().min(0).max(1) }).optional(),
  /** Spark latency, seconds. */
  seconds: z.number(),
  /** Square crop sent to Spark (photo pixels) and its sent size. */
  crop: z.object({
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    outWidth: z.number().int().min(1),
    outHeight: z.number().int().min(1),
  }),
  /** Target remapped into crop fractions (what `scoreRecipe` replays on the crop JPEG). */
  cropTarget: z.object({ box: ShapeTargetSchema.shape.box, outline: z.string().optional() }),
  /** Per-concept part masks (PR-2.5 fills this; absent until then). */
  partMasks: z.array(z.unknown()).optional(),
  /** Winning route-B construction code (PQ-T45); absent when the draft won. */
  code: ShapeCodeSchema.optional(),
});
export type ShapeCapture = z.infer<typeof ShapeCaptureSchema>;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Photo-fraction box → crop-fraction box (resolution independent). */
export function remapBoxToCrop(
  box: NormBox,
  photoW: number,
  photoH: number,
  rect: CropRect
): NormBox {
  return {
    x: clamp01((box.x * photoW - rect.left) / rect.width),
    y: clamp01((box.y * photoH - rect.top) / rect.height),
    w: clamp01((box.w * photoW) / rect.width),
    h: clamp01((box.h * photoH) / rect.height),
  };
}

/** Photo-fraction outline path → crop-fraction path (same rings, re-encoded). */
export function remapOutlineToCrop(
  outline: string,
  photoW: number,
  photoH: number,
  rect: CropRect
): string {
  const f = (n: number) => (Math.round(n * 10000) / 10000).toString();
  return pathToRings(outline)
    .filter((r) => r.length >= 3)
    .map(
      (r) =>
        'M' +
        r
          .map(
            ([x, y]) =>
              `${f((x * photoW - rect.left) / rect.width)} ${f((y * photoH - rect.top) / rect.height)}`
          )
          .join('L') +
        'Z'
    )
    .join('');
}

/**
 * The detection a capture is about (PQ-T1): `pick` as a detection id, else the biggest box whose label
 * contains `pick`, else (when `pick` has several words, like the id `car-side`) its first word. Null
 * when nothing matches; the caller lists the candidates.
 */
export function pickDetection<
  D extends { id: string; label: string; box: { w: number; h: number } },
>(detections: ReadonlyArray<D>, pick: string): D | null {
  const byId = detections.find((d) => d.id === pick);
  if (byId) return byId;
  const biggest = (word: string) =>
    detections
      .filter((d) => d.label.toLowerCase().includes(word.toLowerCase()))
      .reduce<D | null>((a, d) => (!a || d.box.w * d.box.h > a.box.w * a.box.h ? d : a), null);
  const first = pick.split(/[-_\s]+/)[0] ?? '';
  return biggest(pick) ?? (first && first !== pick ? biggest(first) : null);
}

/** The valid SAM part masks of a capture (stored loosely; malformed ones dropped). */
export function captureMasks(capture: Pick<ShapeCapture, 'partMasks'>): PartMask[] {
  return (capture.partMasks ?? []).flatMap((m) => {
    const parsed = PartMaskSchema.safeParse(m);
    return parsed.success ? [parsed.data] : [];
  });
}

/** `<dir>/<id>.capture.json` + `<dir>/<id>.crop.jpg` (the exact bytes Spark saw). */
export function writeCapture(
  dir: string,
  capture: ShapeCapture,
  cropJpeg: Buffer
): [json: string, jpg: string] {
  mkdirSync(dir, { recursive: true });
  const json = join(dir, `${capture.id}.capture.json`);
  const jpg = join(dir, `${capture.id}.crop.jpg`);
  writeFileSync(json, JSON.stringify(ShapeCaptureSchema.parse(capture), null, 2));
  writeFileSync(jpg, cropJpeg);
  return [json, jpg];
}

/** Read a capture back: validated JSON + the crop as photo pixels. */
export async function readCapture(
  dir: string,
  id: string
): Promise<{ capture: ShapeCapture; cropPhoto: PhotoForRegions }> {
  const capture = ShapeCaptureSchema.parse(
    JSON.parse(readFileSync(join(dir, `${id}.capture.json`), 'utf8'))
  );
  const cropPhoto = await photoSize(readFileSync(join(dir, `${id}.crop.jpg`)));
  if (!cropPhoto) throw new Error(`capture ${id}: crop JPEG not readable`);
  return { capture, cropPhoto };
}

/**
 * Offline replay proof (no API): re-score the captured recipe on the captured crop with the
 * remapped target. Null without a recipe or an outline, like the live score.
 */
export async function rescoreCapture(dir: string, id: string): Promise<RecipeScore | null> {
  const { capture, cropPhoto } = await readCapture(dir, id);
  const recipe: ObjectRecipe | undefined = capture.recipe;
  if (!recipe) return null;
  // Captured mask boxes are fractions of the saved crop, i.e. of the whole replayed image (PQ-T1).
  const masks = captureMasks(capture);
  const anatomy = presentAnatomy(capture.kit);
  const answered = anatomy.length ? anatomy : undefined;
  if (!masks.length)
    return scoreRecipe(cropPhoto, capture.cropTarget, recipe, undefined, undefined, answered);
  const { width, height } = cropPhoto;
  return scoreRecipe(
    cropPhoto,
    capture.cropTarget,
    recipe,
    masks,
    {
      left: 0,
      top: 0,
      width,
      height,
      outWidth: width,
      outHeight: height,
    },
    answered
  );
}

export interface CriticReplayRound {
  patch: Partial<ObjectKit>;
  before: number;
  after: number;
  kept: boolean;
}

/**
 * Offline critic rounds on a capture (PR-0.6): up to `rounds` patch → re-fit → re-score cycles,
 * each kept only when the 3-term replay score rises. The re-fit replays the captured part masks
 * (maskless when the capture has none); only the patch request may call Meta. Returns the best
 * recipe + the round log — read the log to learn which prompt lines help, then fold them into
 * `SHAPE_SYSTEM_PROMPT` by hand.
 */
export async function criticReplay(
  perception: Pick<PerceptionClient, 'criticizeShape'>,
  dir: string,
  id: string,
  rounds = 3,
  signal?: AbortSignal
): Promise<{
  recipe: ObjectRecipe;
  kit: ObjectKit;
  score: number;
  roundsRun: CriticReplayRound[];
}> {
  const { capture, cropPhoto } = await readCapture(dir, id);
  if (!capture.recipe) throw new Error(`capture ${id}: no recipe to replay`);
  if (capture.recipe.source === 'free')
    throw new Error(`capture ${id}: free recipe, no kit template to patch`);
  // Route-B recipes rebuild from stored code, not from the kit: patching the kit would replay
  // the draft the code already beat. Replay `code` through the sandbox instead (offline).
  if (capture.recipe.source === 'code')
    throw new Error(`capture ${id}: code recipe, replay its code, no kit template to patch`);
  const target = ShapeTargetSchema.parse({
    id: capture.target.id,
    label: capture.target.label,
    category: capture.target.category,
    ...(capture.target.scenery ? { scenery: capture.target.scenery } : {}),
    box: capture.cropTarget.box,
    ...(capture.cropTarget.outline ? { outline: capture.cropTarget.outline } : {}),
  });
  const start = await scoreRecipe(cropPhoto, capture.cropTarget, capture.recipe);
  if (!start) throw new Error(`capture ${id}: no outline to score against`);
  const aspect = (target.box.w * cropPhoto.width) / (target.box.h * cropPhoto.height);
  const cropUrl = `data:image/jpeg;base64,${cropPhoto.buffer.toString('base64')}`;
  const masks = (capture.partMasks ?? []) as PartMask[];
  const segmentImage = async (_url: string, concept: string) => {
    const { outWidth, outHeight } = capture.crop;
    const instances = masks
      .filter((m) => m.concept === concept)
      .map((m) => ({
        box: {
          x1: m.box.x * outWidth,
          y1: m.box.y * outHeight,
          x2: (m.box.x + m.box.w) * outWidth - 1,
          y2: (m.box.y + m.box.h) * outHeight - 1,
        },
        confidence: 0.9,
        ...(m.outline ? { outline: m.outline } : {}),
      }));
    return {
      source: 'meta' as const,
      model: capture.model,
      concept,
      imageWidth: outWidth,
      imageHeight: outHeight,
      instances,
      count: instances.length,
      boxCoverage: boxUnionCoverage(
        instances.map((i) => i.box),
        outWidth,
        outHeight
      ),
    };
  };
  let kit = capture.kit;
  let recipe = capture.recipe;
  let scored = start;
  const roundsRun: CriticReplayRound[] = [];
  for (let r = 0; r < Math.max(0, rounds); r++) {
    const image = await criticImage(scored.crop, recipe, aspect);
    const patch = await requestPatch(perception, image, kit, scored.score, signal);
    if (!patch) break;
    const patched = mergeKitPatch(kit, patch);
    const retry = await runObjectShape(
      {
        describeShape: async () => ({
          recipe: kitToRecipe(patched),
          kit: patched,
          source: 'meta' as const,
          model: capture.model,
        }),
        // Kit-driven replay: no imagination round off the patched kit.
        describeParts: async () => ({
          recipe: null,
          source: 'meta' as const,
          model: capture.model,
        }),
        segmentImage,
      },
      cropPhoto,
      cropUrl,
      target,
      { signal }
    );
    if (retry.mode !== 'recipe' || !retry.recipe) break;
    const rescored = await scoreRecipe(cropPhoto, capture.cropTarget, retry.recipe);
    const after = rescored?.score.score ?? -1;
    const kept = after > scored.score.score;
    roundsRun.push({ patch, before: scored.score.score, after, kept });
    if (kept && rescored) {
      kit = patched;
      recipe = retry.recipe;
      scored = rescored;
    }
  }
  return { recipe, kit, score: scored.score.score, roundsRun };
}
