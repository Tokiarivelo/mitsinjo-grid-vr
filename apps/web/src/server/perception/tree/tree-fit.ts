import { close } from '../recon/grid';
import { packCrown, runsOf, type Lobe } from './tree-crown';

export type { Lobe };
import type { AlignedViews, GridView } from '../recon/views';

/**
 * A tree read on its drawings (PQ-T79): where the crown is, how thick the trunk is at each height,
 * and the colours of leaves and bark, all measured on pixels. A twig web, a fan of fronds or a
 * conifer is not a solid the carving solver can find (its boxes stack into slabs); a tree is one
 * trunk under one crown, so the crown is read as a stack of lobes and the trunk as a tapered column.
 * Pure: the aligned views in, a plan in cell units out.
 */

export interface TreePlan {
  /** Frame of the drawings in cells; rows run from the crown top (0) to `H`, the foot of the trunk. */
  W: number;
  H: number;
  D: number;
  /** True when no trunk shows under the crown (a bush, a banana plant, a tree drawn down to the ground). */
  bush: boolean;
  /** Crown lobes, top to bottom. */
  crown: Lobe[];
  /** Trunk lobes, top to bottom (empty for a bush). */
  trunk: Lobe[];
  /** Leaf colour of each crown tier, top to bottom, and the bark colour. */
  leaf: string[];
  bark: string;
  /** Rows (of the aligned grid) the crown spans, and the row where the trunk meets the ground. */
  crownTop: number;
  crownBase: number;
  foot: number;
}

/** Closing radius of the leaf mask, cells: leaves, twigs and gaps between fronds become one mass. */
export const CROWN_CLOSE = 3;
/** A row belongs to the crown from this share of the widest row (its top: a spire is narrow; its base: strays hang lower). */
export const CROWN_TOP_SHARE = 0.03;
export const CROWN_ROW_SHARE = 0.1;
/** The crown reaches the ground (a bush) when the trunk would be shorter than this share of the height. */
export const BUSH_TRUNK_SHARE = 0.12;
export const TRUNK_BANDS = 8;
/** Median window of the trunk profile, rows each side: fallen fronds and roots are shorter than this. */
export const TRUNK_WINDOW = 20;
/** Share of the window's widths the trunk takes (a low one: fallen fronds and roots only widen a row). */
export const TRUNK_QUANTILE = 0.3;
/** A row is trunk while its width stays inside these multiples of the median trunk width. */
export const TRUNK_WIDTH_RANGE: readonly [number, number] = [0.6, 1.8];
/** Half-height of a lobe, in band heights: neighbours overlap deeply, so the union is a smooth column, not stacked saucers. */
export const LOBE_REACH = 1.7;
/** The trunk runs this share of the crown's height up into it, so the two always meet. */
export const TRUNK_REACH = 0.35;
/** A gap in a band narrower than this share of the width does not split a lobe. */
export const LOBE_GAP = 0.06;

type Rgb = [number, number, number];

/** Hue (degrees), saturation, value of an sRGB colour. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

/** A pixel of leaves: green to teal, not bark brown, not the pale blue of the sheet. */
export function isLeaf(r: number, g: number, b: number): boolean {
  const [h, s, v] = hsv(r, g, b);
  // Teal fronds lean toward blue; the pale blue of the sheet (low saturation) never counts.
  return s >= 0.1 && v >= 0.1 && h >= 50 && (h <= 175 || (h <= 198 && s >= 0.2));
}

