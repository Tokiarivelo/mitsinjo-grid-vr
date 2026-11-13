import { components, structure, STRUCTURE_MIN_SHARE } from './grid';
import type { Palette } from './palette';
import {
  outerSpan,
  PIECE_MIN_CELLS,
  runPieces,
  spanArea,
  spanEnd,
  spanReach,
  type Span,
} from './pieces';
import { VIEW_NAMES, type AlignedViews, type ViewName } from './views';

/**
 * The solver of the views reconstruction (PQ-T69): per-material visual hull, then analysis by
 * synthesis. No template, no object family: only the pixels of the views.
 *
 * 1. Volumes. A front piece and a side piece of the same colour class that share rows are one
 *    solid: the front piece gives its x span per row, the side piece its row span per z (the
 *    visual hull of that material). A roof drawn as a rectangle in front and a triangle on the
 *    side becomes a pitched roof; a pillar in front and a strip on the side becomes a pillar
 *    standing at that depth.
 * 2. Hidden volumes are dropped: a solid no view can see adds nothing.
 * 3. Fill. Object pixels of the front or the side that no volume explains are closed with the
 *    plain silhouette hull (marked inferred): the model never shows a hole the drawings do not.
 * 4. Details. The model is projected back on every view; where a view shows another class than
 *    the model (a window on a wall, a wheel on a body), a thin slab of that class is laid on the
 *    surface there. This is what uses the back and the left drawings.
 *
 * Voxel grid: W × H × D cells, x left → right seen from the front, y top → bottom, z back → front.
 * Pure and deterministic.
 */

/** A side column joins a volume only where it shares at least this many rows with the front piece. */
export const SPAN_MIN_ROWS = 2;
/** An unexplained piece continues a same-class volume that spans at least this share of it. */
export const CONTINUE_MIN_OVERLAP = 0.5;
/** A volume under this many voxels is noise. */
export const VOLUME_MIN_VOXELS = 12;
/** A volume must show at least this many cells, and this share of its own faces, on some view. */
export const VISIBLE_MIN_CELLS = 4;
export const VISIBLE_MIN_SHARE = 0.04;
/** Solids kept at most (the recipe allows 32 components): volumes first, then fills, then details. */
export const VOLUMES_MAX = 14;
/** Volumes and fills together leave at least `SOLIDS_MAX − BODIES_MAX` solids to the details. */
export const BODIES_MAX = 18;
export const SOLIDS_MAX = 32;
/** A detail region: at least this many cells, this thick, and this full in its own box. */
export const DETAIL_MIN_CELLS = 6;
export const DETAIL_MIN_SIDE = 2;
export const DETAIL_MIN_FILL = 0.35;
/** Thickness of a detail slab, share of the object's extent along the view axis. */
export const DETAIL_DEPTH = 0.02;
/** From this share of its box a region is drawn as a box. */
export const BOX_FILL = 0.9;
/** A near-square region filling its box like a disc (π / 4 ≈ 0.785) is round. */
export const ROUND_FILL: readonly [number, number] = [0.7, 0.86];
export const ROUND_ASPECT = 0.2;
export const ROUND_MIN_SIDE = 4;

/** Edges of a solid in cells (x1 = one past its last cell), y top → bottom. */
export interface SolidBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

export interface Solid {
  /** `volume` = measured on two views; `fill` = silhouette hull (inferred); `detail` = surface slab. */
  role: 'volume' | 'fill' | 'detail';
  cls: number;
  shape: 'box' | 'hull' | 'cylinder';
  /** Cylinder axis (the view axis of the face it sits on). */
  axis?: 'x' | 'z';
  box: SolidBox;
  /** Hull seen from the front: x cells per row. */
  front?: Span;
  /** Hull seen from the side: rows per z column. */
  side?: Span;
  /** Side-face detail outline: z cells per row. */
  profile?: Span;
  /** The face a detail sits on. */
  face?: ViewName;
  /** Cells of the four views that show this solid. */
  visible: number;
}

export interface CarveResult {
  solids: Solid[];
  /** Share of each view's object cells where the model shows the drawn class, 0–1. */
  match: Partial<Record<ViewName, number>>;
  /** Share of each view's object cells the model covers at all, 0–1. */
  cover: Partial<Record<ViewName, number>>;
  counts: { volumes: number; fills: number; details: number; hidden: number };
}

interface Dims {
  W: number;
  H: number;
  D: number;
}

