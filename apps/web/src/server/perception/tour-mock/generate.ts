import 'server-only';

import sharp from 'sharp';
import { ObjectRecipeSchema, type ObjectRecipe } from '@/lib/object-shape';
import type { FlatRender } from '../flat-render';
import { scoreModel, type ModelScore, type RgbGrid } from '../model-score';
import { decodeView } from '../recon/route';
import { readViews } from '../recon/reconstruct';
import type { PhotoForRegions } from '../region';
import { sampleObjectRgb } from '../shape-colors';
import { fitGrid, ringsMask, type Mask } from '../silhouette-fit';
import { reconstructTree } from '../tree/tree-recon';
import { renderAtPhoto, type TourMockEntry } from './render';
import { compileSpec, type TourSpec } from './spec';

export { renderAtPhoto, type TourMockEntry };

/**
 * Offline builder of the tour mock (VS-T41, `make tour-mock`): each hand-built spec is put on its
 * own photo the way a scan photographs it (the equirect strip is a straight crop of the panorama,
 * so the panorama turned to face the object is that photo), drawn at the photo's view (the camera
 * looks up at a ceiling light: the model is seen from below), coloured part by part with the
 * photo's colours inside the hand outline, and scored like every model (`scoreModel`).
 */

export type PanoRing = ReadonlyArray<readonly [number, number]>;

/** The object on its photo: the panorama turned so the object faces the camera. */
export interface ObjectPhoto {
  photo: PhotoForRegions;
  box: { x: number; y: number; w: number; h: number };
  /** Outline rings in photo fractions. */
  rings: Array<Array<readonly [number, number]>>;
  /** Elevation of the object centre seen from the eye (rad, + = above). */
  elevation: number;
}

const nearU = (u: number, ref: number) => u + Math.round(ref - u);

