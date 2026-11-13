import type { ObjectRecipe } from '@/lib/object-shape';
import { renderFlat, type FlatView } from '../flat-render';
import { mirror } from './grid';
import type { Palette } from './palette';
import { VIEW_NAMES, type AlignedViews, type ViewName } from './views';

/**
 * The judge of the views reconstruction (PQ-T69): the finished recipe is drawn by the same flat
 * renderer as every other score, from the four cameras, and compared with the drawings cell by
 * cell. It checks what the 3D view will show, not the solver's own voxels. Pure.
 */

/** Camera of each view (yaw around y): the right camera shows the object's front on its left. */
export const VIEW_CAMERA: Record<ViewName, FlatView> = {
  front: { yaw: 0, pitch: 0 },
  right: { yaw: -Math.PI / 2, pitch: 0 },
  back: { yaw: Math.PI, pitch: 0 },
  left: { yaw: Math.PI / 2, pitch: 0 },
};
/** Views whose camera image is the mirror of the canonical grid (columns on the object axis). */
const MIRRORED: ReadonlyArray<ViewName> = ['right', 'back'];

export interface ViewScore {
  /** Silhouette: drawn object vs model, intersection over union. */
  iou: number;
  /** Share of the drawn object's cells where the model shows the drawn colour class. */
  match: number;
}

export interface ReconScore {
  views: Partial<Record<ViewName, ViewScore>>;
  /** Mean over the views of (iou + match) / 2, 0–1. */
  overall: number;
}

/** `classOf[i]` = colour class of recipe part i. */
export function scoreRecipeOnViews(
  recipe: ObjectRecipe,
  classOf: ReadonlyArray<number>,
  aligned: AlignedViews,
  palette: Palette
): ReconScore {
  const { w, h, d } = recipe.proportions;
  const views: ReconScore['views'] = {};
  let sum = 0;
  let count = 0;
  for (const view of VIEW_NAMES) {
    const target = palette.labels[view];
    const grid = aligned.views[view];
    if (!target || !grid) continue;
    const across = view === 'front' || view === 'back' ? w : d;
    // Framed on the object box itself, so a proud detail never rescales the picture.
    const render = renderFlat(
      { ...recipe, yaw: 0 },
      1,
      grid.cols,
      grid.rows,
      VIEW_CAMERA[view],
      () => ({
        cx: 0,
        cy: 0,
        fw: across,
        fh: h,
      })
    );
    const part = MIRRORED.includes(view) ? mirror(render.part, grid.cols, grid.rows) : render.part;
    let [inter, union, object, same] = [0, 0, 0, 0];
    for (let i = 0; i < target.length; i++) {
      const drawn = target[i]! >= 0;
      const built = part[i]! >= 0;
      if (drawn && built) inter++;
      if (drawn || built) union++;
      if (drawn) {
        object++;
        if (built && classOf[part[i]!] === target[i]) same++;
      }
    }
    const score = { iou: union ? inter / union : 0, match: object ? same / object : 0 };
    views[view] = score;
    sum += (score.iou + score.match) / 2;
    count++;
  }
  return { views, overall: count ? sum / count : 0 };
}
