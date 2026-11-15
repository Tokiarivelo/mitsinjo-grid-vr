import { atlasUv, faceSlot, type AtlasView, type FaceView } from './face-atlas';

/**
 * Silhouette hull of a model built from its drawn views (PQ-T70): the exact intersection of the
 * front silhouette pushed through the depth and the side silhouette pushed through the width,
 * kept as stacked boxes on the reading grid (x left → right seen from the front, y top → bottom,
 * z back → front). A slope is a staircase one grid row high; its steps read the drawing like the
 * slope would, so seen from a drawing's side the model is that drawing. Shared by the server
 * (which measures the boxes) and the 3D view (which meshes them). Pure.
 */

/** One box, grid cells: [x0, x1, y0, y1, z0, z1], upper bounds excluded. */
export type HullBox = readonly [number, number, number, number, number, number];

export interface FaceHull {
  /** Grid size: width, height, depth, in cells. */
  grid: readonly [number, number, number];
  boxes: ReadonlyArray<HullBox>;
}

/** Most boxes a hull keeps (the smallest are dropped past it). */
export const HULL_BOXES_MAX = 2400;
/** A silhouette run shorter than this many cells is a stroke, not a volume. */
export const HULL_MIN_RUN = 2;

/** Runs [start, end) of set cells on row `y` of a mask, at least `HULL_MIN_RUN` long. */
export function maskRuns(mask: Uint8Array, cols: number, y: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= cols; x++) {
    const on = x < cols && mask[y * cols + x] === 1;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (x - start >= HULL_MIN_RUN) out.push([start, x]);
      start = -1;
    }
  }
  return out;
}

/** A rectangle of one grid row: [x0, x1, z0, z1], upper bounds excluded. */
export type RowRect = readonly [number, number, number, number];

/** On each row, every front run crossed with every side run: the silhouette hull, row by row. */
export function hullRows(
  front: { mask: Uint8Array; cols: number; rows: number },
  side: { mask: Uint8Array; cols: number; rows: number }
): RowRect[][] {
  const rows = Math.min(front.rows, side.rows);
  const out: RowRect[][] = [];
  for (let y = 0; y < rows; y++) {
    const zs = maskRuns(side.mask, side.cols, y);
    out.push(
      maskRuns(front.mask, front.cols, y).flatMap(([x0, x1]) =>
        zs.map(([z0, z1]): RowRect => [x0, x1, z0, z1])
      )
    );
  }
  return out;
}

/**
 * A pitched roof volume on the grid: `hip` rises from its whole box to a ridge along x (`ridge` =
 * its length, share of the width); `prism` is a gable, a triangle across x (`apex` = x of its top,
 * share of the width) kept along its whole depth. Boxes as `HullBox`.
 */
export interface RoofVolume {
  shape: 'hip' | 'prism';
  box: HullBox;
  ridge?: number;
  apex?: number;
}

/**
 * A roof whose silhouette hull fills, on average over its rows, more than this share of its
 * largest row is a block (a gable fills half, a hip a third to a half).
 */
export const ROOF_BLOCK_SHARE = 0.65;

const area = (rects: readonly RowRect[]) =>
  rects.reduce((t, r) => t + (r[1] - r[0]) * (r[3] - r[2]), 0);

