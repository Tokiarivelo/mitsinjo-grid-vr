import { mulberry32 } from '@/lib/seeded-random';
import type { GrayGrid } from './repetition';

/**
 * Perspective of the object (PF-T5): how far its front is turned away from the camera (yaw). Pure and
 * deterministic (seeded RANSAC). Sobel gradients → Hough lines → segments (≥ 20 px) → vanishing points
 * of the non-vertical segments by RANSAC → yaw from the strongest one. Two orthogonal vanishing points
 * also give the focal length; otherwise a phone-like default is used.
 */

export interface Segment2 {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type Vec3 = [number, number, number];

/** Fewest segments that must meet at a vanishing point for it to count. */
export const MIN_VP_INLIERS = 8;
/** A segment belongs to a vanishing point when it points at it within this angle (degrees). */
const VP_ANGLE_DEG = 2;
/** Shortest segment kept (grid pixels). */
export const MIN_SEGMENT_PX = 20;
/** Segments within this of vertical are walls / posts, not facade lines (degrees). */
const VERTICAL_DEG = 12;
/** Focal length without two vanishing points, share of the photo's long side (≈ 26 mm phone lens). */
export const DEFAULT_FOCAL = 0.8;
export const MAX_YAW_DEG = 60;
/** Below this the facade counts as facing the camera: far vanishing points are ill-conditioned. */
export const MIN_YAW_DEG = 6;
const RANSAC_ROUNDS = 400;

/** Sobel magnitude and gradient angle (radians) per pixel; zero outside the mask. */
export function sobel(g: GrayGrid): { mag: Float32Array; angle: Float32Array } {
  const { width: W, height: H, gray, mask } = g;
  const mag = new Float32Array(W * H);
  const angle = new Float32Array(W * H);
  const at = (x: number, y: number) =>
    gray[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]!;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const gx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      mag[y * W + x] = Math.hypot(gx, gy) / 4;
      angle[y * W + x] = Math.atan2(gy, gx);
    }
  }
  return { mag, angle };
}

/**
 * Total least squares line through pixels (x, y interleaved), as a segment between the extreme
 * projections; null when shorter than `MIN_SEGMENT_PX`.
 */
export function fitSegment(px: ArrayLike<number>): Segment2 | null {
  const n = px.length / 2;
  if (n < 2) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += px[2 * i]!;
    my += px[2 * i + 1]!;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = px[2 * i]! - mx;
    const dy = px[2 * i + 1]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(phi);
  const uy = Math.sin(phi);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = (px[2 * i]! - mx) * ux + (px[2 * i + 1]! - my) * uy;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  if (hi - lo < MIN_SEGMENT_PX) return null;
  return { x1: mx + lo * ux, y1: my + lo * uy, x2: mx + hi * ux, y2: my + hi * uy };
}

const angleGap = (a: number, b: number) => {
  // Undirected angle difference in [0, π/2].
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
};

/**
 * Straight segments of the grid: edge pixels (strongest 12 %, magnitude ≥ 0.08) vote in a Hough
 * accumulator near their gradient normal (±8°); each peak is walked along the line and its runs of
 * agreeing edge pixels (gaps ≤ 3 px, length ≥ `MIN_SEGMENT_PX`) become segments. Grid pixel coordinates.
 */
