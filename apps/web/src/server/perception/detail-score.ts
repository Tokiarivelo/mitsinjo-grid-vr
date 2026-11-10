/**
 * Detail score (PQ-T2, methodology §6.1): what the outline score cannot see. SAM part masks on the photo
 * against the parts of the flat render, and edges inside the outline (door lines, window frames, seams).
 * Reported next to the weighted score, never inside it until the real-set baseline is known (PQ-T6).
 * Pure and deterministic; everything on the fit grid of `scoreModel`.
 */
import type { KitArchetype } from '@/lib/object-kit';
import type { DimStatus, ObjectRecipe, PartKind } from '@/lib/object-shape';
import { deltaE2000, linearToLab, srgbToLinear } from './color-measure';
import { renderFlat, type FlatRender, type ViewFrame } from './flat-render';
import {
  edgeMap,
  edgeTolerance,
  LANDMARK_MIN_PIXELS,
  matched,
  PHOTO_EDGE_SHARE,
  type RgbGrid,
} from './model-score';
import { distanceTo, emptyMask, maskEdges, type Mask } from './silhouette-fit';

/** SAM concept → the recipe part kinds that draw it. */
export const CONCEPT_KINDS: Readonly<Record<string, ReadonlyArray<PartKind>>> = {
  wheel: ['wheel'],
  window: ['window'],
  door: ['door'],
  chimney: ['chimney'],
  lamp: ['light', 'head'],
};
/** A match: centres closer than this share of the grid diagonal… */
export const DETAIL_MATCH_DIST = 0.1;
/** …and box areas within this ratio of each other (both ways). */
export const DETAIL_AREA_RATIO = 2;

/** One SAM part on the fit grid: concept + box in grid pixels. */
export interface GridPart {
  concept: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What the score needs of each recipe part, by part index. */
export interface DetailPart {
  /** What the part may be: its `kind`, or the kinds guessed for an untagged kit part (thin box = window or door). */
  kinds: ReadonlyArray<PartKind>;
  status?: DimStatus;
}

export interface DetailScore {
  /** SAM parts with a matching model part ÷ SAM parts, 0–1; absent without SAM parts. */
  partRecall?: number;
  /** Visible, measured model parts of a judged kind with a SAM match ÷ such parts; absent without any. */
  partPrecision?: number;
  /** Edge F1 inside the outline shrunk by twice the edge tolerance, 0–1; absent when nothing is inside. */
  interiorEdgeF1?: number;
  /** Mean ΔE2000 of each matched part: its SAM box on the photo against the same pixels on the render. */
  partDeltaE?: number;
  /** PQ-T36: the outline cut in `DETAIL_BANDS` height bands; SSIM of the worst band (lowest), 0–1. */
  bandSsim?: number;
  /** Mean ΔE2000 photo vs render in that worst band. */
  bandDeltaE?: number;
  /** Index of the worst band, 0 = top. */
  worstBand?: number;
  /** Bands where the model covers under half of the outline (a blank band). */
  blankBands?: number;
}

/** Height bands inside the outline (PQ-T36). */
export const DETAIL_BANDS = 8;
/** A band is blank when the render covers less than this share of its outline pixels. */
export const BLANK_BAND_COVER = 0.5;
const SSIM_C1 = 0.01 ** 2;
const SSIM_C2 = 0.03 ** 2;

const lum = (rgb: ArrayLike<number>, i: number) =>
  (0.299 * rgb[i * 3]! + 0.587 * rgb[i * 3 + 1]! + 0.114 * rgb[i * 3 + 2]!) / 255;

/** SSIM of two luminance samples (one window = the whole band). */
export function ssim(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  if (!n) return 1;
  let [ma, mb] = [0, 0];
  for (let i = 0; i < n; i++) [ma, mb] = [ma + a[i]!, mb + b[i]!];
  [ma, mb] = [ma / n, mb / n];
  let [va, vb, cov] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [da, db] = [a[i]! - ma, b[i]! - mb];
    va += da * da;
    vb += db * db;
    cov += da * db;
  }
  [va, vb, cov] = [va / n, vb / n, cov / n];
  return (
    ((2 * ma * mb + SSIM_C1) * (2 * cov + SSIM_C2)) /
    ((ma * ma + mb * mb + SSIM_C1) * (va + vb + SSIM_C2))
  );
}

