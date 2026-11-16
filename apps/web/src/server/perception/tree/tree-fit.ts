import { close } from '../recon/grid';
import { packCrown, runsOf, type Lobe } from './tree-crown';
import { frondCrown, type FrondCrown } from './tree-fronds';

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
  /** A palm's crown (`options.fronds`): the heart and its fronds; `crown` then only measures the outline. */
  fronds?: FrondCrown;
  /**
   * The closed crown on each row (PQ-T82): its first and last cell on the front (x) and on the
   * side (z), null on a row without leaves; and per column the lowest row with leaves (the hem of
   * a weeping curtain), -1 without. Read by the plant builders (`plant-build.ts`).
   */
  rows: { front: Array<[number, number] | null>; side: Array<[number, number] | null> };
  hem: { front: number[]; side: number[] };
  /** Flowers or fruit inside the crown: their colour and their share of the crown's pixels. */
  bloom?: { color: string; share: number };
  /** The side was the front reused (a round plant): the trunk does not lean in depth. */
  sideIsFront: boolean;
}

export interface TreeFitOptions {
  /** The label names a palm, a banana plant…: the crown is written as fronds round a heart. */
  fronds?: boolean;
  /** The side view is the front reused (PQ-T81): its trunk's lean is not a lean in depth. */
  sideIsFront?: boolean;
}

/** Closing radius of the leaf mask, cells: leaves, twigs and gaps between fronds become one mass. */
export const CROWN_CLOSE = 3;
/** A row belongs to the crown from this share of the widest row (its top: a spire is narrow; its base: strays hang lower). */
export const CROWN_TOP_SHARE = 0.03;
export const CROWN_ROW_SHARE = 0.1;
/** The crown reaches the ground (a bush) when the trunk would be shorter than this share of the height. */
export const BUSH_TRUNK_SHARE = 0.12;
export const TRUNK_BANDS = 10;
/** Median window of the trunk profile, rows each side: fallen fronds and roots are shorter than this. */
export const TRUNK_WINDOW = 20;
/** Share of the window's widths the trunk takes (a low one: fallen fronds and roots only widen a row). */
export const TRUNK_QUANTILE = 0.3;
/** A row is trunk while its width stays inside these multiples of the median trunk width. */
export const TRUNK_WIDTH_RANGE: readonly [number, number] = [0.6, 1.8];
/** Half-height of a lobe, in band heights: neighbours overlap deeply, so the union is a smooth column, not stacked saucers. */
export const LOBE_REACH = 1.7;
/** The trunk runs this share of the leaves above it up into the crown, so the two always meet and its tip stays hidden. */
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

/**
 * A pixel of flowers or fruit: saturated, neither leaf nor dull bark brown (a jacaranda's purple, a
 * flamboyant's red), or near-white petals.
 */
export function isPetal(r: number, g: number, b: number): boolean {
  const [hue, sat, val] = hsv(r, g, b);
  if (isLeaf(r, g, b)) return false;
  const brown = hue >= 15 && hue < 50 && sat < 0.6 && val < 0.7;
  return (sat >= 0.45 && val >= 0.45 && !brown) || (sat < 0.12 && val > 0.9);
}

/** Crown matter: leaves, or the flowers that hide them (a tree in full bloom has a crown too). */
export const isFoliage = (r: number, g: number, b: number) => isLeaf(r, g, b) || isPetal(r, g, b);

export const hex = ([r, g, b]: Rgb) =>
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
const crownAt = (v: GridView, i: number) =>
  v.mask[i] && isFoliage(v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!) ? 1 : 0;
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

/** Luminance band of the trunk's pixels the bark colour is the mean of: the darkest are ink lines and shadow, the lightest the anti-aliased edge. */
export const BARK_BAND: readonly [number, number] = [0.2, 0.65];

