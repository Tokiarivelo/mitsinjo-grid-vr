/**
 * Fit by optimisation (PF-T6): the template parameters whose silhouette best matches the SAM mask.
 * θ = {width, depth, yaw, eave}; houses in a row stay as measured (PF-T3, PF-T4).
 * The model is rendered by a pure rasteriser (orthographic, turned by the yaw) at 128 px in the photo box,
 * scored `J = 1 − IoU + λ·chamfer + μ·prior` and minimised with Nelder–Mead from the PF-T3…T5 estimates.
 * Pure and deterministic; geometry only.
 */
import { hullSamplePoints } from '@/lib/hull';
import { expandGenerators } from '@/lib/object-generators';
import { outlineDetails } from '@/features/vision-insert/utils/view-assemblies';
import { kitToRecipe, uniformRoof, type ObjectKit } from '@/lib/object-kit';
import {
  fitRecipe,
  HIP_CLIP_MAX,
  MAX_YAW,
  type ObjectRecipe,
  type RecipePart,
} from '@/lib/object-shape';
import { nelderMead } from './nelder-mead';

/** Columns of the fit grid (rows follow the box aspect). */
export const FIT_COLUMNS = 128;
export const FIT_MAX_EVALS = 150;
/** Weight of the edge distance in J. */
const LAMBDA = 0.5;
/** Weight of the pull back to the measured start (keeps unseen values, e.g. depth seen head-on). */
const PRIOR = 0.02;
/**
 * Pull back to the measured yaw (per rad²): the silhouette barely shows the yaw, so the fit only refines
 * it (5° costs 0.008) and never invents a turn to fill the outline (golden car: 0° measured → 21°).
 */
const YAW_PRIOR = 1;

type Pt = readonly [number, number];
/** A filled grid: 1 = inside. */
export interface Mask {
  cols: number;
  rows: number;
  data: Uint8Array;
}

export const emptyMask = (cols: number, rows: number): Mask => ({
  cols,
  rows,
  data: new Uint8Array(cols * rows),
});

/** Fills `polys` (grid coordinates, even-odd over all of them) into `mask`, pixel centres sampled. */
export function fillPolygons(mask: Mask, polys: ReadonlyArray<ReadonlyArray<Pt>>): void {
  const xs: number[] = [];
  for (let r = 0; r < mask.rows; r++) {
    const y = r + 0.5;
    xs.length = 0;
    for (const p of polys) {
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [xi, yi] = p[i]!;
        const [xj, yj] = p[j]!;
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k]! - 0.5));
      const c1 = Math.min(mask.cols - 1, Math.floor(xs[k + 1]! - 0.5));
      for (let c = c0; c <= c1; c++) mask.data[r * mask.cols + c] = 1;
    }
  }
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: ReadonlyArray<Pt>): Pt[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: Pt[]) => {
    const h: Pt[] = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

const ROUND = 16;
const circle = (y: number, r = 0.5): Array<[number, number, number]> =>
  Array.from({ length: ROUND }, (_, i) => {
    const a = (2 * Math.PI * i) / ROUND;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  });

/** Points of a unit primitive (same as the viewer's `unitPart`) whose hull is its outline. */
function unitPoints(p: RecipePart): Array<[number, number, number]> {
  switch (p.shape) {
    case 'box':
      return [-0.5, 0.5].flatMap((x) =>
        [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z] as [number, number, number]))
      );
    case 'prism': {
      const r = Math.min(1, Math.max(0, p.apex ?? 0.5)) - 0.5;
      return [-0.5, 0.5].flatMap((z) => [
        [-0.5, -0.5, z] as [number, number, number],
        [0.5, -0.5, z] as [number, number, number],
        [r, 0.5, z] as [number, number, number],
      ]);
    }
    case 'hip': {
      const r = Math.min(1, Math.max(0, p.ridge ?? 0.5)) / 2;
      // Half-hip (PG-T22): the gable shoulders stick out beyond the base-to-ridge hull.
      const c = Math.min(HIP_CLIP_MAX, Math.max(0, p.clip ?? 0));
      return [
        ...[-0.5, 0.5].flatMap((x) =>
          [-0.5, 0.5].map((z) => [x, -0.5, z] as [number, number, number])
        ),
        ...(c > 0
          ? [-0.5, 0.5].flatMap((x) =>
              [-1, 1].map((sz) => [x, -0.5 + c, (sz * (1 - c)) / 2] as [number, number, number])
            )
          : []),
        [-r, 0.5, 0],
        [r, 0.5, 0],
      ];
    }
    case 'extrude': {
      const ring = p.points ?? [];
      if (ring.length < 3) return unitPoints({ ...p, shape: 'box' });
      return [-0.5, 0.5].flatMap((z) =>
        ring.map(([x, y]) => [x, y, z] as [number, number, number])
      );
    }
    case 'hull': {
      const pts = hullSamplePoints(p.points ?? [], p.section ?? []);
      return pts.length ? pts : unitPoints({ ...p, shape: 'box' });
    }
    case 'lathe': {
      const profile = p.profile ?? [];
      if (profile.length < 2) return unitPoints({ ...p, shape: 'box' });
      return profile.flatMap(([r, y]) =>
        r > 1e-9 ? circle(y, r) : [[0, y, 0] as [number, number, number]]
      );
    }
    case 'cylinder':
      return [...circle(-0.5), ...circle(0.5)];
    case 'cone':
      return [...circle(-0.5), [0, 0.5, 0]];
    case 'sphere':
      return [-0.4, -0.2, 0, 0.2, 0.4, -0.5, 0.5].flatMap((y) =>
        circle(y, Math.sqrt(Math.max(0, 0.25 - y * y)))
      );
  }
}

