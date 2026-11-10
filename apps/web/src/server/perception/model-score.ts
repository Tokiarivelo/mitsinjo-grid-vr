/**
 * Model score (PR-0.2, PR-0.8): how much the flat render of the model (PR-0.1) looks like the photo box.
 * Silhouette IoU against the SAM mask, edge F1 (outline and inner edges: windows, wheels, roof line) with a
 * small pixel tolerance, region ΔE2000 (each visible part's colour against the photo pixels it covers),
 * and, when part masks exist, the landmark term (rendered part centres against their mask centres).
 * Pure and deterministic; the loop (`/shape-loop`) and the Spark critic (PR-0.6) rank models with it.
 */
import { deltaE2000, hexToLab, linearToLab, srgbToLinear } from './color-measure';
import type { DetailScore } from './detail-score';
import type { FlatRender } from './flat-render';
import { distanceTo, emptyMask, iou, maskEdges, type Mask } from './silhouette-fit';

/** Photo box sampled on the render grid: sRGB, 3 bytes per pixel, row-major. */
export interface RgbGrid {
  cols: number;
  rows: number;
  rgb: ArrayLike<number>;
}

export interface ModelScore {
  /** Silhouette IoU with the SAM mask, 0–1. */
  iou: number;
  /** F1 of render edges against photo edges (tolerance `edgeTolerance`), 0–1. */
  edgeF1: number;
  /** Mean ΔE2000 of each visible part's colour against the photo pixels it covers, weighted by area. */
  deltaE: number;
  /** Part-centre match with the part masks, 0–1; absent without usable landmarks. */
  landmark?: number;
  /** 0–100, higher = closer to the photo. */
  score: number;
  /** Detail numbers (PQ-T2), reported beside the score, not weighted into it. */
  detail?: DetailScore;
}

/** Weights of the score: silhouette, edges, colour. */
export const SCORE_WEIGHTS = { iou: 0.4, edge: 0.35, color: 0.25 } as const;
/** Weights once landmarks judge too (sums to 1, like the classic set). */
export const SCORE_WEIGHTS_LANDMARKS = {
  iou: 0.35,
  edge: 0.3,
  color: 0.2,
  landmark: 0.15,
} as const;
/** Mean part-centre miss (grid-width fractions) at which the landmark term reaches 0. */
export const LANDMARK_MAX_DIST = 0.25;
/** Fewer rendered pixels than this → the part is hidden, its landmark is skipped. */
export const LANDMARK_MIN_PIXELS = 4;

/** One judged part: recipe part index + its mask centre in grid pixels. */
export interface Landmark {
  part: number;
  x: number;
  y: number;
}
/** ΔE at which the colour term reaches 0. */
export const SCORE_DELTA_E_MAX = 25;
/** Sobel magnitude (luminance 0–1) counted as an edge. */
export const EDGE_MIN = 0.1;
/** On busy photos only the strongest edges count: this share of the region's pixels at most. */
export const PHOTO_EDGE_SHARE = 0.2;

/** Edge tolerance in pixels: 2 px on a 128-column grid. */
export const edgeTolerance = (cols: number) => Math.max(1, Math.round(cols / 64));

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Sobel gradient of the luminance (0–1, borders clamped): x, y and magnitude per pixel. */
export function sobel(grid: RgbGrid): { gx: Float32Array; gy: Float32Array; mag: Float32Array } {
  const { cols, rows, rgb } = grid;
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = (0.299 * rgb[i * 3]! + 0.587 * rgb[i * 3 + 1]! + 0.114 * rgb[i * 3 + 2]!) / 255;
  }
  const at = (c: number, r: number) =>
    lum[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))]!;
  const n = cols * rows;
  const [gx, gy, mag] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      gx[i] =
        (at(c + 1, r - 1) +
          2 * at(c + 1, r) +
          at(c + 1, r + 1) -
          at(c - 1, r - 1) -
          2 * at(c - 1, r) -
          at(c - 1, r + 1)) /
        4;
      gy[i] =
        (at(c - 1, r + 1) +
          2 * at(c, r + 1) +
          at(c + 1, r + 1) -
          at(c - 1, r - 1) -
          2 * at(c, r - 1) -
          at(c + 1, r - 1)) /
        4;
      mag[i] = Math.hypot(gx[i]!, gy[i]!);
    }
  }
  return { gx, gy, mag };
}