/** The solid a front piece and a side piece enclose together, or null when they share too few rows. */
export function pairSpans(
  front: Span,
  side: Span
): { front: Span; side: Span; voxels: number } | null {
  const [fy0, fy1] = [front.start, spanEnd(front)];
  const clipped = side.lo.map(
    (lo, i) => [Math.max(lo, fy0), Math.min(side.hi[i]!, fy1)] as [number, number]
  );
  // Longest run of side columns that share enough rows with the front piece.
  let best: [number, number] = [0, -1];
  for (let i = 0; i < clipped.length;) {
    if (clipped[i]![1] - clipped[i]![0] + 1 < SPAN_MIN_ROWS) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < clipped.length && clipped[j + 1]![1] - clipped[j + 1]![0] + 1 >= SPAN_MIN_ROWS)
      j++;
    if (j - i > best[1] - best[0]) best = [i, j];
    i = j + 1;
  }
  if (best[1] < best[0]) return null;
  const kept = clipped.slice(best[0], best[1] + 1);
  const sideSpan: Span = {
    start: side.start + best[0],
    lo: kept.map((c) => c[0]),
    hi: kept.map((c) => c[1]),
  };
  const [ry0, ry1] = spanReach(sideSpan);
  const frontSpan: Span = {
    start: ry0,
    lo: front.lo.slice(ry0 - fy0, ry1 - fy0 + 1),
    hi: front.hi.slice(ry0 - fy0, ry1 - fy0 + 1),
  };
  // Row widths summed once, so the voxel count is one subtraction per column.
  const prefix = [0];
  frontSpan.lo.forEach((lo, i) => prefix.push(prefix[i]! + frontSpan.hi[i]! - lo + 1));
  const voxels = kept.reduce((sum, [lo, hi]) => sum + prefix[hi - ry0 + 1]! - prefix[lo - ry0]!, 0);
  return { front: frontSpan, side: sideSpan, voxels };
}

const fillOf = (s: Span) => {
  const [lo, hi] = spanReach(s);
  return spanArea(s) / ((hi - lo + 1) * s.lo.length);
};

function hullSolid(role: Solid['role'], cls: number, pair: { front: Span; side: Span }): Solid {
  const [x0, x1] = spanReach(pair.front);
  const boxy = fillOf(pair.front) >= BOX_FILL && fillOf(pair.side) >= BOX_FILL;
  return {
    role,
    cls,
    shape: boxy ? 'box' : 'hull',
    box: {
      x0,
      x1: x1 + 1,
      y0: pair.front.start,
      y1: spanEnd(pair.front) + 1,
      z0: pair.side.start,
      z1: spanEnd(pair.side) + 1,
    },
    front: pair.front,
    side: pair.side,
    visible: 0,
  };
}

/** Writes `id` in every voxel of a hull solid (`onlyEmpty`: never over another solid). */
function paint(vox: Int16Array, { W, H }: Dims, s: Solid, id: number, onlyEmpty = false): void {
  const { front, side } = s;
  if (!front || !side) return;
  for (let k = 0; k < side.lo.length; k++) {
    const z = side.start + k;
    for (let y = side.lo[k]!; y <= side.hi[k]!; y++) {
      const r = y - front.start;
      if (r < 0 || r >= front.lo.length) continue;
      const row = (z * H + y) * W;
      for (let x = front.lo[r]!; x <= front.hi[r]!; x++) {
        if (!onlyEmpty || vox[row + x] === 0) vox[row + x] = id;
      }
    }
  }
}

interface Projection {
  cols: number;
  /** Solid id seen at each cell of the canonical view (0 = nothing). */
  id: Int16Array;
  /** Cell index along the view axis of the surface seen there. */
  depth: Int16Array;
}

/** First solid met by each ray of a view. */
function project(vox: Int16Array, { W, H, D }: Dims, view: ViewName): Projection {
  const alongZ = view === 'front' || view === 'back';
  const cols = alongZ ? W : D;
  const steps = alongZ ? D : W;
  // Front and right cameras look down the axis (highest cell first).
  const fromHigh = view === 'front' || view === 'right';
  const id = new Int16Array(cols * H);
  const depth = new Int16Array(cols * H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let u = 0; u < cols; u++) {
      for (let s = 0; s < steps; s++) {
        const a = fromHigh ? steps - 1 - s : s;
        const v = alongZ ? vox[(a * H + y) * W + u]! : vox[(u * H + y) * W + a]!;
        if (v) {
          id[y * cols + u] = v;
          depth[y * cols + u] = a;
          break;
        }
      }
    }
  }
  return { cols, id, depth };
}

