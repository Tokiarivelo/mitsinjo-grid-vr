import sharp from 'sharp';
import type { ObjectRecipe, ShapeTarget } from '@/lib/object-shape';
import { reconstructObject } from '../recon';
import { carArtSvg, type CarArt, type CarArtView } from './car-art';
import { scoreOnPhoto, type ObjectPhoto } from './generate';

/**
 * A tour object built from its imagined drawings (VS-T44): every face drawn without any model
 * (`car-art.ts`), then the same chain as a real capture, offline: the drawings are read, the plan
 * measured, its pieces built and assembled, wearing the drawings (`reconstructObject`, no Meta
 * call). The model is turned to match the photo (best outline IoU), the drawings kept for the 2D
 * faces. Built by `make tour-imagine`, stored in `tour-imagined.json`.
 */

export interface TourImagined {
  recipe: ObjectRecipe;
  /** The imagined drawings (JPEG data URLs): every face, the ¾ view when drawn. */
  views: Partial<Record<ImaginedFace, string>>;
  /** Outline IoU of the turned model on its photo. */
  iou: number;
  /**
   * Its turn on the photo (rad): kept beside the recipe, which has none (a model built from views
   * faces its own front, like the skins of VS-T43).
   */
  yaw: number;
}

export type ImaginedFace = CarArtView | 'left' | 'three_quarter';

export const IMAGINED_PX = 768;
const IMAGINED_JPEG = 86;
/** Yaw search around each guess (rad): the guess ± `YAW_SPAN` in `YAW_STEP`s. */
const YAW_SPAN = 0.4;
const YAW_STEP = 0.05;

const ART_VIEWS: CarArtView[] = ['right', 'front', 'back', 'top'];

const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;

/** Every face of a car drawn as a PNG. */
export async function carArtPngs(art: CarArt, paper?: string): Promise<Record<CarArtView, Buffer>> {
  const out = {} as Record<CarArtView, Buffer>;
  for (const v of ART_VIEWS)
    out[v] = await sharp(Buffer.from(carArtSvg(art, v, paper)))
      .png()
      .toBuffer();
  return out;
}

/** The yaw (rad) whose model best covers the photo's outline, near each of `guesses`. */
export async function fitYaw(
  recipe: ObjectRecipe,
  shot: ObjectPhoto,
  pitch: number,
  guesses: ReadonlyArray<number>
): Promise<{ yaw: number; iou: number }> {
  let best = { yaw: guesses[0] ?? 0, iou: -1 };
  for (const g of guesses)
    for (let d = -YAW_SPAN; d <= YAW_SPAN + 1e-9; d += YAW_STEP) {
      const yaw = Math.atan2(Math.sin(g + d), Math.cos(g + d));
      const { score } = await scoreOnPhoto({ ...recipe, yaw }, shot, pitch);
      if (score.iou > best.iou) best = { yaw, iou: score.iou };
    }
  return best;
}

/**
 * A car imagined from its drawings: the model built offline from them, turned to its photo
 * (`yaws` = guesses, e.g. the hand-built model's yaw ± a quarter turn), and the drawings.
 */
export async function imagineCar(
  id: string,
  art: CarArt,
  shot: ObjectPhoto,
  pitch: number,
  yaws: ReadonlyArray<number>
): Promise<TourImagined | null> {
  const png = await carArtPngs(art);
  const target: ShapeTarget = {
    id,
    label: 'car',
    category: 'other',
    box: { x: 0, y: 0, w: 1, h: 1 },
    facadeUrl: dataUrl(png.right),
    faceUrls: { front: dataUrl(png.front), back: dataUrl(png.back) },
  };
  const built = await reconstructObject({ draw: null }, target, { topPng: png.top });
  if (!built?.recipe.car) return null;
  const { yaw, iou } = await fitYaw(built.recipe, shot, pitch, yaws);
  const jpeg = async (b: Buffer) =>
    `data:image/jpeg;base64,${(
      await sharp(b)
        .resize(IMAGINED_PX, IMAGINED_PX, { fit: 'inside' })
        .jpeg({ quality: IMAGINED_JPEG })
        .toBuffer()
    ).toString('base64')}`;
  // Shown to the operator on white paper, like every drawn face.
  const shown = await carArtPngs(art, '#ffffff');
  const left = await sharp(shown.right).flop().png().toBuffer();
  return {
    recipe: built.recipe,
    views: {
      right: await jpeg(shown.right),
      left: await jpeg(left),
      front: await jpeg(shown.front),
      back: await jpeg(shown.back),
      top: await jpeg(shown.top),
    },
    iou,
    yaw,
  };
}