/**
 * Thin edge pixels of `grid` inside `region` (all pixels without one): local maxima across the gradient
 * (Canny non-max suppression) with magnitude ≥ max(`EDGE_MIN`, the top `share` of the region).
 */
export function edgeMap(grid: RgbGrid, region?: Mask, share = 1): Mask {
  const { cols, rows } = grid;
  const { gx, gy, mag } = sobel(grid);
  const inside = (i: number) => !region || region.data[i] === 1;
  const m = emptyMask(cols, rows);
  const peaks: number[] = [];
  const magAt = (c: number, r: number) =>
    c < 0 || r < 0 || c >= cols || r >= rows ? 0 : mag[r * cols + c]!;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!inside(i) || mag[i]! < EDGE_MIN) continue;
      // Neighbours along the gradient, direction rounded to 45°.
      const a = ((Math.atan2(gy[i]!, gx[i]!) * 4) / Math.PI + 8) % 4;
      const [dc, dr] = [
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
      ][Math.round(a) % 4]!;
      if (mag[i]! >= magAt(c + dc!, r + dr!) && mag[i]! > magAt(c - dc!, r - dr!)) peaks.push(i);
    }
  }
  let threshold = 0;
  if (share < 1) {
    let area = 0;
    for (let i = 0; i < mag.length; i++) if (inside(i)) area++;
    const k = Math.floor(area * share);
    if (k < peaks.length) threshold = peaks.map((i) => mag[i]!).sort((x, y) => y - x)[k]!;
  }
  for (const i of peaks) if (mag[i]! > threshold) m.data[i] = 1;
  return m;
}

/** Share of `a`'s pixels within `tol` of a pixel of `b` (1 when `a` is empty). */
export function matched(a: Mask, bDistance: Float32Array, tol: number): number {
  let n = 0;
  let hit = 0;
  for (let i = 0; i < a.data.length; i++) {
    if (!a.data[i]) continue;
    n++;
    if (bDistance[i]! <= tol) hit++;
  }
  return n ? hit / n : 1;
}

const union = (a: Mask, b: Mask): Mask => {
  const m = emptyMask(a.cols, a.rows);
  for (let i = 0; i < m.data.length; i++) m.data[i] = a.data[i]! | b.data[i]!;
  return m;
};

/**
 * Photo side of the score, fixed while a fit loop tries renders (PR-2.9): photo edges (union with
 * the outline edges) with their distance map, and the CIELAB of every crop pixel.
 */
export interface PhotoTerms {
  cols: number;
  rows: number;
  edges: Mask;
  edgeDistance: Float32Array;
  /** CIELAB triples, row-major, one per crop pixel. */
  lab: Float64Array;
}

export function photoTerms(crop: RgbGrid, outline: Mask): PhotoTerms {
  const { cols, rows } = outline;
  const tol = edgeTolerance(cols);
  const near = emptyMask(cols, rows);
  const toOutline = distanceTo(outline);
  for (let i = 0; i < near.data.length; i++) near.data[i] = toOutline[i]! <= tol ? 1 : 0;
  const edges = union(edgeMap(crop, near, PHOTO_EDGE_SHARE), maskEdges(outline));
  const lab = new Float64Array(cols * rows * 3);
  for (let i = 0; i < cols * rows; i++) {
    lab.set(
      linearToLab(...srgbToLinear(crop.rgb[i * 3]!, crop.rgb[i * 3 + 1]!, crop.rgb[i * 3 + 2]!)),
      i * 3
    );
  }
  return { cols, rows, edges, edgeDistance: distanceTo(edges), lab };
}

/** Unrounded score: the smooth objective a fit loop minimises (`score` 0–100, higher = closer). */
export interface RawScore {
  iou: number;
  edgeF1: number;
  deltaE: number;
  landmark?: number;
  score: number;
}

/**
 * The score of one render with precomputed photo terms (same numbers as `scoreModel`, unrounded).
 * With usable landmarks (PR-0.8) the mean part-centre miss joins as a fourth term under the
 * rebalanced weights; without, the classic three terms (goldens stay neutral).
 */
