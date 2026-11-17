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
import { resolveSilhouettes, silhouettePlant } from './silhouette';
import { compileSpec, type TourPartsSpec, type TourSpec } from './spec';
import { SKIN_ERODE, SKIN_TILE, erodeMask, fillOutside, outlineFrame, type PanoRing } from './skin';

export { renderAtPhoto, type TourMockEntry };

/**
 * Offline builder of the tour mock (VS-T41, `make tour-mock`): each hand-built spec is put on its
 * own photo the way a scan photographs it (the equirect strip is a straight crop of the panorama,
 * so the panorama turned to face the object is that photo), drawn at the photo's view (the camera
 * looks up at a ceiling light: the model is seen from below), coloured part by part with the
 * photo's colours inside the hand outline, and scored like every model (`scoreModel`).
 */

export type { PanoRing };

/** The object on its photo: the panorama turned so the object faces the camera. */
export interface ObjectPhoto {
  photo: PhotoForRegions;
  box: { x: number; y: number; w: number; h: number };
  /** Outline rings in photo fractions. */
  rings: Array<Array<readonly [number, number]>>;
  /** Elevation of the object centre seen from the eye (rad, + = above). */
  elevation: number;
}

/** The panorama turned to put the outline's centre straight ahead (u = 0.5), with box and rings. */
export async function objectPhoto(
  pano: { data: Buffer; width: number; height: number },
  outline: ReadonlyArray<PanoRing>
): Promise<ObjectPhoto> {
  const { uc, box, rings, elevation } = outlineFrame(outline);
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
  return {
    photo: { buffer, width: W, height: H },
    box,
    rings: rings.map((r) => [...r]),
    elevation,
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

/**
 * IoU under which a reconstructed plant is compared with its outline model (VS-T42). Low on
 * purpose: an outline crown reads as a cushion, so it only replaces readings that are clearly broken.
 */
export const PLANT_FALLBACK_IOU = 0.45;

/** Parts → recipe, with `silhouette` parts cut from this photo's outline. */
function compileOnPhoto(spec: TourPartsSpec, shot: ObjectPhoto) {
  const aspect = shot.photo.width / shot.photo.height;
  return compileSpec(resolveSilhouettes(spec, shot.rings, shot.box, aspect));
}

/** Colours measured (two passes: the second sees the shading of the first), validated, scored. */
async function finishEntry(
  recipe0: ObjectRecipe,
  concepts: Array<string | null>,
  fixed: boolean[],
  shot: ObjectPhoto,
  label: string
): Promise<TourMockEntry> {
  const pitch = -shot.elevation;
  let recipe = recipe0;
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

/** A parts spec on its photo → its entry. */
function partsEntry(spec: TourPartsSpec, shot: ObjectPhoto, label: string) {
  const c = compileOnPhoto(spec, shot);
  return finishEntry(
    c.recipe,
    c.concepts.map((x) => x ?? null),
    c.fixed,
    shot,
    label
  );
}

/**
 * One tour object → its mock entry (colours measured, scored), or null when it cannot be built.
 * A plant is read by the tree reconstructor; when that reading scores under `PLANT_FALLBACK_IOU`
 * its outline model (crown + trunk bands) is built too and the better of the two kept.
 */
export async function buildEntry(
  spec: TourSpec,
  shot: ObjectPhoto,
  label: string
): Promise<TourMockEntry | null> {
  if (spec.kind === 'parts') return partsEntry(spec, shot, label);
  const front = await decodeView(await outlinedFront(shot));
  const reading = front ? readViews({ front, right: front }) : null;
  const tree = reading
    ? reconstructTree(reading.aligned, reading.palette, spec.label || label, {
        sideIsFront: true,
        hints: spec.hints,
      })
    : null;
  // The reconstructor measured its colours on the same pixels: keep them.
  const read = tree
    ? await finishEntry(
        tree.recipe,
        tree.recipe.parts.map((p) =>
          p.kind === 'trunk' ? 'tree_trunk' : p.kind === 'crown' ? 'foliage' : null
        ),
        tree.recipe.parts.map(() => true),
        shot,
        label
      )
    : null;
  if (read && read.score.iou >= PLANT_FALLBACK_IOU) return read;
  const outline = silhouettePlant(shot.rings, shot.box, shot.photo.width / shot.photo.height);
  const alt = outline ? await partsEntry(outline, shot, label) : null;
  if (!read) return alt;
  return alt && alt.score.score > read.score.score ? alt : read;
}

/** JPEG quality of a stored front face (VS-T43). */
export const SKIN_JPEG_QUALITY = 84;

/** RGB distance from a part's render past which a photo pixel is what shows through or in front. */
export const SKIN_GATE_RGB = 70;
/** Share of a part's pixels near its render needed to call it plain (then the others are dropped). */
export const SKIN_GATE_SHARE = 0.6;

/**
 * Photo pixels that are the model (VS-T43): inside the outline, covered by a part, and, on a plain
 * part (most of its pixels near its own measured colour), near that colour: the drape seen between
 * the legs of a chair, the sky through a tree are dropped, a patterned blanket keeps its pattern.
 * Pure: `photo` and `render` RGB on the same grid as `outline`.
 */
export function gateSkin(photo: Uint8Array, render: FlatRender, outline: Mask): Mask {
  const n = outline.cols * outline.rows;
  const near = new Map<number, [number, number]>();
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = render.part[i]!;
    if (!outline.data[i] || k < 0) continue;
    const d = Math.hypot(
      photo[i * 3]! - render.rgb[i * 3]!,
      photo[i * 3 + 1]! - render.rgb[i * 3 + 1]!,
      photo[i * 3 + 2]! - render.rgb[i * 3 + 2]!
    );
    dist[i] = d;
    const c = near.get(k) ?? [0, 0];
    c[1]++;
    if (d <= SKIN_GATE_RGB) c[0]++;
    near.set(k, c);
  }
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = render.part[i]!;
    if (!outline.data[i] || k < 0) continue;
    const [ok, all] = near.get(k)!;
    data[i] = ok >= SKIN_GATE_SHARE * all && dist[i]! > SKIN_GATE_RGB ? 0 : 1;
  }
  return { cols: outline.cols, rows: outline.rows, data };
}

/**
 * The front face of a tour object (VS-T43): its photo box cut from the panorama, stretched to one
 * `SKIN_TILE`² atlas tile (columns and rows span the model box), the outline pulled in by
 * `SKIN_ERODE`, the pixels that are not the model dropped (`gateSkin`, made things only) and
 * everything left filled with the nearest object colours. JPEG.
 */
export async function frontSkinTile(
  shot: ObjectPhoto,
  entry?: Pick<TourMockEntry, 'recipe' | 'pitch'>,
  gate = true
): Promise<Buffer> {
  const { photo, box } = shot;
  const left = Math.max(0, Math.floor(box.x * photo.width));
  const top = Math.max(0, Math.floor(box.y * photo.height));
  const width = Math.max(1, Math.min(photo.width - left, Math.ceil(box.w * photo.width)));
  const height = Math.max(1, Math.min(photo.height - top, Math.ceil(box.h * photo.height)));
  const { data } = await sharp(photo.buffer)
    .extract({ left, top, width, height })
    .resize(SKIN_TILE, SKIN_TILE, { fit: 'fill', kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgb = new Uint8Array(data.buffer, data.byteOffset, data.length);
  let mask = erodeMask(ringsMask(shot.rings, box, SKIN_TILE, SKIN_TILE), SKIN_ERODE);
  if (entry && gate) {
    const gated = gateSkin(
      rgb,
      renderAtPhoto(entry.recipe, SKIN_TILE, SKIN_TILE, entry.pitch),
      mask
    );
    // Never drop the whole object (a part read wrong): keep the outline then.
    if (gated.data.some((v) => v)) mask = gated;
  }
  fillOutside(rgb, mask);
  return sharp(Buffer.from(rgb), { raw: { width: SKIN_TILE, height: SKIN_TILE, channels: 3 } })
    .jpeg({ quality: SKIN_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}
