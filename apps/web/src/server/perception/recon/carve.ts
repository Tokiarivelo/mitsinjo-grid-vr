import { MAX_VIEW_PARTS, type RecipeMaterial } from '@/lib/object-shape';
import { deltaE2000 } from '../color-measure';
import { close, components } from './grid';
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
 * The solver of the views reconstruction (PQ-T69): a closed shape first, its colours second.
 * No template, no object family: only the pixels of the views.
 *
 * 1. Shape. The front and the side silhouettes are cut into single-run pieces; every front piece
 *    and side piece that share rows enclose one solid (the visual hull). The shape is closed by
 *    construction: it never depends on how the colours were classed.
 * 2. Hidden solids are dropped: a pillar behind the pillars adds nothing to any view.
 * 3. Colour bands. Each solid is cut along its height where the material its rows show changes
 *    (chimney / roof / walls / base), votes taken on the views that see it.
 * 4. Details. The model is projected back on every view; where a view shows another class than
 *    the model (a window on a wall, a pillar against it), a thin slab of that class is laid on
 *    the surface there. This is what uses the back and the left drawings.
 *
 * Voxel grid: W × H × D cells, x left → right seen from the front, y top → bottom, z back → front.
 * Pure and deterministic.
 */

/** Roofing materials: bodies made of one, spanning the object, are a pitched roof, not a block. */
export const ROOFING: ReadonlyArray<RecipeMaterial> = ['thatch', 'tile', 'slate'];
/** A pitched roof spans at least this share of the object's width and depth. */
export const PITCH_MIN_SPAN = 0.3;
/** A front or back detail on the roof this wide (share of the roof's width) is a gable running to the ridge. */
export const GABLE_MIN_SPAN = 0.15;

/** A side column joins a solid only where it shares at least this many rows with the front piece. */
export const SPAN_MIN_ROWS = 2;
/** A silhouette piece under this share of its view's object cells is a mark, not a mass. */
export const BODY_MIN_SHARE = 0.002;
/** A solid under this many voxels is noise. */
export const VOLUME_MIN_VOXELS = 12;
/** A solid must show at least this many cells on some view. */
export const VISIBLE_MIN_CELLS = 4;
/** A colour band is at least this tall (rows, and share of the object's height). */
export const BAND_MIN_ROWS = 3;
export const BAND_MIN_SHARE = 0.06;
/** Solids kept at most: bodies first (most visible), the rest goes to the details. */
export const BODIES_MAX = 36;
export const SOLIDS_MAX = MAX_VIEW_PARTS;
/** Triangles the 3D view spends per solid (estimates), and the budget the solver keeps under. */
export const TRIANGLES = { box: 12, cylinder: 96, hull: 200, extrude: 160, main: 1700 } as const;
export const TRIANGLE_BUDGET = 4600;
/** A detail region: at least this many cells, this thick, and this full in its own box. */
export const DETAIL_MIN_CELLS = 6;
export const DETAIL_MIN_SIDE = 2;
export const DETAIL_MIN_FILL = 0.35;
/** A detail closer than this (CIEDE2000) to the body under it is a shade of the same material: no slab. */
export const DETAIL_MIN_DELTA_E = 16;
/** From this colour distance a detail counts at its full area when the part budget is shared out. */
export const DETAIL_FULL_DELTA_E = 40;
/** Gaps this wide (cells) inside a detail are bridged: the bars of a window, the joints of a panel. */
export const DETAIL_CLOSE = 2;
/** A detail covers at least this share of its view's object cells. */
export const DETAIL_MIN_SHARE = 0.001;
/** Thickness of a detail slab, share of the object's extent along the view axis. */
export const DETAIL_DEPTH = 0.012;
/** …and at least this many cells: a simplified body outline may stand a cell proud of the cells. */
export const DETAIL_MIN_DEPTH = 2;
/** A region filling this share of its own outline (one run per row) is one slab with that outline. */
export const DETAIL_OUTLINE_FILL = 0.6;
/** From this share of its box a body is drawn as a box; a detail slab from the lower one. */
export const BOX_FILL = 0.9;
export const DETAIL_BOX_FILL = 0.75;
/** A near-square region filling its box like a disc (π / 4 ≈ 0.785) is round. */
export const ROUND_FILL: readonly [number, number] = [0.7, 0.86];
export const ROUND_ASPECT = 0.2;
export const ROUND_MIN_SIDE = 4;
/** Share of the box width a disc leaves empty at each corner of its top and bottom rows. */
export const ROUND_CORNER = 0.15;

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
  /** `volume` = a body of the visual hull; `detail` = surface slab. */
  role: 'volume' | 'detail';
  cls: number;
  shape: 'box' | 'hull' | 'cylinder' | 'extrude';
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
  /** Index of the body most of a detail lies on. */
  on?: number;
  /** Body: part of the pitched roof. Detail: a gable of it (front or back face). */
  roof?: boolean;
  /** Cells of the four views that show this solid. */
  visible: number;
}