/** Row-major 3 × 3 matrix and translation: unit primitive point → view space (x right, y up, z to the camera). */
export interface PartTransform {
  m: readonly number[];
  t: readonly [number, number, number];
}

/** Axis swap of a cylinder / cone, as the viewer's `unitPart` rotation. */
const AXIS: Record<'x' | 'y' | 'z', readonly number[]> = {
  x: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  y: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  z: [1, 0, 0, 0, 0, -1, 0, 1, 0],
};

/**
 * Where a part's unit primitive lands in view space: axis swap, part size and place, object proportions,
 * then the yaw turn (three.js `rotateY`). Shared by the silhouette and the flat renderer.
 */
export function partTransform(recipe: ObjectRecipe, p: RecipePart): PartTransform {
  const { w, h, d } = recipe.proportions;
  const cos = Math.cos(recipe.yaw ?? 0);
  const sin = Math.sin(recipe.yaw ?? 0);
  const a = AXIS[p.axis ?? 'y'];
  const s = [p.size[0] * w, p.size[1] * h, p.size[2] * d];
  // World = diag(s)·A·u + at·dims; view = R_yaw·world.
  const row = (i: number) => [a[i * 3]! * s[i]!, a[i * 3 + 1]! * s[i]!, a[i * 3 + 2]! * s[i]!];
  const [x, y, z] = [row(0), row(1), row(2)];
  const [tx, ty, tz] = [p.at[0] * w, p.at[1] * h, p.at[2] * d];
  return {
    m: [
      ...x.map((v, k) => v * cos + z[k]! * sin),
      ...y,
      ...x.map((v, k) => -v * sin + z[k]! * cos),
    ],
    t: [tx * cos + tz * sin, ty, -tx * sin + tz * cos],
  };
}

export const applyTransform = (
  { m, t }: PartTransform,
  [x, y, z]: readonly [number, number, number]
): [number, number, number] => [
  m[0]! * x + m[1]! * y + m[2]! * z + t[0],
  m[3]! * x + m[4]! * y + m[5]! * z + t[1],
  m[6]! * x + m[7]! * y + m[8]! * z + t[2],
];

/**
 * Silhouette of a fitted recipe in the photo box (`aspect` = box width / height, pixels): the model's
 * height fills the rows, its width spans `h·aspect` across the columns, centred.
 */
