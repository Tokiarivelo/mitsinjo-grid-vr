import type { PlantHints } from '../tree/plant-build';
import { hsv, isFoliage, isLeaf } from '../tree/tree-fit';

/**
 * The outlined photo of a tour plant made easy to read (VS-T46): a crown photographed against the
 * sky shows sky, twigs and the house behind through its gaps, so the tree reader (`fitTree`) finds
 * a torn crown (floating balls, a box trunk). The outline is what the plant team traced; inside it
 * the crown rows are leaves (a gap takes the leaf colour around it, a shade darker: depth), and
 * the rows under the crown are the trunk (bark only, its strays dropped). Read only, never shown or
 * projected on the model. Pure: raw RGB and the outline mask on one grid in, raw RGB out.
 */

/** A crown row is at least this share of the widest outline row (lower and narrower: trunk). */
export const CROWN_WIDTH_SHARE = 0.32;
/** Fewest trunk rows, share of the height, for a trunk to be cut under the crown. */
export const TRUNK_MIN_SHARE = 0.04;
/** Leaf pixels needed in the crown, share of its outline: fewer is a bare tree, left as photographed. */
export const LEAF_MIN_SHARE = 0.2;
/** Radius (share of the crown width) of the window a gap takes its leaf colour from. */
export const GAP_WINDOW = 0.08;
/** A gap is this much darker than the leaves round it (the inside of the crown). */
export const GAP_SHADE = 0.82;
/** RGB distance from the bark median past which a trunk pixel is something else (grass, sky). */
export const BARK_RGB = 70;
/** Hue (degrees) and least saturation a backlit crown is tinted to (a dark needle green). */
export const TINT_HUE = 100;
export const TINT_SAT = 0.35;
/** Brightness past which an unclassified crown pixel is sky seen through it. */
export const SKY_VALUE = 0.62;

/** sRGB of a hue (degrees), saturation and value. */
export function fromHsv(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [r, g, b].map((k) => Math.round((k + m) * 255)) as [number, number, number];
}

/**
 * A crown whose leaves the colour test misses (dark needles against a bright sky read as grey):
 * every crown pixel that is not sky is tinted leaf green at its own brightness, in place.
 */
export function tintCrown(
  rgb: Uint8Array,
  mask: Uint8Array,
  width: number,
  rows: number,
  leaf: Uint8Array
): number {
  let n = 0;
  for (let i = 0; i < width * rows; i++) {
    if (!mask[i] || leaf[i]) continue;
    const [, sat, val] = hsv(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!);
    if (val >= SKY_VALUE || isSky(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!)) continue;
    const [r, g, b] = fromHsv(TINT_HUE, Math.max(TINT_SAT, sat), Math.max(0.16, val));
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
    leaf[i] = 1;
    n++;
  }
  return n;
}

/** Sky or cloud seen through a crown: blue, or bright and grey (a white cloud, not a petal). Never a leaf. */
export function isSky(r: number, g: number, b: number): boolean {
  if (isLeaf(r, g, b)) return false;
  const [h, sat, val] = hsv(r, g, b);
  return (h >= 180 && h <= 260 && val >= 0.45) || (sat < 0.14 && val >= 0.7);
}

/** Habits whose leaves are not a crown of clumps (fronds, blades, pads): left as photographed. */
const UNCLEANED = new Set(['palm', 'fan', 'grass', 'rosette', 'cactus', 'bamboo']);

