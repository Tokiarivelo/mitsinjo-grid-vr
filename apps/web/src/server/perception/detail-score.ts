/**
 * Detail score (PQ-T2, methodology §6.1): what the outline score cannot see. SAM part masks on the photo
 * against the parts of the flat render, and edges inside the outline (door lines, window frames, seams).
 * Reported next to the weighted score, never inside it until the real-set baseline is known (PQ-T6).
 * Pure and deterministic; everything on the fit grid of `scoreModel`.
 */
import type { DimStatus, PartKind } from '@/lib/object-shape';
import { deltaE2000, linearToLab, srgbToLinear } from './color-measure';
import type { FlatRender } from './flat-render';
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

  return {
    ...(sam.length ? { partRecall: round(matches.length / sam.length, 2) } : {}),
    ...(counted.length
      ? { partPrecision: round(counted.filter((k) => taken.has(k)).length / counted.length, 2) }
      : {}),
    ...(interior !== undefined ? { interiorEdgeF1: round(interior, 2) } : {}),
    ...(colours.length
      ? { partDeltaE: round(colours.reduce((a, b) => a + b, 0) / colours.length, 1) }
      : {}),
  };
}