export function renderRecipe(
  recipe: ObjectRecipe,
  aspect: number,
  cols: number,
  rows: number
): Mask {
  const { h } = recipe.proportions;
  const frameW = h * aspect;
  const mask = emptyMask(cols, rows);
  // Grown generators replace their hosts (PQ-T50): the fit sees the same leaves the judge does.
  // Details that stick out (mirrors, feet, gutters, wheel arches) are part of the outline (PQ-T20).
  const { parts: grown } = expandGenerators(recipe.parts);
  for (const p of [...grown, ...outlineDetails(grown)]) {
    const tf = partTransform(recipe, p);
    const pts = unitPoints(p).map((u) => {
      const [sx, y] = applyTransform(tf, u);
      return [((sx + frameW / 2) / frameW) * cols, ((h / 2 - y) / h) * rows] as const;
    });
    fillPolygons(mask, [convexHull(pts)]);
  }
  return mask;
}

/** SAM rings (photo fractions) → mask of the box at `cols` × `rows`. */
export function ringsMask(
  rings: ReadonlyArray<ReadonlyArray<Pt>>,
  box: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number
): Mask {
  const mask = emptyMask(cols, rows);
  fillPolygons(
    mask,
    rings.map((r) =>
      r.map(([x, y]) => [((x - box.x) / box.w) * cols, ((y - box.y) / box.h) * rows] as const)
    )
  );
  return mask;
}

/** Intersection over union of two masks of the same size (0 when both are empty). */
export function iou(a: Mask, b: Mask): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.data.length; i++) {
    inter += a.data[i]! & b.data[i]!;
    union += a.data[i]! | b.data[i]!;
  }
  return union ? inter / union : 0;
}

const isEdge = (m: Mask, c: number, r: number) => {
  if (!m.data[r * m.cols + c]) return false;
  if (c === 0 || r === 0 || c === m.cols - 1 || r === m.rows - 1) return true;
  const k = r * m.cols + c;
  return !m.data[k - 1] || !m.data[k + 1] || !m.data[k - m.cols] || !m.data[k + m.cols];
};

/** Distance (px, 3-4 chamfer / 3) from every pixel to the nearest edge pixel of `m`. */
export const edgeDistance = (m: Mask): Float32Array => distanceTo(maskEdges(m));

/** Boundary pixels of `m` (inside pixels touching the outside or the grid border). */
export function maskEdges(m: Mask): Mask {
  const edges = emptyMask(m.cols, m.rows);
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++) if (isEdge(m, c, r)) edges.data[r * m.cols + c] = 1;
  return edges;
}

/** Distance (px, 3-4 chamfer / 3) from every pixel to the nearest set pixel of `seeds` (huge when none). */
export function distanceTo(seeds: Mask): Float32Array {
  const { cols, rows } = seeds;
  const dist = new Float32Array(cols * rows).fill(1e6);
  for (let i = 0; i < dist.length; i++) if (seeds.data[i]) dist[i] = 0;
  const relax = (k: number, n: number, cost: number) => {
    if (dist[n]! + cost < dist[k]!) dist[k] = dist[n]! + cost;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (c > 0) relax(k, k - 1, 3);
      if (r > 0) {
        relax(k, k - cols, 3);
        if (c > 0) relax(k, k - cols - 1, 4);
        if (c < cols - 1) relax(k, k - cols + 1, 4);
      }
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const k = r * cols + c;
      if (c < cols - 1) relax(k, k + 1, 3);
      if (r < rows - 1) {
        relax(k, k + cols, 3);
        if (c < cols - 1) relax(k, k + cols + 1, 4);
        if (c > 0) relax(k, k + cols - 1, 4);
      }
    }
  }
  for (let i = 0; i < dist.length; i++) dist[i] = dist[i]! / 3;
  return dist;
}

/** Mean distance of `m`'s edge pixels to the target edges, share of the grid diagonal (1 when no edge). */
export function chamfer(m: Mask, targetDistance: Float32Array): number {
  let sum = 0;
  let n = 0;
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      if (isEdge(m, c, r)) {
        sum += targetDistance[r * m.cols + c]!;
        n++;
      }
    }
  }
  return n ? sum / n / Math.hypot(m.cols, m.rows) : 1;
}

/** Grid of the fit and the score: `FIT_COLUMNS` wide, rows following the box aspect (32 – 2 × columns). */
export function fitGrid(aspect: number): { cols: number; rows: number } {
  const cols = FIT_COLUMNS;
  return { cols, rows: clamp(Math.round(cols / aspect), 32, 2 * cols) };
}