export interface CleanFrame {
  rgb: Uint8Array;
  /** 1 = inside the outline. */
  mask: Uint8Array;
  width: number;
  height: number;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** First row of the trunk under the crown (rows below are trunk), or `height` when there is none. */
export function trunkStart(mask: Uint8Array, width: number, height: number): number {
  const w = Array.from({ length: height }, (_, y) => {
    let n = 0;
    for (let x = 0; x < width; x++) n += mask[y * width + x]!;
    return n;
  });
  const widest = Math.max(...w);
  if (!widest) return height;
  // Rows under the outline are not trunk: start from its last row.
  let last = height - 1;
  while (last >= 0 && !w[last]) last--;
  let y = last;
  while (y >= 0 && w[y]! < widest * CROWN_WIDTH_SHARE) y--;
  const start = y + 1;
  return last + 1 - start >= height * TRUNK_MIN_SHARE ? start : height;
}

/**
 * The cleaned photo, or null when the plant is not a crown of leaves (a palm, grass, a bare tree):
 * then the photo is read as it is. Pixels outside the outline are left untouched.
 */
export function cleanPlantFront(frame: CleanFrame, hints: PlantHints): Uint8Array | null {
  const { rgb, mask, width: W, height: H } = frame;
  if ((hints.habit && UNCLEANED.has(hints.habit)) || hints.leaf === 'none') return null;
  // A shrub, a hedge, a cypress: leaves down to the ground, no trunk cut under them.
  const shrub = hints.habit === 'shrub' || hints.habit === 'columnar';
  const split = shrub ? H : trunkStart(mask, W, H);
  const leaf = new Uint8Array(W * H);
  let inCrown = 0;
  let leaves = 0;
  let cx0 = W;
  let cx1 = -1;
  for (let y = 0; y < split; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      inCrown++;
      cx0 = Math.min(cx0, x);
      cx1 = Math.max(cx1, x);
      if (isFoliage(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!)) {
        leaf[i] = 1;
        leaves++;
      }
    }
  if (!inCrown) return null;
  const out = Uint8Array.from(rgb);
  // Too few leaves by colour: a backlit crown, tinted (a bare tree was turned away above).
  if (leaves < inCrown * LEAF_MIN_SHARE) leaves += tintCrown(out, mask, W, split, leaf);
  if (leaves < inCrown * LEAF_MIN_SHARE) return null;
  const src = out.slice();

  // Leaf colour round each pixel: box sums of the leaf pixels (summed-area tables).
  const sat = (pick: (i: number) => number) => {
    const t = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let row = 0;
      for (let x = 0; x < W; x++) {
        row += pick(y * W + x);
        t[(y + 1) * (W + 1) + x + 1] = t[y * (W + 1) + x + 1]! + row;
      }
    }
    return t;
  };
  const sums = [0, 1, 2].map((c) => sat((i) => (leaf[i] ? src[i * 3 + c]! : 0)));
  const count = sat((i) => leaf[i]!);
  const boxSum = (t: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    t[y1 * (W + 1) + x1]! - t[y0 * (W + 1) + x1]! - t[y1 * (W + 1) + x0]! + t[y0 * (W + 1) + x0]!;
  const all: number[][] = [[], [], []];
  for (let i = 0; i < W * H; i++)
    if (leaf[i]) for (let c = 0; c < 3; c++) all[c]!.push(src[i * 3 + c]!);
  const global = all.map(median);
  const r = Math.max(2, Math.round((cx1 - cx0 + 1) * GAP_WINDOW));
  for (let y = 0; y < split; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i] || leaf[i]) continue;
      const [x0, y0] = [Math.max(0, x - r), Math.max(0, y - r)];
      const [x1, y1] = [Math.min(W, x + r + 1), Math.min(H, y + r + 1)];
      const n = boxSum(count, x0, y0, x1, y1);
      for (let c = 0; c < 3; c++) {
        const v = n >= 3 ? boxSum(sums[c]!, x0, y0, x1, y1) / n : global[c]!;
        out[i * 3 + c] = Math.round(v * GAP_SHADE);
      }
    }

  // Trunk rows: the bark, the rest (grass, sky, a fence behind) dropped to paper.
  if (split < H) {
    const bark: number[][] = [[], [], []];
    for (let y = split; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!mask[i] || isFoliage(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!)) continue;
        for (let c = 0; c < 3; c++) bark[c]!.push(rgb[i * 3 + c]!);
      }
    const mid = bark.map(median);
    for (let y = split; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!mask[i]) continue;
        const d = Math.hypot(
          rgb[i * 3]! - mid[0]!,
          rgb[i * 3 + 1]! - mid[1]!,
          rgb[i * 3 + 2]! - mid[2]!
        );
        if (bark[0]!.length && d <= BARK_RGB) continue;
        // Not bark: its colour, so the reader still sees a trunk there (never leaves).
        for (let c = 0; c < 3; c++) out[i * 3 + c] = bark[0]!.length ? mid[c]! : 90;
      }
  }
  return out;
}