/** Per height band inside the outline: SSIM, mean ΔE2000 and render coverage (PQ-T36). */
export function bandDifference(
  render: FlatRender,
  crop: RgbGrid,
  outline: Mask,
  bands = DETAIL_BANDS
): Array<{ ssim: number; deltaE: number; cover: number }> | null {
  const { cols, rows } = outline;
  let [top, bottom] = [rows, -1];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (outline.data[r * cols + c]) [top, bottom] = [Math.min(top, r), Math.max(bottom, r)];
  if (bottom - top + 1 < bands) return null;
  const toLab = (rgb: ArrayLike<number>, i: number) =>
    linearToLab(...srgbToLinear(rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!));
  const out: Array<{ ssim: number; deltaE: number; cover: number }> = [];
  const height = bottom - top + 1;
  for (let k = 0; k < bands; k++) {
    const r0 = top + Math.floor((k * height) / bands);
    const r1 = top + Math.floor(((k + 1) * height) / bands);
    const [a, b] = [[] as number[], [] as number[]];
    let [dE, covered] = [0, 0];
    for (let r = r0; r < r1; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (!outline.data[i]) continue;
        a.push(lum(crop.rgb, i));
        b.push(lum(render.rgb, i));
        dE += deltaE2000(toLab(crop.rgb, i), toLab(render.rgb, i));
        covered += render.mask.data[i]!;
      }
    out.push(
      a.length
        ? { ssim: ssim(a, b), deltaE: dE / a.length, cover: covered / a.length }
        : { ssim: 1, deltaE: 0, cover: 1 }
    );
  }
  return out;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const centre = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];

/** Bounding box (grid px, exclusive end) of each part's visible pixels; null under `LANDMARK_MIN_PIXELS`. */
function visibleBoxes(render: FlatRender, cols: number): Array<Box | null> {
  const boxes = render.colors.map(() => ({ x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: 0 }));
  for (let i = 0; i < render.part.length; i++) {
    const b = boxes[render.part[i]!];
    if (!b) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    b.x0 = Math.min(b.x0, c);
    b.y0 = Math.min(b.y0, r);
    b.x1 = Math.max(b.x1, c + 1);
    b.y1 = Math.max(b.y1, r + 1);
    b.n++;
  }
  return boxes.map((b) => (b.n >= LANDMARK_MIN_PIXELS ? b : null));
}

/** Pixels inside `outline` farther than `margin` from its boundary. */
export function interiorMask(outline: Mask, margin: number): Mask {
  const toEdge = distanceTo(maskEdges(outline));
  const m = emptyMask(outline.cols, outline.rows);
  for (let i = 0; i < m.data.length; i++)
    m.data[i] = outline.data[i] && toEdge[i]! > margin ? 1 : 0;
  return m;
}