export function detectSegments(g: GrayGrid, maxLines = 60): Segment2[] {
  const { width: W, height: H } = g;
  const { mag, angle } = sobel(g);
  const sorted = Float32Array.from(mag.filter((m) => m > 0)).sort();
  if (!sorted.length) return [];
  const thr = Math.max(0.08, sorted[Math.floor(sorted.length * 0.88)] ?? 0);
  const edge = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) edge[i] = mag[i]! >= thr ? 1 : 0;

  const T = 180;
  const diag = Math.ceil(Math.hypot(W, H));
  const R = 2 * diag + 1;
  const acc = new Uint16Array(T * R);
  const cos = Float64Array.from({ length: T }, (_, t) => Math.cos((t * Math.PI) / T));
  const sin = Float64Array.from({ length: T }, (_, t) => Math.sin((t * Math.PI) / T));
  const spread = 8;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!edge[y * W + x]) continue;
      // The line's normal is the gradient direction, folded into [0, π).
      let a = angle[y * W + x]!;
      if (a < 0) a += Math.PI;
      const t0 = Math.round((a * T) / Math.PI);
      for (let k = -spread; k <= spread; k++) {
        const t = (((t0 + k) % T) + T) % T;
        const r = Math.round(x * cos[t]! + y * sin[t]!) + diag;
        acc[t * R + r]!++;
      }
    }
  }

  // Peaks: local maxima (5 × 5, θ wraps) with ≥ MIN_SEGMENT_PX votes, strongest first.
  const peaks: Array<{ t: number; r: number; v: number }> = [];
  for (let t = 0; t < T; t++) {
    for (let r = 0; r < R; r++) {
      const v = acc[t * R + r]!;
      if (v < MIN_SEGMENT_PX) continue;
      let max = true;
      for (let dt = -2; dt <= 2 && max; dt++) {
        for (let dr = -2; dr <= 2; dr++) {
          if (!dt && !dr) continue;
          const tt = (((t + dt) % T) + T) % T;
          const rr = r + dr;
          if (rr < 0 || rr >= R) continue;
          const o = acc[tt * R + rr]!;
          if (o > v || (o === v && tt * R + rr < t * R + r)) {
            max = false;
            break;
          }
        }
      }
      if (max) peaks.push({ t, r, v });
    }
  }
  peaks.sort((p, q) => q.v - p.v || p.t - q.t || p.r - q.r);

  const segments: Segment2[] = [];
  const tol = (10 * Math.PI) / 180;
  for (const { t, r } of peaks.slice(0, maxLines)) {
    const theta = (t * Math.PI) / T;
    const rho = r - diag;
    const c = cos[t]!;
    const s = sin[t]!;
    // Line points: (x, y) = rho·(c, s) + u·(−s, c).
    const x0 = rho * c;
    const y0 = rho * s;
    /** Edge pixels of the current run, refitted into the segment (Hough angles are 1° steps). */
    let px: number[] = [];
    const near = (u: number) => {
      for (let off = -1; off <= 1; off++) {
        const x = Math.round(x0 - u * s + off * c);
        const y = Math.round(y0 + u * c + off * s);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        let a = angle[i]!;
        if (a < 0) a += Math.PI;
        if (edge[i] && angleGap(a, theta) < tol) {
          px.push(x, y);
          return true;
        }
      }
      return false;
    };
    // `u` runs over negative values too: no sentinel number for « no run ».
    let start: number | null = null;
    let last = 0;
    const flush = () => {
      if (start !== null && last - start >= MIN_SEGMENT_PX) {
        const seg = fitSegment(px);
        if (seg) segments.push(seg);
      }
      start = null;
      px = [];
    };
    for (let u = -diag; u <= diag; u++) {
      if (near(u)) {
        start ??= u;
        last = u;
      } else if (start !== null && u - last > 3) flush();
      else if (start === null) px = [];
    }
    flush();
  }
  return segments;
}

/** Lines of a vanishing point must sit this far apart (share of the box height) at the box centre. */
export const MIN_LINE_SPREAD = 0.1;

/**
 * Vertical spread (px) of `segments`' lines at column `x`: lines of one facade sit at different heights
 * (eave, window rows, ground). Copies of one strong edge (Hough finds it several times with a pixel of
 * tilt) stay within a pixel or two and cross just outside the box: a false near vanishing point
 * (golden cottage row: the eave line → 60°). Independent of how far the point is.
 */