/** Mean colour of the middle band (`BARK_BAND`) of the trunk's own pixels (rows `y0`..`y1`, the run `centre ± width / 2`). */
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
        if (v.mask[i] === 1 && !isFoliage(r, g, b)) px.push([r, g, b]);
      }
    }
  }
  if (!px.length) return FALLBACK_BARK;
  const lum = ([r, g, b]: Rgb) => 0.3 * r + 0.59 * g + 0.11 * b;
  px.sort((p, q) => lum(p) - lum(q));
  const from = Math.floor(px.length * BARK_BAND[0]);
  const dark = px.slice(from, Math.max(from + 1, Math.ceil(px.length * BARK_BAND[1])));
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

/** A trunk's bark rising from the foot (`mask` = bark pixels): its top and foot rows; null without. */
export function barkRise(
  mask: Uint8Array,
  cols: number,
  rows: number
): { top: number; foot: number } | null {
  let foot = -1;
  let centre = -1;
  // The foot: the lowest row with bark near the middle third.
  for (let y = rows - 1; y >= 0 && foot < 0; y--)
    for (const [a, b] of runsOf(mask, cols, [y], 1))
      if ((a + b + 1) / 2 > cols / 3 && (a + b + 1) / 2 < (2 * cols) / 3) {
        foot = y;
        centre = (a + b + 1) / 2;
        break;
      }
  if (foot < 0) return null;
  let top = foot;
  let lost = 0;
  for (let y = foot - 1; y >= 0; y--) {
    const runs = runsOf(mask, cols, [y], 1).filter(
      ([a, b]) => Math.abs((a + b + 1) / 2 - centre) <= Math.max(3, (b - a + 1) * 1.5)
    );
    if (!runs.length) {
      // Leaves cross the trunk: a few rows without bark do not end it.
      if (++lost > BARK_GAP) break;
      continue;
    }
    lost = 0;
    const run = runs.reduce((p, q) =>
      Math.abs((q[0] + q[1] + 1) / 2 - centre) < Math.abs((p[0] + p[1] + 1) / 2 - centre) ? q : p
    );
    centre = (run[0] + run[1] + 1) / 2;
    top = y;
  }
  return { top, foot };
}

/** Rows without bark a trunk seen through hanging leaves may cross. */
export const BARK_GAP = 6;

/** Share of the crown's pixels that must be flowers or fruit for them to count. */
export const BLOOM_MIN = 0.02;

/**
 * Flowers or fruit in the crown (`isPetal` pixels). Their mean colour and share; null under `BLOOM_MIN`.
 */
export function bloomOf(
  views: ReadonlyArray<GridView | undefined>,
  crown: Uint8Array,
  cols: number,
  top: number,
  base: number
): { color: string; share: number } | null {
  let [r, g, b, n, all] = [0, 0, 0, 0, 0];
  for (const v of views) {
    if (!v || v.cols !== cols) continue;
    for (let y = top; y <= base && y < v.rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!crown[i] || !v.mask[i]) continue;
        all++;
        const [pr, pg, pb] = [v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!];
        if (!isPetal(pr, pg, pb)) continue;
        r += pr;
        g += pg;
        b += pb;
        n++;
      }
  }
  if (!all || n / all < BLOOM_MIN) return null;
  return { color: hex([r / n, g / n, b / n]), share: Math.round((n / all) * 1000) / 1000 };
}

/**
 * Reads the tree. Null when no crown shows (no leaf colour on the drawings): the caller then keeps
 * the generic reconstruction.
 */