export function scoreRender(
  render: FlatRender,
  outline: Mask,
  terms: PhotoTerms,
  landmarks?: ReadonlyArray<Landmark>
): RawScore {
  const { cols, rows } = terms;
  const silhouette = iou(render.mask, outline);
  // Silhouettes count on both sides: the render's black background would otherwise draw an outline the
  // photo only shows on contrasted backgrounds, and a box filling the grid would show none.
  const model = union(edgeMap({ cols, rows, rgb: render.rgb }), maskEdges(render.mask));
  const tol = edgeTolerance(cols);
  const precision = matched(model, terms.edgeDistance, tol);
  const recall = matched(terms.edges, distanceTo(model), tol);
  const edges = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const sums = render.colors.map((): [number, number, number, number] => [0, 0, 0, 0]);
  for (let i = 0; i < render.part.length; i++) {
    const k = render.part[i]!;
    if (k < 0 || !outline.data[i]) continue;
    const s = sums[k]!;
    s[0] += terms.lab[i * 3]!;
    s[1] += terms.lab[i * 3 + 1]!;
    s[2] += terms.lab[i * 3 + 2]!;
    s[3]++;
  }
  let total = 0;
  let n = 0;
  sums.forEach(([L, a, b, count], k) => {
    if (!count) return;
    total += count * deltaE2000(hexToLab(render.colors[k]!), [L / count, a / count, b / count]);
    n += count;
  });
  const dE = n ? total / n : 100;
  const color = Math.max(0, 1 - dE / SCORE_DELTA_E_MAX);
  const landmark = scoreLandmarks(render, landmarks, cols);
  if (landmark === undefined) {
    const w = SCORE_WEIGHTS;
    return {
      iou: silhouette,
      edgeF1: edges,
      deltaE: dE,
      score: 100 * (w.iou * silhouette + w.edge * edges + w.color * color),
    };
  }
  const w = SCORE_WEIGHTS_LANDMARKS;
  return {
    iou: silhouette,
    edgeF1: edges,
    deltaE: dE,
    landmark,
    score: 100 * (w.iou * silhouette + w.edge * edges + w.color * color + w.landmark * landmark),
  };
}

/**
 * Landmark term (PR-0.8): mean rendered-centroid miss of the judged parts, 0–1 (1 = on the
 * masks). Undefined without usable landmarks (none passed, unknown indices, hidden parts).
 */
function scoreLandmarks(
  render: FlatRender,
  landmarks: ReadonlyArray<Landmark> | undefined,
  cols: number
): number | undefined {
  if (!landmarks?.length || !(cols > 0)) return undefined;
  let total = 0;
  let count = 0;
  for (const lm of landmarks) {
    if (!Number.isInteger(lm.part) || lm.part < 0) continue;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < render.part.length; i++) {
      if (render.part[i] !== lm.part) continue;
      sx += i % cols;
      sy += Math.floor(i / cols);
      n++;
    }
    if (n < LANDMARK_MIN_PIXELS) continue;
    total += Math.hypot(sx / n - lm.x, sy / n - lm.y) / cols;
    count++;
  }
  if (!count) return undefined;
  return Math.max(0, 1 - total / count / LANDMARK_MAX_DIST);
}

/** Edge F1 of the render against the photo, photo edges counted only near the outline (no background). */
export function edgeF1(render: FlatRender, crop: RgbGrid, outline: Mask): number {
  return scoreRender(render, outline, photoTerms(crop, outline)).edgeF1;
}

/** Area-weighted ΔE2000 of each part's colour against the mean Lab of the photo pixels it covers. */
export function regionDeltaE(render: FlatRender, crop: RgbGrid, outline: Mask): number {
  return scoreRender(render, outline, photoTerms(crop, outline)).deltaE;
}

/** The score of a flat render against the photo crop and the SAM mask, all on the same grid. */
export function scoreModel(
  render: FlatRender,
  crop: RgbGrid,
  outline: Mask,
  landmarks?: ReadonlyArray<Landmark>
): ModelScore {
  const r = scoreRender(render, outline, photoTerms(crop, outline), landmarks);
  return {
    iou: round(r.iou, 2),
    edgeF1: round(r.edgeF1, 2),
    deltaE: round(r.deltaE, 1),
    ...(r.landmark !== undefined ? { landmark: round(r.landmark, 2) } : {}),
    score: Math.round(r.score),
  };
}