export function lineSpread(segments: readonly Segment2[], x: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    if (Math.abs(dx) < 1e-9) continue;
    const y = s.y1 + ((x - s.x1) * (s.y2 - s.y1)) / dx;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi > lo ? hi - lo : 0;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Homogeneous line through a segment, normalised so a² + b² = 1. */
function lineOf(s: Segment2): Vec3 {
  const l = cross([s.x1, s.y1, 1], [s.x2, s.y2, 1]);
  const n = Math.hypot(l[0], l[1]) || 1;
  return [l[0] / n, l[1] / n, l[2] / n];
}

/** Angle (radians) between a segment and the direction from its midpoint to the (homogeneous) point `v`. */
function pointingError(s: Segment2, v: Vec3): number {
  const mx = (s.x1 + s.x2) / 2;
  const my = (s.y1 + s.y2) / 2;
  const dx = v[0] - mx * v[2];
  const dy = v[1] - my * v[2];
  const ux = s.x2 - s.x1;
  const uy = s.y2 - s.y1;
  const n = Math.hypot(dx, dy) * Math.hypot(ux, uy);
  if (n < 1e-12) return Math.PI / 2;
  return Math.acos(Math.min(1, Math.abs(dx * ux + dy * uy) / n));
}

/** Smallest eigenvector of a symmetric 3 × 3 matrix (Jacobi rotations). */
function smallestEigenvector(m: number[][]): Vec3 {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      if (Math.abs(a[p]![q]!) < 1e-15) continue;
      const th = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!;
        const akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq;
        a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!;
        const aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk;
        a[q]![k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!;
        const vkq = v[k]![q]!;
        v[k]![p] = c * vkp - s * vkq;
        v[k]![q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 3; i++) if (a[i]![i]! < a[best]![best]!) best = i;
  return [v[0]![best]!, v[1]![best]!, v[2]![best]!];
}

export interface VanishingPoint {
  /** Homogeneous point (w = 0: at infinity, lines parallel on the photo). */
  v: Vec3;
  inliers: number[];
  /** Total length of the inlier segments (px). */
  support: number;
}

/**
 * Best vanishing point of `segments` by RANSAC (pairs of segments, score = inlier length), refined by
 * least squares on its inliers. `reject(v)` drops hypotheses (a point inside the object box), and so do
 * points whose lines all sit at one height (`spreadAt`: copies of one edge). Null under
 * `MIN_VP_INLIERS` inliers.
 */
export function ransacVanishingPoint(
  segments: Segment2[],
  {
    seed = 1,
    reject,
    spreadAt,
  }: {
    seed?: number;
    reject?: (v: Vec3) => boolean;
    /** Column and smallest spread (px) of the inlier lines there (`lineSpread`); none = not checked. */
    spreadAt?: { x: number; min: number };
  } = {}
): VanishingPoint | null {
  if (segments.length < MIN_VP_INLIERS) return null;
  const spread = (inliers: number[]) =>
    !spreadAt ||
    lineSpread(
      inliers.map((k) => segments[k]!),
      spreadAt.x
    ) >= spreadAt.min;
  const lines = segments.map(lineOf);
  const lengths = segments.map((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
  const tol = (VP_ANGLE_DEG * Math.PI) / 180;
  const inliersOf = (v: Vec3) => segments.flatMap((s, i) => (pointingError(s, v) < tol ? [i] : []));
  const rnd = mulberry32(seed);
  let best: VanishingPoint | null = null;
  for (let round = 0; round < RANSAC_ROUNDS; round++) {
    const i = Math.floor(rnd() * lines.length);
    const j = Math.floor(rnd() * lines.length);
    if (i === j) continue;
    const v = cross(lines[i]!, lines[j]!);
    if (Math.hypot(...v) < 1e-12 || reject?.(v)) continue;
    const inliers = inliersOf(v);
    const support = inliers.reduce((s, k) => s + lengths[k]!, 0);
    if (best && support <= best.support) continue;
    if (!spread(inliers)) continue;
    best = { v, inliers, support };
  }
  if (!best || best.inliers.length < MIN_VP_INLIERS) return null;
  // Refine: v minimising Σ wᵢ (lᵢ · v)² with |v| = 1.
  const m = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const k of best.inliers) {
    const l = lines[k]!;
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) m[a]![b] = m[a]![b]! + lengths[k]! * l[a]! * l[b]!;
  }
  const refined = smallestEigenvector(m);
  if (!reject?.(refined)) {
    const inliers = inliersOf(refined);
    const support = inliers.reduce((s, k) => s + lengths[k]!, 0);
    if (spread(inliers) && inliers.length >= best.inliers.length) {
      best = { v: refined, inliers, support };
    }
  }
  return best;
}

/** Facade yaw (radians, + = right end farther) from a horizontal vanishing point, in photo pixels. */
export function yawFromVanishingPoint(v: Vec3, cx: number, focal: number): number {
  // Same point with w ≥ 0; the facade's horizontal direction is then (vx − cx·w, ·, −f·w) in scene axes.
  const [x, , w] = v[2] < 0 ? [-v[0], -v[1], -v[2]] : v;
  const dx = x - cx * w;
  if (Math.abs(dx) < 1e-12) return w > 0 ? Math.sign(dx || 1) * (Math.PI / 2) : 0;
  return Math.sign(dx) * Math.atan2(focal * w, Math.abs(dx));
}

export interface Perspective {
  /** Radians, clamped to ± `MAX_YAW_DEG`; 0 = facing the camera (also under `MIN_YAW_DEG`). */
  yaw: number;
  /** Focal length used (photo pixels) and whether it was measured from two vanishing points. */
  focal: number;
  focalMeasured: boolean;
  /** Inliers of the facade vanishing point (confidence, PF-T7), and of the second facade (0 = one facade). */
  inliers: number;
  inliersSide: number;
}

/**
 * Yaw of the object on the photo. `grid` covers `box` (photo fractions) of a `photoW` × `photoH` photo.
 * Null when fewer than `MIN_VP_INLIERS` facade lines meet: then the model stays facing the camera.
 */
export function measurePerspective(
  grid: GrayGrid,
  box: { x: number; y: number; w: number; h: number },
  photoW: number,
  photoH: number,
  /** Rows of the box to read lines on (fractions, y down): a house's walls, not its sloping gables. */
  rows: readonly [number, number] = [0, 1]
): Perspective | null {
  const inRows = (s: Segment2) =>
    Math.min(s.y1, s.y2) >= rows[0] * grid.height - 0.5 &&
    Math.max(s.y1, s.y2) <= rows[1] * grid.height + 0.5;
  const sx = (box.w * photoW) / grid.width;
  const sy = (box.h * photoH) / grid.height;
  const ox = box.x * photoW;
  const oy = box.y * photoH;
  const toPhoto = (s: Segment2): Segment2 => ({
    x1: ox + (s.x1 + 0.5) * sx,
    y1: oy + (s.y1 + 0.5) * sy,
    x2: ox + (s.x2 + 0.5) * sx,
    y2: oy + (s.y2 + 0.5) * sy,
  });
  const vertical = (s: Segment2) =>
    Math.abs(Math.atan2(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1))) <
    (VERTICAL_DEG * Math.PI) / 180;
  const segs = detectSegments(grid)
    .filter(inRows)
    .map(toPhoto)
    .filter((s) => !vertical(s));
  // A facade's vanishing point is never on the object itself.
  const reject = ([x, y, w]: Vec3) =>
    Math.abs(w) > 1e-9 &&
    x / w > ox &&
    x / w < ox + box.w * photoW &&
    y / w > oy &&
    y / w < oy + box.h * photoH;
  const spreadAt = {
    x: ox + (box.w * photoW) / 2,
    min: MIN_LINE_SPREAD * box.h * photoH,
  };
  const first = ransacVanishingPoint(segs, { seed: 1, reject, spreadAt });
  if (!first) return null;
  const used = new Set(first.inliers);
  const second = ransacVanishingPoint(
    segs.filter((_, i) => !used.has(i)),
    { seed: 2, reject, spreadAt }
  );

  const cx = photoW / 2;
  const cy = photoH / 2;
  const long = Math.max(photoW, photoH);
  let focal = DEFAULT_FOCAL * long;
  let focalMeasured = false;
  const finite = (v: Vec3) => Math.abs(v[2]) > 1e-9;
  if (second && finite(first.v) && finite(second.v)) {
    // Two orthogonal directions: (v₁ − c)·(v₂ − c) + f² = 0.
    const a = [first.v[0] / first.v[2] - cx, first.v[1] / first.v[2] - cy];
    const b = [second.v[0] / second.v[2] - cx, second.v[1] / second.v[2] - cy];
    const f2 = -(a[0]! * b[0]! + a[1]! * b[1]!);
    if (f2 > (0.4 * long) ** 2 && f2 < (3 * long) ** 2) {
      focal = Math.sqrt(f2);
      focalMeasured = true;
    }
  }
  const max = (MAX_YAW_DEG * Math.PI) / 180;
  const raw = Math.max(-max, Math.min(max, yawFromVanishingPoint(first.v, cx, focal)));
  const yaw = Math.abs(raw) < (MIN_YAW_DEG * Math.PI) / 180 ? 0 : raw;
  return {
    yaw,
    focal: Math.round(focal),
    focalMeasured,
    inliers: first.inliers.length,
    inliersSide: second?.inliers.length ?? 0,
  };
}