const hex = ([r, g, b]: Rgb) =>
  `#${[r, g, b]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

/** Two opposite views of one frame as one mask (a leaf seen on either counts). */
function either(a: GridView, b: GridView | undefined, pick: (v: GridView, i: number) => number) {
  const out = new Uint8Array(a.cols * a.rows);
  for (let i = 0; i < out.length; i++) {
    out[i] = pick(a, i) || (b && b.cols === a.cols && b.rows === a.rows ? pick(b, i) : 0) ? 1 : 0;
  }
  return out;
}

const leafAt = (v: GridView, i: number) =>
  v.mask[i] && isLeaf(v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!) ? 1 : 0;
const objectAt = (v: GridView, i: number) => v.mask[i]!;

/** The value at share `q` of the sorted values (0 = smallest); 0 when none. */
function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const w = [...values].sort((a, b) => a - b);
  return w[Math.min(w.length - 1, Math.floor(q * w.length))]!;
}

/**
 * Width and centre of the trunk at each row, from the raw runs: the width is a low quantile of the
 * window (a fallen frond or a root only widens a row), the centre the median of the rows that are
 * about that wide (a one-sided frond would pull it aside). Rows without a run stay 0.
 */
function trunkProfile(w: Float32Array, c: Float32Array, half: number) {
  const outW = new Float32Array(w.length);
  const outC = new Float32Array(w.length);
  for (let y = 0; y < w.length; y++) {
    const rows: number[] = [];
    for (let i = Math.max(0, y - half); i <= Math.min(w.length - 1, y + half); i++)
      if (w[i]! > 0) rows.push(i);
    if (!rows.length) continue;
    const q = quantile(
      rows.map((i) => w[i]!),
      TRUNK_QUANTILE
    );
    const clean = rows.filter((i) => w[i]! <= q * 1.15);
    outW[y] = q;
    outC[y] = quantile(
      clean.map((i) => c[i]!),
      0.5
    );
  }
  return { w: outW, c: outC };
}

/** Width and centre of the trunk run on each row of `[y0, rows)`: the run that continues the one below. */
function trunkRuns(
  mask: Uint8Array,
  cols: number,
  rows: number,
  y0: number
): { w: Float32Array; c: Float32Array } {
  const w = new Float32Array(rows);
  const c = new Float32Array(rows);
  let prev = -1;
  for (let y = rows - 1; y >= y0; y--) {
    const runs = runsOf(mask, cols, [y], 0);
    if (!runs.length) continue;
    let best = runs[0]!;
    let bestScore = -Infinity;
    for (const run of runs) {
      const width = run[1] - run[0] + 1;
      const centre = (run[0] + run[1] + 1) / 2;
      const score = width - (prev >= 0 ? 0.5 * Math.abs(centre - prev) : 0);
      if (score > bestScore) [best, bestScore] = [run, score];
    }
    w[y] = best[1] - best[0] + 1;
    c[y] = (best[0] + best[1] + 1) / 2;
    prev = c[y]!;
  }
  return { w, c };
}

/** Mean colour of the cells of `mask` over rows `[y0, y1)` of the views; null when none. */
function meanColour(
  views: ReadonlyArray<GridView | undefined>,
  keep: (v: GridView, i: number) => boolean,
  y0: number,
  y1: number
): Rgb | null {
  let [r, g, b, n] = [0, 0, 0, 0];
  for (const v of views) {
    if (!v) continue;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(v.rows, Math.ceil(y1)); y++)
      for (let x = 0; x < v.cols; x++) {
        const i = y * v.cols + x;
        if (!keep(v, i)) continue;
        r += v.rgb[i * 3]!;
        g += v.rgb[i * 3 + 1]!;
        b += v.rgb[i * 3 + 2]!;
        n++;
      }
  }
  return n ? [r / n, g / n, b / n] : null;
}

/** Mean colour of the darker half of the trunk's own pixels (rows `y0`..`y1`, the run `centre ± width / 2`). */
export function barkColour(
  views: ReadonlyArray<GridView | undefined>,
  centre: ArrayLike<number>,
  width: ArrayLike<number>,
  y0: number,
  y1: number
): Rgb {
  const px: Rgb[] = [];
  for (const v of views) {
    if (!v) continue;
    for (let y = y0; y <= y1 && y < v.rows; y++) {
      const half = (width[y] ?? 0) / 2;
      if (half <= 0) continue;
      for (
        let x = Math.max(0, Math.ceil(centre[y]! - half));
        x < Math.min(v.cols, centre[y]! + half);
        x++
      ) {
        const i = y * v.cols + x;
        const [r, g, b] = [v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!];
        if (v.mask[i] === 1 && !isLeaf(r, g, b)) px.push([r, g, b]);
      }
    }
  }
  if (!px.length) return FALLBACK_BARK;
  const lum = ([r, g, b]: Rgb) => 0.3 * r + 0.59 * g + 0.11 * b;
  px.sort((p, q) => lum(p) - lum(q));
  const dark = px.slice(0, Math.max(1, Math.ceil(px.length / 2)));
  const sum = dark.reduce<Rgb>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
  return [sum[0] / dark.length, sum[1] / dark.length, sum[2] / dark.length];
}

const FALLBACK_LEAF: Rgb = [74, 110, 58];
const FALLBACK_BARK: Rgb = [96, 72, 54];

/** Leaf colour of each tier of `tiers` equal slices of the crown, top to bottom. */
function tierColours(
  views: ReadonlyArray<GridView | undefined>,
  top: number,
  base: number,
  n: number
) {
  const whole = meanColour(views, (v, i) => leafAt(v, i) === 1, top, base + 1) ?? FALLBACK_LEAF;
  const step = (base + 1 - top) / n;
  return Array.from({ length: n }, (_, k) =>
    hex(
      meanColour(views, (v, i) => leafAt(v, i) === 1, top + k * step, top + (k + 1) * step) ?? whole
    )
  );
}

/**
 * Reads the tree. Null when no crown shows (no leaf colour on the drawings): the caller then keeps
 * the generic reconstruction.
 */
export function fitTree(aligned: AlignedViews): TreePlan | null {
  const { front, right, back, left } = aligned.views;
  const { W, D } = aligned;
  const rows = front.rows;
  const sideA = right;
  const frontLeaf = either(front, back, leafAt);
  const sideLeaf = either(sideA, left, leafAt);
  const frontCrown = close(frontLeaf, W, rows, CROWN_CLOSE);
  const sideCrown = close(sideLeaf, D, rows, CROWN_CLOSE);
  // Crown rows: the share of each row the closed leaves fill, the larger of the two views.
  const share = Array.from({ length: rows }, (_, y) => {
    let f = 0;
    let s = 0;
    for (let x = 0; x < W; x++) f += frontCrown[y * W + x]!;
    for (let x = 0; x < D; x++) s += sideCrown[y * D + x]!;
    return Math.max(f / W, s / D);
  });
  const widest = Math.max(...share);
  if (widest <= 0) return null;
  const top = share.findIndex((v) => v >= CROWN_TOP_SHARE * widest);
  const base =
    share.length - 1 - [...share].reverse().findIndex((v) => v >= CROWN_ROW_SHARE * widest);
  if (top < 0 || base < top) return null;

  // Trunk: the run that rises from the ground, median-filtered (fallen fronds, roots, forks).
  const frontObject = either(front, back, objectAt);
  const sideObject = either(sideA, left, objectAt);
  const trunkTop = base + 1;
  let foot = rows - 1;
  let bush = rows - 1 - base < BUSH_TRUNK_SHARE * rows;
  const trunk: Lobe[] = [];
  let bark: Rgb = FALLBACK_BARK;
  if (!bush) {
    const f = trunkRuns(frontObject, W, rows, trunkTop);
    const s = trunkRuns(sideObject, D, rows, trunkTop);
    const pf = trunkProfile(f.w, f.c, TRUNK_WINDOW);
    const ps = trunkProfile(s.w, s.c, TRUNK_WINDOW);
    const [fw, fc, sw, sc] = [pf.w, pf.c, ps.w, ps.c];
    const allW = [...fw, ...sw].filter((v) => v > 0).sort((a, b) => a - b);
    const w0 = allW.length ? allW[Math.floor(allW.length / 2)]! : 0;
    // The foot: the lowest row where the raw width is a trunk's (roots and fallen leaves lie below).
    const inRange = (y: number) => {
      const ws = [f.w[y]!, s.w[y]!].filter((v) => v > 0);
      return (
        ws.length > 0 &&
        ws.every((v) => v >= TRUNK_WIDTH_RANGE[0] * w0 && v <= TRUNK_WIDTH_RANGE[1] * w0)
      );
    };
    foot = rows - 1;
    while (foot > trunkTop + 2 && !(inRange(foot) && inRange(foot - 1) && inRange(foot - 2)))
      foot--;
    if (w0 <= 0 || foot - trunkTop < BUSH_TRUNK_SHARE * rows * 0.5) {
      bush = true;
      foot = rows - 1;
    } else {
      // Lobes from the foot up into the crown, whose rows give the trunk its top.
      const reach = Math.round((base - top) * TRUNK_REACH);
      const topRow = Math.max(top, trunkTop - reach);
      const height = foot + 1 - topRow;
      const bands = Math.max(3, Math.min(TRUNK_BANDS, Math.round(height / 6)));
      const step = height / bands;
      const at = (arr: Float32Array, y: number) => {
        const v = arr[Math.min(foot, Math.max(trunkTop, y))]!;
        return v > 0 ? v : w0;
      };
      // A centre above the trunk's top is the nearest measured one (a missing row is no x = 0).
      const centre = (arr: Float32Array, y: number) => {
        const from = Math.min(foot, Math.max(trunkTop, y));
        for (let d = 0; d <= foot - trunkTop; d++)
          for (const row of [from + d, from - d])
            if (row >= trunkTop && row <= foot && arr[row]! > 0) return arr[row]!;
        return arr.find((v) => v > 0) ?? 0;
      };
      for (let b = 0; b < bands; b++) {
        const mid = topRow + (b + 0.5) * step;
        const y = Math.round(mid);
        const [wf, ws] = [at(fw, y), at(sw, y)];
        trunk.push({
          c: [centre(fc, y), mid, centre(sc, y)],
          r: [Math.max(1, wf / 2), step * LOBE_REACH, Math.max(1, ws / 2)],
        });
      }
      // Bark: the darker half of what the front shows on the trunk itself, leaves and the
      // anti-aliased edge (a blend with the sheet) left out.
      bark = barkColour([front, back], fc, fw, trunkTop, foot);
    }
  }
  const crown = packCrown(
    { front: frontCrown, side: sideCrown, W, D, rows },
    top,
    bush ? foot : base,
    Math.max(1, Math.round(W * LOBE_GAP))
  );
  if (!crown.length) return null;
  const views = [front, back, right, left];
  return {
    W,
    H: foot + 1,
    D,
    bush,
    crown,
    trunk,
    leaf: tierColours(views, top, bush ? foot : base, 3),
    bark: hex(bark),
    crownTop: top,
    crownBase: base,
    foot,
  };
}