const meet = (a: RowRect, b: RowRect): RowRect | null => {
  const r: RowRect = [
    Math.max(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  return r[1] - r[0] >= 1 && r[3] - r[2] >= 1 ? r : null;
};

/** Cross-section of a roof volume on row `y`; null outside its rows or when it closes. */
export function roofSection(roof: RoofVolume, y: number): RowRect | null {
  const [x0, x1, y0, y1, z0, z1] = roof.box;
  if (y < y0 || y >= y1) return null;
  // 0 at the eave, 1 at the ridge.
  const f = (y1 - (y + 0.5)) / (y1 - y0);
  let r: RowRect;
  if (roof.shape === 'hip') {
    const half = ((x1 - x0) / 2) * (1 - f * (1 - (roof.ridge ?? 0.5)));
    const deep = ((z1 - z0) / 2) * (1 - f);
    const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
    r = [
      Math.round(cx - half),
      Math.round(cx + half),
      Math.round(cz - deep),
      Math.round(cz + deep),
    ];
  } else {
    const top = x0 + (roof.apex ?? 0.5) * (x1 - x0);
    r = [Math.round(x0 + (top - x0) * f), Math.round(x1 + (top - x1) * f), z0, z1];
  }
  return r[1] - r[0] >= 1 && r[3] - r[2] >= 1 ? r : null;
}

/** A row this wide and deep, share of the widest and deepest rows, has reached the eave. */
export const EAVE_REACH = 0.93;

/**
 * The row under the eave between `top` and `bottom`: a roof ends where the silhouettes stop
 * widening, whatever the colours say (brick walls under clay tiles read as one class). The first
 * row from the top as wide and as deep as the widest closes the roof; `bottom` when none does, or
 * when the very first row is already full (a block roof: the silhouettes say nothing).
 */
export function eaveRow(rows: readonly RowRect[][], top: number, bottom: number): number {
  const extent = (rects: readonly RowRect[], lo: 0 | 2) =>
    rects.length
      ? Math.max(...rects.map((r) => r[lo + 1]!)) - Math.min(...rects.map((r) => r[lo]!))
      : 0;
  let [wide, deep] = [0, 0];
  for (let y = top; y < bottom; y++) {
    wide = Math.max(wide, extent(rows[y]!, 0));
    deep = Math.max(deep, extent(rows[y]!, 2));
  }
  for (let y = top; y < bottom; y++)
    if (extent(rows[y]!, 0) >= EAVE_REACH * wide && extent(rows[y]!, 2) >= EAVE_REACH * deep)
      // Full from its first row: a block, nothing to read on the silhouettes.
      return y === top ? bottom : y;
  return bottom;
}

/**
 * Two silhouettes cannot tell a roof with crossed ridges from a block. Where the hull of the
 * roof's rows is such a block, it is cut to the inferred roof volumes; what stands above the roof
 * (a chimney) runs down through it. A hull that already narrows toward the top is left as drawn.
 * Returns new rows.
 */
export function pitchRoof(rows: readonly RowRect[][], roofs: readonly RoofVolume[]): RowRect[][] {
  const hip = roofs.find((r) => r.shape === 'hip');
  if (!hip) return rows.map((r) => [...r]);
  const [, , y0, y1] = hip.box;
  const top = Math.max(0, y0);
  const bottom = eaveRow(rows, top, Math.min(rows.length, y1));
  const height = bottom - top;
  if (height < 4) return rows.map((r) => [...r]);
  const areas = rows.slice(top, bottom).map(area);
  const widest = Math.max(...areas);
  const mean = areas.reduce((t, v) => t + v, 0) / areas.length;
  if (!(widest > 0) || mean <= ROOF_BLOCK_SHARE * widest) return rows.map((r) => [...r]);
  const eaved: RoofVolume = {
    ...hip,
    box: [hip.box[0], hip.box[1], top, bottom, hip.box[4], hip.box[5]],
  };
  const above = top > 0 ? rows[top - 1]! : [];
  return rows.map((rects, y) => {
    if (y < top || y >= bottom) return [...rects];
    const allowed: RowRect[] = [...above];
    for (const roof of roofs) {
      // The hip ends at the eave found on the silhouettes, not at the foot of its colour class.
      const section = roofSection(roof === hip ? eaved : roof, y);
      if (section) allowed.push(section);
    }
    const out: RowRect[] = [];
    for (const rect of rects)
      for (const a of allowed) {
        const cut = meet(rect, a);
        if (cut && !out.some((o) => o.every((v, i) => v === cut[i]))) out.push(cut);
      }
    return out;
  });
}

/** A footprint covering less than this share of the grid is not trusted (a misread plan). */
export const FOOTPRINT_MIN_SHARE = 0.35;

/**
 * Rows cut to the object's footprint seen from above (`mask`: `cols` = width cells, `rows` =
 * depth cells, row 0 = back): an L-shaped or round plan is no longer filled to its bounding
 * rectangle. A footprint that covers too little of the grid is ignored. Returns new rows.
 */
export function clipFootprint(
  rows: readonly RowRect[][],
  footprint: { mask: Uint8Array; cols: number; rows: number }
): RowRect[][] {
  const { mask, cols, rows: depth } = footprint;
  let covered = 0;
  for (const v of mask) covered += v;
  if (covered < FOOTPRINT_MIN_SHARE * cols * depth) return rows.map((r) => [...r]);
  const cache = new Map<string, RowRect[]>();
  const cut = (r: RowRect): RowRect[] => {
    const key = r.join();
    const hit = cache.get(key);
    if (hit) return hit;
    const [x0, x1, z0, z1] = r;
    const out: Array<[number, number, number, number]> = [];
    let open = new Map<string, number>();
    for (let z = Math.max(0, z0); z < Math.min(depth, z1); z++) {
      const next = new Map<string, number>();
      let start = -1;
      for (let x = x0; x <= x1; x++) {
        const on = x < x1 && x < cols && mask[z * cols + x] === 1;
        if (on && start < 0) start = x;
        if (!on && start >= 0) {
          if (x - start >= HULL_MIN_RUN) {
            const k = `${start},${x}`;
            const at = open.get(k);
            if (at !== undefined) out[at]![3] = z + 1;
            else out.push([start, x, z, z + 1]);
            next.set(k, at ?? out.length - 1);
          }
          start = -1;
        }
      }
      open = next;
    }
    const kept = out.filter((o) => o[3] - o[2] >= HULL_MIN_RUN);
    cache.set(key, kept);
    return kept;
  };
  return rows.map((rects) => rects.flatMap((r) => cut(r)));
}

/** Rows above the first row this full (share of the fullest row) stand on the body: chimneys, masts. */
export const BODY_ROW_SHARE = 0.5;
/** A crossing is kept when the plan shows it this clearly, share of the clearest crossing. */
export const GHOST_KEEP_SHARE = 0.5;

/**
 * Two silhouettes put a chimney at every crossing of a front run and a side run: two chimneys
 * drawn on each elevation come out as four. Above the body, where several runs cross, only the
 * crossings the view from above shows are kept (`contrast` = how much the plan differs there
 * from what surrounds it), and at least one per run: nothing drawn on an elevation disappears.
 * Returns new rows.
 */
export function dropGhosts(
  rows: readonly RowRect[][],
  contrast: (rect: RowRect) => number
): RowRect[][] {
  const areas = rows.map(area);
  const full = Math.max(0, ...areas);
  const body = areas.findIndex((a) => a >= BODY_ROW_SHARE * full);
  const crossed = (rects: readonly RowRect[]) =>
    new Set(rects.map((r) => `${r[0]},${r[1]}`)).size >= 2 &&
    new Set(rects.map((r) => `${r[2]},${r[3]}`)).size >= 2;
  // Columns: the crossings of every crossed row above the body, joined where they overlap, so a
  // chimney is kept or dropped whole (its cap and its shaft are not the same rectangle).
  type Column = { box: [number, number, number, number]; score: number; kept: boolean };
  const columns: Column[] = [];
  const columnOf = new Map<RowRect, Column>();
  rows.forEach((rects, y) => {
    if (y >= body || !crossed(rects)) return;
    for (const r of rects) {
      const score = contrast(r);
      let col = columns.find(
        (c) => r[0] < c.box[1] && r[1] > c.box[0] && r[2] < c.box[3] && r[3] > c.box[2]
      );
      if (!col) columns.push((col = { box: [r[0], r[1], r[2], r[3]], score, kept: false }));
      else {
        col.box = [
          Math.min(col.box[0], r[0]),
          Math.max(col.box[1], r[1]),
          Math.min(col.box[2], r[2]),
          Math.max(col.box[3], r[3]),
        ];
        col.score = Math.max(col.score, score);
      }
      columnOf.set(r, col);
    }
  });
  if (!columns.length) return rows.map((r) => [...r]);
  const best = Math.max(...columns.map((c) => c.score));
  for (const c of columns) c.kept = c.score >= GHOST_KEEP_SHARE * best;
  // Every run of each elevation keeps its clearest column.
  rows.forEach((rects, y) => {
    if (y >= body || !crossed(rects)) return;
    for (const lo of [0, 2] as const)
      for (const key of new Set(rects.map((r) => `${r[lo]},${r[lo + 1]}`))) {
        const mine = rects.filter((r) => `${r[lo]},${r[lo + 1]}` === key);
        if (!mine.some((r) => columnOf.get(r)!.kept))
          columnOf.get(
            mine.reduce((p, r) => (columnOf.get(r)!.score > columnOf.get(p)!.score ? r : p))
          )!.kept = true;
      }
  });
  const dropped = columns.filter((c) => !c.kept);
  // A dropped column goes on every row: its shaft runs down between the roof slopes.
  const ghost = (r: RowRect) =>
    dropped.some(
      (c) =>
        r[0] >= c.box[0] - GHOST_MARGIN &&
        r[1] <= c.box[1] + GHOST_MARGIN &&
        r[2] >= c.box[2] - GHOST_MARGIN &&
        r[3] <= c.box[3] + GHOST_MARGIN
    );
  return rows.map((rects) => rects.filter((r) => !ghost(r)));
}

/** Cells a shaft may overhang the column it belongs to. */
const GHOST_MARGIN = 1;

/** Cells around a rectangle its colour is compared with. */
const CONTRAST_RING = 3;

/**
 * How much a rectangle of a view from above (`rgb`: `cols` = width, `rows` = depth) differs from
 * the ring around it: RGB distance of the two mean colours. A chimney on a roof stands out, a
 * ghost crossing is plain roof.
 */
export function planContrast(
  plan: { rgb: Uint8Array; cols: number; rows: number },
  rect: RowRect
): number {
  const [x0, x1, z0, z1] = rect;
  const inside = [0, 0, 0, 0];
  const around = [0, 0, 0, 0];
  for (let z = Math.max(0, z0 - CONTRAST_RING); z < Math.min(plan.rows, z1 + CONTRAST_RING); z++)
    for (
      let x = Math.max(0, x0 - CONTRAST_RING);
      x < Math.min(plan.cols, x1 + CONTRAST_RING);
      x++
    ) {
      const sum = x >= x0 && x < x1 && z >= z0 && z < z1 ? inside : around;
      const i = (z * plan.cols + x) * 3;
      sum[0]! += plan.rgb[i]!;
      sum[1]! += plan.rgb[i + 1]!;
      sum[2]! += plan.rgb[i + 2]!;
      sum[3]!++;
    }
  if (!inside[3] || !around[3]) return 0;
  return Math.hypot(
    inside[0]! / inside[3]! - around[0]! / around[3]!,
    inside[1]! / inside[3]! - around[1]! / around[3]!,
    inside[2]! / inside[3]! - around[2]! / around[3]!
  );
}

/** Rows stacked into boxes: a rectangle repeated on the next row grows its box. */
export function stackRows(rows: readonly RowRect[][], cols: number, depth: number): FaceHull {
  const boxes: Array<[number, number, number, number, number, number]> = [];
  let open = new Map<string, number>();
  rows.forEach((rects, y) => {
    const next = new Map<string, number>();
    for (const [x0, x1, z0, z1] of rects) {
      const key = `${x0},${x1},${z0},${z1}`;
      if (next.has(key)) continue;
      const at = open.get(key);
      if (at !== undefined) boxes[at]![3] = y + 1;
      else boxes.push([x0, x1, y, y + 1, z0, z1]);
      next.set(key, at ?? boxes.length - 1);
    }
    open = next;
  });
  const volume = (b: HullBox) => (b[1] - b[0]) * (b[3] - b[2]) * (b[5] - b[4]);
  const kept =
    boxes.length > HULL_BOXES_MAX
      ? [...boxes].sort((a, b) => volume(b) - volume(a)).slice(0, HULL_BOXES_MAX)
      : boxes;
  return { grid: [cols, rows.length, depth], boxes: kept };
}

/**
 * The hull of two silhouettes sharing their rows, cut to the inferred pitched roof when given,
 * then to the footprint seen from above when given; with `contrast` (read on that view) the
 * ghost crossings above the body are dropped.
 */
export function silhouetteHull(
  front: { mask: Uint8Array; cols: number; rows: number },
  side: { mask: Uint8Array; cols: number; rows: number },
  roofs: readonly RoofVolume[] = [],
  footprint?: { mask: Uint8Array; cols: number; rows: number },
  contrast?: (rect: RowRect) => number
): FaceHull {
  let rows = hullRows(front, side);
  if (roofs.length) rows = pitchRoof(rows, roofs);
  if (footprint) rows = clipFootprint(rows, footprint);
  if (contrast) rows = dropGhosts(rows, contrast);
  return stackRows(rows, front.cols, side.cols);
}

/** The surfaces of a hull an operator can restyle: what slopes or faces the sky, then each wall. */
export const HULL_SURFACES = ['roof', 'front', 'right', 'back', 'left'] as const;
export type HullSurface = (typeof HULL_SURFACES)[number];

/** A row is roof when the hull is this much smaller on it than `ROOF_ROW_SPAN` rows lower. */
export const ROOF_ROW_SHRINK = 0.96;
export const ROOF_ROW_SPAN = 3;

/**
 * Rows of a hull that slope (1 = roof): the section shrinks steadily toward the top, where a wall
 * keeps its section. Read on the boxes alone, so it holds for any hull.
 */
export function roofRows(hull: FaceHull): Uint8Array {
  const H = hull.grid[1];
  const areas = new Float64Array(H);
  for (const [x0, x1, y0, y1, z0, z1] of hull.boxes)
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) areas[y]! += (x1 - x0) * (z1 - z0);
  let last = H - 1;
  while (last > 0 && !areas[last]) last--;
  const out = new Uint8Array(H);
  for (let y = 0; y <= last; y++) {
    const below = areas[Math.min(last, y + ROOF_ROW_SPAN)]!;
    if (areas[y]! > 0 && areas[y]! <= ROOF_ROW_SHRINK * below) out[y] = 1;
  }
  return out;
}

export interface HullMesh {
  /** Surface of each triangle, index in `HULL_SURFACES`. */
  surface: Uint8Array;
  /** Triangle soup, object units (the grid stretched to `dims`, centred, y up). */
  position: Float32Array;
  normal: Float32Array;
  /** Atlas uvs (`lib/face-atlas.ts`). */
  uv: Float32Array;
}

/** Rows a cap reads inside the drawing, away from the outline stroke of its edge. */
const CAP_INSET_ROWS = 1.5;

/**
 * The boxes as a mesh wearing the drawings. A wall reads the drawing that faces it. A step (the
 * part of a box top or underside its neighbour does not cover) reads the drawing its staircase
 * faces, on the row of its own riser; a free top or underside reads the front a little inside.
 * `views` = drawings in the atlas: a missing one borrows the opposite one (same tile frame).
 */
export function hullMesh(
  hull: FaceHull,
  dims: readonly [number, number, number],
  views: ReadonlyArray<AtlasView>
): HullMesh {
  const [W, H, D] = hull.grid;
  const has = new Set<AtlasView>(views);
  const fromAbove = has.has('top');
  const tile = (v: FaceView): FaceView => {
    if (has.has(v)) return v;
    const other = ({ front: 'back', back: 'front', right: 'left', left: 'right' } as const)[v];
    return has.has(other) ? other : (views.find((w): w is FaceView => w !== 'top') ?? 'front');
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const surfaces: number[] = [];
  const sloped = roofRows(hull);
  /** A box is roof when most of its rows slope. */
  const isRoof = (b: HullBox) => {
    let n = 0;
    for (let y = b[2]; y < b[3]; y++) n += sloped[y] ?? 0;
    return n * 2 > b[3] - b[2];
  };
  const ROOF = 0;
  const wallOf = (v: FaceView) => HULL_SURFACES.indexOf(v);
  /** A grid point with the row its colour is read on. */
  const vertex = (
    x: number,
    y: number,
    z: number,
    view: FaceView,
    row: number,
    n: readonly [number, number, number]
  ) => {
    pos.push((x / W - 0.5) * dims[0], (0.5 - y / H) * dims[1], (z / D - 0.5) * dims[2]);
    nrm.push(n[0], n[1], n[2]);
    const s = view === 'front' || view === 'back' ? x / W : z / D;
    const [u, v] = atlasUv(faceSlot(tile(view)), s, Math.min(1, Math.max(0, row / H)));
    uvs.push(u, v);
  };
  type P = readonly [number, number, number];
  /** Quad a → b → c → d, counter-clockwise seen from outside. `row` null = each vertex's own y. */
  const quad = (
    a: P,
    b: P,
    c: P,
    d: P,
    view: FaceView,
    n: readonly [number, number, number],
    row: number | null,
    surface: number
  ) => {
    for (const p of [a, b, c, a, c, d]) vertex(p[0], p[1], p[2], view, row ?? p[1], n);
    surfaces.push(surface, surface);
  };
  const tops = new Map<number, HullBox[]>();
  const bottoms = new Map<number, HullBox[]>();
  for (const b of hull.boxes) {
    (tops.get(b[2]) ?? tops.set(b[2], []).get(b[2])!).push(b);
    (bottoms.get(b[3]) ?? bottoms.set(b[3], []).get(b[3])!).push(b);
  }
  const cuts = (lo: number, hi: number, values: number[]) =>
    [...new Set([lo, hi, ...values.filter((v) => v > lo && v < hi)])].sort((p, q) => p - q);
  /** Horizontal face of `b` at row `y`, less what `others` cover; `up` = it faces the sky. */
  const cap = (b: HullBox, y: number, others: HullBox[], up: boolean) => {
    const [x0, x1, , , z0, z1] = b;
    const over = others.filter((o) => o[0] < x1 && o[1] > x0 && o[4] < z1 && o[5] > z0);
    const xs = cuts(
      x0,
      x1,
      over.flatMap((o) => [o[0], o[1]])
    );
    const zs = cuts(
      z0,
      z1,
      over.flatMap((o) => [o[4], o[5]])
    );
    const n = [0, up ? 1 : -1, 0] as const;
    // The row of this box's own riser at that face.
    const riser = up ? y + 0.5 : y - 0.5;
    for (let i = 0; i + 1 < xs.length; i++)
      for (let k = 0; k + 1 < zs.length; k++) {
        const [ax, bx, az, bz] = [xs[i]!, xs[i + 1]!, zs[k]!, zs[k + 1]!];
        const [cx, cz] = [(ax + bx) / 2, (az + bz) / 2];
        if (over.some((o) => cx > o[0] && cx < o[1] && cz > o[4] && cz < o[5])) continue;
        let view: FaceView = 'front';
        let row = up ? y + CAP_INSET_ROWS : y - CAP_INSET_ROWS;
        let best = Infinity;
        for (const o of over) {
          // How far the cell lies beyond each side of the neighbour: the nearest side wins.
          const sides: Array<[FaceView, number]> = [
            ['front', cz - o[5]],
            ['back', o[4] - cz],
            ['right', cx - o[1]],
            ['left', o[0] - cx],
          ];
          for (const [v, gap] of sides)
            if (gap >= 0 && gap < best) {
              best = gap;
              view = v;
              row = riser;
            }
        }
        const corners: [P, P, P, P] = up
          ? [
              [ax, y, bz],
              [bx, y, bz],
              [bx, y, az],
              [ax, y, az],
            ]
          : [
              [ax, y, az],
              [bx, y, az],
              [bx, y, bz],
              [ax, y, bz],
            ];
        // Seen from above: the view from above is its drawing (tile rows run back → front).
        if (up && fromAbove) {
          for (const k of [0, 1, 2, 0, 2, 3] as const) {
            const p = corners[k];
            pos.push(
              (p[0] / W - 0.5) * dims[0],
              (0.5 - p[1] / H) * dims[1],
              (p[2] / D - 0.5) * dims[2]
            );
            nrm.push(0, 1, 0);
            uvs.push(...atlasUv(faceSlot('top'), p[0] / W, p[2] / D));
          }
          surfaces.push(ROOF, ROOF);
          continue;
        }
        // What faces the sky is roof; an underside follows its box.
        quad(...corners, view, n, row, up || isRoof(b) ? ROOF : wallOf(view));
      }
  };
  for (const b of hull.boxes) {
    const [x0, x1, y0, y1, z0, z1] = b;
    const roof = isRoof(b);
    const on = (v: FaceView) => (roof ? ROOF : wallOf(v));
    quad(
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y0, z1],
      [x0, y0, z1],
      'front',
      [0, 0, 1],
      null,
      on('front')
    );
    quad(
      [x1, y1, z0],
      [x0, y1, z0],
      [x0, y0, z0],
      [x1, y0, z0],
      'back',
      [0, 0, -1],
      null,
      on('back')
    );
    quad(
      [x1, y1, z1],
      [x1, y1, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      'right',
      [1, 0, 0],
      null,
      on('right')
    );
    quad(
      [x0, y1, z0],
      [x0, y1, z1],
      [x0, y0, z1],
      [x0, y0, z0],
      'left',
      [-1, 0, 0],
      null,
      on('left')
    );
    cap(b, y0, bottoms.get(y0) ?? [], true);
    cap(b, y1, tops.get(y1) ?? [], false);
  }
  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    uv: new Float32Array(uvs),
    surface: Uint8Array.from(surfaces),
  };
}