/** Edge F1 restricted to `interior`: photo edges (strongest share) against render edges. */
function interiorF1(render: FlatRender, crop: RgbGrid, interior: Mask): number | undefined {
  if (!interior.data.some((v) => v === 1)) return undefined;
  const { cols, rows } = interior;
  const tol = edgeTolerance(cols);
  const photo = edgeMap(crop, interior, PHOTO_EDGE_SHARE);
  const model = edgeMap({ cols, rows, rgb: render.rgb }, interior);
  const precision = matched(model, distanceTo(photo), tol);
  const recall = matched(photo, distanceTo(model), tol);
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

/** Mean CIELAB of `grid` over the pixels in `box` where `keep` is set; null when none. */
function meanLab(grid: RgbGrid, keep: Mask, box: Box): [number, number, number] | null {
  const { cols, rows } = keep;
  let [L, A, B, n] = [0, 0, 0, 0];
  for (let r = Math.max(0, Math.floor(box.y0)); r < Math.min(rows, Math.ceil(box.y1)); r++) {
    for (let c = Math.max(0, Math.floor(box.x0)); c < Math.min(cols, Math.ceil(box.x1)); c++) {
      const i = r * cols + c;
      if (!keep.data[i]) continue;
      const lab = linearToLab(
        ...srgbToLinear(grid.rgb[i * 3]!, grid.rgb[i * 3 + 1]!, grid.rgb[i * 3 + 2]!)
      );
      L += lab[0];
      A += lab[1];
      B += lab[2];
      n++;
    }
  }
  return n ? [L / n, A / n, B / n] : null;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * The four detail numbers of one render. `concepts` = what SAM was asked for (default: the concepts of
 * `samParts`); model parts of other kinds are not judged. Parts `inferred` (mirrored hidden sides) or
 * not visible in the render never count against precision.
 */
export function scoreDetail(input: {
  render: FlatRender;
  crop: RgbGrid;
  outline: Mask;
  parts: ReadonlyArray<DetailPart>;
  samParts: ReadonlyArray<GridPart>;
  concepts?: ReadonlyArray<string>;
}): DetailScore {
  const { render, crop, outline, parts } = input;
  const { cols, rows } = outline;
  const sam = input.samParts.filter((p) => CONCEPT_KINDS[p.concept] && area(p) > 0);
  const concepts = new Set(input.concepts ?? sam.map((p) => p.concept));
  const judged = new Set([...concepts].flatMap((c) => CONCEPT_KINDS[c] ?? []));
  const boxes = visibleBoxes(render, cols);
  const maxDist = DETAIL_MATCH_DIST * Math.hypot(cols, rows);

  // Greedy one-to-one matching, largest SAM part first, nearest candidate wins.
  const taken = new Set<number>();
  const matches: Array<{ sam: GridPart; part: number }> = [];
  for (const s of [...sam].sort((a, b) => area(b) - area(a))) {
    const kinds = CONCEPT_KINDS[s.concept]!;
    const [sx, sy] = centre(s);
    let best = -1;
    let bestD = Infinity;
    boxes.forEach((b, k) => {
      const own = parts[k]?.kinds ?? [];
      if (!b || taken.has(k) || !own.some((kind) => kinds.includes(kind))) return;
      const ratio = area(b) / area(s);
      if (ratio > DETAIL_AREA_RATIO || ratio < 1 / DETAIL_AREA_RATIO) return;
      const [bx, by] = centre(b);
      const d = Math.hypot(bx - sx, by - sy);
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = k;
      }
    });
    if (best < 0) continue;
    taken.add(best);
    matches.push({ sam: s, part: best });
  }

  const counted = parts.flatMap((p, k) =>
    boxes[k] && p.kinds.some((kind) => judged.has(kind)) && p.status !== 'inferred' ? [k] : []
  );
  // Same pixels on both sides: the SAM box where the photo outline and the render overlap.
  const both = emptyMask(cols, rows);
  for (let i = 0; i < both.data.length; i++) both.data[i] = outline.data[i]! & render.mask.data[i]!;
  const rendered = { cols, rows, rgb: render.rgb };
  const colours = matches.flatMap(({ sam: s }) => {
    const seen = meanLab(crop, both, s);
    const drawn = meanLab(rendered, both, s);
    return seen && drawn ? [deltaE2000(drawn, seen)] : [];
  });
  const interior = interiorF1(render, crop, interiorMask(outline, 2 * edgeTolerance(cols)));
  const bandRows = bandDifference(render, crop, outline);
  const worst = bandRows?.reduce((w, b, k) => (b.ssim < bandRows[w]!.ssim ? k : w), 0);

  return {
    ...(sam.length ? { partRecall: round(matches.length / sam.length, 2) } : {}),
    ...(counted.length
      ? { partPrecision: round(counted.filter((k) => taken.has(k)).length / counted.length, 2) }
      : {}),
    ...(interior !== undefined ? { interiorEdgeF1: round(interior, 2) } : {}),
    ...(colours.length
      ? { partDeltaE: round(colours.reduce((a, b) => a + b, 0) / colours.length, 1) }
      : {}),
    ...(bandRows && worst !== undefined
      ? {
          bandSsim: round(bandRows[worst]!.ssim, 2),
          bandDeltaE: round(bandRows[worst]!.deltaE, 1),
          worstBand: worst,
          blankBands: bandRows.filter((b) => b.cover < BLANK_BAND_COVER).length,
        }
      : {}),
  };
}

/** Archetypes that are flat by nature: thin from the side is right for them (PQ-T36). */
export const FLAT_ARCHETYPES: ReadonlySet<KitArchetype> = new Set(['screen', 'panel', 'water']);
/** Side silhouette under this share of the front one → a paper-thin model. */
export const THIN_SIDE_SHARE = 0.15;
/** A 45° silhouette piece counts as detached from this share of the silhouette up. */
export const DETACHED_MIN_SHARE = 0.005;
const VIEW_GRID = 96;

export interface ViewCheck {
  /** Side (90°) silhouette area ÷ front (0°) one. */
  sideShare: number;
  /** Separate pieces of the 45° silhouette (1 = one body). */
  pieces45: number;
  /** null = passes; else why the model is degenerate. */
  fail: 'thin' | 'detached' | null;
}

/** Connected pieces (4-neighbour) of a mask with at least `min` pixels. */
function pieces(m: Mask, min: number): number {
  const seen = new Uint8Array(m.data.length);
  let count = 0;
  for (let s = 0; s < m.data.length; s++) {
    if (!m.data[s] || seen[s]) continue;
    let size = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const [c, r] = [i % m.cols, Math.floor(i / m.cols)];
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const [nc, nr] = [c + dc, r + dr];
        if (nc < 0 || nr < 0 || nc >= m.cols || nr >= m.rows) continue;
        const j = nr * m.cols + nc;
        if (m.data[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (size >= min) count++;
  }
  return count;
}

/**
 * Degenerate view (PQ-T36, methodology §12.2): the model seen at 0°, 45° and 90° on one fixed frame.
 * Fails when the side silhouette is under `THIN_SIDE_SHARE` of the front one (not for flat archetypes),
 * or when the 45° view falls apart in pieces (a part floating off the body). Needs no photo.
 */
export function degenerateView(recipe: ObjectRecipe, archetype: KitArchetype): ViewCheck {
  const { w, h, d } = recipe.proportions;
  const span = 1.2 * Math.hypot(w, h, d);
  const frame = (): ViewFrame => ({ cx: 0, cy: 0, fw: span, fh: span });
  const at = (deg: number) =>
    renderFlat(
      { ...recipe, yaw: 0 },
      1,
      VIEW_GRID,
      VIEW_GRID,
      { yaw: (deg * Math.PI) / 180, pitch: 0 },
      frame
    ).mask;
  const area = (m: Mask) => m.data.reduce((s, v) => s + v, 0);
  const [front, diag, side] = [at(0), at(45), at(90)];
  const sideShare = area(front) ? area(side) / area(front) : 0;
  const pieces45 = pieces(diag, Math.max(1, Math.round(DETACHED_MIN_SHARE * area(diag))));
  const fail =
    !FLAT_ARCHETYPES.has(archetype) && sideShare < THIN_SIDE_SHARE
      ? 'thin'
      : pieces45 > 1
        ? 'detached'
        : null;
  return { sideShare: round(sideShare, 2), pieces45, fail };
}