export function fitTree(aligned: AlignedViews, options: TreeFitOptions = {}): TreePlan | null {
  const { front, right, back, left } = aligned.views;
  const { W, D } = aligned;
  const rows = front.rows;
  const sideA = right;
  const frontLeaf = either(front, back, crownAt);
  const sideLeaf = either(sideA, left, crownAt);
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
  let trunkTop = base + 1;
  let foot = rows - 1;
  let bush = rows - 1 - base < BUSH_TRUNK_SHARE * rows;
  // A weeping crown hangs down to the ground round its trunk (PQ-T82): the trunk is then the
  // bark that rises from the foot through the curtain, not what shows under the crown.
  let frontTrunkMask = frontObject;
  let sideTrunkMask = sideObject;
  if (bush) {
    const bark = (v: GridView, i: number) =>
      v.mask[i] && !isFoliage(v.rgb[i * 3]!, v.rgb[i * 3 + 1]!, v.rgb[i * 3 + 2]!) ? 1 : 0;
    const frontBark = either(front, back, bark);
    const rise = barkRise(frontBark, W, rows);
    if (rise && rise.foot - rise.top >= BUSH_TRUNK_SHARE * rows) {
      bush = false;
      trunkTop = rise.top;
      frontTrunkMask = frontBark;
      sideTrunkMask = options.sideIsFront ? frontBark : either(sideA, left, bark);
    }
  }
  const trunk: Lobe[] = [];
  let bark: Rgb = FALLBACK_BARK;
  if (!bush) {
    const f = trunkRuns(frontTrunkMask, W, rows, trunkTop);
    const s = trunkRuns(sideTrunkMask, D, rows, trunkTop);
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
      // An umbrella crown arches over the trunk: the trunk rises to the leaves above its own column.
      const column = (mask: Uint8Array, cols: number, x: number) => {
        const cx = Math.min(cols - 1, Math.max(0, Math.round(x)));
        for (let y = base; y >= top; y--) if (mask[y * cols + cx]) return y;
        return base;
      };
      const mid = (arr: Float32Array) => arr.find((v, y) => y >= trunkTop && v > 0) ?? 0;
      const under = Math.min(column(frontCrown, W, mid(fc)), column(sideCrown, D, mid(sc)));
      const meet = Math.min(trunkTop, under);
      const topRow = Math.max(top, meet - Math.round((meet - top) * TRUNK_REACH));
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
          // A side that is the front reused says nothing of a lean in depth.
          c: [centre(fc, y), mid, options.sideIsFront ? D / 2 : centre(sc, y)],
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
  // Fronds: the heart over the trunk (or the middle of a trunkless plant), the reach of the outline.
  let fronds: FrondCrown | undefined;
  if (options.fronds) {
    const span = (mask: Uint8Array, cols: number): [number, number] => {
      let [lo, hi] = [cols, -1];
      for (let y = top; y <= base; y++)
        for (let x = 0; x < cols; x++)
          if (mask[y * cols + x]) [lo, hi] = [Math.min(lo, x), Math.max(hi, x + 1)];
      return hi < 0 ? [0, cols] : [lo, hi];
    };
    const [fx, sz] = [span(frontCrown, W), span(sideCrown, D)];
    const centre: [number, number] = trunk.length
      ? [trunk[0]!.c[0], trunk[0]!.c[2]]
      : [(fx[0] + fx[1]) / 2, (sz[0] + sz[1]) / 2];
    fronds = frondCrown(top, bush ? foot : base, centre, [
      Math.max(centre[0] - fx[0], fx[1] - centre[0]),
      Math.max(centre[1] - sz[0], sz[1] - centre[1]),
    ]);
  }
  const spans = (mask: Uint8Array, cols: number) =>
    Array.from({ length: rows }, (_, y): [number, number] | null => {
      let [lo, hi] = [-1, -1];
      for (let x = 0; x < cols; x++)
        if (mask[y * cols + x]) {
          if (lo < 0) lo = x;
          hi = x;
        }
      return lo < 0 ? null : [lo, hi + 1];
    });
  const hems = (mask: Uint8Array, cols: number) =>
    Array.from({ length: cols }, (_, x) => {
      for (let y = rows - 1; y >= 0; y--) if (mask[y * cols + x]) return y;
      return -1;
    });
  const bloom = bloomOf([front, back], frontCrown, W, top, bush ? foot : base);
  return {
    ...(fronds ? { fronds } : {}),
    ...(bloom ? { bloom } : {}),
    rows: { front: spans(frontCrown, W), side: spans(sideCrown, D) },
    hem: { front: hems(frontLeaf, W), side: hems(sideLeaf, D) },
    sideIsFront: Boolean(options.sideIsFront),
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