export interface CarveResult {
  solids: Solid[];
  /** Share of each view's object cells where the model shows the drawn class, 0–1. */
  match: Partial<Record<ViewName, number>>;
  /** Share of each view's object cells the model covers at all, 0–1. */
  cover: Partial<Record<ViewName, number>>;
  counts: { volumes: number; details: number; hidden: number };
  /** `group[class]`: the class its material is drawn as (shades of one named material are one). */
  group: number[];
}

interface Dims {
  W: number;
  H: number;
  D: number;
}

/**
 * The solids a front piece and a side piece enclose together: one per unbroken run of side
 * columns that share rows with the front piece (a row of pillars gives one solid per pillar).
 */
export function pairSpans(
  front: Span,
  side: Span
): Array<{ front: Span; side: Span; voxels: number }> {
  const [fy0, fy1] = [front.start, spanEnd(front)];
  const clipped = side.lo.map(
    (lo, i) => [Math.max(lo, fy0), Math.min(side.hi[i]!, fy1)] as [number, number]
  );
  const shares = (c: [number, number]) => c[1] - c[0] + 1 >= SPAN_MIN_ROWS;
  const out: Array<{ front: Span; side: Span; voxels: number }> = [];
  for (let i = 0; i < clipped.length; i++) {
    if (!shares(clipped[i]!)) continue;
    let j = i;
    while (j + 1 < clipped.length && shares(clipped[j + 1]!)) j++;
    const kept = clipped.slice(i, j + 1);
    const sideSpan: Span = {
      start: side.start + i,
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
    frontSpan.lo.forEach((lo, r) => prefix.push(prefix[r]! + frontSpan.hi[r]! - lo + 1));
    const voxels = kept.reduce(
      (sum, [lo, hi]) => sum + prefix[hi - ry0 + 1]! - prefix[lo - ry0]!,
      0
    );
    out.push({ front: frontSpan, side: sideSpan, voxels });
    i = j;
  }
  return out;
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

/** Rows of a span from `a` to `b` (inclusive, absolute line numbers). */
const rowsOf = (s: Span, a: number, b: number): Span => ({
  start: a,
  lo: s.lo.slice(a - s.start, b - s.start + 1),
  hi: s.hi.slice(a - s.start, b - s.start + 1),
});

/**
 * Colour bands of a body: the class each of its rows shows most on the views that see it, short
 * runs given to their longer neighbour. `[y0, y1, class]`, top → bottom, covering the body's rows.
 */
export function colourBands(
  votes: ReadonlyArray<Uint32Array>,
  y0: number,
  preferred: (c: number) => boolean,
  minRows: number,
  allowed: (row: number, c: number) => boolean = () => true
): Array<[number, number, number]> {
  const n = votes.length;
  const rowClass = votes.map((v, row) => {
    let best = -1;
    // A paper-coloured class (glass, an open porch) is a surface feature: it wins a row only alone.
    for (const wanted of [true, false]) {
      for (let c = 0; c < v.length; c++)
        if (
          v[c]! > 0 &&
          preferred(c) === wanted &&
          allowed(row, c) &&
          (best < 0 || v[c]! > v[best]!)
        )
          best = c;
      if (best >= 0) break;
    }
    return best;
  });
  // Rows nobody sees take the class of the nearest seen row.
  for (let i = 1; i < n; i++) if (rowClass[i]! < 0) rowClass[i] = rowClass[i - 1]!;
  for (let i = n - 2; i >= 0; i--) if (rowClass[i]! < 0) rowClass[i] = rowClass[i + 1]!;
  let bands: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const last = bands.at(-1);
    if (last && last[2] === rowClass[i]) last[1] = i;
    else bands.push([i, i, Math.max(0, rowClass[i]!)]);
  }
  // Shortest band first: it joins the longer of its neighbours, equal classes fuse.
  for (;;) {
    let k = -1;
    bands.forEach((b, i) => {
      const len = b[1] - b[0] + 1;
      if (len < minRows && (k < 0 || len < bands[k]![1] - bands[k]![0] + 1)) k = i;
    });
    if (k < 0 || bands.length === 1) break;
    const [up, down] = [bands[k - 1], bands[k + 1]];
    const length = (b?: [number, number, number]) => (b ? b[1] - b[0] + 1 : -1);
    const into = length(up) >= length(down) ? up! : down!;
    into[0] = Math.min(into[0], bands[k]![0]);
    into[1] = Math.max(into[1], bands[k]![1]);
    bands.splice(k, 1);
    bands = bands.reduce<Array<[number, number, number]>>((out, b) => {
      const last = out.at(-1);
      if (last && last[2] === b[2]) last[1] = b[1];
      else out.push(b);
      return out;
    }, []);
  }
  return bands.map(([a, b, c]) => [y0 + a, y0 + b, c]);
}

/**
 * Solids of the aligned, classed views. `materials[class]` (optional, from the labelling step)
 * tells which classes are roofing: no view sees a roof from above, so its slopes are inferred
 * from what it is made of.
 */
export function carve(
  aligned: AlignedViews,
  palette: Palette,
  materials: ReadonlyArray<RecipeMaterial | undefined> = [],
  roofClass: number | null = null
): CarveResult {
  // Roofing: a class named a roofing material, or the class the model calls the roof (metal sheets…).
  const roofing = (c: number) =>
    c === roofClass || (materials[c] !== undefined && ROOFING.includes(materials[c]));
  const { W, H, D } = aligned;
  const dims = { W, H, D };
  const classes = palette.classes.length;
  const frontMask = aligned.views.front.mask;
  const sideMask = aligned.views.right.mask;
  const massOf = (mask: Uint8Array) =>
    Math.max(PIECE_MIN_CELLS, Math.ceil(mask.reduce((n, m) => n + m, 0) * BODY_MIN_SHARE));
  const vox = new Int16Array(W * H * D);
  const repaint = (solids: Solid[]) => {
    vox.fill(0);
    solids.forEach((s, i) => paint(vox, dims, s, i + 1));
  };
  /** What each view sees of the painted solids. */
  const projections = () =>
    Object.fromEntries(VIEW_NAMES.map((v) => [v, project(vox, dims, v)])) as Record<
      ViewName,
      Projection
    >;
  const countSeen = (solids: Solid[], seen: Record<ViewName, Projection>) => {
    const count = new Uint32Array(solids.length);
    for (const v of VIEW_NAMES) for (const id of seen[v].id) if (id) count[id - 1]!++;
    solids.forEach((s, i) => (s.visible = count[i]!));
  };

  // 1. The closed shape: every front piece × side piece of the two silhouettes (the visual hull).
  const fronts = runPieces(W, H, (x, y) => frontMask[y * W + x] === 1, 'rows', massOf(frontMask));
  const sides = runPieces(D, H, (z, y) => sideMask[y * D + z] === 1, 'cols', massOf(sideMask));
  let bodies: Solid[] = [];
  for (const f of fronts)
    for (const s of sides)
      for (const pair of pairSpans(f, s))
        if (pair.voxels >= VOLUME_MIN_VOXELS) bodies.push(hullSolid('volume', 0, pair));
  // 2. A body no view can see (a pillar behind the pillars) adds nothing.
  const visibleOnly = (solids: Solid[]) => {
    repaint(solids);
    countSeen(solids, projections());
    return solids.filter((s) => s.visible >= VISIBLE_MIN_CELLS);
  };
  const total = bodies.length;
  bodies = visibleOnly(bodies);
  const hidden = total - bodies.length;

  /** `apart[a][b]`: classes a and b are two materials, not two shades of one. */
  const apart = palette.classes.map((a) =>
    palette.classes.map((b) => deltaE2000(a.lab, b.lab) >= DETAIL_MIN_DELTA_E)
  );
  /**
   * Shades of one material are one material: each class, largest first, stands with the first
   * larger class it is not apart from (dark and light planks, lit and shaded stone). Colour
   * decides, not the names: only a roofing class and a class that is not roofing never join.
   */
  const group: number[] = [];
  palette.classes.forEach((_, c) => {
    const rep = group.findIndex((g, k) => g === k && !apart[c]![k]! && roofing(c) === roofing(k));
    group.push(rep >= 0 ? rep : c);
  });
  // 3. Colour: each body is cut in bands along its height, one per material its rows show.
  repaint(bodies);
  const seen = projections();
  const minRows = Math.max(BAND_MIN_ROWS, Math.round(H * BAND_MIN_SHARE));
  const banded: Solid[] = [];
  bodies.forEach((body, index) => {
    const [y0, y1] = [body.box.y0, body.box.y1 - 1];
    const votes = Array.from({ length: y1 - y0 + 1 }, () => new Uint32Array(classes));
    // What the front and the back alone show: a roof's slopes face them, so they fix its eave.
    const facing = Array.from({ length: y1 - y0 + 1 }, () => new Uint32Array(classes));
    for (const view of VIEW_NAMES) {
      const labels = palette.labels[view];
      if (!labels) continue;
      const { id, cols } = seen[view];
      for (let y = y0; y <= y1; y++) {
        for (let u = 0; u < cols; u++) {
          const cell = y * cols + u;
          if (id[cell] !== index + 1 || labels[cell]! < 0) continue;
          const g = group[labels[cell]!]!;
          votes[y - y0]![g]!++;
          if (view === 'front' || view === 'back') facing[y - y0]![g]!++;
        }
      }
    }
    // A row is roof only where the front and back show roof on it: under their eave it is wall,
    // whatever the sides show (their roof there is laid on as a detail).
    const roofRow = (row: number, c: number) => {
      if (!roofing(c)) return true;
      const f = facing[row]!;
      let total = 0;
      for (const n of f) total += n;
      return total === 0 || f[c]! * 2 >= total;
    };
    const bands = colourBands(votes, y0, (c) => !palette.classes[c]!.paper, minRows, roofRow);
    if (bands.length === 1) {
      banded.push({ ...body, cls: bands[0]![2] });
      return;
    }
    for (const [a, b, cls] of bands)
      for (const pair of pairSpans(rowsOf(body.front!, a, b), body.side!))
        banded.push(hullSolid('volume', cls, pair));
  });
  bodies = visibleOnly(banded)
    .sort((a, b) => b.visible - a.visible)
    .slice(0, BODIES_MAX);
  repaint(bodies);
  const finalSeen = projections();
  countSeen(bodies, finalSeen);
  const volumes = bodies;
  // The roofing bodies are one pitched roof when together they span the object.
  const roofBodies = bodies.filter((b) => roofing(b.cls));
  if (roofBodies.length) {
    const span = (lo: 'x0' | 'z0', hi: 'x1' | 'z1') =>
      Math.max(...roofBodies.map((b) => b.box[hi])) - Math.min(...roofBodies.map((b) => b.box[lo]));
    if (span('x0', 'x1') >= W * PITCH_MIN_SPAN && span('z0', 'z1') >= D * PITCH_MIN_SPAN)
      for (const b of roofBodies) b.roof = true;
  }
  const roofWidth = Math.max(
    0,
    ...roofBodies.filter((b) => b.roof).map((b) => b.box.x1 - b.box.x0)
  );

  // 4. Details: where a view shows another class than the model, a slab of that class on the surface.
  const candidates: Array<{
    solid: Solid;
    cells: Array<[ViewName, number]>;
    weight: number;
    /** Cells the slab stands proud per layer, signed along the view axis. */
    proud: number;
  }> = [];
  const shown: Partial<Record<ViewName, Int16Array>> = {};
  for (const view of VIEW_NAMES) {
    const target = palette.labels[view];
    if (!target) continue;
    const p = finalSeen[view];
    const cols = p.cols;
    const model = Int16Array.from(p.id, (id) => (id ? bodies[id - 1]!.cls : -1));
    shown[view] = model;
    const alongZ = view === 'front' || view === 'back';
    const outward = view === 'front' || view === 'right';
    const thick = Math.max(DETAIL_MIN_DEPTH, Math.round(DETAIL_DEPTH * (alongZ ? D : W)));
    const minDetail = Math.max(
      DETAIL_MIN_CELLS,
      Math.ceil(target.reduce((n, t) => n + (t >= 0 ? 1 : 0), 0) * DETAIL_MIN_SHARE)
    );
    // One pass per material, the paper-coloured ones first (glass keeps its bars); a cell taken
    // by a detail is not offered to the next material.
    const taken = new Uint8Array(cols * H);
    const order = Array.from({ length: classes }, (_, c) => c)
      .filter((c) => group[c] === c)
      .sort(
        (a, b) => Number(palette.classes[b]!.paper) - Number(palette.classes[a]!.paper) || a - b
      );
    for (const c of order) {
      const differs = Uint8Array.from(target, (t, i) =>
        t >= 0 &&
        group[t] === c &&
        !taken[i] &&
        model[i]! >= 0 &&
        model[i] !== c &&
        apart[c]![model[i]!]!
          ? 1
          : 0
      );
      // Bridged only over the model: a detail never grows outside the object.
      const bridged = close(differs, cols, H, DETAIL_CLOSE).map((v, i) =>
        v && model[i]! >= 0 && !taken[i] ? 1 : 0
      );
      for (const region of components(cols, H, (i) => bridged[i] === 1)) {
        if (region.area < minDetail) continue;
        const inRegion = new Uint8Array(cols * H);
        for (const i of region.cells) inRegion[i] = 1;
        const inside = (u: number, y: number) => inRegion[y * cols + u] === 1;
        // A region that fills its own outline is one slab (a gable, a wall band); a ragged one
        // is cut where it forks.
        const outline = outerSpan(cols, H, inside, 'rows');
        const outer: Span = {
          start: region.y0,
          lo: Array.from(
            { length: region.y1 - region.y0 + 1 },
            (_, i) => outline.get(region.y0 + i)![0]
          ),
          hi: Array.from(
            { length: region.y1 - region.y0 + 1 },
            (_, i) => outline.get(region.y0 + i)![1]
          ),
        };
        const pieces =
          region.area >= spanArea(outer) * DETAIL_OUTLINE_FILL
            ? [outer]
            : runPieces(cols, H, inside, 'rows', DETAIL_MIN_CELLS);
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
              taken[cell] = 1;
            }
          });
          if (!depths.length) continue;
          depths.sort((a, b) => a - b);
          // Body most of the region lies on.
          const under = new Map<number, number>();
          for (const [, cell] of cells)
            if (p.id[cell]) under.set(p.id[cell]!, (under.get(p.id[cell]!) ?? 0) + 1);
          const on = [...under].sort((a, b) => b[1] - a[1])[0]![0] - 1;
          // The surface the slab lies on: the face of a body drawn as a box, else the median
          // depth of the cells under the region.
          const host = bodies[on]!;
          const face = alongZ
            ? outward
              ? host.box.z1 - 1
              : host.box.z0
            : outward
              ? host.box.x1 - 1
              : host.box.x0;
          const surface = host.shape === 'box' ? face : depths[Math.floor(depths.length / 2)]!;
          // Half a cell in the surface, `thick` cells proud of it.
          const [a0, a1] = outward
            ? [surface + 0.5, surface + 1 + thick]
            : [surface - thick, surface + 0.5];
          const round =
            Math.min(w, h) >= ROUND_MIN_SIDE &&
            Math.abs(w - h) / Math.max(w, h) <= ROUND_ASPECT &&
            fill >= ROUND_FILL[0] &&
            fill <= ROUND_FILL[1] &&
            // A disc leaves its box corners empty, top and bottom; a ragged rectangle does not.
            [0, h - 1].every(
              (r) => span.lo[r]! - u0 >= w * ROUND_CORNER && u1 - span.hi[r]! >= w * ROUND_CORNER
            );
          const [y0, y1] = [span.start, span.start + h];
          const base = bodies[on]!.cls;
          // On the pitched roof only a gable stays (it runs back to the ridge); a flat slab would
          // float where the block's face was.
          const gable = bodies[on]!.roof === true && alongZ && w >= roofWidth * GABLE_MIN_SPAN;
          if (bodies[on]!.roof && !gable) continue;
          // The pitched roof is drawn once, as the roof: no roofing slab on the walls under it.
          if (roofWidth > 0 && roofing(c)) continue;
          const contrast = deltaE2000(palette.classes[c]!.lab, palette.classes[base]!.lab);
          candidates.push({
            weight: spanArea(span) * Math.min(1, contrast / DETAIL_FULL_DELTA_E),
            cells,
            proud: outward ? thick : -thick,
            solid: {
              role: 'detail',
              cls: c,
              shape: round
                ? 'cylinder'
                : fill >= DETAIL_BOX_FILL
                  ? 'box'
                  : alongZ
                    ? 'extrude'
                    : 'hull',
              ...(round ? { axis: alongZ ? ('z' as const) : ('x' as const) } : {}),
              box: alongZ
                ? { x0: u0, x1: u1 + 1, y0, y1, z0: a0, z1: a1 }
                : { x0: a0, x1: a1, y0, y1, z0: u0, z1: u1 + 1 },
              ...(alongZ ? { front: span } : { profile: span }),
              face: view,
              on,
              ...(gable ? { roof: true } : {}),
              visible: spanArea(span),
            },
          });
        }
      }
    }
  }
  // The most telling first: area weighted by how far the detail's colour is from the body under it.
  candidates.sort((a, b) => b.weight - a.weight);
  const details = candidates.slice(0, Math.max(0, SOLIDS_MAX - bodies.length));
  // Layers: the large slabs first, a slab lying on another one stands one layer prouder.
  const layers: Partial<Record<ViewName, Uint8Array>> = {};
  for (const d of [...details].sort((a, b) => b.cells.length - a.cells.length)) {
    const view = d.solid.face!;
    const layer = (layers[view] ??= new Uint8Array(shown[view]!.length));
    const votes = [0, 0, 0, 0];
    for (const [, cell] of d.cells) votes[Math.min(3, layer[cell]!)]!++;
    const under = votes.indexOf(Math.max(...votes));
    const lift = under * d.proud;
    const axis = view === 'front' || view === 'back' ? 'z' : 'x';
    if (d.proud > 0) d.solid.box[`${axis}1`] += lift;
    else d.solid.box[`${axis}0`] += lift;
    for (const [, cell] of d.cells) {
      layer[cell] = Math.min(3, under + 1);
      shown[view]![cell] = d.solid.cls;
    }
  }
  // Triangle budget: the main body keeps its fine skin, the least seen hulls become boxes.
  const main = bodies.reduce((best, s, i) => (s.visible > bodies[best]!.visible ? i : best), 0);
  const all = [...bodies, ...details.map((d) => d.solid)];
  const cost = (s: Solid, i: number) =>
    s.shape === 'hull' && i === main ? TRIANGLES.main : TRIANGLES[s.shape];
  let triangles = all.reduce((sum, s, i) => sum + cost(s, i), 0);
  const leastSeen = all
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => (s.shape === 'hull' || s.shape === 'extrude') && i !== main)
    .sort((a, b) => a.s.visible - b.s.visible);
  for (const { s } of leastSeen) {
    if (triangles <= TRIANGLE_BUDGET) break;
    triangles -= TRIANGLES[s.shape] - TRIANGLES.box;
    s.shape = 'box';
  }

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
      if (model[i] === group[target[i]!]) same++;
    }
    match[view] = object ? same / object : 0;
    cover[view] = object ? covered / object : 0;
  }
  return {
    solids: all,
    group,
    match,
    cover,
    counts: { volumes: volumes.length, details: details.length, hidden },
  };
}
