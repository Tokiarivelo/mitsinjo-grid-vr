import 'server-only';

import {
  frontPartIndex,
  type ObjectRecipe,
  type PartKind,
  type PartMask,
  type ShapeTarget,
} from '@/lib/object-shape';
import { pathToRings } from '@/lib/vision';
import { renderFlat, type FlatRender } from './flat-render';
import { scoreDetail, type DetailPart, type GridPart } from './detail-score';
import { cropToPhoto, isWheelPart, photoToObject, type MaskMapGeom } from './mask-geometry';
import {
  scoreModel,
  weightDetail,
  type Landmark,
  type ModelScore,
  type RgbGrid,
} from './model-score';
import type { PhotoForRegions } from './region';
import { sampleObjectRgb } from './shape-colors';
import { cropRectForShape, type CropRect } from './shape-crop';
import { fitGrid, ringsMask } from './silhouette-fit';

export interface RecipeScore {
  score: ModelScore;
  /** What was compared: photo box and flat render on the fit grid (contact sheet, Spark critic). */
  crop: RgbGrid;
  render: FlatRender;
}

/** Part-mask concepts judged as landmarks (PR-0.8): wheels, windows, doors. */
const LANDMARK_CONCEPTS: ReadonlySet<string> = new Set(['wheel', 'window', 'door']);

/**
 * Masks → judged parts (PR-0.8): each wheel/window/door mask becomes the nearest part of its kind
 * (wheels, else thin boxes) with the mask centre in grid pixels. Skips other concepts, masks without
 * a part of their kind, and malformed boxes. Pure.
 */
export function buildLandmarks(
  recipe: ObjectRecipe,
  masks: ReadonlyArray<PartMask>,
  geom: MaskMapGeom,
  cols: number,
  rows: number
): Landmark[] {
  const main = recipe.parts[frontPartIndex(recipe)]!;
  const out: Landmark[] = [];
  for (const mask of masks) {
    if (!LANDMARK_CONCEPTS.has(mask.concept)) continue;
    const { box } = mask;
    const nums = [box.x, box.y, box.w, box.h];
    if (!nums.every((v) => Number.isFinite(v)) || !(box.w > 0) || !(box.h > 0)) continue;
    const [px, py] = cropToPhoto(geom, box.x + box.w / 2, box.y + box.h / 2);
    const m = photoToObject(geom, px, py);
    if (!m) continue;
    const kind =
      mask.concept === 'wheel'
        ? (p: (typeof recipe.parts)[number]) => isWheelPart(p, main.at[1])
        : (p: (typeof recipe.parts)[number]) => isPanelPart(p, main);
    let best = -1;
    let bestD = Infinity;
    recipe.parts.forEach((p, i) => {
      if (!kind(p)) return;
      const d = Math.hypot(p.at[0] - m.x, p.at[1] - m.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) continue;
    out.push({ part: best, x: (m.x + 0.5) * cols, y: (0.5 - m.y) * rows });
  }
  return out;
}

/** Thin flat box that is not the main body: a kit window or door (the PR-0.8 landmark guess). */
const isPanelPart = (p: ObjectRecipe['parts'][number], main: ObjectRecipe['parts'][number]) =>
  p !== main && p.shape === 'box' && p.size[2] <= 0.05;

/** What each part may be for the detail score: its `kind`, else the landmark guesses (wheel, panel). */
export function detailParts(recipe: ObjectRecipe): DetailPart[] {
  const main = recipe.parts[frontPartIndex(recipe)]!;
  return recipe.parts.map((p) => {
    const kinds: PartKind[] = p.kind
      ? [p.kind]
      : isWheelPart(p, main.at[1])
        ? ['wheel']
        : isPanelPart(p, main)
          ? ['window', 'door']
          : [];
    return { kinds, ...(p.status ? { status: p.status } : {}) };
  });
}

/** Part masks (crop fractions) → boxes on the fit grid; malformed boxes dropped. Pure. */
export function gridParts(
  masks: ReadonlyArray<PartMask>,
  geom: MaskMapGeom,
  cols: number,
  rows: number
): GridPart[] {
  return masks.flatMap((mask) => {
    const { box } = mask;
    if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || !(box.w > 0) || !(box.h > 0))
      return [];
    const a = photoToObject(geom, ...cropToPhoto(geom, box.x, box.y));
    const b = photoToObject(geom, ...cropToPhoto(geom, box.x + box.w, box.y + box.h));
    if (!a || !b) return [];
    return [
      {
        concept: mask.concept,
        x0: (a.x + 0.5) * cols,
        y0: (0.5 - a.y) * rows,
        x1: (b.x + 0.5) * cols,
        y1: (0.5 - b.y) * rows,
      },
    ];
  });
}

/**
 * Score of a recipe against the selected box (PR-0.2): flat render, photo box and SAM mask on the fit grid.
 * With part masks the landmark term joins (PR-0.8). Null without an outline (no mask to compare with).
 */
export async function scoreRecipe(
  photo: PhotoForRegions,
  target: Pick<ShapeTarget, 'box' | 'outline'>,
  recipe: ObjectRecipe,
  masks?: ReadonlyArray<PartMask>,
  /** Rect the mask fractions refer to; default = the shape crop of `photo` (live). Replays pass the whole crop. */
  maskCrop?: CropRect
): Promise<RecipeScore | null> {
  const rings = target.outline ? pathToRings(target.outline).filter((r) => r.length >= 3) : [];
  const { box } = target;
  const aspect = (box.w * photo.width) / (box.h * photo.height);
  if (!rings.length || !(aspect > 0)) return null;
  const { cols, rows } = fitGrid(aspect);
  const crop = await sampleObjectRgb(photo, box, cols, rows);
  const render = renderFlat(recipe, aspect, cols, rows);
  const geom: MaskMapGeom | null =
    photo.width > 0 && photo.height > 0
      ? {
          photoW: photo.width,
          photoH: photo.height,
          box,
          crop: maskCrop ?? cropRectForShape(photo.width, photo.height, box),
        }
      : null;
  const landmarks =
    masks?.length && geom ? buildLandmarks(recipe, masks, geom, cols, rows) : undefined;
  const outline = ringsMask(rings, box, cols, rows);
  const detail = scoreDetail({
    render,
    crop,
    outline,
    parts: detailParts(recipe),
    samParts: masks?.length && geom ? gridParts(masks, geom, cols, rows) : [],
  });
  return {
    score: weightDetail({ ...scoreModel(render, crop, outline, landmarks), detail }),
    crop,
    render,
  };
}