export interface SilhouetteFit {
  recipe: ObjectRecipe;
  /** IoU of the fitted silhouette with the SAM mask (0–1, 2 decimals). */
  iou: number;
  /** IoU before the fit (the PF-T3…T5 estimates), for the logs. */
  iouStart: number;
  evals: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Best template parameters for `kit` against the SAM `rings` (photo fractions) of `box`. `aspect` = box
 * width / height (pixels); `yaw0` = PF-T5 estimate; `canYaw` = a yaw was measured on a straight-edged
 * archetype (a tree, or a facade without vanishing lines, is never turned). Houses: the eave moves. ≤ `FIT_MAX_EVALS` evaluations, stop when ΔJ < 1e-3. Null when the
 * mask is empty.
 */
export function fitSilhouette({
  kit,
  rings,
  box,
  aspect,
  yaw0 = 0,
  canYaw,
}: {
  kit: ObjectKit;
  rings: ReadonlyArray<ReadonlyArray<Pt>>;
  box: { x: number; y: number; w: number; h: number };
  aspect: number;
  yaw0?: number;
  canYaw: boolean;
}): SilhouetteFit | null {
  if (!(aspect > 0) || !rings.length) return null;
  const { cols, rows } = fitGrid(aspect);
  const target = ringsMask(rings, box, cols, rows);
  if (!target.data.some((v) => v)) return null;
  const targetDistance = edgeDistance(target);

  const house = kit.archetype === 'house';
  // Houses in a row stay as measured (PF-T3 gables, PF-T4 period): a flat outline must not gain gables.
  const roof = house ? (kit.roof ?? uniformRoof(Math.max(1, kit.details?.units ?? 1))) : null;
  const base: ObjectKit = roof ? { ...kit, roof } : kit;
  const eaveLo = roof ? Math.max(...roof.gables.map((g) => g.top)) + 0.05 : 0;
  const build = (x: number[]): ObjectRecipe => {
    const [lw, ld, yawRaw, eaveRaw] = x;
    const k: ObjectKit = roof
      ? { ...base, roof: { ...roof, eave: clamp(eaveRaw ?? roof.eave, eaveLo, 0.9) } }
      : base;
    const yaw = canYaw ? clamp(yawRaw ?? 0, -MAX_YAW, MAX_YAW) : 0;
    const fitted = fitRecipe(kitToRecipe(k), aspect, yaw);
    const sw = Math.exp(clamp(lw!, -0.7, 0.7));
    const sd = Math.exp(clamp(ld!, -1.2, 1.2));
    const p = fitted.proportions;
    const w = p.w * sw;
    const d = p.d * sd;
    const max = Math.max(w, p.h, d);
    return {
      ...fitted,
      proportions: {
        w: clamp(w / max, 0.01, 1),
        h: clamp(p.h / max, 0.01, 1),
        d: clamp(d / max, 0.01, 1),
      },
    };
  };
  const x0 = [0, 0, canYaw ? yaw0 : 0, ...(roof ? [roof.eave] : [])];
  const score = (x: number[]) => {
    const m = renderRecipe(build(x), aspect, cols, rows);
    const prior = PRIOR * (x[0]! ** 2 + x[1]! ** 2) + YAW_PRIOR * (x[2]! - x0[2]!) ** 2;
    return 1 - iou(m, target) + LAMBDA * chamfer(m, targetDistance) + prior;
  };
  const steps = [0.15, 0.3, canYaw ? 0.05 : 0, ...(roof ? [0.08] : [])];
  // A fixed coordinate (yaw of a tree) gets no step and stays put.
  const free = steps.map((s, i) => (s > 0 ? i : -1)).filter((i) => i >= 0);
  const expand = (y: number[]) => {
    const x = [...x0];
    free.forEach((i, k) => (x[i] = y[k]!));
    return x;
  };
  const run = nelderMead(
    (y) => score(expand(y)),
    free.map((i) => x0[i]!),
    free.map((i) => steps[i]!),
    { maxEvals: FIT_MAX_EVALS, tol: 1e-3 }
  );
  const recipe = build(expand(run.x));
  return {
    recipe,
    iou: round2(iou(renderRecipe(recipe, aspect, cols, rows), target)),
    iouStart: round2(iou(renderRecipe(build(x0), aspect, cols, rows), target)),
    evals: run.evals,
  };
}