/** Most frequent class of the cells of `span` (rows → columns) on a label map. */
function majorityClass(labels: Int16Array, cols: number, span: Span, classes: number): number {
  const votes = new Uint32Array(classes);
  span.lo.forEach((lo, i) => {
    for (let x = lo; x <= span.hi[i]!; x++) {
      const l = labels[(span.start + i) * cols + x]!;
      if (l >= 0) votes[l]!++;
    }
  });
  let best = 0;
  for (let c = 1; c < classes; c++) if (votes[c]! > votes[best]!) best = c;
  return best;
}

/** A span over the longest unbroken run of scan lines of an outer-span map. */
function longestSpan(map: Map<number, [number, number]>): Span | null {
  const lines = [...map.keys()].sort((a, b) => a - b);
  let best: number[] = [];
  let run: number[] = [];
  for (const a of lines) {
    if (run.length && a !== run.at(-1)! + 1) run = [];
    run.push(a);
    if (run.length > best.length) best = run;
  }
  if (!best.length) return null;
  return {
    start: best[0]!,
    lo: best.map((a) => map.get(a)![0]),
    hi: best.map((a) => map.get(a)![1]),
  };
}

/** Solids of the aligned, classed views. */
export function carve(aligned: AlignedViews, palette: Palette): CarveResult {
  const { W, H, D } = aligned;
  const dims = { W, H, D };
  const classes = palette.classes.length;
  // The drawn classes, and the same maps with surface features absorbed in the region that
  // encloses them: volumes are cut from the second, details are found against the first.
  const drawnFront = palette.labels.front!;
  const drawnRight = palette.labels.right!;
  const front = structure(drawnFront, W, H, classes);
  const right = structure(drawnRight, D, H, classes);
  /** Smallest piece that makes a volume on a view: a mass, not a mark. */
  const massOf = (labels: Int16Array) =>
    Math.max(
      PIECE_MIN_CELLS,
      Math.ceil(labels.reduce((n, l) => n + (l >= 0 ? 1 : 0), 0) * STRUCTURE_MIN_SHARE)
    );
  const [frontMass, sideMass] = [massOf(front), massOf(right)];
  const vox = new Int16Array(W * H * D);

  // 1. Volumes: every front piece × side piece of one class.
  let volumes: Solid[] = [];
  for (let c = 0; c < classes; c++) {
    const fronts = runPieces(W, H, (x, y) => front[y * W + x] === c, 'rows', frontMass);
    const sides = runPieces(D, H, (z, y) => right[y * D + z] === c, 'cols', sideMass);
    for (const f of fronts) {
      for (const s of sides) {
        const pair = pairSpans(f, s);
        if (pair && pair.voxels >= VOLUME_MIN_VOXELS)
          volumes.push({ ...hullSolid('volume', c, pair), visible: pair.voxels });
      }
    }
  }
  // Large first: a small solid (pillar, chimney) is painted over the body it stands in.
  volumes.sort((a, b) => b.visible - a.visible);
  const repaint = (solids: Solid[]) => {
    vox.fill(0);
    solids.forEach((s, i) => paint(vox, dims, s, i + 1));
  };
  /** Cells of the four views showing each solid (index = solid id − 1). */
  const seenBy = (count: number) => {
    const seen = new Uint32Array(count);
    for (const v of VIEW_NAMES) for (const id of project(vox, dims, v).id) if (id) seen[id - 1]!++;
    return seen;
  };
  repaint(volumes);
  // 2. Hidden volumes go; the rest is capped, most visible first.
  const total = volumes.length;
  const seen = seenBy(volumes.length);
  volumes = volumes
    .map((s, i) => ({ ...s, visible: seen[i]! }))
    .filter(
      (s) =>
        s.visible >= VISIBLE_MIN_CELLS &&
        s.visible >= VISIBLE_MIN_SHARE * (spanArea(s.front!) + spanArea(s.side!))
    );
  const hidden = total - volumes.length;
  if (volumes.length > VOLUMES_MAX) {
    const cut = [...volumes].sort((a, b) => b.visible - a.visible)[VOLUMES_MAX - 1]!.visible;
    volumes = volumes.filter((s) => s.visible >= cut).slice(0, VOLUMES_MAX);
  }
  repaint(volumes);

  // 3. Fill what the volumes leave open, with the plain silhouette hull.
  const fills: Solid[] = [];
  const sideOuter = longestSpan(outerSpan(D, H, (z, y) => right[y * D + z]! >= 0, 'cols'));
  const frontOuter = longestSpan(outerSpan(W, H, (x, y) => front[y * W + x]! >= 0, 'rows'));
  const addFill = (cls: number, pair: ReturnType<typeof pairSpans>) => {
    if (!pair || pair.voxels < VOLUME_MIN_VOXELS) return;
    if (volumes.length + fills.length >= BODIES_MAX) return;
    const solid = hullSolid('fill', cls, pair);
    fills.push(solid);
    paint(vox, dims, solid, volumes.length + fills.length, true);
  };
  /** Share of [a0, a1] that [b0, b1] covers (inclusive cells). */
  const covers = (a0: number, a1: number, b0: number, b1: number) =>
    Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1) / (a1 - a0 + 1);
  /** Volumes of `cls` whose rows touch [y0, y1]: an open piece of that class continues them. */
  const neighbours = (cls: number, y0: number, y1: number) =>
    volumes.filter((v) => v.cls === cls && v.box.y0 <= y1 + 1 && v.box.y1 >= y0);
  {
    // Front cells nothing explains: the part is hidden on the side view. It continues the same
    // material's volume next to it (same depth); with none, it takes the whole side silhouette.
    const seenFront = project(vox, dims, 'front');
    const open = (x: number, y: number) => front[y * W + x]! >= 0 && seenFront.id[y * W + x] === 0;
    for (const piece of runPieces(W, H, open, 'rows', frontMass)) {
      const cls = majorityClass(front, W, piece, classes);
      const [x0, x1] = spanReach(piece);
      const [y0, y1] = [piece.start, spanEnd(piece)];
      const next = neighbours(cls, y0, y1).filter(
        (v) => covers(x0, x1, v.box.x0, v.box.x1 - 1) >= CONTINUE_MIN_OVERLAP
      );
      if (next.length) {
        for (const v of next) {
          const n = v.side!.lo.length;
          const side: Span = { start: v.side!.start, lo: Array(n).fill(y0), hi: Array(n).fill(y1) };
          addFill(cls, pairSpans(piece, side));
        }
      } else if (sideOuter) addFill(cls, pairSpans(piece, sideOuter));
    }
  }
  {
    // Side cells nothing explains: the mirror case, hidden on the front view.
    const seenRight = project(vox, dims, 'right');
    const open = (z: number, y: number) => right[y * D + z]! >= 0 && seenRight.id[y * D + z] === 0;
    for (const piece of runPieces(D, H, open, 'cols', sideMass)) {
      // The piece's class: majority of the side cells it covers (rows per column).
      const votes = new Uint32Array(classes);
      piece.lo.forEach((lo, i) => {
        for (let y = lo; y <= piece.hi[i]!; y++) {
          const l = right[y * D + piece.start + i]!;
          if (l >= 0) votes[l]!++;
        }
      });
      let cls = 0;
      for (let c = 1; c < classes; c++) if (votes[c]! > votes[cls]!) cls = c;
      const [z0, z1] = [piece.start, spanEnd(piece)];
      const [y0, y1] = spanReach(piece);
      const next = neighbours(cls, y0, y1).filter(
        (v) => covers(z0, z1, v.box.z0, v.box.z1 - 1) >= CONTINUE_MIN_OVERLAP
      );
      if (next.length) {
        for (const v of next) {
          // The neighbour's x span, held from its nearest row over the piece's rows.
          const f = v.front!;
          const row = (y: number) => Math.max(0, Math.min(f.lo.length - 1, y - f.start));
          const rows = Array.from({ length: y1 - y0 + 1 }, (_, i) => row(y0 + i));
          addFill(
            cls,
            pairSpans(
              { start: y0, lo: rows.map((r) => f.lo[r]!), hi: rows.map((r) => f.hi[r]!) },
              piece
            )
          );
        }
      } else if (frontOuter) addFill(cls, pairSpans(frontOuter, piece));
    }
  }
  const bodies = [...volumes, ...fills];
  const bodySeen = seenBy(bodies.length);
  bodies.forEach((s, i) => (s.visible = bodySeen[i]!));

  // 4. Details: where a view shows another class than the model, a slab of that class on the surface.
  const candidates: Array<{ solid: Solid; cells: Array<[ViewName, number]> }> = [];
  const shown: Partial<Record<ViewName, Int16Array>> = {};
  for (const view of VIEW_NAMES) {
    const target = palette.labels[view];
    if (!target) continue;
    const p = project(vox, dims, view);
    const cols = p.cols;
    const model = Int16Array.from(p.id, (id) => (id ? bodies[id - 1]!.cls : -1));
    shown[view] = model;
    const alongZ = view === 'front' || view === 'back';
    const outward = view === 'front' || view === 'right';
    const thick = Math.max(1, Math.round(DETAIL_DEPTH * (alongZ ? D : W)));
    for (let c = 0; c < classes; c++) {
      const differs = (i: number) => target[i] === c && model[i]! >= 0 && model[i] !== c;
      for (const region of components(cols, H, differs)) {
        if (region.area < DETAIL_MIN_CELLS) continue;
        const inRegion = new Uint8Array(cols * H);
        for (const i of region.cells) inRegion[i] = 1;
        const pieces = runPieces(
          cols,
          H,
          (u, y) => inRegion[y * cols + u] === 1,
          'rows',
          DETAIL_MIN_CELLS
        );
        for (const span of pieces) {
          const [u0, u1] = spanReach(span);
          const [w, h] = [u1 - u0 + 1, span.lo.length];
          const fill = spanArea(span) / (w * h);
          if (Math.min(w, h) < DETAIL_MIN_SIDE || fill < DETAIL_MIN_FILL) continue;
          // Surface under the region: median depth of the cells it covers.
          const depths: number[] = [];
          const cells: Array<[ViewName, number]> = [];
          span.lo.forEach((lo, i) => {
            for (let u = lo; u <= span.hi[i]!; u++) {
              const cell = (span.start + i) * cols + u;
              if (p.depth[cell]! >= 0) depths.push(p.depth[cell]!);
              cells.push([view, cell]);
            }
          });
          if (!depths.length) continue;
          depths.sort((a, b) => a - b);
          const surface = depths[Math.floor(depths.length / 2)]!;
          // Half a cell in the surface, `thick` cells proud of it.
          const [a0, a1] = outward
            ? [surface + 0.5, surface + 1 + thick]
            : [surface - thick, surface + 0.5];
          const round =
            Math.min(w, h) >= ROUND_MIN_SIDE &&
            Math.abs(w - h) / Math.max(w, h) <= ROUND_ASPECT &&
            fill >= ROUND_FILL[0] &&
            fill <= ROUND_FILL[1];
          const [y0, y1] = [span.start, span.start + h];
          candidates.push({
            cells,
            solid: {
              role: 'detail',
              cls: c,
              shape: round ? 'cylinder' : fill >= BOX_FILL ? 'box' : 'hull',
              ...(round ? { axis: alongZ ? ('z' as const) : ('x' as const) } : {}),
              box: alongZ
                ? { x0: u0, x1: u1 + 1, y0, y1, z0: a0, z1: a1 }
                : { x0: a0, x1: a1, y0, y1, z0: u0, z1: u1 + 1 },
              ...(alongZ ? { front: span } : { profile: span }),
              face: view,
              visible: spanArea(span),
            },
          });
        }
      }
    }
  }
  candidates.sort((a, b) => b.solid.visible - a.solid.visible);
  const details = candidates.slice(0, Math.max(0, SOLIDS_MAX - bodies.length));
  for (const d of details) for (const [view, cell] of d.cells) shown[view]![cell] = d.solid.cls;

  const match: CarveResult['match'] = {};
  const cover: CarveResult['cover'] = {};
  for (const view of VIEW_NAMES) {
    const target = palette.labels[view];
    const model = shown[view];
    if (!target || !model) continue;
    let [object, same, covered] = [0, 0, 0];
    for (let i = 0; i < target.length; i++) {
      if (target[i]! < 0) continue;
      object++;
      if (model[i]! >= 0) covered++;
      if (model[i] === target[i]) same++;
    }
    match[view] = object ? same / object : 0;
    cover[view] = object ? covered / object : 0;
  }
  return {
    solids: [...bodies, ...details.map((d) => d.solid)],
    match,
    cover,
    counts: { volumes: volumes.length, fills: fills.length, details: details.length, hidden },
  };
}