/** The panorama turned to put the outline's centre straight ahead (u = 0.5), with box and rings. */
export async function objectPhoto(
  pano: { data: Buffer; width: number; height: number },
  outline: ReadonlyArray<PanoRing>
): Promise<ObjectPhoto> {
  const ref = outline[0]![0]![0];
  const us = outline.flatMap((r) => r.map(([u]) => nearU(u, ref)));
  const vs = outline.flatMap((r) => r.map(([, v]) => v));
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const uc = (u0 + u1) / 2;
  const { width: W, height: H, data } = pano;
  // Roll the rows so column uc lands at W / 2.
  const shift = Math.round((0.5 - (uc - Math.floor(uc))) * W);
  const rolled = Buffer.alloc(data.length);
  for (let y = 0; y < H; y++) {
    const row = y * W * 3;
    for (let x = 0; x < W; x++) {
      const nx = (((x + shift) % W) + W) % W;
      data.copy(rolled, row + nx * 3, row + x * 3, row + x * 3 + 3);
    }
  }
  const buffer = await sharp(rolled, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
  const toX = (u: number) => nearU(u, ref) - uc + 0.5;
  return {
    photo: { buffer, width: W, height: H },
    box: { x: toX(u0), y: v0, w: u1 - u0, h: v1 - v0 },
    rings: outline.map((r) => r.map(([u, v]) => [toX(u), v] as const)),
    elevation: (0.5 - (v0 + v1) / 2) * Math.PI,
  };
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

/** Fewest visible pixels for a part's colour to be measured (else its hand colour stays). */
export const MIN_PART_PIXELS = 6;
/** RGB distance from the part's photo median past which a pixel counts as an occluder. */
export const OCCLUDER_RGB = 90;
/** Share of pixels near the median needed to drop the others. */
export const NEAR_SHARE = 0.5;

/**
 * Each part's colour from the photo pixels it covers inside the outline: the part's base colour
 * scaled by photo / render medians per channel, so the shaded render matches the photo. Parts
 * hidden or too small keep their colour; `fixed` parts too.
 */
export function measurePartColors(
  recipe: ObjectRecipe,
  render: FlatRender,
  crop: RgbGrid,
  outline: Mask,
  fixed: readonly boolean[]
): ObjectRecipe {
  const n = recipe.parts.length;
  const photo: number[][][] = Array.from({ length: n }, () => [[], [], []]);
  const drawn: number[][][] = Array.from({ length: n }, () => [[], [], []]);
  for (let i = 0; i < render.part.length; i++) {
    const k = render.part[i]!;
    if (k < 0 || !outline.data[i]) continue;
    for (let c = 0; c < 3; c++) {
      photo[k]![c]!.push(crop.rgb[i * 3 + c]!);
      drawn[k]![c]!.push(render.rgb[i * 3 + c]!);
    }
  }
  return {
    ...recipe,
    parts: recipe.parts.map((p, k) => {
      if (fixed[k] || photo[k]![0]!.length < MIN_PART_PIXELS) return p;
      const base = [1, 3, 5].map((o) => parseInt(p.color.slice(o, o + 2), 16));
      // Occluders (a hedge before a wall, a tree before a house) are not the part: keep the
      // pixels near the part's own photo median when they are most of it, else trust every pixel.
      const [pr, pg, pb] = photo[k]!;
      const mid = [median(pr!), median(pg!), median(pb!)];
      const near = pr!.flatMap((r, i) =>
        Math.hypot(r - mid[0]!, pg![i]! - mid[1]!, pb![i]! - mid[2]!) <= OCCLUDER_RGB ? [i] : []
      );
      const keep = near.length >= pr!.length * NEAR_SHARE ? near : pr!.map((_, i) => i);
      const pick = (v: number[]) => keep.map((i) => v[i]!);
      const rgb = base.map((b, c) => {
        const d = median(pick(drawn[k]![c]!));
        const ph = median(pick(photo[k]![c]!));
        return d > 4 ? (b * ph) / d : ph;
      });
      return { ...p, color: hex(rgb[0]!, rgb[1]!, rgb[2]!) };
    }),
  };
}

/** Score of a recipe on its photo at the photo's view. */
export async function scoreOnPhoto(
  recipe: ObjectRecipe,
  shot: ObjectPhoto,
  pitch: number
): Promise<{ score: ModelScore; render: FlatRender; crop: RgbGrid; outline: Mask }> {
  const aspect = (shot.box.w * shot.photo.width) / (shot.box.h * shot.photo.height);
  const { cols, rows } = fitGrid(aspect);
  const crop = await sampleObjectRgb(shot.photo, shot.box, cols, rows);
  const outline = ringsMask(shot.rings, shot.box, cols, rows);
  const render = renderAtPhoto(recipe, cols, rows, pitch);
  return { score: scoreModel(render, crop, outline), render, crop, outline };
}

/** Side of the outlined front view handed to the tree reconstructor (pixels). */
const PLANT_VIEW_PX = 320;

/**
 * The outlined photo as a front view: the box on white paper, everything outside the outline
 * painted paper (what a cut-out drawing looks like to `readViews`). Measured, never projected.
 */
export async function outlinedFront(shot: ObjectPhoto): Promise<Buffer> {
  const { photo, box } = shot;
  const left = Math.max(0, Math.floor(box.x * photo.width));
  const top = Math.max(0, Math.floor(box.y * photo.height));
  const width = Math.max(1, Math.min(photo.width - left, Math.ceil(box.w * photo.width)));
  const height = Math.max(1, Math.min(photo.height - top, Math.ceil(box.h * photo.height)));
  const scale = PLANT_VIEW_PX / Math.max(width, height);
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const { data } = await sharp(photo.buffer)
    .extract({ left, top, width, height })
    .resize(w, h, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = ringsMask(shot.rings, box, w, h);
  for (let i = 0; i < w * h; i++) if (!mask.data[i]) data.fill(255, i * 3, i * 3 + 3);
  // A paper margin all round: the reader finds the object on its paper.
  const m = Math.round(Math.max(w, h) * 0.08);
  return sharp(data, { raw: { width: w, height: h, channels: 3 } })
    .extend({ top: m, bottom: m, left: m, right: m, background: '#ffffff' })
    .png()
    .toBuffer();
}

/** One tour object → its mock entry (colours measured, scored), or null when it cannot be built. */
export async function buildEntry(
  spec: TourSpec,
  shot: ObjectPhoto,
  label: string
): Promise<TourMockEntry | null> {
  const pitch = -shot.elevation;
  let recipe: ObjectRecipe;
  let concepts: Array<string | null>;
  let fixed: boolean[];
  if (spec.kind === 'plant') {
    const front = await decodeView(await outlinedFront(shot));
    const reading = front ? readViews({ front, right: front }) : null;
    const tree = reading
      ? reconstructTree(reading.aligned, reading.palette, spec.label || label, {
          sideIsFront: true,
          hints: spec.hints,
        })
      : null;
    if (!tree) return null;
    recipe = tree.recipe;
    concepts = recipe.parts.map((p) =>
      p.kind === 'trunk' ? 'tree_trunk' : p.kind === 'crown' ? 'foliage' : null
    );
    // The reconstructor measured its colours on the same pixels: keep them.
    fixed = recipe.parts.map(() => true);
  } else {
    const c = compileSpec(spec);
    recipe = c.recipe;
    concepts = c.concepts.map((x) => x ?? null);
    fixed = c.fixed;
  }
  // Two colour passes: the second sees the shading of the first.
  for (let pass = 0; pass < 2 && fixed.some((f) => !f); pass++) {
    const s = await scoreOnPhoto(recipe, shot, pitch);
    recipe = measurePartColors(recipe, s.render, s.crop, s.outline, fixed);
  }
  const valid = ObjectRecipeSchema.safeParse(recipe);
  if (!valid.success)
    throw new Error(`${label}: invalid recipe, ${valid.error.issues[0]?.message}`);
  const { score } = await scoreOnPhoto(recipe, shot, pitch);
  return {
    recipe,
    pitch: Math.round(pitch * 1e4) / 1e4,
    concepts,
    score: { iou: score.iou, edgeF1: score.edgeF1, deltaE: score.deltaE, score: score.score },
  };
}
