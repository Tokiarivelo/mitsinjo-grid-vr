import type { ObjectRecipe } from '@/lib/object-shape';
import {
  renderFlat,
  type FlatPaint,
  type FlatRender,
  type ViewBounds,
  type ViewFrame,
} from '../flat-render';
import type { ModelScore } from '../model-score';

/** One tour object's shipped mock answer (VS-T41), written by `make tour-mock` into `tour-mock.json`. */
export interface TourMockEntry {
  recipe: ObjectRecipe;
  /** View pitch of the photo (rad, − = seen from below): what the part masks are drawn at. */
  pitch: number;
  /** SAM concept per recipe part (`model3dPart` keys), null where the part has none. */
  concepts: Array<string | null>;
  score: Pick<ModelScore, 'iou' | 'edgeF1' | 'deltaE' | 'score'>;
}

/** The model's bounds fill the grid: the photo box is the object's bounds (like `fitRecipe`). */
const fill = (b: ViewBounds): ViewFrame => ({
  cx: (b.x0 + b.x1) / 2,
  cy: (b.y0 + b.y1) / 2,
  fw: Math.max(1e-6, b.x1 - b.x0),
  fh: Math.max(1e-6, b.y1 - b.y0),
});

/** The recipe at the photo's view: seen from the eye, below a ceiling light, above a rock (`paint`: wearing its faces). */
export function renderAtPhoto(
  recipe: ObjectRecipe,
  cols: number,
  rows: number,
  pitch: number,
  paint?: FlatPaint
): FlatRender {
  return renderFlat(recipe, cols / rows, cols, rows, { yaw: 0, pitch }, fill, paint);
}
